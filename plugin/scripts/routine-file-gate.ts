// routine-file-gate.mjs — DIR-051: the MECHANICAL quality/dedup/rate gate for routine findings (the
// DIR-051 adversarial audit refuted the gate as prose-only — this makes it runnable). A routine FILES
// findings as tasks; before one lands, it must pass this gate: QUALITY (a real, actionable finding —
// carries a `## Finding` with reproduction evidence, not a vague concern), DEDUP (not already on the
// board — by a stable finding key), RATE (≤ K new routine-filed tasks per window). This does NOT make
// the FILE-only-vs-execute boundary mechanical (that is the driving agent's contract, backstopped by
// a post-fire "a routine produced no commits, only task files" check in the skill) — but it removes
// the "queue-spam is prose-capped only" hole the audit found.
//
// Pure functions are exported and unit-tested; `main()` is a thin CLI over them.

import fs from "node:fs";
import path from "node:path";
import { isDirectEntry } from "./gate-script-base.ts";

export const DEFAULT_RATE = 3; // ≤ K routine-filed tasks per window (tunable)

// ── findingKey ───────────────────────────────────────────────────────────────────────────────────
// A stable dedup key from a task's `## Finding` section (normalized: lowercased, whitespace-collapsed,
// first 200 chars). Two findings with the same normalized finding text are duplicates.
export function findingKey(taskText) {
  const m = String(taskText).match(/##\s+Finding\s*\n([\s\S]*?)(?:\n##\s|\n*$)/i);
  const body = (m ? m[1] : "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
  return body;
}

// ── quality ──────────────────────────────────────────────────────────────────────────────────────
// A finding is actionable iff it has a non-trivial `## Finding` AND cites reproduction evidence (a
// command, a path, a diff/commit ref, a test name) — not a vague concern.
const EVIDENCE = /(`[^`]+`|\b\w[\w./-]*\.(mjs|js|ts|md|json|sh)\b|\b[0-9a-f]{7,40}\b|exit\s+\d|npx |node |git )/i;
export function isActionable(taskText) {
  const key = findingKey(taskText);
  if (key.length < 20) return false;                 // a real finding is more than a phrase
  const m = String(taskText).match(/##\s+Finding\s*\n([\s\S]*?)(?:\n##\s|\n*$)/i);
  return !!m && EVIDENCE.test(m[1]);                 // must cite concrete evidence
}

// ── gateFinding ──────────────────────────────────────────────────────────────────────────────────
// candidate: the new task text. opts: { existingKeys:Set|[], recentCount:number, K:number }.
// Returns { accept, reason }.
export function gateFinding(candidate: string, { existingKeys = [] as string[], recentCount = 0, K = DEFAULT_RATE }: { existingKeys?: Set<string> | string[]; recentCount?: number; K?: number } = {}) {
  if (!isActionable(candidate)) return { accept: false, reason: "quality: no actionable `## Finding` with reproduction evidence" };
  const keys = existingKeys instanceof Set ? existingKeys : new Set(existingKeys);
  const key = findingKey(candidate);
  if (keys.has(key)) return { accept: false, reason: "dedup: an equivalent finding is already on the board" };
  if (recentCount >= K) return { accept: false, reason: `rate: ${recentCount} routine-filed tasks this window ≥ cap ${K}` };
  return { accept: true, reason: "accepted: actionable, novel, within rate" };
}

// ── boardKeys ────────────────────────────────────────────────────────────────────────────────────
// Gather existing finding keys from a board dir (task .md files) for the dedup check.
// excludePath: when provided, skip the file whose resolved/real path matches this path — so a
// candidate physically IN the board dir is not counted as its own duplicate.
export function boardKeys(boardDir: string, excludePath: string | null = null): Set<string> {
  const keys = new Set<string>();
  let files;
  try { files = fs.readdirSync(boardDir).filter((f) => f.endsWith(".md")); } catch { return keys; }
  let skip = null;
  if (excludePath) { try { skip = fs.realpathSync(path.resolve(excludePath)); } catch { skip = path.resolve(excludePath); } }
  for (const f of files) {
    try {
      const abs = path.join(boardDir, f);
      let absReal; try { absReal = fs.realpathSync(abs); } catch { absReal = path.resolve(abs); }
      if (skip && absReal === skip) continue;
      const k = findingKey(fs.readFileSync(abs, "utf8"));
      if (k) keys.add(k);
    } catch { /* skip */ }
  }
  return keys;
}

// ── FILING PRIMITIVES (gap-ac214-fifth-crossing-routine-detects-but-nothing-acts) ────────────────
//
// WHY THIS SECTION EXISTS (measured): the three gates above were reached ONLY by the AGENT channel
// (`plugin/skills/routines/SKILL.md` Phase 3). The MECHANICAL channel — `probe-routine.ts` driven by
// the quality driver's Layer-1b routine table — appended structured findings to
// `.quay/routine-findings.jsonl` and STOPPED there. Measured consequence: 61 finding records / 57
// distinct findingIds landed in that carrier, and `grep -rl <id> tasks/` matched 0 of them (the only
// 6 hits were the routine's OWN task quoting its output) ⇒ **no routine finding had ever become a
// task**, across every routine. The carrier had no consumer; the finding was a record, not an action.
// ⇒ The mechanical channel gets the filing step it was missing, reusing the SAME three gates rather
// than growing a second quality judge.
//
// ⛔ FILE-ONLY, still: this section writes TASK FILES ONLY. A routine names work; it never executes
// it (the closing action for any filed task stays with the dispatch chain). The probe's own
// READ-ONLY guard is unaffected — the probe runs BEFORE this, and `probe-routine.ts` step ⑤ rejects a
// run whose probe wrote anything. This runs after, in the routine process, and only ever creates
// `tasks/<id>.md`.

/** Every mechanically filed task carries this id prefix — the ONE way to count "filed by a routine"
 *  (the rate window and AC6's production reading both key on it, ⛔ never on a hand-kept counter). */
export const ROUTINE_TASK_PREFIX = "gap-routine-";

/** The rate window (ms). A day, because the finding rate is a per-day property of the corpus. */
export const FILING_WINDOW_MS = 24 * 60 * 60 * 1000;

/** A finding the routine has ALREADY decided to emit. Structural only — this module does not know
 *  which probe produced it (that is what makes the filing step generic across routines). */
export interface FileableFinding {
  id: string | null;
  kind: string | null;
  symbols: string[];
  files: string[];
  verdict: string | null;
  rationale: string;
  suggestedAction: string | null;
  /** Producer/subject the finding names, when the probe's contract carries one. `null` = the finding
   *  names none (⛔ not the same as "named one that is not registered" — 硬规则 3b). */
  producer?: string | null;
}

/** Declared no-op actions — a finding whose action is one of these is a *measurement*, not work.
 *  Without this the semantic-dedup scan's `suggestedAction: "leave"` verdicts (the majority of that
 *  routine's output) would be filed as tasks on every run: "a noisy track gets switched off". */
const NO_ACTION_RE = /^\s*(leave|none|nothing|no[-_ ]?action|ignore|ignore-it|ok|accept(ed)?|fine)\b/i;

/** Does this finding ask for work? ⛔ Not a boolean gate on its own — it is ONE of the reasons the
 *  filing step gives for disposing of a finding, and the reason is always recorded verbatim. */
export function hasRequestedAction(f: FileableFinding): boolean {
  const a = String(f.suggestedAction ?? "").trim();
  return a.length > 0 && !NO_ACTION_RE.test(a);
}

/** The candidate task text for a finding. Rendered so that the EXISTING `gateFinding` quality gate
 *  accepts it iff the finding really carries reproduction evidence — i.e. the gate is reused, not
 *  bypassed: `files` (path:line) and `symbols` are exactly the concreteness `isActionable` demands. */
export function routineFindingCandidateText(f: FileableFinding): string {
  return [
    "## Finding",
    String(f.rationale ?? "").trim(),
    "",
    `files: ${f.files.map((x) => `\`${x}\``).join(", ")}`,
    `symbols: ${f.symbols.map((x) => `\`${x}\``).join(", ")}`,
    f.verdict ? `verdict: \`${f.verdict}\`` : "",
    f.kind ? `kind: \`${f.kind}\`` : "",
    f.suggestedAction ? `suggestedAction: \`${f.suggestedAction}\`` : "",
    "",
  ].filter((l) => l !== null).join("\n");
}

/** Deterministic task id for a finding. Slugged from the routine name + the finding id (the probe's
 *  own stable identifier for it), NOT from a counter — a counter would make the same finding a new
 *  task after every restart. Collisions between two DIFFERENT findings that slug identically are
 *  disambiguated by the caller with a suffix derived from the finding key (⛔ never by overwriting). */
export function routineTaskId(routine: string, findingId: string | null): string {
  const slug = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const a = slug(routine).slice(0, 32) || "routine";
  const b = slug(findingId).slice(0, 48) || "finding";
  return `${ROUTINE_TASK_PREFIX}${a}-${b}`.slice(0, 100).replace(/-$/, "");
}

/** Read a producer registry (`{ producers: [{id}, …] }`) into a set of registered ids.
 *  Unreadable / malformed / empty ⇒ **null**, which is a THIRD value distinct from "read it and it
 *  had no producers" (硬规则 3b: 读不懂 must not be shaped like 读懂了). Callers must fail closed on
 *  null rather than treating it as "nothing is registered". */
export function readProducerRegistry(file: string): Set<string> | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const list = (parsed as Record<string, unknown>).producers;
  if (!Array.isArray(list)) return null;
  const ids = new Set<string>();
  for (const p of list) {
    if (p && typeof p === "object" && !Array.isArray(p)) {
      const id = (p as Record<string, unknown>).id;
      if (typeof id === "string" && id.trim()) ids.add(id.trim());
    }
  }
  return ids;
}

/** The producer gate (AC5's red side). A finding that NAMES a producer must name one the workspace
 *  has REGISTERED — a finding naming an unregistered producer is a probe-invented subject, and
 *  filing it would put a phantom owner on the board.
 *
 *  ⚠️ `registered` is deliberately THREE-valued, and the three must not share an output (硬规则 3b —
 *  本仓库三次实测的形态都是「读不懂输入」与「合格」共用了一个返回值):
 *    `undefined` = the routine declares NO producer registry ⇒ the gate does not apply (a finding
 *                  from a routine with no such concept is none of this gate's business);
 *    `null`      = a registry IS declared but could not be read ⇒ REJECT (fail-closed);
 *    `Set`       = read it; membership decides.
 *  Collapsing `undefined` into `null` files nothing for every generic routine — the first version of
 *  this function did exactly that and the "(f) no registry declared" case caught it. */
export function producerGate(f: FileableFinding, registered: Set<string> | null | undefined): { ok: boolean; evaluated: boolean; reason: string } {
  const named = String(f.producer ?? "").trim();
  if (!named || NO_ACTION_RE.test(named)) {
    return { ok: true, evaluated: false, reason: "producer: finding names no producer — gate not applicable" };
  }
  if (registered === undefined) {
    return { ok: true, evaluated: false, reason: "producer: this routine declares no producer registry — gate not applicable" };
  }
  if (registered === null) {
    return { ok: false, evaluated: true, reason: `producer: registry unreadable ⇒ '${named}' cannot be verified as registered (fail-closed)` };
  }
  if (!registered.has(named)) {
    return { ok: false, evaluated: true, reason: `producer: '${named}' is not registered (registered: ${[...registered].sort().join(", ") || "<none>"})` };
  }
  return { ok: true, evaluated: true, reason: `producer: '${named}' is registered` };
}

/** The rate window's numerator, read from the CARRIER itself (⛔ no hand-kept counter file): the
 *  number of filings this routine recorded in the trailing window. `nowMs` is injected so the window
 *  is testable; a record with an unparseable ts is skipped, never counted (硬规则 3b). */
export function countRecentFilings(carrierPath: string, nowMs: number, windowMs: number = FILING_WINDOW_MS): number {
  let text: string;
  try { text = fs.readFileSync(carrierPath, "utf8"); } catch { return 0; }
  let n = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let r: Record<string, unknown>;
    try { r = JSON.parse(line); } catch { continue; }
    if (r.kind !== "filing-round") continue;
    const at = Date.parse(String(r.ts ?? ""));
    if (!Number.isFinite(at) || nowMs - at > windowMs || at > nowMs) continue;
    const filed = Array.isArray(r.filed) ? r.filed.length : 0;
    n += filed;
  }
  return n;
}

/** The task body. Shape = `finding`-shape (`## Finding` + AC + DoD), which is the shape
 *  `ready-pool-check.ts`'s SHAPE_REGISTRY recognizes for a defect report — so a filed task is
 *  author→ready-eligible rather than pool noise. The finding's own evidence is quoted VERBATIM in
 *  `## Finding` so the task and the carrier record are checkably the same fact. */
export function renderRoutineTaskBody(f: FileableFinding, ctx: { routine: string; probe: string; runId: string; carrier: string; ts: string; taskId: string }): string {
  const files = f.files.map((x) => `- \`${x}\``);
  return [
    "## Finding",
    String(f.rationale ?? "").trim(),
    "",
    `载体记录（逐字来源）：\`${ctx.carrier}\` · routine \`${ctx.routine}\` · probe \`${ctx.probe}\` · runId \`${ctx.runId}\` · ts \`${ctx.ts}\`。`,
    "",
    "该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸",
    "（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。",
    "",
    `- 观测符号：${f.symbols.map((s) => `\`${s}\``).join("、") || "<none>"}`,
    ...(files.length ? ["- 涉及文件：", ...files] : []),
    ...(f.kind ? [`- kind：\`${f.kind}\``] : []),
    ...(f.verdict ? [`- verdict：\`${f.verdict}\``] : []),
    "",
    "## Requested action",
    String(f.suggestedAction ?? "").trim() || "（finding 未给出 suggestedAction —— 立案时按 rationale 判定处置）",
    "",
    "## AC（draft）",
    `- [ ] \`${ctx.carrier}\` 中 finding \`${f.id ?? "<no-id>"}\`（routine \`${ctx.routine}\`，runId \`${ctx.runId}\`）所描述的问题被复核并处置`,
    "- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案",
    "",
    "## DoD（draft）",
    "- [ ] 上面的判据实跑通过",
    "- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑",
    "",
    "## Touches",
    // The finding's own files (path only — a `path:line` is not a writable surface) plus the task's
    // own file (self-touch, which the dispatch gate requires). Directories are dropped: a bare
    // directory is an overbroad declaration (`checkTouchesNarrow`) and would block promotion.
    ...[...new Set([
      ...f.files.map((x) => String(x).split(":")[0].trim()).filter((p) => p && !p.endsWith("/")),
      ...(ctx.taskId ? [`tasks/${ctx.taskId}.md`] : []),
    ])].map((t) => `- \`${t}\``),
  ].join("\n");
}

/** Resolve a spawnable argv for the workspace's task store. Mirrors the two layouts the kernel
 *  already knows (`goalStoreArgv`'s branches): a source checkout has `packages/quay-native`, a
 *  shipped layout has the vendored bundle beside this kernel. Returns null when NEITHER exists —
 *  the caller must report that as "unresolvable", never as "nothing to file" (硬规则 3b). */
export function resolveTaskCliEntry(root: string, kernelPluginRoot: string | null): string[] | null {
  const src = path.join(root, "packages", "quay-native", "bin", "quay-native.ts");
  if (fs.existsSync(src)) return ["--no-warnings", "--experimental-strip-types", src];
  if (kernelPluginRoot) {
    const vendored = path.join(kernelPluginRoot, "vendor", "quay-native", "dist", "quay-native.js");
    if (fs.existsSync(vendored)) return ["--no-warnings", vendored];
  }
  return null;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
// Usage: routine-file-gate.mjs [--board <dir>] [--recent N] [--k K] <candidate-task.md>
// Exit 0 = accept (file it); 1 = REJECT (quality/dedup/rate); 2 = usage/parse error.
function usage() { process.stderr.write("Usage: routine-file-gate.mjs [--board <dir>] [--recent N] [--k K] <candidate-task.md>\n"); }

export async function main(argv) {
  const args = argv.slice(2);
  let board = null, recent = 0, K = DEFAULT_RATE;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--board") { board = args[++i]; continue; }
    if (args[i] === "--recent") { recent = Number(args[++i]); continue; }
    if (args[i] === "--k") { K = Number(args[++i]); continue; }
    files.push(args[i]);
  }
  if (files.length !== 1 || !Number.isFinite(recent) || !Number.isFinite(K) || K < 1) { usage(); return 2; }
  if (!fs.existsSync(files[0])) { process.stderr.write(`ERROR: not found: ${files[0]}\n`); return 2; }
  const candidate = fs.readFileSync(files[0], "utf8");
  const existingKeys: Set<string> = board ? boardKeys(board, files[0]) : new Set<string>();
  const r = gateFinding(candidate, { existingKeys, recentCount: recent, K });
  process.stdout.write(`${r.accept ? "ACCEPT" : "REJECT"}: ${r.reason}\n`);
  return r.accept ? 0 : 1;
}

if (isDirectEntry(import.meta, undefined, "routine-file-gate")) { main(process.argv).then((c) => process.exit(c)); }
