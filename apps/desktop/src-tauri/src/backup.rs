//! Password backup: the vault entries of the given accounts in one age file, encrypted with a passphrase (scrypt
//! key, authenticated encryption), so they can move to another computer. Postbell never stores the passphrase.
//! A wrong passphrase and a damaged file give the same error: age cannot tell them apart.

use crate::store::PortErr;
use crate::vault::{Secret, Vault, VaultEntry};
use age::secrecy::SecretString;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use zeroize::Zeroizing;

/// The shortest passphrase, in characters.
pub const MIN_PASSPHRASE: usize = 12;
/// A real backup is a few kilobytes; anything far larger is not ours and is not read whole.
pub const MAX_FILE: u64 = 4 * 1024 * 1024;
const VERSION: u32 = 1;

/// An account as the UI knows it; `id` is the vault key, the rest lets a person recognise the account in the file.
#[derive(Clone, Serialize, Deserialize)]
pub struct BackupAccount {
    pub id: String,
    pub brand: String,
    pub network: String,
    pub handle: String,
}

#[derive(Serialize, Deserialize)]
struct Item {
    #[serde(flatten)]
    account: BackupAccount,
    #[serde(flatten)]
    entry: VaultEntry,
}

#[derive(Serialize, Deserialize)]
struct Body {
    version: u32,
    created: i64,
    accounts: Vec<Item>,
}

/// What a restore did: `changed` replaced an entry, `added` filled an account that had none, `skipped` were in the
/// backup but not among the accounts here.
#[derive(Debug, PartialEq, Serialize)]
pub struct Restored {
    pub changed: usize,
    pub added: usize,
    pub skipped: usize,
}

fn unreadable() -> PortErr {
    PortErr::new("BACKUP_UNREADABLE", "wrong passphrase or damaged file")
}

pub fn check_passphrase(p: &Secret) -> Result<(), PortErr> {
    if p.expose().chars().count() < MIN_PASSPHRASE {
        return Err(PortErr::new("BACKUP_PASSPHRASE_SHORT", format!("under {MIN_PASSPHRASE} characters")));
    }
    Ok(())
}

/// Encrypts the entries of `accounts` that have one; returns the file bytes and how many accounts went in.
/// `work` sets scrypt's work factor (tests only); `None` lets age pick about one second on this computer.
pub fn seal(vault: &Vault, accounts: &[BackupAccount], passphrase: &Secret, created: i64, work: Option<u8>) -> Result<(Vec<u8>, usize), PortErr> {
    check_passphrase(passphrase)?;
    let mut items = Vec::new();
    for a in accounts {
        if let Some(entry) = vault.get(&a.id)? {
            items.push(Item { account: a.clone(), entry });
        }
    }
    if items.is_empty() {
        return Err(PortErr::new("BACKUP_EMPTY", "no account has a password or codes"));
    }
    let count = items.len();
    let body = Zeroizing::new(serde_json::to_vec(&Body { version: VERSION, created, accounts: items }).map_err(|e| PortErr::new("BACKUP_FAILED", e))?);
    let mut recipient = age::scrypt::Recipient::new(SecretString::from(passphrase.expose()));
    if let Some(log_n) = work {
        recipient.set_work_factor(log_n);
    }
    let encryptor = age::Encryptor::with_recipients(std::iter::once(&recipient as &dyn age::Recipient)).map_err(|e| PortErr::new("BACKUP_FAILED", e))?;
    let mut out = Vec::new();
    let mut w = encryptor.wrap_output(&mut out).map_err(|e| PortErr::new("BACKUP_FAILED", e))?;
    w.write_all(&body).and_then(|_| w.finish()).map_err(|e| PortErr::new("BACKUP_FAILED", e))?;
    Ok((out, count))
}

/// Decrypts and checks a whole backup before anything is written; any failure is `BACKUP_UNREADABLE`.
fn open(file: &[u8], passphrase: &Secret) -> Result<Body, PortErr> {
    let identity = age::scrypt::Identity::new(SecretString::from(passphrase.expose()));
    let decryptor = age::Decryptor::new_buffered(file).map_err(|_| unreadable())?;
    let mut reader = decryptor.decrypt(std::iter::once(&identity as &dyn age::Identity)).map_err(|_| unreadable())?;
    let mut plain = Zeroizing::new(Vec::new());
    reader.read_to_end(&mut plain).map_err(|_| unreadable())?;
    let body: Body = serde_json::from_slice(&plain).map_err(|_| unreadable())?;
    if body.version != VERSION {
        return Err(unreadable());
    }
    Ok(body)
}

/// Writes the backup's entries for the accounts here (`present`), replacing what they had; others are untouched.
/// If a write fails, the entries already written go back to their old values, so the vault is left as it was.
pub fn restore(vault: &Vault, file: &[u8], passphrase: &Secret, present: &[String]) -> Result<Restored, PortErr> {
    let body = open(file, passphrase)?;
    let mut done = Restored { changed: 0, added: 0, skipped: 0 };
    let mut undo: Vec<(String, Option<VaultEntry>)> = Vec::new();
    for item in body.accounts {
        let id = item.account.id;
        if !present.contains(&id) {
            done.skipped += 1;
            continue;
        }
        let result = vault.get(&id).and_then(|old| {
            let had = old.is_some();
            vault.put(&id, item.entry)?;
            Ok((had, old))
        });
        match result {
            Ok((had, old)) => {
                if had {
                    done.changed += 1;
                } else {
                    done.added += 1;
                }
                undo.push((id, old));
            }
            Err(e) => {
                for (id, old) in undo.into_iter().rev() {
                    let _ = vault.put(&id, old.unwrap_or_default());
                }
                return Err(e);
            }
        }
    }
    Ok(done)
}

/// The file name the save dialog offers; `today` is `YYYY-MM-DD` or the name has no date.
pub fn file_name(today: &str) -> String {
    let dated = today.len() == 10 && today.bytes().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == b'-' } else { c.is_ascii_digit() });
    if dated { format!("postbell-kasa-{today}.age") } else { "postbell-kasa.age".to_string() }
}

/// Writes next to the target first and renames, so a failed save never leaves half a backup under its name.
pub fn save(path: &std::path::Path, bytes: &[u8]) -> Result<(), PortErr> {
    let fail = |e: std::io::Error| PortErr::new("BACKUP_WRITE", e);
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = std::path::PathBuf::from(tmp);
    let written = std::fs::File::create(&tmp).and_then(|mut f| f.write_all(bytes).and_then(|_| f.sync_all()));
    if let Err(e) = written.and_then(|_| std::fs::rename(&tmp, path)) {
        let _ = std::fs::remove_file(&tmp);
        return Err(fail(e));
    }
    Ok(())
}

/// Reads a picked backup, refusing anything larger than a backup can be.
pub fn load(path: &std::path::Path) -> Result<Vec<u8>, PortErr> {
    let mut f = std::fs::File::open(path).map_err(|e| PortErr::new("FILE_READ", e))?;
    let mut bytes = Vec::new();
    (&mut f).take(MAX_FILE + 1).read_to_end(&mut bytes).map_err(|e| PortErr::new("FILE_READ", e))?;
    if bytes.len() as u64 > MAX_FILE {
        return Err(unreadable());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    const WORK: Option<u8> = Some(10);

    fn s(v: &str) -> Secret {
        Secret::new(v.to_string())
    }

    fn acc(id: &str) -> BackupAccount {
        BackupAccount { id: id.into(), brand: "initech".into(), network: "x".into(), handle: "@initech".into() }
    }

    fn pass() -> Secret {
        s("uzun-ornek-parola-1")
    }

    fn filled() -> Vault {
        let v = Vault::mock();
        v.write("initech-x", Some(s("ornek-sifre-123")), Some(vec![s("1111"), s("2222")]), true).unwrap();
        v.write("initech-instagram", Some(s("ornek-sifre-456")), None, true).unwrap();
        v
    }

    #[test]
    fn a_backup_round_trips_into_another_vault() {
        let (file, n) = seal(&filled(), &[acc("initech-x"), acc("initech-instagram"), acc("initech-threads")], &pass(), 1, WORK).unwrap();
        assert_eq!(n, 2);
        let other = Vault::mock();
        let r = restore(&other, &file, &pass(), &["initech-x".into(), "initech-instagram".into()]).unwrap();
        assert_eq!(r, Restored { changed: 0, added: 2, skipped: 0 });
        assert_eq!(other.password("initech-x").unwrap().expose(), "ornek-sifre-123");
        assert_eq!(other.status(&["initech-x".into()]).unwrap()[0].codes, 2);
    }

    #[test]
    fn the_file_holds_no_secret_or_handle_in_plain_text() {
        let (file, _) = seal(&filled(), &[acc("initech-x")], &pass(), 1, WORK).unwrap();
        for needle in ["ornek-sifre-123", "1111", "@initech", "initech-x", "uzun-ornek-parola-1"] {
            assert!(!file.windows(needle.len()).any(|w| w == needle.as_bytes()), "{needle}");
        }
        assert!(file.starts_with(b"age-encryption.org/v1\n"));
    }

    #[test]
    fn a_wrong_passphrase_and_a_damaged_byte_give_the_same_error_and_write_nothing() {
        let (file, _) = seal(&filled(), &[acc("initech-x")], &pass(), 1, WORK).unwrap();
        let mut damaged = file.clone();
        let last = damaged.len() - 1;
        damaged[last] ^= 1;
        let other = Vault::mock();
        let present = ["initech-x".to_string()];
        for (f, p) in [(&file, s("baska-uzun-parola-2")), (&damaged, pass()), (&file[..20].to_vec(), pass())] {
            assert_eq!(restore(&other, f, &p, &present).unwrap_err().code, "BACKUP_UNREADABLE");
        }
        assert!(!other.status(&present).unwrap()[0].password);
    }

    #[test]
    fn restore_replaces_the_same_account_and_leaves_others_alone() {
        let (file, _) = seal(&filled(), &[acc("initech-x"), acc("initech-instagram")], &pass(), 1, WORK).unwrap();
        let here = Vault::mock();
        here.write("initech-x", Some(s("eski-sifre")), None, true).unwrap();
        here.write("initech-tiktok", Some(s("dokunulmaz")), None, true).unwrap();
        let present = ["initech-x".to_string(), "initech-tiktok".to_string()];
        let r = restore(&here, &file, &pass(), &present).unwrap();
        assert_eq!(r, Restored { changed: 1, added: 0, skipped: 1 });
        assert_eq!(here.password("initech-x").unwrap().expose(), "ornek-sifre-123");
        assert_eq!(here.password("initech-tiktok").unwrap().expose(), "dokunulmaz");
        // Running it again gives the same vault.
        assert_eq!(restore(&here, &file, &pass(), &present).unwrap(), Restored { changed: 1, added: 0, skipped: 1 });
        assert_eq!(here.password("initech-x").unwrap().expose(), "ornek-sifre-123");
    }

    #[test]
    fn a_failed_write_puts_the_earlier_entries_back() {
        let (file, _) = seal(&filled(), &[acc("initech-x"), acc("initech-instagram")], &pass(), 1, WORK).unwrap();
        let here = Vault::mock();
        here.write("initech-x", Some(s("eski-sifre")), None, true).unwrap();
        // An id the vault refuses makes the second write fail after the first one landed.
        let r = restore_with(&here, &file, &["initech-x".into(), "initech-instagram".into()], "initech-instagram");
        assert_eq!(r.unwrap_err().code, "VAULT_UNAVAILABLE");
        here.fail_on("");
        assert_eq!(here.password("initech-x").unwrap().expose(), "eski-sifre");
        assert!(!here.status(&["initech-instagram".into()]).unwrap()[0].password);
    }

    /// `restore` with the vault made to fail on `broken`.
    fn restore_with(vault: &Vault, file: &[u8], present: &[String], broken: &str) -> Result<Restored, PortErr> {
        vault.fail_on(broken);
        restore(vault, file, &pass(), present)
    }

    #[test]
    fn the_file_name_takes_only_a_date() {
        assert_eq!(file_name("2026-11-22"), "postbell-kasa-2026-11-22.age");
        assert_eq!(file_name("../x/2026"), "postbell-kasa.age");
        assert_eq!(file_name("2026-11-2a"), "postbell-kasa.age");
    }

    #[test]
    fn save_replaces_the_file_whole_and_load_refuses_a_huge_one() {
        let dir = std::env::temp_dir().join(format!("postbell-backup-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("y.age");
        save(&path, b"first").unwrap();
        save(&path, b"second").unwrap();
        assert_eq!(load(&path).unwrap(), b"second");
        assert!(!dir.join("y.age.tmp").exists());
        std::fs::write(&path, vec![0u8; MAX_FILE as usize + 1]).unwrap();
        assert_eq!(load(&path).unwrap_err().code, "BACKUP_UNREADABLE");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn short_passphrases_and_an_empty_vault_are_refused() {
        assert_eq!(seal(&filled(), &[acc("initech-x")], &s("kisa-parola"), 1, WORK).unwrap_err().code, "BACKUP_PASSPHRASE_SHORT");
        // Twelve characters, two of them outside ASCII, are enough.
        assert!(check_passphrase(&s("ğüşiöç123456")).is_ok());
        assert_eq!(seal(&Vault::mock(), &[acc("initech-x")], &pass(), 1, WORK).unwrap_err().code, "BACKUP_EMPTY");
    }

    /// Prints how long age's own work factor takes here: `cargo test --release -- --ignored key_derivation_time --nocapture`.
    #[test]
    #[ignore]
    fn key_derivation_time() {
        let v = filled();
        for run in 1..=5 {
            let t = std::time::Instant::now();
            let (file, _) = seal(&v, &[acc("initech-x")], &pass(), 1, None).unwrap();
            let sealed = t.elapsed();
            let t = std::time::Instant::now();
            restore(&Vault::mock(), &file, &pass(), &["initech-x".into()]).unwrap();
            println!("run {run}: seal {:.2} s, restore {:.2} s", sealed.as_secs_f64(), t.elapsed().as_secs_f64());
        }
    }
}
