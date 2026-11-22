use crate::store::PortErr;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

/// Bounded so that a whole drive picked by mistake stays cheap to scan.
const FIND_DEPTH: usize = 3;
const LIST_DEPTH: usize = 3;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PackageDir {
    pub dir: String,
    pub manifest: Option<String>,
    pub files: Vec<PackageFile>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PackageFile {
    pub path: String,
    pub size: u64,
}

#[derive(Default)]
pub struct Registry {
    folders: Vec<(String, Option<PathBuf>)>,
}

impl Registry {
    pub fn set(&mut self, folders: Vec<String>) {
        self.folders = folders.into_iter().map(|f| (f.clone(), fs::canonicalize(&f).ok())).collect();
    }

    fn allows(&self, folder: &str, canonical: Option<&Path>) -> bool {
        self.folders.iter().any(|(raw, c)| raw == folder || (c.is_some() && c.as_deref() == canonical))
    }

    /// `canonical` must be canonicalized; the folders are resolved again on every call, so a drive attached after launch works.
    pub fn contains(&self, canonical: &Path) -> bool {
        self.folders.iter().filter_map(|(raw, _)| fs::canonicalize(raw).ok()).any(|f| canonical != f && canonical.starts_with(&f))
    }
}

pub fn read(registry: &Registry, folder: &str) -> Result<Vec<PackageDir>, PortErr> {
    let canonical = fs::canonicalize(folder).ok();
    if !registry.allows(folder, canonical.as_deref()) {
        return Err(PortErr::new("FOLDER_NOT_REGISTERED", folder));
    }
    let root = match canonical {
        Some(c) if c.is_dir() => c,
        Some(_) => return Err(PortErr::new("FOLDER_MISSING", format!("not a folder: {folder}"))),
        None => {
            return Err(match fs::metadata(folder) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => PortErr::new("FOLDER_MISSING", format!("folder missing: {folder}")),
                Err(e) => PortErr::new("FOLDER_READ", e),
                Ok(_) => PortErr::new("FOLDER_READ", format!("path did not resolve: {folder}")),
            })
        }
    };
    let mut out = Vec::new();
    find(&root, &root, 0, &mut out).map_err(|e| PortErr::new("FOLDER_READ", e))?;
    out.sort_by(|a, b| a.dir.cmp(&b.dir));
    Ok(out)
}

fn rel(base: &Path, p: &Path) -> String {
    p.strip_prefix(base).unwrap_or(p).components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/")
}

// `DirEntry::file_type` does not follow links, so junctions and symlinks cannot lead outside the brand folder.
fn subdirs(dir: &Path) -> std::io::Result<Vec<PathBuf>> {
    let mut v = Vec::new();
    for e in fs::read_dir(dir)? {
        let e = e?;
        if e.file_type()?.is_dir() {
            v.push(e.path());
        }
    }
    Ok(v)
}

fn find(root: &Path, dir: &Path, depth: usize, out: &mut Vec<PackageDir>) -> std::io::Result<()> {
    let manifest = dir.join("manifest.json");
    if manifest.is_file() {
        let mut files = Vec::new();
        list(dir, dir, 0, &mut files)?;
        files.sort_by(|a: &PackageFile, b: &PackageFile| a.path.cmp(&b.path));
        out.push(PackageDir { dir: rel(root, dir), manifest: fs::read_to_string(&manifest).ok(), files });
        return Ok(());
    }
    if depth >= FIND_DEPTH {
        return Ok(());
    }
    for d in subdirs(dir)? {
        find(root, &d, depth + 1, out)?;
    }
    Ok(())
}

fn list(base: &Path, dir: &Path, depth: usize, out: &mut Vec<PackageFile>) -> std::io::Result<()> {
    for e in fs::read_dir(dir)? {
        let e = e?;
        let t = e.file_type()?;
        if t.is_file() {
            out.push(PackageFile { path: rel(base, &e.path()), size: e.metadata()?.len() });
        } else if t.is_dir() && depth + 1 < LIST_DEPTH {
            list(base, &e.path(), depth + 1, out)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("postbell-pkg-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        let p = d.join("brand").join("2026-11-12").join("package");
        fs::create_dir_all(p.join("images")).unwrap();
        fs::write(p.join("manifest.json"), "{}").unwrap();
        fs::write(p.join("main.mp4"), "0123").unwrap();
        fs::write(p.join("images").join("card.png"), "").unwrap();
        fs::write(d.join("secret.txt"), "outside").unwrap();
        d
    }

    // The folder appears after registration (a drive attached later): inside is allowed, the folder itself and outside are not.
    #[test]
    fn contains_resolves_folder_that_appears_after_registration() {
        let d = std::env::temp_dir().join(format!("postbell-pkg-later-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        let mut r = Registry::default();
        r.set(vec![d.join("brand").to_string_lossy().to_string()]);
        fs::create_dir_all(d.join("brand").join("package")).unwrap();
        fs::write(d.join("brand").join("package").join("card.png"), "x").unwrap();
        fs::write(d.join("outside.png"), "x").unwrap();
        assert!(r.contains(&fs::canonicalize(d.join("brand").join("package").join("card.png")).unwrap()));
        assert!(!r.contains(&fs::canonicalize(d.join("brand")).unwrap()));
        assert!(!r.contains(&fs::canonicalize(d.join("outside.png")).unwrap()));
    }

    #[test]
    fn reads_registered_folder() {
        let d = tree("ok");
        let folder = d.join("brand").to_string_lossy().to_string();
        let mut r = Registry::default();
        r.set(vec![folder.clone()]);
        let list = read(&r, &folder).unwrap();
        assert_eq!(
            list,
            vec![PackageDir {
                dir: "2026-11-12/package".into(),
                manifest: Some("{}".into()),
                files: vec![
                    PackageFile { path: "images/card.png".into(), size: 0 },
                    PackageFile { path: "main.mp4".into(), size: 4 },
                    PackageFile { path: "manifest.json".into(), size: 2 },
                ],
            }]
        );
    }

    #[test]
    fn rejects_folder_outside_registry() {
        let d = tree("outside");
        let mut r = Registry::default();
        r.set(vec![d.join("brand").to_string_lossy().to_string()]);
        for f in [d.to_string_lossy().to_string(), d.join("brand").join("..").to_string_lossy().to_string(), "C:/Windows".into()] {
            assert_eq!(read(&r, &f).unwrap_err().code, "FOLDER_NOT_REGISTERED", "{f}");
        }
    }

    #[test]
    fn same_folder_spelled_differently_is_allowed() {
        let d = tree("spelling");
        let mut r = Registry::default();
        r.set(vec![d.join("brand").to_string_lossy().to_string()]);
        let other = format!("{}/./brand", d.to_string_lossy());
        assert_eq!(read(&r, &other).unwrap().len(), 1);
    }

    #[test]
    fn registered_but_missing_folder_is_missing() {
        let mut r = Registry::default();
        r.set(vec!["C:/no/such/folder".into()]);
        assert_eq!(read(&r, "C:/no/such/folder").unwrap_err().code, "FOLDER_MISSING");
    }

    #[test]
    fn registered_file_is_missing_folder() {
        let d = tree("file");
        let file = d.join("secret.txt").to_string_lossy().to_string();
        let mut r = Registry::default();
        r.set(vec![file.clone()]);
        assert_eq!(read(&r, &file).unwrap_err().code, "FOLDER_MISSING");
    }
}
