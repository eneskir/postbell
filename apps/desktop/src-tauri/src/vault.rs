//! Password vault: one Windows Credential Manager entry per account, holding its password and backup codes.
//! A secret never reaches the log, an error message or `Debug` output, and its memory is zeroed when dropped.
//! Copies made outside this module (the IPC message, the clipboard's own buffer) are out of its reach.

use crate::store::PortErr;
use keyring_core::{CredentialStore, Entry, Error};
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use zeroize::Zeroizing;

/// Windows' limit for one credential's secret (`CRED_MAX_CREDENTIAL_BLOB_SIZE`).
pub const MAX_BYTES: usize = 2560;
/// The service of the real entries; a test copy uses `TEST_SERVICE`.
pub const SERVICE: &str = "Postbell";
pub const TEST_SERVICE: &str = "Postbell test";
/// How long a copied password stays on the clipboard.
pub const CLEAR_AFTER: Duration = Duration::from_secs(30);

/// A secret text: zeroed when dropped, masked in `Debug`.
pub struct Secret(Zeroizing<String>);

impl Secret {
    pub fn new(s: String) -> Self {
        Secret(Zeroizing::new(s))
    }

    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Debug for Secret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Secret(***)")
    }
}

impl Serialize for Secret {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(&self.0)
    }
}

impl<'de> Deserialize<'de> for Secret {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        String::deserialize(d).map(Secret::new)
    }
}

/// The one secret blob stored per account.
#[derive(Default, Serialize, Deserialize)]
struct VaultEntry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    password: Option<Secret>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    codes: Vec<Secret>,
}

impl VaultEntry {
    fn is_empty(&self) -> bool {
        self.password.is_none() && self.codes.is_empty()
    }
}

/// What the UI may know about an entry; never the values.
#[derive(Debug, PartialEq, Serialize)]
pub struct Status {
    pub account: String,
    pub password: bool,
    pub codes: usize,
}

/// Maps a store error to a port error; raw secret bytes carried by some variants are never formatted.
fn port_err(e: Error) -> PortErr {
    match e {
        Error::NoEntry => PortErr::new("VAULT_NOT_FOUND", "no entry"),
        Error::TooLong(attr, limit) => PortErr::new("VAULT_TOO_LARGE", format!("{attr} is over {limit}")),
        Error::PlatformFailure(p) => PortErr::new("VAULT_UNAVAILABLE", format!("platform: {p}")),
        Error::NoStorageAccess(p) => PortErr::new("VAULT_UNAVAILABLE", format!("no access: {p}")),
        Error::BadEncoding(_) | Error::BadDataFormat(..) => PortErr::new("VAULT_UNAVAILABLE", "entry unreadable"),
        Error::Invalid(attr, _) => PortErr::new("VAULT_UNAVAILABLE", format!("invalid {attr}")),
        _ => PortErr::new("VAULT_UNAVAILABLE", "store failure"),
    }
}

fn unreadable() -> PortErr {
    PortErr::new("VAULT_UNAVAILABLE", "entry unreadable")
}

/// Account ids come from `uniqueId` in `src/core/names.ts`; anything else never names an entry.
fn valid_account(id: &str) -> bool {
    !id.is_empty() && id.len() <= 80 && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

pub struct Vault {
    store: Result<Arc<CredentialStore>, String>,
    service: String,
    /// The Windows store keeps entries on this computer only (`Local`), never in a roaming profile.
    modifiers: HashMap<&'static str, &'static str>,
}

impl Vault {
    /// The Windows Credential Manager; elsewhere the vault reports `VAULT_UNAVAILABLE` on every call.
    pub fn open(service: &str) -> Self {
        #[cfg(windows)]
        let store = windows_native_keyring_store::Store::new().map(|s| s as Arc<CredentialStore>).map_err(|e| port_err(e).detail);
        #[cfg(not(windows))]
        let store = Err("no credential store on this system".to_string());
        Vault { store, service: service.to_string(), modifiers: HashMap::from([("persistence", "Local")]) }
    }

    #[cfg(test)]
    fn mock() -> Self {
        let store: Arc<CredentialStore> = keyring_core::mock::Store::new().unwrap();
        Vault { store: Ok(store), service: "Postbell test".into(), modifiers: HashMap::new() }
    }

    fn entry(&self, account: &str) -> Result<Entry, PortErr> {
        if !valid_account(account) {
            return Err(PortErr::new("VAULT_UNAVAILABLE", "invalid account id"));
        }
        let store = self.store.as_ref().map_err(|e| PortErr::new("VAULT_UNAVAILABLE", e))?;
        Entry::new_in_store_with_modifiers(store, &self.service, account, &self.modifiers).map_err(port_err)
    }

    fn read(&self, entry: &Entry) -> Result<Option<VaultEntry>, PortErr> {
        match entry.get_secret() {
            Ok(bytes) => {
                let bytes = Zeroizing::new(bytes);
                serde_json::from_slice(&bytes).map(Some).map_err(|_| unreadable())
            }
            Err(Error::NoEntry) => Ok(None),
            Err(e) => Err(port_err(e)),
        }
    }

    /// One status per account, in the same order.
    pub fn status(&self, accounts: &[String]) -> Result<Vec<Status>, PortErr> {
        accounts
            .iter()
            .map(|a| {
                let v = self.read(&self.entry(a)?)?.unwrap_or_default();
                Ok(Status { account: a.clone(), password: v.password.is_some(), codes: v.codes.len() })
            })
            .collect()
    }

    /// With `replace`, the entry becomes exactly the given values; without it, a `None` keeps the stored value.
    /// An empty password or code is dropped; an entry left with nothing is deleted.
    pub fn write(&self, account: &str, password: Option<Secret>, codes: Option<Vec<Secret>>, replace: bool) -> Result<(), PortErr> {
        let entry = self.entry(account)?;
        let mut v = if replace { VaultEntry::default() } else { self.read(&entry)?.unwrap_or_default() };
        if let Some(p) = password {
            v.password = Some(p).filter(|p| !p.expose().is_empty());
        }
        if let Some(c) = codes {
            v.codes = c.into_iter().filter(|c| !c.expose().is_empty()).collect();
        }
        if v.is_empty() {
            return match entry.delete_credential() {
                Ok(()) | Err(Error::NoEntry) => Ok(()),
                Err(e) => Err(port_err(e)),
            };
        }
        let raw: usize = v.password.iter().chain(&v.codes).map(|s| s.expose().len()).sum();
        if raw > MAX_BYTES {
            return Err(PortErr::new("VAULT_TOO_LARGE", format!("values are over {MAX_BYTES} bytes")));
        }
        // Sized up front so the buffer never moves, which would leave an unzeroed copy behind; escapes take at most 6 bytes per byte.
        let mut blob = Zeroizing::new(Vec::with_capacity(raw * 6 + 64 * (v.codes.len() + 1)));
        serde_json::to_writer(&mut *blob, &v).map_err(|_| PortErr::new("VAULT_UNAVAILABLE", "entry not written"))?;
        if blob.len() > MAX_BYTES {
            return Err(PortErr::new("VAULT_TOO_LARGE", format!("entry is {} bytes, over {MAX_BYTES}", blob.len())));
        }
        entry.set_secret(&blob).map_err(port_err)
    }

    pub fn password(&self, account: &str) -> Result<Secret, PortErr> {
        let v = self.read(&self.entry(account)?)?;
        v.and_then(|mut v| v.password.take()).ok_or_else(|| PortErr::new("VAULT_NOT_FOUND", "no password"))
    }

    /// Deletes every entry of this service, also ones no account names any more; returns how many.
    pub fn delete_all(&self) -> Result<usize, PortErr> {
        let store = self.store.as_ref().map_err(|e| PortErr::new("VAULT_UNAVAILABLE", e))?;
        // Targets are `<account>.<service>`; the service is a fixed name of letters and spaces, so it needs no escaping.
        debug_assert!(self.service.chars().all(|c| c.is_ascii_alphabetic() || c == ' '));
        let pattern = format!("^[a-z0-9-]{{1,80}}\\.{}$", self.service);
        let found = Entry::search_in_store(store, &HashMap::from([("pattern", pattern.as_str())])).map_err(port_err)?;
        let n = found.len();
        for e in found {
            match e.delete_credential() {
                Ok(()) | Err(Error::NoEntry) => {}
                Err(e) => return Err(port_err(e)),
            }
        }
        Ok(n)
    }

    /// Deleting an account that has no entry is not an error.
    pub fn delete(&self, account: &str) -> Result<(), PortErr> {
        match self.entry(account)?.delete_credential() {
            Ok(()) | Err(Error::NoEntry) => Ok(()),
            Err(e) => Err(port_err(e)),
        }
    }
}

/// The latest copy and its number, so only its timer, or the app's exit, clears the clipboard.
static LAST_COPY: Mutex<Option<(u64, Secret)>> = Mutex::new(None);

fn clipboard_err(e: arboard::Error) -> PortErr {
    PortErr::new("CLIPBOARD_FAILED", e)
}

/// Puts the password on the clipboard, kept out of Windows' clipboard history and cloud sync, and clears it after
/// `after` (or when the app quits first) unless something else was copied meanwhile.
pub fn copy(secret: Secret, after: Duration) -> Result<(), PortErr> {
    let mut clipboard = arboard::Clipboard::new().map_err(clipboard_err)?;
    #[cfg(windows)]
    {
        use arboard::SetExtWindows;
        clipboard.set().exclude_from_history().exclude_from_cloud().text(secret.expose()).map_err(clipboard_err)?;
    }
    #[cfg(not(windows))]
    clipboard.set_text(secret.expose()).map_err(clipboard_err)?;
    let n = {
        let mut last = LAST_COPY.lock().unwrap_or_else(|e| e.into_inner());
        let n = last.as_ref().map_or(1, |(m, _)| m + 1);
        *last = Some((n, secret));
        n
    };
    std::thread::spawn(move || {
        std::thread::sleep(after);
        clear_copy(Some(n));
    });
    Ok(())
}

/// Clears the clipboard if it still holds the latest copy (`only`: that copy's number; `None`: whichever it is).
pub fn clear_copy(only: Option<u64>) {
    let mut last = LAST_COPY.lock().unwrap_or_else(|e| e.into_inner());
    let Some((n, secret)) = last.as_ref() else { return };
    if only.is_some_and(|o| o != *n) {
        return;
    }
    if let Ok(mut c) = arboard::Clipboard::new() {
        let now = c.get_text().map(Zeroizing::new);
        if now.is_ok_and(|t| *t == secret.expose()) {
            let _ = c.clear();
        }
    }
    *last = None;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(v: &str) -> Secret {
        Secret::new(v.to_string())
    }

    fn codes(list: &[&str]) -> Option<Vec<Secret>> {
        Some(list.iter().map(|c| s(c)).collect())
    }

    #[test]
    fn a_secret_is_masked_in_debug_output() {
        let v = s("ornek-sifre-123");
        assert_eq!(format!("{v:?}"), "Secret(***)");
        assert_eq!(format!("{:?}", Some(&v)), "Some(Secret(***))");
    }

    #[test]
    fn write_read_and_delete() {
        let vault = Vault::mock();
        vault.write("acme-x", Some(s("ornek-sifre-123")), codes(&["1111", "", "2222"]), true).unwrap();
        assert_eq!(vault.password("acme-x").unwrap().expose(), "ornek-sifre-123");
        assert_eq!(vault.status(&["acme-x".into()]).unwrap(), vec![Status { account: "acme-x".into(), password: true, codes: 2 }]);
        vault.delete("acme-x").unwrap();
        assert_eq!(vault.password("acme-x").unwrap_err().code, "VAULT_NOT_FOUND");
        vault.delete("acme-x").unwrap();
    }

    #[test]
    fn none_keeps_the_stored_value_unless_replacing() {
        let vault = Vault::mock();
        vault.write("acme-x", Some(s("first")), codes(&["1111"]), true).unwrap();
        vault.write("acme-x", None, codes(&["2222", "3333"]), false).unwrap();
        assert_eq!(vault.password("acme-x").unwrap().expose(), "first");
        assert_eq!(vault.status(&["acme-x".into()]).unwrap()[0].codes, 2);
        vault.write("acme-x", Some(s("second")), None, false).unwrap();
        assert_eq!(vault.status(&["acme-x".into()]).unwrap()[0].codes, 2);
        vault.write("acme-x", None, codes(&["4444"]), true).unwrap();
        assert_eq!(vault.status(&["acme-x".into()]).unwrap(), vec![Status { account: "acme-x".into(), password: false, codes: 1 }]);
    }

    #[test]
    fn an_empty_entry_is_deleted() {
        let vault = Vault::mock();
        vault.write("acme-x", Some(s("first")), None, true).unwrap();
        vault.write("acme-x", Some(s("")), None, false).unwrap();
        assert_eq!(vault.status(&["acme-x".into()]).unwrap()[0], Status { account: "acme-x".into(), password: false, codes: 0 });
        vault.write("acme-y", None, None, true).unwrap();
    }

    #[test]
    fn a_status_never_creates_an_entry() {
        let vault = Vault::mock();
        let st = vault.status(&["acme-x".into(), "acme-y".into()]).unwrap();
        assert!(st.iter().all(|s| !s.password && s.codes == 0));
    }

    #[test]
    fn over_the_limit_is_too_large_and_writes_nothing() {
        let vault = Vault::mock();
        vault.write("acme-x", Some(s("kept")), None, true).unwrap();
        let big = "a".repeat(MAX_BYTES + 1);
        assert_eq!(vault.write("acme-x", Some(s(&big)), None, false).unwrap_err().code, "VAULT_TOO_LARGE");
        // Within the raw limit but over it once quoted and escaped.
        let quoted = "\"".repeat(MAX_BYTES / 2 + 1);
        assert_eq!(vault.write("acme-x", Some(s(&quoted)), None, false).unwrap_err().code, "VAULT_TOO_LARGE");
        assert_eq!(vault.password("acme-x").unwrap().expose(), "kept");
        let fits = "a".repeat(MAX_BYTES - 20);
        vault.write("acme-x", Some(s(&fits)), None, true).unwrap();
    }

    #[test]
    fn an_unreadable_entry_is_an_error_without_its_bytes() {
        let vault = Vault::mock();
        vault.entry("acme-x").unwrap().set_secret(b"ornek-sifre-123").unwrap();
        let e = vault.password("acme-x").unwrap_err();
        assert_eq!(e.code, "VAULT_UNAVAILABLE");
        assert!(!e.detail.contains("ornek"));
        let bad = port_err(Error::BadEncoding(b"ornek-sifre-123".to_vec()));
        assert!(!format!("{bad:?}").contains("ornek"));
    }

    #[test]
    fn only_account_ids_name_entries() {
        let vault = Vault::mock();
        for bad in ["", "Acme", "a.b", "a/b", "a b", &"a".repeat(81)] {
            assert_eq!(vault.write(bad, Some(s("x")), None, true).unwrap_err().code, "VAULT_UNAVAILABLE", "{bad}");
        }
        vault.write("acme-x-2", Some(s("x")), None, true).unwrap();
    }

    /// Writes, reads and deletes a real Windows Credential Manager entry under the test service.
    /// Run by hand: `cargo test -- --ignored real_credential_manager`.
    #[test]
    #[ignore]
    #[cfg(windows)]
    fn real_credential_manager_round_trip() {
        let vault = Vault::open("Postbell test");
        let id = "self-test-vault";
        vault.write(id, Some(s("ornek-sifre-123")), codes(&["1111", "2222"]), true).unwrap();
        assert_eq!(vault.password(id).unwrap().expose(), "ornek-sifre-123");
        assert_eq!(vault.status(&[id.into()]).unwrap()[0].codes, 2);
        vault.delete(id).unwrap();
        assert_eq!(vault.password(id).unwrap_err().code, "VAULT_NOT_FOUND");
    }

    /// `cargo test -- --ignored real_delete_all`: removes every entry of one service and none of a look-alike one.
    #[test]
    #[ignore]
    #[cfg(windows)]
    fn real_delete_all_takes_only_its_service() {
        let mine = Vault::open("Postbell test");
        let other = Vault::open("Postbell test other");
        for id in ["self-test-a", "self-test-b"] {
            mine.write(id, Some(s("ornek-sifre-123")), None, true).unwrap();
        }
        other.write("self-test-a", Some(s("ornek-sifre-456")), None, true).unwrap();
        assert_eq!(mine.delete_all().unwrap(), 2);
        assert_eq!(mine.password("self-test-a").unwrap_err().code, "VAULT_NOT_FOUND");
        assert_eq!(other.password("self-test-a").unwrap().expose(), "ornek-sifre-456");
        assert_eq!(other.delete_all().unwrap(), 1);
    }
}
