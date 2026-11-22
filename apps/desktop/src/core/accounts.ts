import type { Language } from "./manifest.ts";
import { uniqueId } from "./names.ts";
import { formatsOf, NETWORKS, networkOf, type Account, type AccountId, type BrandId, type Network, type Share } from "./shares.ts";
import type { StoreFile } from "./store.ts";

export const HANDLE_MAX = 100;

export function cleanHandle(raw: string): string | null {
  const t = raw.replace(/[\s\p{C}]/gu, "").replace(/^@+/, "");
  return t === "" ? null : [...`@${t}`].slice(0, HANDLE_MAX).join("");
}

// Networks compare handles case-insensitively.
const handleKey = (h: string) => (cleanHandle(h) ?? "").toLowerCase();

export type AccountDraft = { readonly network: Network; readonly handle: string; readonly language: Language };

export type SetupStep = "add-account" | "enter-times";

export function setupStepOf(accounts: readonly Account[], brand: BrandId): SetupStep | null {
  const own = accounts.filter((a) => a.brand === brand);
  if (own.length === 0) return "add-account";
  return own.some((a) => Object.values(a.times).some((t) => t !== undefined)) ? null : "enter-times";
}

export type AccountProblem =
  | { readonly field: "handle"; readonly code: "empty" | "taken" }
  | { readonly field: "language"; readonly code: "taken"; readonly by: string };

export function accountProblems(s: StoreFile, brand: BrandId, d: AccountDraft, self?: AccountId): AccountProblem[] {
  const out: AccountProblem[] = [];
  const others = s.accounts.filter((a) => a.id !== self && a.brand === brand && a.network === d.network);
  const handle = cleanHandle(d.handle);
  if (handle === null) out.push({ field: "handle", code: "empty" });
  else if (others.some((a) => handleKey(a.handle) === handle.toLowerCase())) out.push({ field: "handle", code: "taken" });
  const sameLanguage = formatsOf(d.network).length > 0 ? others.find((a) => a.language === d.language) : undefined;
  if (sameLanguage) out.push({ field: "language", code: "taken", by: sameLanguage.handle });
  return out;
}

// `ok: false` with no problems: the brand or account is no longer in the store, which stays unchanged.
export type AccountResult =
  | { readonly ok: true; readonly store: StoreFile; readonly id: AccountId }
  | { readonly ok: false; readonly problems: readonly AccountProblem[] };

export function addAccount(s: StoreFile, brand: BrandId, d: AccountDraft): AccountResult {
  if (!s.brands.some((b) => b.id === brand)) return { ok: false, problems: [] };
  const problems = accountProblems(s, brand, d);
  const handle = cleanHandle(d.handle);
  if (problems.length || handle === null) return { ok: false, problems };
  const id = uniqueId(`${brand}-${d.network}`, new Set(s.accounts.map((a) => a.id))) as AccountId;
  const account: Account = { id, brand, network: d.network, handle, language: d.language, times: {} };
  return { ok: true, id, store: { ...s, accounts: [...s.accounts, account] } };
}

export function updateAccount(s: StoreFile, id: AccountId, patch: Pick<AccountDraft, "handle" | "language">): AccountResult {
  const a = s.accounts.find((x) => x.id === id);
  if (!a) return { ok: false, problems: [] };
  const problems = accountProblems(s, a.brand, { network: a.network, ...patch }, id);
  const handle = cleanHandle(patch.handle);
  if (problems.length || handle === null) return { ok: false, problems };
  if (handle === a.handle && patch.language === a.language) return { ok: true, id, store: s };
  const next: Account = { ...a, handle, language: patch.language };
  return { ok: true, id, store: { ...s, accounts: s.accounts.map((x) => (x.id === id ? next : x)) } };
}

export function removeAccount(s: StoreFile, id: AccountId): StoreFile {
  return s.accounts.some((a) => a.id === id) ? { ...s, accounts: s.accounts.filter((a) => a.id !== id) } : s;
}

export type AccountRow =
  | { readonly kind: "account"; readonly account: Account }
  | { readonly kind: "missing"; readonly network: Network; readonly language: Language; readonly languageShown: boolean };

const open = (s: Share) => s.status.kind !== "done" && s.status.kind !== "skipped";

export function accountRows(accounts: readonly Account[], brand: BrandId, shares: readonly Share[]): AccountRow[] {
  const rows: AccountRow[] = [];
  for (const network of NETWORKS) {
    const own = accounts.filter((a) => a.brand === brand && a.network === network);
    for (const account of own) rows.push({ kind: "account", account });
    const wanted = shares.filter((s) => s.brand === brand && s.account === null && open(s) && networkOf(s.platform) === network).map((s) => s.content.language);
    const languages = own.length === 0 ? wanted.slice(0, 1) : [...new Set(wanted)];
    for (const language of languages) rows.push({ kind: "missing", network, language, languageShown: own.length > 0 });
  }
  return rows;
}

export function draftFor(accounts: readonly Account[], brand: BrandId, shares: readonly Share[]): AccountDraft {
  const network = NETWORKS.find((n) => !accounts.some((a) => a.brand === brand && a.network === n)) ?? "x";
  const language = shares.find((s) => s.brand === brand)?.content.language ?? "tr";
  return { network, handle: "", language };
}
