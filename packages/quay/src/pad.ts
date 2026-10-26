// pad.ts — the ONE definition of the two-digit zero-pad every surface uses to format a
// clock/date component (observation's journal stamp; the serve layer's HH:MM labels).
//
// gap-routine-semantic-dedup-scan-pad2: three copies of this one format lived at
// observation.ts (Core), serve-render.ts (the serve-layer canonical, already exported and
// already imported by serve-dashboard.ts) and serve-dashboard.ts (a redundant redeclaration
// in a module that imports from serve-render). Core cannot import the view layer, so the
// shared home has to be a core-layer LEAF — this module — with the serve layer re-exporting
// it; the same disposition ../relative-time.ts took for the "X ago" string.
//
// The sparklineSvg copy in serve-dashboard.ts is deliberately NOT folded in: that function's
// source is serialized via `Function.prototype.toString()` into the browser, so it must stay
// self-contained (no closure over module-level helpers) — see its header comment.
//
// Semantics are `String(n).padStart(2, "0")`, byte-identical to the observation/dashboard
// bodies it replaces. It also matches what serve-render's body produced on EVERY actual call
// site (all of them pass non-negative integers < 100: hours, minutes, seconds, month+1, day);
// unlike that body it does not turn a negative number into `0-1`.
export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
