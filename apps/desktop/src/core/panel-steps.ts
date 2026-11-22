import { recordOf, type Share, type ShareBlocker, type ShareRecord } from "./shares.ts";
import type { LocalMs } from "./time.ts";

export type StepState = { readonly kind: "ready" } | { readonly kind: "blocked"; readonly reason: ShareBlocker } | { readonly kind: "done" };

export type PanelSteps = {
  readonly reveal: boolean;
  readonly share: StepState;
  readonly mark: StepState;
  readonly skip: boolean;
};

const finished = (s: Share) => s.status.kind === "done" || s.status.kind === "skipped";

function firstBlocker(s: Share): ShareBlocker | null {
  if (s.blockers.includes("account-missing")) return "account-missing";
  if (s.blockers.includes("file-missing")) return "file-missing";
  return null;
}

export function panelSteps(s: Share): PanelSteps {
  const blocker = firstBlocker(s);
  const blocked = (reason: ShareBlocker): StepState => ({ kind: "blocked", reason });
  return {
    reveal: !s.blockers.includes("file-missing"),
    share: blocker ? blocked(blocker) : { kind: "ready" },
    mark: finished(s) ? { kind: "done" } : blocker ? blocked(blocker) : { kind: "ready" },
    skip: !finished(s),
  };
}

export type MarkResult = { readonly ok: true; readonly record: ShareRecord } | { readonly ok: false; readonly why: ShareBlocker | "finished" };

export function markShare(s: Share, status: ShareRecord["status"], at: LocalMs): MarkResult {
  if (finished(s)) return { ok: false, why: "finished" };
  const blocker = firstBlocker(s);
  if (status === "done" && blocker) return { ok: false, why: blocker };
  return { ok: true, record: recordOf(s, status, at) };
}
