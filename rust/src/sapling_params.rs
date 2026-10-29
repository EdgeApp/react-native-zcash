//! Fetches the Sapling proving parameters into the directory zingolib reads
//! them from.
//!
//! The parameters are a fixed output of the Sapling MPC, roughly 50 MB, and
//! are needed only to create Sapling spends and outputs. Scanning, receiving
//! and Orchard sends never touch them, so the library ships without them and
//! fetches them once, the first time the wallet holds Sapling funds.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use zingolib::wallet::sapling_params::{self, SaplingParamFile};

/// The files are served in two parts because of a 512 MB CDN cache limit.
const DOWNLOAD_URL: &str = "https://download.z.cash/downloads";
const PARTS: [u8; 2] = [1, 2];

static DIRECTORY: OnceLock<PathBuf> = OnceLock::new();

/// Names the directory the parameters are cached in, and tells zingolib to
/// read them from there.
pub fn set_directory(directory: PathBuf) -> Result<(), String> {
    sapling_params::set_directory(directory.clone()).map_err(|e| e.to_string())?;
    // zingolib has accepted the same directory, so this one matches it.
    let _ = DIRECTORY.set(directory);
    Ok(())
}

/// Downloads whichever parameter file is missing or fails verification.
/// Cached files that verify are left alone, so a repeat call costs two reads.
pub async fn fetch() -> Result<(), String> {
    let directory = DIRECTORY
        .get()
        .ok_or_else(|| "documentDirectory is not set".to_string())?;
    tokio::fs::create_dir_all(directory)
        .await
        .map_err(|e| e.to_string())?;
    for file in SaplingParamFile::ALL {
        let destination = directory.join(file.file_name());
        if is_cached(file, &destination).await {
            continue;
        }
        fetch_one(file, &destination).await?;
    }
    Ok(())
}

async fn is_cached(file: SaplingParamFile, path: &Path) -> bool {
    match tokio::fs::read(path).await {
        Ok(bytes) => file.verify(&bytes).is_ok(),
        Err(_) => false,
    }
}

/// Downloads one parameter file and verifies it before writing it, so a
/// truncated or substituted download never lands where a later run reads it.
async fn fetch_one(file: SaplingParamFile, destination: &Path) -> Result<(), String> {
    let name = file.file_name();
    let mut bytes = Vec::with_capacity(file.expected_len());
    for part in PARTS {
        let url = format!("{DOWNLOAD_URL}/{name}.part.{part}");
        let response = reqwest::get(&url)
            .await
            .and_then(|response| response.error_for_status())
            .map_err(|e| format!("{name} part {part}: {e}"))?;
        let body = response
            .bytes()
            .await
            .map_err(|e| format!("{name} part {part}: {e}"))?;
        bytes.extend_from_slice(&body);
    }
    file.verify(&bytes).map_err(|e| e.to_string())?;

    // Write beside the destination and rename, so a crash mid-write leaves
    // no partial file under the name zingolib reads.
    let partial = destination.with_extension("partial");
    tokio::fs::write(&partial, &bytes)
        .await
        .map_err(|e| e.to_string())?;
    tokio::fs::rename(&partial, destination)
        .await
        .map_err(|e| e.to_string())
}
