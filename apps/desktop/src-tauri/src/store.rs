use serde::Serialize;
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

pub const SUPPORTED_VERSION: u64 = 3;
const FILE: &str = "store.json";
const TMP: &str = "store.json.tmp";

/// Error sent to the UI: `code` is one of `PortErrorCode` in `src/core/port.ts`, and `detail` is only for diagnosis.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PortErr {
    pub code: &'static str,
    pub detail: String,
}

impl PortErr {
    pub fn new(code: &'static str, detail: impl ToString) -> Self {
        PortErr { code, detail: detail.to_string() }
    }
}

pub fn path(dir: &Path) -> PathBuf {
    dir.join(FILE)
}

pub fn cleanup(dir: &Path) -> std::io::Result<bool> {
    match fs::remove_file(dir.join(TMP)) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e),
    }
}

/// `None` when there is no file yet (first launch).
pub fn load(dir: &Path) -> Result<Option<String>, PortErr> {
    match fs::read_to_string(path(dir)) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(PortErr::new("STORE_READ", e)),
    }
}

fn version_of(text: &str) -> Option<u64> {
    serde_json::from_str::<serde_json::Value>(text).ok()?.get("version")?.as_u64()
}

/// Lets tests cut a write halfway.
#[derive(Clone, Copy, PartialEq)]
enum Cut {
    Never,
    HalfWritten,
}

pub fn save(dir: &Path, text: &str) -> Result<(), PortErr> {
    save_cut(dir, text, Cut::Never)
}

fn save_cut(dir: &Path, text: &str, cut: Cut) -> Result<(), PortErr> {
    if version_of(text) != Some(SUPPORTED_VERSION) {
        return Err(PortErr::new("STORE_WRITE", format!("store to write is not version {SUPPORTED_VERSION}")));
    }
    let w = |e: std::io::Error| PortErr::new("STORE_WRITE", e);
    // A store that cannot be read cannot be checked for a newer version, so it is not overwritten.
    if let Some(v) = load(dir)?.as_deref().and_then(version_of) {
        if v > SUPPORTED_VERSION {
            return Err(PortErr::new("STORE_NEWER_VERSION", format!("store on disk is version {v}")));
        }
        // The first save after an update keeps the older file, so going back to the older app loses nothing.
        let old = dir.join(format!("store.v{v}.json"));
        if v < SUPPORTED_VERSION && !old.exists() {
            fs::copy(path(dir), &old).map_err(w)?;
        }
    }
    fs::create_dir_all(dir).map_err(w)?;
    let tmp = dir.join(TMP);
    {
        let mut f = fs::File::create(&tmp).map_err(w)?;
        if cut == Cut::HalfWritten {
            f.write_all(&text.as_bytes()[..text.len() / 2]).map_err(w)?;
            return Err(PortErr::new("STORE_WRITE", "test: write cut halfway"));
        }
        f.write_all(text.as_bytes()).map_err(w)?;
        f.sync_all().map_err(w)?;
    }
    // On Windows `rename` replaces the existing file (MoveFileExW with MOVEFILE_REPLACE_EXISTING).
    fs::rename(&tmp, path(dir)).map_err(w)
}

pub fn backup(dir: &Path, unix_secs: u64) -> Result<PathBuf, PortErr> {
    let to = dir.join(format!("store.unreadable-{unix_secs}.json"));
    fs::copy(path(dir), &to).map_err(|e| PortErr::new("STORE_BACKUP", e))?;
    Ok(to)
}

pub fn brand_folders(text: &str) -> Vec<String> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(text) else { return vec![] };
    v.get("brands")
        .and_then(|b| b.as_array())
        .map(|list| list.iter().filter_map(|b| b.get("folder")?.as_str().map(String::from)).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    pub fn temp_dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("postbell-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    const V3_A: &str = r#"{"version":3,"brands":[{"folder":"C:/a"}]}"#;
    const V3_B: &str = r#"{"version":3,"brands":[]}"#;

    #[test]
    fn missing_file_is_first_launch() {
        let d = temp_dir("missing");
        assert_eq!(load(&d), Ok(None));
    }

    #[test]
    fn save_then_load_round_trips() {
        let d = temp_dir("roundtrip");
        save(&d, V3_A).unwrap();
        save(&d, V3_B).unwrap();
        assert_eq!(load(&d).unwrap().as_deref(), Some(V3_B));
        assert!(!d.join(TMP).exists());
    }

    #[test]
    fn cut_mid_write_keeps_old_file_and_cleanup_removes_tmp() {
        let d = temp_dir("cut");
        save(&d, V3_A).unwrap();
        let r = save_cut(&d, V3_B, Cut::HalfWritten);
        assert_eq!(r.unwrap_err().code, "STORE_WRITE");
        assert!(d.join(TMP).exists(), "the partial temp file stays");
        assert_eq!(load(&d).unwrap().as_deref(), Some(V3_A), "the old store is intact");
        assert_eq!(cleanup(&d).unwrap(), true);
        assert!(!d.join(TMP).exists());
        assert_eq!(cleanup(&d).unwrap(), false);
        assert_eq!(load(&d).unwrap().as_deref(), Some(V3_A));
    }

    #[test]
    fn newer_version_on_disk_is_never_overwritten() {
        let d = temp_dir("newer");
        let newer = r#"{"version":4,"future":true}"#;
        fs::write(path(&d), newer).unwrap();
        assert_eq!(save(&d, V3_B).unwrap_err().code, "STORE_NEWER_VERSION");
        assert_eq!(load(&d).unwrap().as_deref(), Some(newer));
    }

    #[test]
    fn unreadable_file_on_disk_is_never_overwritten() {
        let d = temp_dir("unreadable");
        let bytes = [b'{', 0xFF, 0xFE, b'}'];
        fs::write(path(&d), bytes).unwrap();
        assert_eq!(save(&d, V3_B).unwrap_err().code, "STORE_READ");
        assert_eq!(fs::read(path(&d)).unwrap(), bytes);
    }

    #[test]
    fn only_current_version_is_written() {
        let d = temp_dir("version");
        assert_eq!(save(&d, r#"{"version":4}"#).unwrap_err().code, "STORE_WRITE");
        assert_eq!(save(&d, r#"{"version":2}"#).unwrap_err().code, "STORE_WRITE");
        assert_eq!(save(&d, r#"{"version":1}"#).unwrap_err().code, "STORE_WRITE");
        assert_eq!(save(&d, "corrupt").unwrap_err().code, "STORE_WRITE");
        assert_eq!(load(&d), Ok(None));
    }

    #[test]
    fn first_save_over_an_older_version_keeps_a_copy_once() {
        let d = temp_dir("older");
        let v1 = r#"{"version":1,"brands":[]}"#;
        fs::write(path(&d), v1).unwrap();
        save(&d, V3_A).unwrap();
        assert_eq!(fs::read_to_string(d.join("store.v1.json")).unwrap(), v1);
        assert_eq!(load(&d).unwrap().as_deref(), Some(V3_A));
        save(&d, V3_B).unwrap();
        assert_eq!(fs::read_to_string(d.join("store.v1.json")).unwrap(), v1, "a later save leaves the copy alone");
        fs::write(path(&d), r#"{"version":1,"brands":[{"folder":"C:/later"}]}"#).unwrap();
        save(&d, V3_A).unwrap();
        assert_eq!(fs::read_to_string(d.join("store.v1.json")).unwrap(), v1, "an existing copy is never overwritten");
    }

    #[test]
    fn backup_copies_unreadable_file() {
        let d = temp_dir("backup");
        fs::write(path(&d), "{corrupt").unwrap();
        let b = backup(&d, 42).unwrap();
        assert_eq!(fs::read_to_string(b).unwrap(), "{corrupt");
        assert_eq!(fs::read_to_string(path(&d)).unwrap(), "{corrupt");
    }

    #[test]
    fn brand_folders_come_from_store() {
        assert_eq!(brand_folders(V3_A), vec!["C:/a".to_string()]);
        assert!(brand_folders("corrupt").is_empty());
    }
}
