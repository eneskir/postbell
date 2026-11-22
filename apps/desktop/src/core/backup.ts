import type { AccountId } from "./shares.ts";
import type { StoreFile } from "./store.ts";

// Mirrors `src-tauri/src/backup.rs` `MIN_PASSPHRASE`; both count characters, not bytes.
export const PASSPHRASE_MIN = 12;
export const passphraseLongEnough = (p: string) => [...p].length >= PASSPHRASE_MIN;

// `id` is the vault key; brand name, network and handle let a person recognise the account inside the file.
export type BackupAccount = { readonly id: AccountId; readonly brand: string; readonly network: string; readonly handle: string };
// `count`: accounts with a password or codes in the file; `created`: Unix milliseconds.
export type BackupSaved = { readonly count: number; readonly created: number };
// `changed` replaced an entry, `added` filled an account that had none, `skipped` were in the file but not here.
export type Restored = { readonly changed: number; readonly added: number; readonly skipped: number };

export function backupAccountsOf(s: StoreFile): BackupAccount[] {
  const names = new Map<string, string>(s.brands.map((b) => [b.id, b.name]));
  return s.accounts.map((a) => ({ id: a.id, brand: names.get(a.brand) ?? a.brand, network: a.network, handle: a.handle }));
}

const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

export function parseBackupSaved(raw: unknown): BackupSaved | null {
  const { count: c, created } = (raw ?? {}) as Record<string, unknown>;
  return count(c) && count(created) ? { count: c, created } : null;
}

export function parseRestored(raw: unknown): Restored | null {
  const { changed, added, skipped } = (raw ?? {}) as Record<string, unknown>;
  return count(changed) && count(added) && count(skipped) ? { changed, added, skipped } : null;
}
