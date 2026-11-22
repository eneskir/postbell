import { listen } from "@tauri-apps/api/event";

// Tauri's listen() resolves later; an unsubscribe that comes first runs once it does.
export function subscribe(event: string, f: (payload: unknown) => void): () => void {
  let stop: (() => void) | null = null;
  let done = false;
  void listen<unknown>(event, (e) => f(e.payload)).then((unlisten) => {
    if (done) unlisten();
    else stop = unlisten;
  });
  return () => {
    done = true;
    stop?.();
  };
}
