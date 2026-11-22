use crate::packages::Registry;
use crate::store::PortErr;
use std::fs;
use std::path::{Component, Path, PathBuf};

/// Returns `None` if the file is already there; the deepest existing parent must sit inside a registered folder, so a deleted package folder is refused.
pub fn restore_target(registry: &Registry, folder: &str, path: &str) -> Result<Option<PathBuf>, PortErr> {
    let rel = Path::new(path);
    if path.is_empty() || !rel.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err(PortErr::new("FOLDER_NOT_REGISTERED", path));
    }
    let joined = Path::new(folder).join(rel);
    if joined.is_file() {
        return Ok(None);
    }
    if joined.exists() {
        return Err(PortErr::new("FILE_WRITE", format!("a folder with this name exists: {}", joined.display())));
    }
    let mut base = joined.parent().ok_or_else(|| PortErr::new("FOLDER_NOT_REGISTERED", path))?;
    while !base.exists() {
        base = base.parent().ok_or_else(|| PortErr::new("FOLDER_NOT_REGISTERED", path))?;
    }
    let real = fs::canonicalize(base).map_err(|e| PortErr::new("FOLDER_READ", e))?;
    if !registry.contains(&real) {
        return Err(PortErr::new("FOLDER_NOT_REGISTERED", folder));
    }
    let below = joined.strip_prefix(base).map_err(|_| PortErr::new("FOLDER_NOT_REGISTERED", path))?;
    Ok(Some(real.join(below)))
}

/// Copies through a temp name and one rename, so a half-written file never shows in the package list.
/// `inside` checks a resolved folder against the registered ones: the folder is checked again right before the write
/// and the written file after the rename, so a folder swapped for a link meanwhile cannot take the copy outside.
pub fn copy_into(source: &Path, target: &Path, inside: &dyn Fn(&Path) -> bool) -> Result<(), PortErr> {
    let ext = |p: &Path| p.extension().map(|e| e.to_string_lossy().to_lowercase());
    if ext(source) != ext(target) {
        return Err(PortErr::new("FILE_TYPE", format!(".{}", ext(target).unwrap_or_default())));
    }
    if !source.is_file() {
        return Err(PortErr::new("FILE_MISSING", source.display()));
    }
    let write = |e: std::io::Error| PortErr::new("FILE_WRITE", e);
    let dir = target.parent().ok_or_else(|| PortErr::new("FILE_WRITE", target.display()))?;
    fs::create_dir_all(dir).map_err(write)?;
    let outside = || PortErr::new("FOLDER_NOT_REGISTERED", dir.display());
    if !inside(&fs::canonicalize(dir).map_err(write)?) {
        return Err(outside());
    }
    if target.exists() {
        return Ok(());
    }
    let name = target.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let temp = dir.join(format!(".{name}.postbell-kopya"));
    let _ = fs::remove_file(&temp);
    // `create_new` never opens something already at the temp name, such as a link planted there.
    let copied = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)
        .and_then(|mut t| fs::File::open(source).and_then(|mut s| std::io::copy(&mut s, &mut t)).and_then(|_| t.sync_all()));
    let done = copied.and_then(|_| fs::rename(&temp, target));
    if done.is_err() {
        let _ = fs::remove_file(&temp);
    }
    done.map_err(write)?;
    let landed = fs::canonicalize(target).ok().and_then(|p| p.parent().map(Path::to_path_buf));
    if !landed.is_some_and(|p| inside(&p)) {
        let _ = fs::remove_file(target);
        return Err(outside());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup(tag: &str) -> (PathBuf, String, Registry) {
        let d = std::env::temp_dir().join(format!("postbell-restore-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("brand").join("2026-11-12").join("package")).unwrap();
        fs::write(d.join("source.mp4"), "video").unwrap();
        fs::write(d.join("source.mov"), "video").unwrap();
        let folder = d.join("brand").to_string_lossy().to_string();
        let mut r = Registry::default();
        r.set(vec![folder.clone()]);
        (d, folder, r)
    }

    #[test]
    fn copies_missing_file_into_package_and_keeps_source() {
        let (d, folder, r) = setup("ok");
        let target = restore_target(&r, &folder, "2026-11-12/package/main.mp4").unwrap().unwrap();
        copy_into(&d.join("source.mp4"), &target, &|_| true).unwrap();
        assert_eq!(fs::read_to_string(d.join("brand/2026-11-12/package/main.mp4")).unwrap(), "video");
        assert!(d.join("source.mp4").is_file(), "the source is not moved");
        assert!(!d.join("brand/2026-11-12/package/.main.mp4.postbell-kopya").exists(), "no temp file is left");
        // Now in place: no dialog.
        assert_eq!(restore_target(&r, &folder, "2026-11-12/package/main.mp4").unwrap(), None);
        // A missing subfolder is created.
        let deep = restore_target(&r, &folder, "2026-11-12/package/images/card.mp4").unwrap().unwrap();
        copy_into(&d.join("source.mp4"), &deep, &|_| true).unwrap();
        assert!(d.join("brand/2026-11-12/package/images/card.mp4").is_file());
    }

    #[test]
    fn refuses_paths_outside_package_and_other_types() {
        let (d, folder, r) = setup("refuse");
        let code = |p: &str| restore_target(&r, &folder, p).unwrap_err().code;
        assert_eq!(code("../outside.mp4"), "FOLDER_NOT_REGISTERED");
        assert_eq!(code("2026-11-12/../../outside.mp4"), "FOLDER_NOT_REGISTERED");
        assert_eq!(code(""), "FOLDER_NOT_REGISTERED");
        assert_eq!(code(&d.join("absolute.mp4").to_string_lossy()), "FOLDER_NOT_REGISTERED");
        // Without the package folder only the brand root remains, which is refused.
        assert_eq!(code("deleted-package/main.mp4"), "FOLDER_NOT_REGISTERED");
        assert_eq!(restore_target(&Registry::default(), &folder, "2026-11-12/package/main.mp4").unwrap_err().code, "FOLDER_NOT_REGISTERED");
        let target = restore_target(&r, &folder, "2026-11-12/package/main.mp4").unwrap().unwrap();
        assert_eq!(copy_into(&d.join("source.mov"), &target, &|_| true).unwrap_err().code, "FILE_TYPE");
        assert!(!target.exists());
    }

    #[test]
    fn never_overwrites_and_cleans_stale_temp() {
        let (d, _folder, _r) = setup("overwrite");
        let pkg = d.join("brand/2026-11-12/package");
        fs::write(pkg.join(".main.mp4.postbell-kopya"), "partial").unwrap();
        copy_into(&d.join("source.mp4"), &pkg.join("main.mp4"), &|_| true).unwrap();
        assert!(!pkg.join(".main.mp4.postbell-kopya").exists());
        fs::write(d.join("new.mp4"), "other").unwrap();
        copy_into(&d.join("new.mp4"), &pkg.join("main.mp4"), &|_| true).unwrap();
        assert_eq!(fs::read_to_string(pkg.join("main.mp4")).unwrap(), "video", "an existing file is never overwritten");
    }

    /// A package folder swapped for a junction to an outside folder after the target was resolved gets no copy.
    #[test]
    #[cfg(windows)]
    fn a_folder_swapped_for_a_link_gets_no_copy() {
        let (d, folder, r) = setup("junction");
        let target = restore_target(&r, &folder, "2026-11-12/package/main.mp4").unwrap().unwrap();
        let pkg = target.parent().unwrap().to_path_buf();
        let out = d.join("disari");
        fs::create_dir_all(&out).unwrap();
        fs::rename(&pkg, d.join("package-eski")).unwrap();
        let made = std::process::Command::new("cmd").args(["/C", "mklink", "/J"]).arg(&pkg).arg(&out).output().unwrap();
        assert!(made.status.success());
        let inside = |p: &Path| r.contains(p);
        assert_eq!(copy_into(&d.join("source.mp4"), &target, &inside).unwrap_err().code, "FOLDER_NOT_REGISTERED");
        assert!(!out.join("main.mp4").exists());
        fs::remove_dir(&pkg).unwrap();
    }
}

