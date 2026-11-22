import type { PortErrorCode, PortResult } from "./port.ts";
import { emptyStore, parseStoreText, type StoreFile } from "./store.ts";

export type Screen<T, E extends string = string> =
  | { readonly kind: "loading" }
  | { readonly kind: "empty" }
  | { readonly kind: "ready"; readonly value: T }
  | { readonly kind: "error"; readonly code: E };

export type StoreScreenError = PortErrorCode | "store-unreadable" | "store-newer-version";

// `store` is null when the file is unreadable or from a newer version, so it is never overwritten.
export type LoadedStore = { readonly screen: Screen<StoreFile, StoreScreenError>; readonly store: StoreFile | null };

export function loadStore(loaded: PortResult<{ readonly text: string | null }>): LoadedStore {
  if (!loaded.ok) return { screen: { kind: "error", code: loaded.error.code }, store: null };
  const state = parseStoreText(loaded.value.text);
  switch (state.kind) {
    case "empty": {
      const store = emptyStore();
      return { screen: storeScreenOf(store), store };
    }
    case "ready":
      return { screen: storeScreenOf(state.store), store: state.store };
    case "unreadable":
      return { screen: { kind: "error", code: "store-unreadable" }, store: null };
    case "newer-version":
      return { screen: { kind: "error", code: "store-newer-version" }, store: null };
    default: {
      const never: never = state;
      return never;
    }
  }
}

export const storeScreenOf = (store: StoreFile): Screen<StoreFile, StoreScreenError> => (store.brands.length ? { kind: "ready", value: store } : { kind: "empty" });
