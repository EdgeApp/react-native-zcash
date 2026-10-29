import { execFile } from 'child_process'
import { readdir, stat } from 'fs/promises'
import { join, relative } from 'path'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/**
 * Mach-O section attribute meaning "this section contains only instructions".
 * See `S_ATTR_PURE_INSTRUCTIONS` in <mach-o/loader.h>.
 */
const S_ATTR_PURE_INSTRUCTIONS = 0x80000000

/**
 * The `__TEXT` sections that legitimately hold data rather than code, so the
 * missing instruction attribute says nothing about them. Anything else landing
 * in `__TEXT` is assumed to be code, which is the safe direction: a new data
 * section fails the build until somebody adds it here, while a new code section
 * cannot slip through unflagged.
 */
const dataSections = new Set([
  '__const',
  '__cstring',
  '__dof',
  '__eh_frame',
  '__gcc_except_tab',
  '__info_plist',
  '__literal4',
  '__literal8',
  '__literal16',
  '__objc_classname',
  '__objc_methname',
  '__objc_methtype',
  '__oslogstring',
  '__ustring'
])

interface Section {
  library: string
  member: string
  arch: string
  segment: string
  section: string
  flags: number
}

/**
 * Walks an xcframework and fails if any slice carries code in a `__TEXT`
 * section the linker will not recognize as code.
 *
 * A section without `S_ATTR_PURE_INSTRUCTIONS` is sorted past every real code
 * section, at the far end of `__TEXT`, and ld will not plant a branch island
 * into it. Once the app's `__TEXT` grows past the +/-128MB reach of an arm64
 * `B`/`BL`, every call into that section fails to link with an `arm64_b26`
 * fixup error. The monero-vendored LMDB shipped exactly this bug for years
 * through its `ESECT` macro, and it only surfaced once four large native wallet
 * libraries shared one binary. Catching it here keeps the next one from
 * reaching a consumer's link.
 */
export async function checkCodeSections(
  xcframeworkPath: string
): Promise<void> {
  const libraries = await findArchives(xcframeworkPath)
  if (libraries.length === 0) {
    throw new Error(`No static libraries found in ${xcframeworkPath}`)
  }

  const bad: Section[] = []
  for (const library of libraries) {
    for (const arch of await getArchs(library)) {
      for (const section of await readSections(library, arch)) {
        if (section.segment !== '__TEXT') continue
        if (dataSections.has(section.section)) continue
        if ((section.flags & S_ATTR_PURE_INSTRUCTIONS) !== 0) continue
        bad.push(section)
      }
    }
    console.log(`Checked code sections in ${library}`)
  }

  if (bad.length > 0) {
    const lines = bad.map(
      row =>
        `  (${row.segment},${row.section}) flags 0x${row.flags
          .toString(16)
          .padStart(8, '0')} in ${relative(xcframeworkPath, row.library)}(${
          row.member
        }) [${row.arch}]`
    )
    // Dedupe, since one section repeats across every object that defines it:
    const unique = [...new Set(lines)]
    throw new Error(
      `${unique.length} __TEXT section(s) are not flagged as code:\n` +
        unique.join('\n') +
        '\nSpell the section out in full ' +
        '(`segment,section,regular,pure_instructions`), or let the code live ' +
        'in __text. Add the section to `dataSections` if it really holds data.'
    )
  }
}

async function findArchives(path: string): Promise<string[]> {
  const found: string[] = []
  for (const name of await readdir(path)) {
    const child = join(path, name)
    if ((await stat(child)).isDirectory()) {
      found.push(...(await findArchives(child)))
    } else if (name.endsWith('.a')) {
      found.push(child)
    }
  }
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

async function getArchs(library: string): Promise<string[]> {
  const { stdout } = await execFileAsync('lipo', ['-archs', library])
  return stdout.trim().split(/\s+/)
}

/**
 * Reads the section table of every member of one architecture slice.
 *
 * `otool -l` accepts an archive directly and prints a header line naming each
 * member, so there is no need to unpack the archive to a temporary directory.
 */
async function readSections(library: string, arch: string): Promise<Section[]> {
  const { stdout } = await execFileAsync(
    'otool',
    ['-arch', arch, '-l', library],
    { maxBuffer: 1 << 30 }
  )

  const out: Section[] = []
  let member = library
  let segment: string | undefined
  let section: string | undefined
  for (const line of stdout.split('\n')) {
    const memberMatch = /^.*\((.*\.o)\):$/.exec(line)
    if (memberMatch != null) {
      member = memberMatch[1]
      continue
    }

    const fields = line.trim().split(/\s+/)
    if (fields[0] === 'Section') {
      // A section header always restates both names, so drop anything stale
      // from the enclosing segment's load command:
      segment = undefined
      section = undefined
    } else if (fields[0] === 'sectname') section = fields[1]
    else if (fields[0] === 'segname') segment = fields[1]
    else if (fields[0] === 'flags' && segment != null && section != null) {
      out.push({
        library,
        member,
        arch,
        segment,
        section,
        flags: Number.parseInt(fields[1], 16)
      })
      segment = undefined
      section = undefined
    }
  }
  return out
}
