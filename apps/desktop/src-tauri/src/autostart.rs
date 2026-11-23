//! «Bilgisayar açılınca başlat»: a "Postbell" value in the user's Run key starts the app at sign-in, hidden in the tray.
use crate::store::PortErr;
use std::path::Path;

pub const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
pub const VALUE: &str = "Postbell";
/// A test copy writes here instead, so it never starts at a real sign-in.
pub const TEST_PREFIX: &str = r"Software\Postbell autostart test\";
/// The Run value passes this flag; the app then starts without showing its window.
pub const BACKGROUND: &str = "--background";

pub fn key(test: bool) -> String {
    format!("{}{RUN_KEY}", if test { TEST_PREFIX } else { "" })
}

/// Quoted, since the install folder may hold spaces.
pub fn command(exe: &Path) -> String {
    format!("\"{}\" {BACKGROUND}", exe.display())
}

#[cfg(windows)]
pub fn set(on: bool, test: bool, exe: &Path) -> Result<(), PortErr> {
    use crate::setup_win::{reg_delete_value, reg_write, RegValue};
    let key = key(test);
    let r = if on { reg_write(&key, &[(VALUE, RegValue::Str(command(exe)))]) } else { reg_delete_value(&key, VALUE) };
    r.map_err(|e| PortErr::new("AUTOSTART_FAILED", e))
}

#[cfg(not(windows))]
pub fn set(_on: bool, _test: bool, _exe: &Path) -> Result<(), PortErr> {
    Err(PortErr::new("AUTOSTART_FAILED", "Windows only"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_quotes_the_exe_and_adds_the_flag() {
        assert_eq!(command(Path::new(r"C:\Users\Firstname Lastname\AppData\Local\Postbell\postbell.exe")), r#""C:\Users\Firstname Lastname\AppData\Local\Postbell\postbell.exe" --background"#);
    }

    #[test]
    fn a_test_copy_never_touches_the_real_run_key() {
        assert_eq!(key(false), RUN_KEY);
        assert!(key(true).starts_with(TEST_PREFIX) && key(true).ends_with(RUN_KEY));
    }
}
