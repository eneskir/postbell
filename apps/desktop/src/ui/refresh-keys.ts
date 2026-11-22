// WebView2 reloads the page on F5, Ctrl+R, Ctrl+Shift+R, Ctrl+F5 and the refresh key, which loses the in-memory route.
// Tauri does not expose `AreBrowserAcceleratorKeysEnabled`, so the keys are caught in the page and reread the folders instead.
export type KeyLike = { readonly key: string; readonly ctrlKey: boolean; readonly altKey: boolean };

export function isRefreshKey(e: KeyLike): boolean {
  if (e.key === "F5" || e.key === "BrowserRefresh") return true;
  return e.ctrlKey && !e.altKey && e.key.toLowerCase() === "r";
}
