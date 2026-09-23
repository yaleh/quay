// routine-file-gate.mjs — DIR-051: the MECHANICAL quality/dedup/rate gate for routine findings (the
// DIR-051 adversarial audit refuted the gate as prose-only — this makes it runnable). A routine FILES
// findings as tasks; before one lands, it must pass this gate: QUALITY (a real, actionable finding —
// carries a `## Finding` with reproduction evidence, not a vague concern), DEDUP (not already on the
// board — keyed on the finding's mechanical SUBJECT, the symbols it names, with the finding's prose
// as the fallback; see findingKey for why prose alone is not cross-round-stable), RATE (≤ K new
// routine-filed tasks per window). This does NOT make
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
// The dedup key for a task's `## Finding` section. TWO sources, in priority order:
//
//   ① THE SUBJECT — the symbols the finding names (`symbols: \`a\`, \`b\`` in a candidate text;
//      `- 观测符号：\`a\`、\`b\`` in a filed task body — ONE parser reads both spellings). Normalized
//      to `symbols:<sorted,lowercased,deduped>`. This is the STABLE handle: the probe extracts it
//      mechanically from its inventory, so it survives a round boundary.
//   ② THE PROSE — normalized (lowercased, whitespace-collapsed), first 200 chars, prefixed `prose:`.
//      The fallback for a finding that names no symbols, and the ORIGINAL behaviour.
//
// WHY ① EXISTS — measured 2026-09-22 (gap-routine-semantic-dedup-scan-routine-dedup-branch-never-fires).
// The key used to be ② alone. For `semantic-dedup-scan` the rationale is re-paraphrased by a
// fresh-context LLM every round, so ② has NO cross-round persistence: grouping that routine's 476
// carrier records by their mechanical subject (symbol set) yields **76 clusters recurring across ≥2
// rounds (129 round-instances), and 0 of them ever produced the same prose key twice**. The gate's
// own output shows the consequence: across every `semantic-dedup-scan` filing round **0 rejections
// carried `dedup:`** (277 `rate:`, 36 `action:`), while the SAME clusters (readManifest / sha256 /
// escapeRegExp / lineOf / maskComments …) were re-reported every round under a regenerated slug. The
// branch was never broken — the quantity it keyed on simply had no cross-round persistence.
// ② is KEPT, ⛔ not replaced: it stays correct for a routine whose rationale IS mechanical
// (freshness-refresh templates it from the subject id, and its `dedup:` branch demonstrably fires —
// 2 dedup rejections recorded 2026-09-18). Deleting ② would disable dedup for those routines.
//
// WHY THE SYMBOLS AND NOT THE FILES — measured on the same corpus: the file axis is unstable AND not
// even discriminating. Only 42/76 recurring clusters list the same file set across rounds (the `walk`
// cluster: 12 files → 6, with ZERO overlap) **and** a files-only key swallows **121 distinct clusters
// under 40 key values** — it would suppress a real finding as a "duplicate" of an unrelated one, the
// over-block that turns a noisy track off. The symbol set is the axis that survives.
// ⛔ Do NOT fold the file set back into the key; that is exactly what made the old key round-specific.
//
// The two sources carry DISTINCT prefixes so a value from one can never equal a value from the other
// (硬规则 3b: 「没有 subject」与「有 subject」不得共用一种键形，否则"读不出主语"会伪装成"命中").
// Measured over all 544 carrier finding records: 360 distinct symbol sets, **0 shared across two
// routines** ⇒ the subject alone is discriminating today, and the routine is deliberately NOT folded
// in (硬规则 12: no prerequisite without an occurrence reading — the reading here is 0).
//
// THE DECLARED BOUNDARY of the subject key — exact symbol-set equality, on purpose. The probe's
// symbol set DOES drift between rounds in the looser sense: of the 360 observed sets, 346 pairs are
// subset/superset and 320 partially overlap (`readjsonlines` vs `readjsonlines,readjsonllines` vs
// `readjsonlines,readjsonllines,readfrontfield` are one cluster in three shapes). A subset/superset
// rule would swallow **161 of the 360 sets under a family-mate** — nearly half of all subjects
// suppressible by an unrelated broad entry, the silent over-block that turns a noisy track off. So
// the key stays exact: a re-finding whose symbol set drifted is NOT deduped and remains RATE-limited
// — i.e. it degrades to the pre-fix behaviour for that record. ⛔ Never worse than before; the
// boundary is named here so the residual reads as declared, not as the branch being dead again.

/** The `## Finding` section. Shared by every extractor below — one section grammar, not three. */
const FINDING_SECTION = /##\s+Finding\s*\n([\s\S]*?)(?:\n##\s|\n*$)/i;

/** The symbols line, in either spelling the two renderers emit — the candidate's
 *  `symbols: \`a\`, \`b\`` and the filed body's `- 观测符号：\`a\`、\`b\``. ⛔ ONE parser for both: the
 *  candidate and the board task MUST key identically, and the task-body spelling is what board tasks
 *  filed before this change already carry ⇒ they retro-fit with no migration.
 *  `- 观测符号：<none>` (the renderer's no-symbols form) matches the LINE but yields no backticked
 *  token ⇒ "" — a real "names no symbols", ⛔ never a key of the literal `<none>`. */
const SYMBOLS_LINE = /^[ \t]*[-*]?[ \t]*(?:观测符号|symbols)[ \t]*[:：][ \t]*(.*)$/im;

/** The finding's mechanical subject: the sorted, lowercased symbol set it names. "" when the finding
 *  names no symbols — a legitimate state (the freshness routine's ids are not symbols), ⛔ not an
 *  error and not a key (硬规则 6: 缺值 ≠ 为假; a fabricated key would dedup everything against it). */
export function findingSubjectKey(taskText) {
  const section = String(taskText).match(FINDING_SECTION);
  if (!section) return "";
  const line = section[1].match(SYMBOLS_LINE);
  if (!line) return "";
  const syms = [...line[1].matchAll(/`([^`]+)`/g)].map((m) => m[1].trim().toLowerCase()).filter(Boolean);
  if (!syms.length) return "";
  return `symbols:${[...new Set(syms)].sort().join(",")}`;
}

/** The prose key — the ORIGINAL `findingKey` body, kept byte-for-byte and **unprefixed** so
 *  `isActionable` (and every consumer that wants "the finding's TEXT", not "its identity") reads
 *  exactly what it read before this function existed. Prefixing here would shift `isActionable`'s
 *  20-char bar by the prefix length and silently reclassify boundary findings (硬规则 4b). */
export function proseKey(taskText) {
  const m = String(taskText).match(FINDING_SECTION);
  return (m ? m[1] : "").trim().toLowerCase().replace(/\s+/g, " ").slice(0, 200);
}

export function findingKey(taskText) {
  const subject = findingSubjectKey(taskText);
  if (subject) return subject;
  const prose = proseKey(taskText);
  return prose ? `prose:${prose}` : "";
}

// ── recurrence — the round's filing PRIORITY ─────────────────────────────────────────────────────
//
// WHY THIS EXISTS (measured 2026-09-23, from the routine's own carrier `.quay/routine-findings.jsonl`
// — 544 finding records / 69 filing-rounds at that reading; the file is TRACKED, so every number here
// is re-derivable with one replay, ⛔ not a fixture).
//
// The three gates above decide WHETHER a finding may be filed. None of them says WHICH of a round's
// 50–120 candidates gets the round's rate budget (`DEFAULT_RATE` filings per window) — the loop spent
// it in the PROBE'S EMISSION ORDER, an order that carries no value signal at all. The slots therefore
// went to whichever clusters the fresh-context scan happened to list first, while clusters the corpus
// had already re-reported for 3–6 rounds were rejected `rate:` and never became a task. Measured in
// the very round that filed THIS task (`semantic-dedup-scan-1790118332027`, 52 candidates, k=3):
//
//     filed                 prior-round recurrence {0, 0, 1}   ← two first-seen findings took 2 of 3 slots
//     rejected `rate:`      prior-round recurrence {4, 3, 3, 3} — mergeenv·mergeprofileenv,
//                           isdeadinflight·isdeadmerge, parseargs, statecolortoken·timelinecolortoken
//
// — i.e. the rate gate was throttling exactly the work the corpus had been re-reporting, while
// first-seen findings (the cheapest thing for a scan to emit) walked in. The highest-recurrence
// cluster measured over all rounds, `readmanifest`, had been re-reported in **6** prior rounds and its
// final candidate was never filed (that one is an `action:` reject — a `leave` verdict, so priority
// alone does not file it; see the residual note below).
//
// ⛔ WHAT THIS IS NOT. It does not raise the cap, weaken a gate, or add a second quality judge: it
// ORDERS the candidates the existing gates already judge, so the same budget buys the highest-value
// work. `rate:` stays the declared throttle — it now drops the FRESHEST tail instead of an arbitrary
// one. The combination with the subject key above is what converges: a filed cluster is deduped away
// on the next round, so the queue drains from the top down rather than being re-chosen at random.
//
// THE PRIORITY KEY IS THE DEDUP KEY — literally the same call (`findingKey` over the same rendered
// candidate text). A separate "recurrence key" that could drift from the dedup key would prioritize
// by a quantity no gate keys on, and the drift would be silent (硬规则 5b).
//
// DECLARED RESIDUAL: priority is not eligibility. A 6-round cluster carrying `suggestedAction:
// "leave"` is still a measurement and still not filed (the `action:` gate) — so the top of the
// priority order is not always the top of the filed set. That is correct and is why the filings record
// the recurrence next to the verdict (see `selectFilings`' rate reason).

/** A carrier `finding` record → the `FileableFinding` shape `routineFindingCandidateText` renders.
 *  ⚠️ The finding's own kind is the record's `dupKind`: the record's top-level `kind` is the RECORD
 *  kind (`"finding"`). Reading `kind` here would put the string "finding" in every candidate text
 *  (harmless for the key, which ignores it — but it would silently misreport the finding's kind). */
function carrierFinding(r: Record<string, unknown>): FileableFinding {
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    id: str(r.findingId),
    kind: str(r.dupKind),
    symbols: arr(r.symbols),
    files: arr(r.files),
    verdict: str(r.verdict),
    rationale: str(r.rationale) ?? "",
    suggestedAction: str(r.suggestedAction),
    producer: str(r.producer),
  };
}

/** Recurrence of every subject the carrier has ever reported: finding key → the number of DISTINCT
 *  `runId`s that reported it (「这个主语被几轮重复报过」 — the quantity the finding above is about).
 *
 *  **Three-valued, and the three must not share an output** (硬规则 3b — the failure mode this repo
 *  has measured three times is 「读不懂输入」 sharing a return value with 「合格」):
 *    `Map`  = read it; a key absent from the map was never reported ⇒ recurrence 0 (a complete
 *             reading makes absence informative — 硬规则 6's 「缺值」 would be a HALF-read map);
 *    `null` = unreadable, or readable but carrying no parseable record at all ⇒ recurrence UNKNOWN.
 *             Callers must fall back to the pre-recurrence behaviour (probe order) and must NOT
 *             render this as 「复现 0」 — "we could not measure it" and "nothing recurred" are the
 *             two states this function exists to keep apart.
 *  An empty-but-readable carrier is a legitimate `Map` (no records ⇒ nothing recurred).
 *
 *  ⚠️ Distinct runIds, ⛔ not record count: one round can emit the same subject twice (the probe
 *  splits a scan into shards), and counting records would make a sharded round look like recurrence.
 *  A record with no usable `runId` cannot be attributed to a round and is skipped rather than
 *  counted as its own round. */
export function recurrenceByKey(carrierPath: string): Map<string, number> | null {
  let text: string;
  try { text = fs.readFileSync(carrierPath, "utf8"); } catch { return null; }
  const rounds = new Map<string, Set<string>>();
  let nonBlank = 0;
  let parsed = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    nonBlank += 1;
    let rec: unknown;
    try { rec = JSON.parse(line); } catch { continue; }
    if (!rec || typeof rec !== "object" || Array.isArray(rec)) continue;
    parsed += 1;
    const r = rec as Record<string, unknown>;
    if (r.kind !== "finding") continue;
    const run = typeof r.runId === "string" ? r.runId.trim() : "";
    if (!run) continue;
    const key = findingKey(routineFindingCandidateText(carrierFinding(r)));
    if (!key) continue;
    let seen = rounds.get(key);
    if (!seen) { seen = new Set<string>(); rounds.set(key, seen); }
    seen.add(run);
  }
  // Read it, and every non-blank line was unintelligible ⇒ we did NOT read it (hard rule 3b).
  if (nonBlank > 0 && parsed === 0) return null;
  const out = new Map<string, number>();
  for (const [key, seen] of rounds) out.set(key, seen.size);
  return out;
}

/** One candidate's place in the round's decision order — the audit surface of the priority: which
 *  key it was ranked by, and the recurrence that produced its rank (`null` = the carrier could not be
 *  read, so there was no ranking at all — ⛔ never 0, which would read as 「没复现过」). */
export interface RecurrenceRank {
  index: number;
  key: string;
  recurrence: number | null;
}

/** The order in which a round's candidates should consume the rate budget: **recurrence desc**, ties
 *  (and an unreadable carrier) in the probe's own order — so a tie is not silently reshuffled and the
 *  fallback is the exact pre-recurrence behaviour, ⛔ never worse.
 *
 *  Pure (the caller does the reading), because the priority must be re-runnable against the real
 *  carrier as a pure READING — the same reason `selectFilings` is pure. */
export function recurrenceOrder(
  findings: readonly FileableFinding[], recurrence: Map<string, number> | null,
): RecurrenceRank[] {
  const ranked = findings.map((f, index) => {
    const key = findingKey(routineFindingCandidateText(f));
    return { index, key, recurrence: recurrence ? recurrence.get(key) ?? 0 : null };
  });
  if (!recurrence) return ranked; // probe order: the pre-recurrence decision order, byte for byte
  return [...ranked].sort((a, b) => (b.recurrence as number) - (a.recurrence as number) || a.index - b.index);
}

// ── quality ──────────────────────────────────────────────────────────────────────────────────────
// A finding is actionable iff it has a non-trivial `## Finding` AND cites reproduction evidence (a
// command, a path, a diff/commit ref, a test name) — not a vague concern.
const EVIDENCE = /(`[^`]+`|\b\w[\w./-]*\.(mjs|js|ts|md|json|sh)\b|\b[0-9a-f]{7,40}\b|exit\s+\d|npx |node |git )/i;
export function isActionable(taskText) {
  // ⛔ `proseKey`, never `findingKey`: the quality bar is about the TEXT, and it must not shift when
  // the dedup key's SOURCE changes. (The subject is not evidence of actionability either — a bare
  // symbol list is a name, not a reproduction.) Behaviour is byte-identical to the pre-subject gate.
  const key = proseKey(taskText);
  if (key.length < 20) return false;                 // a real finding is more than a phrase
  const m = String(taskText).match(FINDING_SECTION);
  return !!m && EVIDENCE.test(m[1]);                 // must cite concrete evidence
}

// ── gateFinding ──────────────────────────────────────────────────────────────────────────────────
// candidate: the new task text. opts: { existingKeys:Set|[], recentCount:number, K:number }.
// Returns { accept, reason }.
export function gateFinding(candidate: string, { existingKeys = [] as string[], recentCount = 0, K = DEFAULT_RATE }: { existingKeys?: Set<string> | string[]; recentCount?: number; K?: number } = {}) {
  if (!isActionable(candidate)) return { accept: false, reason: "quality: no actionable `## Finding` with reproduction evidence" };
  const keys = existingKeys instanceof Set ? existingKeys : new Set(existingKeys);
  const key = findingKey(candidate);
  // The matched key is NAMED in the reason: the reason is recorded verbatim in the carrier, and
  // without it a dedup decision is unauditable — you cannot tell which subject swallowed a candidate,
  // so an over-block reads exactly like a correct suppression (硬规则 3: 枚举不布尔).
  if (keys.has(key)) return { accept: false, reason: `dedup: an equivalent finding is already on the board (matched key: ${key})` };
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
    // ⛔ 平标题，**不加 `（draft）` 后缀**：`SHAPE_SECTIONS` 两种都认，但 **checkbox 闸只认平标题** ——
    // 带后缀时 `quay task check` 报 "AC section has no checkboxes"（实测：第一版用 `## AC（draft）`
    // 立出来的 6 条任务全部 FAIL）⇒ 机械立出来的任务会**结构上无法通过 ready/done 闸**，即又一个
    // 「看起来立了案、其实动不了」的形态。同一个坑在 meta-driver 的 renderAutoDriveBody 里也在（本文
    // 只修例程这一侧，⛔ 不动不在 Touches 内的 meta-driver.ts）。
    "## AC",
    `- [ ] \`${ctx.carrier}\` 中 finding \`${f.id ?? "<no-id>"}\`（routine \`${ctx.routine}\`，runId \`${ctx.runId}\`）所描述的问题被复核并处置`,
    "- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案",
    "",
    "## DoD",
    "- [ ] 上面的判据实跑通过",
    "- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑",
    "",
    "## Touches",
    // The finding's own files (path only — a `path:line` is not a writable surface) plus the task's
    // own file (self-touch, which the dispatch gate requires). Directories are dropped: a bare
    // directory is an overbroad declaration (`checkTouchesNarrow`) and would block promotion.
    ...[...new Set([
      // ⚠️ 运行态路径落入 **证据**、⛔ 不落入 Touches：`files` 是 finding 的**观测位置**，不是可写面。
      // `.quay/` 是本仓库运行态的家（`.gitignore`/quay-init 用同一条规则）；把一个运行态载体声明成
      // Touches，等于宣称这道任务会去改它——那是假声明，而且正好撞上「Touches 里声明 .quay 运行时
      // 产物会挡晋升」那条实测。它们仍然逐字出现在 `## Finding` 的涉及文件里（可核），只是不占声明面。
      ...f.files.map((x) => String(x).split(":")[0].trim())
        .filter((p) => p && !p.endsWith("/") && !p.startsWith(".quay/")),
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
