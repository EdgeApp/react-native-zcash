import babel from 'rollup-plugin-babel'
import filesize from 'rollup-plugin-filesize'
// import flowEntry from 'rollup-plugin-flow-entry'
import resolve from 'rollup-plugin-node-resolve'

import packageJson from './package.json'

const extensions = ['.ts']
const babelOpts = {
  babelrc: false,
  extensions,
  include: ['src/**/*'],
  presets: [
    [
      '@babel/preset-env',
      {
        exclude: ['transform-regenerator'],
        loose: true
      }
    ],
    '@babel/preset-typescript'
  ],
  plugins: [
    ['@babel/plugin-transform-for-of', { assumeArray: true }],
    '@babel/plugin-transform-object-assign'
  ]
}
const resolveOpts = { extensions }
// const flowOpts = { types: 'src/index.flow.js' }

const external = [
  'fs',
  'path',
  'react-native',
  ...Object.keys(packageJson.dependencies),
  ...Object.keys(packageJson.devDependencies)
]

export default [
  // React Native build:
  {
    external,
    input: 'src/react-native.ts',
    output: [{ file: packageJson.main, format: 'cjs', sourcemap: true }],
    plugins: [resolve(resolveOpts), babel(babelOpts), filesize()]
  }
]
