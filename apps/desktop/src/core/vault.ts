import type { AccountId, Network } from "./shares.ts";

// Mirrors `src-tauri/src/vault.rs` `Status`: what the UI may know about an account's vault entry, never the values.
export type VaultStatus = { readonly account: AccountId; readonly password: boolean; readonly codes: number };

// What the form typed; an empty field means "keep the stored value" when editing.
export type VaultDraft = { readonly password: string; readonly codes: string };
export const EMPTY_VAULT_DRAFT: VaultDraft = { password: "", codes: "" };

// Sent to `vault_write`: `null` keeps the stored value unless `replace`, which makes the entry exactly these values.
export type VaultChange = { readonly password: string | null; readonly codes: readonly string[] | null; readonly replace: boolean };

// Windows keeps at most 2560 bytes per entry (`vault::MAX_BYTES`); these caps leave room for the entry's own format.
export const PASSWORD_MAX = 256;
export const CODES_MAX = 1600;

// One code per line; blank lines and the spaces around a code are dropped.
export const codesOf = (text: string): string[] =>
  text
    .split(/\r?\n/)
    .map((c) => c.trim())
    .filter((c) => c !== "");

// A new account replaces whatever an old account with the same id left behind; an edit changes only the fields typed in.
export function vaultChangeOf(d: VaultDraft, isNew: boolean): VaultChange | null {
  const codes = codesOf(d.codes);
  const password = d.password === "" ? null : d.password;
  if (isNew) return { password, codes, replace: true };
  if (password === null && codes.length === 0) return null;
  return { password, codes: codes.length === 0 ? null : codes, replace: false };
}

export const hasSecrets = (c: VaultChange) => c.password !== null || (c.codes?.length ?? 0) > 0;

// Threads signs in with the Instagram account, so a Threads account without its own password says so.
export const signsInWithInstagram = (n: Network, status: VaultStatus | undefined) => n === "threads" && !status?.password;

export function parseVaultStatus(raw: unknown): VaultStatus[] | null {
  if (!Array.isArray(raw)) return null;
  const out: VaultStatus[] = [];
  for (const x of raw) {
    const { account, password, codes } = (x ?? {}) as Record<string, unknown>;
    if (typeof account !== "string" || typeof password !== "boolean" || !Number.isSafeInteger(codes) || (codes as number) < 0) return null;
    out.push({ account: account as AccountId, password, codes: codes as number });
  }
  return out;
}
