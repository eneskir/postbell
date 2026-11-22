import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { parseAppInfo } from "../../core/app-info.ts";
import type { PackageDir, PackageFile } from "../../core/packages.ts";
import { parseAlarmTarget, parsePortError, RESTORE_RESULTS, SHARE_OPEN_RESULTS, type Port, type PortResult } from "../../core/port.ts";
import { serializeStore } from "../../core/store.ts";
import { parseVaultStatus } from "../../core/vault.ts";
import { subscribe } from "./listen.ts";

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<PortResult<T>> {
  try {
    return { ok: true, value: await invoke<T>(cmd, args) };
  } catch (e) {
    return { ok: false, error: parsePortError(e) };
  }
}

const isFiles = (v: unknown): v is PackageFile[] =>
  Array.isArray(v) && v.every((x) => typeof x === "object" && x !== null && typeof x.path === "string" && Number.isSafeInteger(x.size) && x.size >= 0);

function parsePackages(raw: unknown): PackageDir[] | null {
  if (!Array.isArray(raw)) return null;
  const out: PackageDir[] = [];
  for (const p of raw) {
    const { dir, manifest, files } = (p ?? {}) as Record<string, unknown>;
    if (typeof dir !== "string" || !(manifest === null || typeof manifest === "string") || !isFiles(files)) return null;
    out.push({ dir, manifest, files: files.map((f) => ({ path: f.path, size: f.size })) });
  }
  return out;
}

export const tauriPort: Port = {
  async appInfo() {
    try {
      return parseAppInfo(await invoke<unknown>("app_info"));
    } catch {
      return { ok: false, code: "APP_INFO_UNAVAILABLE" };
    }
  },
  async ready(rendered) {
    await invoke("ready", { rendered });
  },
  async selfTest() {
    const r = await call<{ active?: unknown; add_record?: unknown }>("self_test_options");
    return r.ok ? { active: r.value.active === true, addRecord: r.value.add_record === true } : { active: false, addRecord: false };
  },
  packages: {
    async read(folder) {
      const r = await call<unknown>("packages_read", { folder });
      if (!r.ok) return r;
      const list = parsePackages(r.value);
      return list ? { ok: true, value: list } : { ok: false, error: { code: "shell-unavailable", detail: "PACKAGES_SHAPE" } };
    },
  },
  files: {
    url: (folder, path) => convertFileSrc(`${folder.replace(/[\\/]+$/, "")}/${path}`, "postbell-file"),
    reveal: (folder, path) => call<void>("file_reveal", { folder, path }),
    async restore(folder, path) {
      const r = await call<unknown>("file_restore", { folder, path });
      if (!r.ok) return r;
      const v = RESTORE_RESULTS.find((x) => x === r.value);
      return v ? { ok: true, value: v } : { ok: false, error: { code: "shell-unavailable", detail: `file_restore: ${JSON.stringify(r.value)}` } };
    },
  },
  links: {
    async openSharePage(platform, text) {
      const r = await call<unknown>("share_page_open", { platform, text });
      if (!r.ok) return r;
      const v = SHARE_OPEN_RESULTS.find((x) => x === r.value);
      return v ? { ok: true, value: v } : { ok: false, error: { code: "shell-unavailable", detail: `share_page_open: ${JSON.stringify(r.value)}` } };
    },
  },
  dialogs: {
    async pickFolder() {
      const r = await call<unknown>("dialog_pick_folder");
      if (!r.ok) return r;
      return r.value === null || typeof r.value === "string" ? { ok: true, value: r.value } : { ok: false, error: { code: "shell-unavailable", detail: "DIALOG_SHAPE" } };
    },
  },
  window: {
    minimize: () => getCurrentWindow().minimize(),
    toggleMaximize: () => getCurrentWindow().toggleMaximize(),
    close: () => getCurrentWindow().close(),
  },
  alarms: {
    // Sent as JSON text so the shell parses it and logs a bad plan instead of failing the call.
    set: (plan) => call<void>("alarms_set", { plan: JSON.stringify(plan) }),
    onOpen: (open) => subscribe("alarm-open", (payload) => open(parseAlarmTarget(payload))),
  },
  tray: {
    set: (texts) => call<void>("tray_set", { texts: JSON.stringify(texts) }),
  },
  vault: {
    async status(accounts) {
      const r = await call<unknown>("vault_status", { accounts });
      if (!r.ok) return r;
      const list = parseVaultStatus(r.value);
      return list ? { ok: true, value: list } : { ok: false, error: { code: "shell-unavailable", detail: "VAULT_STATUS_SHAPE" } };
    },
    write: (account, { password, codes, replace }) => call<void>("vault_write", { account, password, codes, replace }),
    async password(account) {
      const r = await call<unknown>("vault_password", { account });
      if (!r.ok) return r;
      return typeof r.value === "string" ? { ok: true, value: r.value } : { ok: false, error: { code: "shell-unavailable", detail: "VAULT_PASSWORD_SHAPE" } };
    },
    copy: (account) => call<void>("vault_copy", { account }),
    remove: (account) => call<void>("vault_delete", { account }),
  },
  store: {
    async load() {
      const r = await call<{ path?: unknown; text?: unknown }>("store_load");
      if (!r.ok) return r;
      const { path, text } = r.value;
      if (typeof path !== "string" || !(text === null || typeof text === "string")) {
        return { ok: false, error: { code: "shell-unavailable", detail: "STORE_LOAD_SHAPE" } };
      }
      return { ok: true, value: { path, text } };
    },
    save: (store) => call<void>("store_save", { text: serializeStore(store) }),
    backup: () => call<string>("store_backup"),
  },
};
