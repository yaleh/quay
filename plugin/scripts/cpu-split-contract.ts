// cpu-split-contract.ts — the SINGLE implementation of the CPU user/sys split admission rule shared
// by the two round-record writers (per-task-suite-record.ts and pre-verified-round-record.ts).
//
// gap-routine-architecture-analysis-dup-cpu-split-validation-two-copies (archguard exact-clone
// e903751a0cc007ae): the rule was a byte-identical 7-statement / 97-token block in both writers, so a
// change to the fail-closed condition could land in one copy only. It now lives here once; both
// writers IMPORT it (硬规则 5b: 在某处修好 X ≠ X 只在那一处 — the fix is the shared source, not a
// second copy).
//
// The contract (unchanged from the two former copies):
//   - The gnu-time split is written ONLY alongside a REAL cpu_time_s (the user+sys sum). A split
//     without its sum is ambiguous ⇒ a caller that passes a REAL split value with a null/absent
//     cpu_time_s fails closed (硬规则 3b: 读不懂 ≠ 合格).
//   - Each component is a non-negative number or explicit null (AC6, never a misleading 0).
//   - An EMPTY string / the literal "null" / the literal 0 means "considered + unavailable" ⇒ the
//     component is omitted, NOT fail-closed. This is load-bearing: a bash caller whose capture has no
//     gnu-time (e.g. a doc-only skip) passes `--cpu-user-s ""` and must not trip the gate.
//   - A negative or non-numeric value is still a REAL attempt at a split ⇒ it enters validation and
//     fails closed; an invalid split is never silently swallowed.
//
// Pure: no I/O, no process state. The callers own the record shape; this module owns only whether a
// passed split is admissible and, if so, its normalized numeric components.

/** The two gnu-time columns, keyed by the caller's option field and the CLI flag they came from. */
const SPLIT_FLAGS = [
  ["cpu-user-s", "cpuUserS"],
  ["cpu-sys-s", "cpuSysS"],
] as const;

/**
 * True iff the caller passed something that is a REAL attempt at a split: not absent, not empty,
 * not the literal "null", and not the literal 0 (which normalizes to omitted, AC6). Negative /
 * non-numeric values count as real attempts so they reach validation and fail closed.
 */
function isRealSplitValue(raw) {
  if (raw == null) return false;
  const s = String(raw).trim();
  if (s === "" || s === "null") return false;
  const v = Number(s);
  return !(Number.isFinite(v) && v === 0);
}

/**
 * Resolve the CPU user/sys split for a round record.
 *
 * Returns `{ error }` when the split is not admissible (the caller returns it verbatim, so the
 * writer exits fail-closed with nothing written), or `{ cpuUserS, cpuSysS }` with the normalized
 * components (each `undefined` when omitted — never a fabricated 0).
 */
export function resolveCpuSplit(o: { cpuUserS?: unknown; cpuSysS?: unknown; cpuTimeS?: number | null }):
  | { error: string }
  | { cpuUserS: number | undefined; cpuSysS: number | undefined } {
  const hasRealSplit = SPLIT_FLAGS.some(([, key]) => isRealSplitValue(o[key]));
  if (!hasRealSplit) return { cpuUserS: undefined, cpuSysS: undefined };
  if (o.cpuTimeS == null) {
    return { error: "--cpu-user-s/--cpu-sys-s require a real --cpu-time-s (the gnu-time sum); a split without its sum is ambiguous" };
  }
  const out: { cpuUserS?: number; cpuSysS?: number } = {};
  for (const [name, key] of SPLIT_FLAGS) {
    const raw = o[key];
    if (raw == null) continue;
    const s = String(raw).trim();
    if (s === "" || s === "null") continue; // considered + unavailable → omitted
    const v = Number(s);
    if (!Number.isFinite(v) || v < 0) {
      return { error: `--${name} must be a non-negative number, 0, or null (got ${JSON.stringify(raw)})` };
    }
    if (v === 0) continue; // 0 → omitted (AC6)
    out[key] = v;
  }
  return { cpuUserS: out.cpuUserS, cpuSysS: out.cpuSysS };
}
