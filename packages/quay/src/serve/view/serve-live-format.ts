// serve-live-format.ts — the pure formatters /live and the dashboard share.
//
// WHY THIS MODULE EXISTS (gap-routine-architecture-analysis-god-package-serve-fanout-556): these
// three functions used to live in `pages/serve-live.ts`, and `view/serve-dashboard.ts` imported
// them from there. That one import closed a directory cycle — `serve/view` → `serve/pages` →
// `serve/view` (plus the sibling `view` → `io` / `view` → `feat` back-edges) — which AC-916's
// standing guard (`packages/quay/test/directory-cycle.test.mjs`) rejects. The formatters are
// presentation helpers with no page-handler state, so they belong in the leaf `view` package:
// moving them here makes `view` import NOTHING from the other serve subpackages and the graph
// acyclic again. Behaviour and exports are byte-for-byte unchanged; only the carrier moved.

import type { SuiteStateView } from "../../observation.ts";

// gap-webui-live-implcomplete-state-render: the impl-complete boundary (implCompletedAtMs) splits an
// in-flight run into implementing (null) vs awaiting-land (non-null). The awaiting-land duration is
// now − implCompletedAtMs, where "now" is the observation instant ALREADY embedded in the snapshot
// (minutes = (now − startedAtMs)/60000) — so the render stays a pure function of LiveResult, with no
// Date.now() inside it (deterministic and testable against a fixed nowMs).
export function awaitingLandMs(t: { startedAtMs: number; minutes: number; implCompletedAtMs: number | null }): number | null {
  if (t.implCompletedAtMs == null) return null;
  const nowMs = t.startedAtMs + t.minutes * 60_000;
  return Math.max(0, nowMs - t.implCompletedAtMs);
}

export function formatAwaitingDuration(ms: number | null): string {
  if (ms == null) return "—";
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return "<1m";
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h${m}m`;
}

/** fan-in 阶段的套件状态后缀（full-suite-state.json — gap-live-fan-in-execution-phase-two-axis）：
 *  ` · suite green` 之类；无 suite 状态时为 ""（诚实无标注，不伪造「suite 在跑」）。 */
export function suiteSuffix(suite: SuiteStateView | null): string {
  if (suite == null || suite.state == null) return "";
  return ` · suite ${suite.state}`;
}
