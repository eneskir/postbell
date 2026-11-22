export type AppInfo = {
  readonly name: string;
  readonly version: string;
};

export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string };

export function parseAppInfo(raw: unknown): ParseResult<AppInfo> {
  if (typeof raw !== "object" || raw === null) return { ok: false, code: "APP_INFO_INVALID" };
  const { name, version } = raw as Record<string, unknown>;
  if (typeof name !== "string" || name.trim() === "") return { ok: false, code: "APP_INFO_INVALID" };
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
    return { ok: false, code: "APP_INFO_INVALID" };
  }
  return { ok: true, value: { name, version } };
}
