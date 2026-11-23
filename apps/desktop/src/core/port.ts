import type { AppInfo, ParseResult } from "./app-info.ts";
import type { BackupAccount, BackupSaved, Restored } from "./backup.ts";
import type { Platform } from "./manifest.ts";
import type { PackageDir } from "./packages.ts";
import type { AccountId, BrandId, ShareId } from "./shares.ts";
import type { StoreFile } from "./store.ts";
import type { LocalDate } from "./time.ts";
import type { VaultChange, VaultStatus } from "./vault.ts";

// The app and the setup windows share it.
export interface ReadyPort {
  // The first frame is drawn; the shell shows the window. `rendered` is recorded only in self-test mode.
  ready(rendered: string): Promise<void>;
}

export interface Port extends ReadyPort {
  appInfo(): Promise<ParseResult<AppInfo>>;
  // Self-test mode (real shell only): the UI adds a test record and the shell keeps the window hidden.
  selfTest(): Promise<{ readonly active: boolean; readonly addRecord: boolean }>;
  readonly packages: {
    // Reads only a registered brand folder; any other path gives `folder-not-registered`.
    read(folder: string): Promise<PortResult<readonly PackageDir[]>>;
  };
  // `path` is relative to the brand folder, with "/"; the shell serves only registered brand folders.
  readonly files: {
    url(folder: string, path: string): string;
    // Opens Explorer with the file selected; a missing file gives `file-missing`, a path outside the folder is refused.
    reveal(folder: string, path: string): Promise<PortResult<void>>;
    // Copies a file picked in the Windows file dialog into the package under its manifest name, never overwriting.
    // The picked path never reaches the UI; another extension gives `file-type`.
    restore(folder: string, path: string): Promise<PortResult<RestoreResult>>;
  };
  // Opens the platform's share page in the default browser (URLs in `src-tauri/src/open.rs`); only X takes the text. `text-dropped`: the text did not fit the URL.
  readonly links: {
    openSharePage(platform: Platform, text: string): Promise<PortResult<ShareOpenResult>>;
  };
  // The OS folder picker; null when cancelled. The picked folder stays unreadable until it is in the store (`packages.read` allow list).
  readonly dialogs: {
    pickFolder(): Promise<PortResult<string | null>>;
  };
  // Dragging, double-click maximize and snapping come from `data-tauri-drag-region`, not from the port.
  readonly window: {
    minimize(): Promise<void>;
    toggleMaximize(): Promise<void>;
    close(): Promise<void>;
  };
  // `set` takes the whole list on every change. A notification click focuses the window and reports its target, null for a grouped one (Home).
  readonly alarms: {
    set(plan: AlarmPlan): Promise<PortResult<void>>;
    onOpen(open: (target: AlarmTarget | null) => void): () => void;
  };
  // The first call creates the tray icon, later calls update it. While it exists and `hideOnClose` is on («Kapatınca simgeye küçül»),
  // closing hides the window and the app keeps running; off, closing quits (`src-tauri/src/tray.rs`).
  readonly tray: {
    set(texts: TrayTexts, hideOnClose: boolean): Promise<PortResult<void>>;
  };
  // «Bilgisayar açılınca başlat»: a value in the user's Run key starts the app at sign-in, hidden in the tray (`src-tauri/src/autostart.rs`).
  readonly autostart: {
    set(on: boolean): Promise<PortResult<void>>;
  };
  // Passwords and backup codes in the Windows Credential Manager, one entry per account (`src-tauri/src/vault.rs`).
  // The UI never gets a backup code, and gets a password only from `password`; `copy` keeps it in the shell.
  readonly vault: {
    status(accounts: readonly AccountId[]): Promise<PortResult<readonly VaultStatus[]>>;
    write(account: AccountId, change: VaultChange): Promise<PortResult<void>>;
    password(account: AccountId): Promise<PortResult<string>>;
    // The clipboard copy is left out of Windows' clipboard history and cleared after 30 seconds if still there.
    copy(account: AccountId): Promise<PortResult<void>>;
    // An account without an entry is not an error.
    remove(account: AccountId): Promise<PortResult<void>>;
  };
  // A passphrase-encrypted file of the vault entries in the age format (`src-tauri/src/backup.rs`); the UI never sees a path.
  readonly backup: {
    // Asks where to save under a dated name, then writes the entries of `accounts`; null when the dialog is cancelled.
    save(accounts: readonly BackupAccount[], passphrase: string, today: LocalDate): Promise<PortResult<BackupSaved | null>>;
    // Asks for a backup file and keeps it in the shell; its path to show, or null when cancelled. Restore reads the kept one.
    pick(): Promise<PortResult<string | null>>;
    // Writes the picked file's entries for `accounts` only, and nothing unless the whole file opens with the passphrase.
    restore(passphrase: string, accounts: readonly AccountId[]): Promise<PortResult<Restored>>;
  };
  readonly store: {
    // The file path and raw text; `text` is null when the file does not exist.
    load(): Promise<PortResult<{ readonly path: string; readonly text: string | null }>>;
    // Writes a temporary file and renames it; the shell also refuses when the file on disk is a newer version.
    save(store: StoreFile): Promise<PortResult<void>>;
    // Copies an unreadable file next to itself and returns the copy's path.
    backup(): Promise<PortResult<string>>;
  };
}

// Sent to the shell's alarm service (`src-tauri/src/alarms.rs` `Plan`); `at` is Unix milliseconds.
export type AlarmTarget = { readonly brand: BrandId; readonly share: ShareId };
export type WireAlarm = {
  readonly id: string;
  readonly at: number;
  readonly title: string;
  readonly body: string;
  readonly brand: string;
  readonly label: string;
  readonly target: AlarmTarget;
};
export type AlarmPlan = {
  readonly alarms: readonly WireAlarm[];
  readonly texts: { readonly open: string; readonly openHome: string; readonly many: string };
};

// Mirrors `src-tauri/src/tray.rs` `Texts`.
export type TrayTexts = {
  readonly open: string;
  readonly quit: string;
  readonly tooltip: string;
  readonly hiddenTitle: string;
  readonly hiddenBody: string;
};

export function parseAlarmTarget(raw: unknown): AlarmTarget | null {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as { brand?: unknown; share?: unknown };
  return typeof r.brand === "string" && typeof r.share === "string" ? { brand: r.brand as BrandId, share: r.share as ShareId } : null;
}

export type RestoreResult = "copied" | "present" | "cancelled";
export const RESTORE_RESULTS: readonly RestoreResult[] = ["copied", "present", "cancelled"];

export type ShareOpenResult = "opened" | "text-dropped";
export const SHARE_OPEN_RESULTS: readonly ShareOpenResult[] = ["opened", "text-dropped"];

export type PortErrorCode =
  | "store-read"
  | "store-write"
  | "store-newer-version"
  | "store-backup"
  | "folder-not-registered"
  | "folder-missing"
  | "folder-read"
  | "dialog-failed"
  | "file-missing"
  | "file-type"
  | "file-write"
  | "open-failed"
  | "vault-unavailable"
  | "vault-too-large"
  | "vault-not-found"
  | "clipboard-failed"
  | "backup-passphrase-short"
  | "backup-empty"
  | "backup-unreadable"
  | "backup-not-picked"
  | "backup-write"
  | "backup-failed"
  | "autostart-failed"
  | "shell-unavailable";

export type PortError = { readonly code: PortErrorCode; readonly detail: string };

export type PortResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: PortError };

const CODES: readonly PortErrorCode[] = ["store-read", "store-write", "store-newer-version", "store-backup", "folder-not-registered", "folder-missing", "folder-read", "dialog-failed", "file-missing", "file-type", "file-write", "open-failed", "vault-unavailable", "vault-too-large", "vault-not-found", "clipboard-failed", "backup-passphrase-short", "backup-empty", "backup-unreadable", "backup-not-picked", "backup-write", "backup-failed", "autostart-failed", "shell-unavailable"];

export function parsePortError(raw: unknown): PortError {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as { code?: unknown; detail?: unknown };
  const code = typeof r.code === "string" ? r.code.toLowerCase().replaceAll("_", "-") : "";
  const detail = typeof r.detail === "string" ? r.detail : typeof raw === "string" ? raw : JSON.stringify(raw);
  return { code: (CODES as readonly string[]).includes(code) ? (code as PortErrorCode) : "shell-unavailable", detail };
}
