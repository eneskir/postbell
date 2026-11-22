import { useEffect, useState } from "react";
import { MINUTE, type LocalMs } from "../core/time.ts";

export function localNow(d = new Date()): LocalMs {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()) as LocalMs;
}

export function instantOf(local: LocalMs): number {
  const d = new Date(local);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes()).getTime();
}

// Timers fire late after sleep, minimize or background throttling, so the clock is re-read on focus and visibility.
export function useNow(): LocalMs {
  const [now, setNow] = useState(() => localNow());
  useEffect(() => {
    let timer = 0;
    // UTC offsets are whole minutes, so the next UTC minute boundary is also the local one.
    const tick = () => {
      window.clearTimeout(timer);
      setNow(localNow());
      timer = window.setTimeout(tick, MINUTE - (Date.now() % MINUTE));
    };
    const wake = () => {
      if (document.visibilityState === "visible") tick();
    };
    timer = window.setTimeout(tick, MINUTE - (Date.now() % MINUTE));
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);
  return now;
}
