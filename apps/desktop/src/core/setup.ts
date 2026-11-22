import type { ReadyPort } from "./port.ts";

// Mirrors Rust `Installed` (test `installed_serializes_to_contract`). An installed exe with an unreadable version arrives as `older`, maybe with an empty version.
export type Installed =
  | { readonly kind: "none" }
  | { readonly kind: "older" | "same" | "newer"; readonly version: string };

export type SetupMode = "setup" | "uninstall";

export type SetupInfo = { readonly mode: SetupMode; readonly version: string; readonly installed: Installed };

export type SetupError = { readonly code: string; readonly detail: string };

export type SetupResult = { readonly ok: true } | { readonly ok: false; readonly error: SetupError };

export type Progress = { readonly done: number; readonly total: number };

export interface SetupPort extends ReadyPort {
  state(): Promise<SetupInfo | null>;
  install(desktop: boolean): Promise<SetupResult>;
  uninstall(removeData: boolean): Promise<SetupResult>;
  forceCloseApp(): Promise<SetupResult>;
  // Opens the installed Postbell; on success the setup window closes.
  openApp(): Promise<SetupResult>;
  onProgress(f: (p: Progress) => void): () => void;
  close(): Promise<void>;
}

const VERSION = /^\d+\.\d+\.\d+$/;
const CODE = /^[A-Z][A-Z0-9_]*$/;
const record = (raw: unknown): Record<string, unknown> => (typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {});

export function parseSetupInfo(raw: unknown): SetupInfo | null {
  const r = record(raw);
  const i = record(r.installed);
  if ((r.mode !== "setup" && r.mode !== "uninstall") || typeof r.version !== "string" || !VERSION.test(r.version)) return null;
  if (i.kind === "none") return { mode: r.mode, version: r.version, installed: { kind: "none" } };
  if ((i.kind === "older" || i.kind === "same" || i.kind === "newer") && typeof i.version === "string") {
    return { mode: r.mode, version: r.version, installed: { kind: i.kind, version: i.version } };
  }
  return null;
}

// Rust `PortErr` is `{ code, detail }`; a plain-text error such as a missing command becomes `SETUP_FAILED`.
export function parseSetupError(raw: unknown): SetupError {
  const r = record(raw);
  const code = typeof r.code === "string" && CODE.test(r.code) ? r.code : "SETUP_FAILED";
  const detail = typeof r.detail === "string" ? r.detail : typeof raw === "string" ? raw : (JSON.stringify(raw) ?? "");
  return { code, detail };
}

export function parseProgress(raw: unknown): Progress | null {
  const { done, total } = record(raw);
  return Number.isSafeInteger(done) && Number.isSafeInteger(total) && (total as number) > 0 && (done as number) >= 0 && (done as number) <= (total as number)
    ? { done: done as number, total: total as number }
    : null;
}

export type Ask = "welcome" | "update" | "same" | "newer" | "confirm";

export function askOf(info: SetupInfo): Ask {
  if (info.mode === "uninstall") return "confirm";
  switch (info.installed.kind) {
    case "none":
      return "welcome";
    case "older":
      return "update";
    case "same":
      return "same";
    case "newer":
      return "newer";
  }
}

export type Job = "install" | "uninstall" | "open-app";

export type Phase =
  | { readonly kind: "ask" }
  | { readonly kind: "busy" }
  | { readonly kind: "done" }
  | { readonly kind: "error"; readonly job: Job; readonly error: SetupError };

export type ErrorButton = "retry" | "force-close" | "close";

export function errorButtons(job: Job, error: SetupError): readonly ErrorButton[] {
  if (job === "open-app") return ["close"];
  return error.code === "SETUP_APP_RUNNING" ? ["retry", "force-close"] : ["retry"];
}

export const isUpdate = (info: SetupInfo) => info.mode === "setup" && info.installed.kind === "older";
