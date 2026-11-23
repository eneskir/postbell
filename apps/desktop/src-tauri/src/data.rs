//! «Veriler»: the store as a JSON file the user saves or opens. The store holds no passwords, so neither does the file.
use crate::store::{self, PortErr};
use std::io::Read;
use std::path::Path;

/// Far above a real store; a bigger file is not a Postbell data file.
pub const MAX_BYTES: u64 = 8 * 1024 * 1024;

/// The dialog's suggestion must be a bare `.json` file name.
pub fn valid_name(name: &str) -> bool {
    name.ends_with(".json") && name.len() <= 100 && !name.contains(['/', '\\', ':'])
}

pub fn write(path: &Path, text: &str) -> Result<(), PortErr> {
    std::fs::write(path, text).map_err(|e| PortErr::new("DATA_WRITE", e))
}

pub fn read(path: &Path) -> Result<String, PortErr> {
    let file = std::fs::File::open(path).map_err(|e| PortErr::new("DATA_READ", e))?;
    let mut bytes = Vec::new();
    file.take(MAX_BYTES + 1).read_to_end(&mut bytes).map_err(|e| PortErr::new("DATA_READ", e))?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(PortErr::new("DATA_TOO_LARGE", format!("over {MAX_BYTES} bytes")));
    }
    String::from_utf8(bytes).map_err(|_| PortErr::new("DATA_READ", "not UTF-8 text"))
}

/// Copies the store before an import replaces it; a first launch has nothing to copy.
pub fn keep(dir: &Path, unix_secs: u64) -> Result<(), PortErr> {
    let from = store::path(dir);
    if !from.exists() {
        return Ok(());
    }
    std::fs::copy(&from, dir.join(format!("store.before-import-{unix_secs}.json"))).map(|_| ()).map_err(|e| PortErr::new("STORE_BACKUP", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("postbell-data-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn only_a_bare_json_name_is_suggested() {
        assert!(valid_name("postbell-veriler-2026-11-23.json"));
        for bad in ["veriler.txt", "../veriler.json", r"C:\veriler.json", "a/b.json", &format!("{}.json", "a".repeat(100))] {
            assert!(!valid_name(bad), "{bad}");
        }
    }

    #[test]
    fn a_written_file_reads_back() {
        let f = temp_dir("round").join("v.json");
        write(&f, "{\"version\":4,\"note\":\"Geçmiş\"}").unwrap();
        assert_eq!(read(&f).unwrap(), "{\"version\":4,\"note\":\"Geçmiş\"}");
    }

    #[test]
    fn an_oversized_or_binary_file_is_refused() {
        let d = temp_dir("refuse");
        let big = d.join("big.json");
        fs::File::create(&big).unwrap().set_len(MAX_BYTES + 1).unwrap();
        assert_eq!(read(&big).unwrap_err().code, "DATA_TOO_LARGE");
        let bin = d.join("bin.json");
        fs::write(&bin, [0xff, 0xfe, 0x00]).unwrap();
        assert_eq!(read(&bin).unwrap_err().code, "DATA_READ");
        assert_eq!(read(&d.join("none.json")).unwrap_err().code, "DATA_READ");
    }

    #[test]
    fn keep_copies_the_store_and_skips_a_first_launch() {
        let d = temp_dir("keep");
        keep(&d, 7).unwrap();
        assert!(!d.join("store.before-import-7.json").exists());
        fs::write(store::path(&d), "{\"version\":4}").unwrap();
        keep(&d, 8).unwrap();
        assert_eq!(fs::read_to_string(d.join("store.before-import-8.json")).unwrap(), "{\"version\":4}");
    }
}
