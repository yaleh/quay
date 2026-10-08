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
    subject: str(r.subject),
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
export function gateFinding(candidate: string, { existingKeys = [] as string[], recentCount = 0, K = DEFAULT_RATE }: { existingKeys?: Set<string> | readonly string[]; recentCount?: number; K?: number } = {}): { accept: boolean; reason: string; dedup: DedupReading | null } {
  if (!isActionable(candidate)) return { accept: false, reason: "quality: no actionable `## Finding` with reproduction evidence", dedup: null };
  // The dedup judgment is ONE call into ONE implementation (`dedupReading`, which carries the
  // matched key AND the holder's status into the reason): the reason is recorded verbatim in the
  // carrier, and without it a dedup decision is unauditable — you cannot tell which subject swallowed
  // a candidate, so an over-block reads exactly like a correct suppression (硬规则 3: 枚举不布尔).
  const dedup = dedupReading(existingKeys, findingKey(candidate));
  if (dedup.block) return { accept: false, reason: dedup.reason, dedup };
  if (recentCount >= K) return { accept: false, reason: `rate: ${recentCount} routine-filed tasks this window ≥ cap ${K}`, dedup };
  // ⚠️ A `novel` acceptance keeps the pre-status reason VERBATIM; when the candidate matched keys
  // that are all CLOSED, the reason carries that fact — ⛔ an accepted finding whose subject is
  // 「板上只有 done」 must not read like 「板上什么都没有」 (硬规则 3).
  return {
    accept: true, dedup,
    reason: dedup.state === "novel" ? "accepted: actionable, novel, within rate" : `accepted: actionable, novel, within rate — ${dedup.reason}`,
  };
}

/** The gate for the HUMAN-VISIBLE escalation channel (remedy availability = `blocked`).
 *
 *  Same QUALITY and DEDUP judgments as `gateFinding` (⛔ reusing `isActionable`/`findingKey`, not a
 *  second parser), but **no rate window** — and that omission is the point, not an exemption from
 *  throttling:
 *
 *  ✦ The dispatch rate window bounds *dispatch-queue* pressure: `filed` entries feed the ready pool.
 *    An escalation never enters that pool (it is created `status: needs-human`), so it is not the
 *    quantity that window bounds. Measured 2026-09-25 on this task's own first production round:
 *    the window was already saturated (3 filings in 24h — 2 of them freshness-refresh's own, 1 from
 *    `semantic-dedup-scan`), so a `blocked` reading was recorded while the escalation was **starved
 *    to zero**: the reading changed nothing, which is the exact defect this task closes, reproduced
 *    one layer down at the throttle.
 *  ✦ The escalation channel has its OWN bound, and it is the one the task's 2b prescribes: **at most
 *    one open escalation per SUBJECT while the reading is unchanged** (enforced by the
 *    `escalationMarkerByKey` board marker + the caller's `blocked-repeat` disposition). That bound is
 *    by identity, not by rate, and it is ≤ |tracked subjects| in total — it cannot spam.
 *  ✦ ⛔ The measured reading is still the reason a reader can audit this: the round record carries
 *    `escalated` (separately from `filed`) and `remedy_availability` verbatim, so "escalated" and
 *    "dispatch-filed" never share a shape. */
export function gateEscalation(candidate: string, { existingKeys = [] as string[] | Set<string> } = {}): { accept: boolean; reason: string; dedup: DedupReading | null } {
  if (!isActionable(candidate)) return { accept: false, reason: "quality: no actionable `## Finding` with reproduction evidence", dedup: null };
  // ⚠️ The same QUALITY + DEDUP judgment as `gateFinding` (⛔ one implementation, `dedupReading`),
  // judged on THIS channel's own terms: an escalation's object is 「该读数**仍然**陈旧」, so a key held
  // only by FINISHED tasks has no semantics for it at all — ⛔ it must not pose as an open duplicate
  // and swallow the escalation (that is exactly the defect this section closes). A key held by an
  // OPEN task still blocks, and an unreadable owner still fails closed.
  const dedup = dedupReading(existingKeys, findingKey(candidate));
  if (dedup.block) return { accept: false, reason: dedup.reason, dedup };
  const base = "accepted: actionable, novel — routed to the HUMAN-VISIBLE channel (its own throttle: one open escalation per subject while the reading is unchanged)";
  return {
    accept: true, dedup,
    reason: dedup.state === "novel" ? base : `${base} · ${dedup.reason} — ⛔ a finished task does not close the READING`,
  };
}

// ── boardKeys / the dedup space's STATUS DIMENSION ───────────────────────────────────────────────
//
// WHY THE STATUS DIMENSION EXISTS (tasks/gap-ac214-eighth-crossing-done-key-permanently-suppresses-…;
// measured 2026-09-25 on `.quay/routine-findings.jsonl` line 974, runId
// `freshness-refresh-1790308195712`). `boardKeys()` was status-BLIND: every `.md` on the board
// supplying a key made that key a blocking duplicate — including a key supplied ONLY by a `done`
// task. For `freshness-refresh` that semantics is inverted: its findings do not describe a defect
// that is fixed once, they describe a STATE that goes stale again as `develop` advances. Sealing a
// subject with `done` turns 「处理过一次」 into 「从此不再看它」 — and it sealed exactly the two subjects
// that were over the freshness margin: AC-238/239 matched `symbols:goal-009-ac-238,upgrade-face` /
// `…-239…`, both owned by a `status: done` routine task, so the escalation channel built one
// crossing earlier was structurally unreachable for them — every round, through 790 consecutive
// failures. This is the parent AC's own theme (「一旦转绿即永久绿」) in dedup space.
//
// THE THREE STATES (硬规则 3b — ⛔ no two of them may share an output):
//   `live`      ≥1 owner is `todo`/`ready`/`needs-human` ⇒ a REAL duplicate ⇒ blocks, as always.
//   `done-only` EVERY owner's status was read and all are `done`/`superseded` ⇒ not an OPEN
//               equivalent ⇒ must NOT block (this is the crossing-closing state).
//   `unknown`   the key is present but no owner's status could be read (absent/unrecognized
//               `status:`, a bare caller-supplied key set, or this round's own acceptance) ⇒
//               NOT-EVALUATED, fail-closed. ⛔ 「读不出拥有者状态」must not be shaped like
//               `done-only` (that is the 3b failure: 读不懂 ⇒ 伪装成检查通过) and must not be shaped
//               like `live` (that hides a mechanism failure as a correct suppression).
// ⛔ The match stays EXACT and the boundary is unchanged: only a key whose OWNERS are all closed
//   stops blocking. A closed key does not make some other symbol set non-blocking (see the DECLARED
//   BOUNDARY note above `findingKey`).
//
// ⛔ NOT relaxed here: the human channel's own throttle (`escalationMarkerByKey` + the caller's
//   `blocked-repeat`) is by IDENTITY (≤ one open escalation per subject while the reading is
//   unchanged), and it is untouched — this dimension only removes a FINISHED task's power to pose as
//   an open duplicate.

/** The statuses that mean "this file is still OPEN work" — an equivalent finding under one of these
 *  is a real duplicate. `needs-human` is OPEN: the file is waiting on a human, it is not finished. */
export const LIVE_TASK_STATUSES: readonly string[] = ["todo", "ready", "needs-human"];
/** The statuses that mean "this file is FINISHED" — `done` is work completed, `superseded` was
 *  replaced. Neither closes the SUBJECT (see the section comment). */
export const CLOSED_TASK_STATUSES: readonly string[] = ["done", "superseded"];

/** One board file that supplies a finding key, with its own `status` read from the frontmatter.
 *  `status: null` = could NOT be read (no frontmatter / no `status:` line / empty value) — a THIRD
 *  value, ⛔ never conflated with a status string (硬规则 3b / 6). */
export interface BoardKeyOwner { file: string; status: string | null }

/** A key's standing on the board — the STATUS DIMENSION's three values. ⛔ Not a boolean: `live` and
 *  `unknown` both block but for different reasons, and `unknown` must never be reported as
 *  `done-only` (that would be 「读不懂」伪装成「检查通过」, 硬规则 3b). */
export type BoardKeyState = "live" | "done-only" | "unknown";

const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const FRONTMATTER_STATUS = /^status[ \t]*:[ \t]*["']?([^\s"']+)["']?[ \t]*$/m;

/** The task file's own `status:` scalar. `null` = not readable (硬规则 6: 缺值 = 未查, ⛔ never a
 *  value). A local 3-line reader on purpose: it must not couple this gate to a task store, and the
 *  frontmatter shape is already shared with every other reader in the repo. */
export function readTaskStatus(taskText: string): string | null {
  const fm = String(taskText).match(FRONTMATTER_BLOCK);
  if (!fm) return null;
  const m = fm[1].match(FRONTMATTER_STATUS);
  return m ? m[1].trim().toLowerCase() : null;
}

/** Classify ONE key's owners. Priority `live` > `unknown` > `done-only`:
 *   `live` first — one OPEN owner is a definite reading whatever its siblings say;
 *   `unknown` BEFORE `done-only` — a key with one closed owner and one unreadable owner fails
 *   closed instead of being reported as 「只有已关闭的」 (硬规则 3b).
 *  An empty/absent owner list is `unknown`, ⛔ never `done-only`: 「没有记下任何拥有者」 is exactly
 *  the state that must not be renderable as 「已关闭」. */
export function boardKeyState(owners: readonly BoardKeyOwner[] | null | undefined): BoardKeyState {
  if (!owners || owners.length === 0) return "unknown";
  if (owners.some((o) => LIVE_TASK_STATUSES.includes(String(o.status)))) return "live";
  return owners.every((o) => CLOSED_TASK_STATUSES.includes(String(o.status))) ? "done-only" : "unknown";
}

/** The board's dedup space: the key set **plus** each key's owners. The two live in ONE object on
 *  purpose — a second, parallel structure could drift from the set, and the drift would be silent
 *  (硬规则 5b).
 *
 *  ⚠️ It IS a `Set<string>`, so every existing caller reads unchanged: `keys.has`, `keys.add`,
 *  `[...keys]`, and a test handing in a plain `Set`. A caller that passes a BARE set — no board
 *  provenance — classifies as `unknown` (fail-closed): byte-for-byte the pre-status behaviour, ⛔ not
 *  a silent 「no duplicate」. */
export class BoardKeys extends Set<string> {
  /** key → the board files that supply it, each with its own status. */
  readonly owners: Map<string, BoardKeyOwner[]>;
  /** `false` = the board directory could NOT be listed ⇒ every membership answer is NOT-EVALUATED
   *  (硬规则 3b: ⛔ not "the board is empty"). */
  readonly readable: boolean;
  constructor(owners: Map<string, BoardKeyOwner[]>, readable = true) {
    super(owners.keys());
    this.owners = owners;
    this.readable = readable;
  }
}

/** Gather existing finding keys from a board dir (task .md files) for the dedup check, WITH the
 *  status of every file supplying each key. excludePath semantics are unchanged (skip the candidate's
 *  own file — see exp5-DEFECT-ROUTINE-GATE-SELF-REJECT).
 *  ⚠️ A file whose bytes cannot be READ contributes no key — unchanged from before this change, and a
 *  declared residual: the state this section adds is the OWNER's status, while board unreadability is
 *  reported separately by `BoardKeys.readable`. */
export function boardKeys(boardDir: string, excludePath: string | null = null): BoardKeys {
  const owners = new Map<string, BoardKeyOwner[]>();
  let files;
  try { files = fs.readdirSync(boardDir).filter((f) => f.endsWith(".md")); } catch { return new BoardKeys(owners, false); }
  let skip = null;
  if (excludePath) { try { skip = fs.realpathSync(path.resolve(excludePath)); } catch { skip = path.resolve(excludePath); } }
  for (const f of files) {
    try {
      const abs = path.join(boardDir, f);
      let absReal; try { absReal = fs.realpathSync(abs); } catch { absReal = path.resolve(abs); }
      if (skip && absReal === skip) continue;
      const text = fs.readFileSync(abs, "utf8");
      const k = findingKey(text);
      if (!k) continue;
      const owner: BoardKeyOwner = { file: f, status: readTaskStatus(text) };
      const list = owners.get(k);
      if (list) list.push(owner); else owners.set(k, [owner]);
    } catch { /* skip */ }
  }
  return new BoardKeys(owners);
}

// ── dedupReading — the gate's ONE dedup judgment, over the key AND its owners' statuses ──────────
/** A candidate's standing against the dedup space. `novel` is the pre-existing "no match at all";
 *  the other three are the STATUS DIMENSION's values (see the boardKeys section comment). */
export type DedupState = "novel" | "done-only" | "live" | "unknown";

export interface DedupReading {
  state: DedupState;
  /** The candidate's OWN key ("" when it names neither symbols nor a prose body). */
  key: string;
  /** The key's board owners (`[]` for `novel`). */
  owners: BoardKeyOwner[];
  /** Does this verdict BLOCK the channel that asked? */
  block: boolean;
  /** The audit line. ⛔ It always names WHY — an over-block that names no cause reads exactly like a
   *  correct suppression (硬规则 3: 枚举不布尔). */
  reason: string;
}

/** Classify a candidate key against the dedup space. Pure — the caller supplies the space (so the
 *  same judgment can be re-run against the real board as a pure READING, like `recurrenceOrder`). */
export function dedupReading(existingKeys: Set<string> | readonly string[], key: string): DedupReading {
  const keys = existingKeys instanceof Set ? existingKeys : new Set(existingKeys);
  if (!key || !keys.has(key)) {
    return {
      state: "novel", key, owners: [], block: false,
      reason: key
        ? `novel: no finding on the board carries the key '${key}'`
        : "novel: the candidate names no symbols and has no prose ⇒ there is no key to match",
    };
  }
  const board = existingKeys instanceof BoardKeys ? existingKeys : null;
  const owners = board && board.readable ? board.owners.get(key) ?? null : null;
  const state = boardKeyState(owners);
  const named = (owners ?? []).map((o) => `${o.file} [status: ${o.status ?? "<unreadable>"}]`).join(", ");
  if (state === "live") {
    return {
      state, key, owners: owners ?? [], block: true,
      reason: `dedup: an equivalent finding is already OPEN on the board (matched key: ${key}, holder: ${named})`,
    };
  }
  if (state === "unknown") {
    const why = !board
      ? "the key set was supplied without board provenance (a bare Set), so no owner status was ever read"
      : !board.readable
        ? "the board directory could not be listed"
        : owners === null
          ? "the key was recorded by THIS round's own acceptance, not read from a board file"
          : "no supplying file carries a readable `status:` this gate recognizes";
    return {
      state, key, owners: owners ?? [], block: true,
      reason: `dedup: the board holds '${key}' but its owner's status was NOT EVALUATED (${why}${named ? `; holders: ${named}` : ""}) ⇒ fail-closed — ⛔ this is neither 「a live duplicate」 nor 「only closed tasks」`,
    };
  }
  return {
    state, key, owners: owners ?? [], block: false,
    reason: `not an open duplicate: the board holds '${key}' only under CLOSED task(s) (${named}) ⇒ 「该主体曾被处理过」 is not 「该主体此刻仍有未处理的等价工作」`,
  };
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
  /** The tracked SUBJECT the finding is about (`GOAL-009-AC-NNN`), declared by the freshness probe's
   *  own output contract. `null` = the probe reported none. Load-bearing for the escalation dedup
   *  ("同一主体"): the producer id is coarser (one producer can own several subjects) and the
   *  finding id is re-slugged by a fresh context every round. */
  subject?: string | null;
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

/** One read of the mapping file, two extractions (`producers` ids + the `execution_probe`
 *  declaration). ONE read on purpose: two readers of the same file can drift, and the drift would be
 *  invisible (硬规则 5b). `null` from either field is the THREE-valued "could not read it" (硬规则 3b)
 *  — ⛔ never conflated with "read it and the field was empty/absent":
 *    `producers: null`         = the file or its shape could not be read ⇒ callers fail closed;
 *    `executionProbe: null`    = the file WAS read and declares no `execution_probe` ⇒ the
 *                                remedy-availability reading is `not-declared` (gate not applicable),
 *                                which is a different state from "we tried and could not tell". */
export interface ProducerMappingRead {
  producers: Set<string> | null;
  executionProbe: ExecutionProbeDecl | null;
  /** id → the entry's own `command`, for quoting VERBATIM into an escalation (⛔ never re-typed). */
  commands: Map<string, string>;
}

export function readProducerMapping(file: string): ProducerMappingRead {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return { producers: null, executionProbe: null, commands: new Map() };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { producers: null, executionProbe: null, commands: new Map() };
  }
  const root = parsed as Record<string, unknown>;
  const list = root.producers;
  if (!Array.isArray(list)) return { producers: null, executionProbe: null, commands: new Map() };
  const ids = new Set<string>();
  const commands = new Map<string, string>();
  for (const p of list) {
    if (p && typeof p === "object" && !Array.isArray(p)) {
      const id = (p as Record<string, unknown>).id;
      if (typeof id === "string" && id.trim()) {
        ids.add(id.trim());
        const cmd = (p as Record<string, unknown>).command;
        if (typeof cmd === "string" && cmd.trim()) commands.set(id.trim(), cmd.trim());
      }
    }
  }
  return { producers: ids, executionProbe: parseExecutionProbe(root.execution_probe), commands };
}

/** Read a producer registry (`{ producers: [{id}, …] }`) into a set of registered ids.
 *  Unreadable / malformed / empty ⇒ **null**, which is a THIRD value distinct from "read it and it
 *  had no producers" (硬规则 3b: 读不懂 must not be shaped like 读懂了). Callers must fail closed on
 *  null rather than treating it as "nothing is registered". */
export function readProducerRegistry(file: string): Set<string> | null {
  return readProducerMapping(file).producers;
}

// ── remedy availability (tasks/gap-ac214-seventh-crossing-blocked-remedy-has-no-consumer) ────────
//
// THE DEFECT THIS SECTION EXISTS FOR (measured 2026-09-25, `.quay/routine-findings.jsonl` line 878).
// The probe had ALREADY measured, and honestly written into the production carrier, the quantity
// `inventory.producers_executable_from_this_host: 0` — with its cause named in `notes`
// (`ssh precondition 0 verified live this run (… Permission denied, rc=255) so NO producer is
// runnable from this host without an authorization change`). The SAME round's `filing-round` record
// still filed two `status: ready` tasks whose requested action was `re-run coldstart-face on a host
// already authorized to B`. ⇒ The reading had no consumer, so it was shaped exactly like "nothing
// happened" (硬规则 3b / 4b): a truthful reading that changes nothing is indistinguishable from a
// system that never looked.
//
// THE SHAPE OF THE FIX — three independently-valued states, none of which shares an output with
// another (硬规则 3b), and each of which CHANGES THE RESULT:
//   `executable`    the declared `execution_probe` ran and succeeded ⇒ file as before;
//   `blocked`       the probe ran and returned the DECLARED denial ⇒ the finding goes to the
//                   human-visible channel (a `needs-human` task quoting the verbatim remedy) and
//                   NEVER to a dispatchable `ready` task — and the same subject is not escalated
//                   twice while the reading stays blocked;
//   `not-evaluated` the probe could not be read (spawn error, timeout, or a non-zero result that is
//                   NOT the declared denial) ⇒ the reading is recorded but the filing shape is
//                   unchanged. Fail-OPEN is deliberate and is the declared direction: the 2026-09-25
//                   reading was produced by a probe that ran fine, and a false `blocked` would make
//                   the mechanism stop filing real work (a "恒报挡住" failure, which is why AC4's
//                   negative control exists). The state is visible in the carrier either way.
//   `not-declared`  the mapping declares no `execution_probe` at all ⇒ the gate does not apply
//                   (a routine/workspace with no such concept is none of this gate's business).
//
// ⛔ SCOPE, deliberately narrow: the reading gates ONLY a finding whose named producer appears in the
// `execution_probe.producers` list. A `missing-producer` finding asks for a registration change
// (locally executable), and a finding naming some other producer is none of this probe's business —
// escalating either would be the over-block that turns the track off.

/** The declared `execution_probe` block of `plugin/freshness-producers.json` (see its `_comment`). */
export interface ExecutionProbeDecl {
  id: string;
  /** argv of the reachability check (⛔ a check, never a producer run). */
  command: string[];
  timeoutMs: number;
  /** The substring whose presence in the probe output marks a DEFINITE authorization denial. */
  blockedPattern: string | null;
  /** Which registered producers this reading gates. */
  producers: string[];
  /** The verbatim human remedy, quoted into the escalation task. */
  remedy: { host: string | null; action: string; alternative: string | null } | null;
}

/** Parse the declared block. Absent/malformed ⇒ null (= "not declared", see readProducerMapping).
 *  A malformed block is NOT distinguished from an absent one here on purpose: both mean "no usable
 *  declaration", and the reading that results (`not-declared`) is recorded verbatim in the carrier —
 *  ⛔ it is never rendered as `executable`. */
export function parseExecutionProbe(raw: unknown): ExecutionProbeDecl | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : null;
  const command = Array.isArray(r.command) && r.command.length > 0 && r.command.every((x) => typeof x === "string" && x)
    ? (r.command as string[]) : null;
  if (!id || !command) return null;
  const producers = Array.isArray(r.producers) ? r.producers.filter((x): x is string => typeof x === "string" && !!x.trim()).map((x) => x.trim()) : [];
  const remedyRaw = r.remedy && typeof r.remedy === "object" && !Array.isArray(r.remedy) ? r.remedy as Record<string, unknown> : null;
  const action = remedyRaw && typeof remedyRaw.action === "string" && remedyRaw.action.trim() ? remedyRaw.action.trim() : null;
  return {
    id,
    command,
    timeoutMs: typeof r.timeout_ms === "number" && Number.isFinite(r.timeout_ms) && r.timeout_ms > 0 ? r.timeout_ms : 20_000,
    blockedPattern: typeof r.blocked_pattern === "string" && r.blocked_pattern.trim() ? r.blocked_pattern.trim() : null,
    producers,
    remedy: remedyRaw && action
      ? {
        host: typeof remedyRaw.host === "string" && remedyRaw.host.trim() ? remedyRaw.host.trim() : null,
        action,
        alternative: typeof remedyRaw.alternative === "string" && remedyRaw.alternative.trim() ? remedyRaw.alternative.trim() : null,
      }
      : null,
  };
}

/** The routine's own vocabulary. The probe spec DECLARES the same three (`output_routing.remedy_availability.values`)
 *  and the declaration is load-bearing: a value the spec does not declare is not readable (硬规则 3b). */
export const REMEDY_AVAILABILITY_VALUES = ["executable", "blocked", "not-evaluated"] as const;
export type RemedyAvailabilityStatus = (typeof REMEDY_AVAILABILITY_VALUES)[number] | "not-declared";

/** Which channel decided the round's reading — enumerated, ⛔ never a boolean (硬规则 3). */
export type RemedyAvailabilitySource = "execution-probe" | "probe-reported" | "none";

export interface RemedyAvailability {
  status: RemedyAvailabilityStatus;
  /** false for `not-declared` / `not-evaluated` — never conflated with a judged `executable`. */
  evaluated: boolean;
  /** Which channel produced `status`. */
  source: RemedyAvailabilitySource;
  /** The declared probe id, when one was declared. */
  probeId: string | null;
  /** The probe's OWN reported value, verbatim — `null` when it reported none. Kept so a reader can
   *  tell "the probe agreed" from "the probe said nothing" (⛔ not from "the probe disagreed"). */
  probeReported: string | null;
  /** The spec's declared vocabulary, verbatim (`[]` when the spec declares none). */
  specValues: string[];
  /** The verbatim observation that produced the reading (the probe's own output, one line). */
  observed: string | null;
  reason: string;
}

function notEvaluated(reason: string, base: Partial<RemedyAvailability> = {}): RemedyAvailability {
  return {
    status: "not-evaluated", evaluated: false, source: "none", probeId: null, probeReported: null,
    specValues: [], observed: null, reason, ...base,
  };
}

/** Classify ONE run of the declared `execution_probe`. Pure — the caller spawns.
 *
 *  ⚠️ The classifier's whole job is the THREE-WAY split, so read the branches as the specification:
 *  success ⇒ `executable`; the DECLARED denial pattern ⇒ `blocked`; EVERYTHING ELSE (spawn error,
 *  timeout, any other non-zero exit) ⇒ `not-evaluated`. ⛔ Do not widen `blocked` to "non-zero exit":
 *  on this host the FQDN form gives rc=255 + `Permission denied`, while the short-alias form gives
 *  rc=255 + `Could not resolve hostname` (no `~/.ssh/config`) — same rc, and only the first is an
 *  authorization fact. Widening it would make a DNS failure read as "the humans must act". */
export function classifyExecutionProbeResult(
  decl: ExecutionProbeDecl,
  r: { status: number | null; error?: { message?: string } | null; stdout?: string | null; stderr?: string | null },
): RemedyAvailability {
  const base = { probeId: decl.id, specValues: [] as string[] };
  if (r.error) {
    return notEvaluated(`execution probe '${decl.id}' could not be run (${r.error.message ?? "spawn error"}) ⇒ remedy availability NOT evaluated`, base);
  }
  const out = `${String(r.stdout ?? "")}\n${String(r.stderr ?? "")}`.trim();
  const observed = out.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 3).join(" | ") || null;
  if (r.status === 0) {
    return {
      status: "executable", evaluated: true, source: "execution-probe", probeId: decl.id, probeReported: null,
      specValues: [], observed, reason: `execution probe '${decl.id}' succeeded (exit 0) ⇒ the producers it gates are executable from this host`,
    };
  }
  if (decl.blockedPattern && out.includes(decl.blockedPattern)) {
    return {
      status: "blocked", evaluated: true, source: "execution-probe", probeId: decl.id, probeReported: null,
      specValues: [], observed,
      reason: `execution probe '${decl.id}' returned the declared denial (exit ${r.status}, matched ${JSON.stringify(decl.blockedPattern)}) ⇒ NO producer it gates is runnable from this host without an authorization change`,
    };
  }
  return notEvaluated(
    `execution probe '${decl.id}' exited ${r.status} but did not match the declared denial pattern ${JSON.stringify(decl.blockedPattern)} ⇒ the reading is NOT 'blocked' (this is the third state: could not tell)`,
    { ...base, observed },
  );
}

/** Fold the probe's OWN declared value into the reading. The spec's `values` list is what makes the
 *  probe's answer readable: a value the spec does not declare is dropped (硬规则 3b — an undeclared
 *  token must not be silently accepted as a state this routine understands).
 *  Precedence: the MECHANICAL reading wins when it is evaluated (it is reproducible and the probe's
 *  value is a re-paraphrase by a fresh context); the probe's value is used only when the mechanical
 *  one could not be read. Both are recorded either way. */
export function foldProbeReportedValue(
  mechanical: RemedyAvailability,
  probeReported: unknown,
  specValues: readonly string[],
): RemedyAvailability {
  const raw = typeof probeReported === "string" && probeReported.trim() ? probeReported.trim() : null;
  const values = specValues.map((v) => String(v).trim()).filter(Boolean);
  const accepted = raw !== null && values.includes(raw) ? raw : null;
  const withSpec: RemedyAvailability = { ...mechanical, probeReported: raw, specValues: values };
  if (mechanical.evaluated) return withSpec;
  if (accepted === null) {
    return {
      ...withSpec,
      reason: `${mechanical.reason}; the probe reported ${raw === null ? "no value" : JSON.stringify(raw)}${raw !== null && values.length === 0 ? " and the spec declares no vocabulary" : ""} ⇒ nothing to fall back on`,
    };
  }
  if (accepted === "blocked" && mechanical.status === "not-evaluated") {
    return {
      ...withSpec,
      status: "blocked", evaluated: true, source: "probe-reported",
      reason: `${mechanical.reason}; the PROBE reported '${accepted}' (a declared value) ⇒ the round is treated as blocked on the probe's own live reading`,
    };
  }
  if (accepted === "executable") {
    return {
      ...withSpec,
      status: "executable", evaluated: true, source: "probe-reported",
      reason: `${mechanical.reason}; the PROBE reported 'executable' (a declared value) ⇒ the round files normally`,
    };
  }
  return {
    ...withSpec,
    reason: `${mechanical.reason}; the probe reported '${accepted}', which is not a terminal reading here ⇒ not evaluated`,
  };
}

/** Does the reading gate THIS finding's producer? Only when the reading is `blocked` AND the finding
 *  names a producer the declared probe covers. See the ⛔ SCOPE note above. */
export function remedyGatesProducer(remedy: RemedyAvailability | undefined, decl: ExecutionProbeDecl | null, producer: string | null | undefined): boolean {
  if (!remedy || remedy.status !== "blocked") return false;
  const named = String(producer ?? "").trim();
  if (!named) return false;
  if (!decl || decl.producers.length === 0) return false;
  return decl.producers.includes(named);
}

/** The escalation's identity — "同一主体" for a freshness finding is its SUBJECT (`GOAL-009-AC-NNN`),
 *  which the probe's own output contract declares. Falls back to the producer (an escalation is then
 *  per-producer), then to the finding id. "" ⇒ nothing stable to key on ⇒ the caller records the
 *  escalation but cannot dedup it (⛔ recorded, never silently dropped). */
export function escalationKey(f: FileableFinding): string {
  const subject = String(f.subject ?? "").trim();
  if (subject) return `subject:${subject}`;
  const producer = String(f.producer ?? "").trim();
  if (producer) return `producer:${producer}`;
  const id = String(f.id ?? "").trim();
  return id ? `finding:${id}` : "";
}

/** The line every escalation task body carries. It is the ONLY marker of "this file is a
 *  human-visible escalation, not a dispatchable finding task", and it is what makes the
 *  "do not re-file the same subject while the reading is unchanged" rule re-readable from the BOARD
 *  (⛔ not from a hand-kept counter). Both the `blocked` state and the subject are in it, so a reader
 *  can tell it from the `executable`/`not-evaluated` shapes and from another subject's escalation. */
export function escalationMarkerLine(subject: string, probeId: string | null): string {
  return `- remedy-availability：\`blocked\` · subject：\`${subject}\` · host-execution-probe：\`${probeId ?? "<none>"}\``;
}

const ESCALATION_MARKER_RE = /^[ \t]*[-*][ \t]*remedy-availability[ \t]*[:：][ \t]*`blocked`[ \t]*·[ \t]*subject[ \t]*[:：][ \t]*`([^`]+)`/im;

/** Subject (the full escalation key, ⛔ not the bare subject) → the task file that already carries
 *  it, for every `tasks/*.md` on the board that is a blocked escalation. An unreadable board
 *  returns an EMPTY map — which is the same value a clean board gives. That is acceptable here and
 *  only here: the failure direction is "we might re-file a subject we already escalated", which is
 *  visible on the board (two files, same marker) rather than silent. ⛔ Never used to decide that
 *  something is NOT blocked. */
export function escalationMarkerByKey(boardDir: string): Map<string, string> {
  const out = new Map<string, string>();
  let files: string[];
  try { files = fs.readdirSync(boardDir).filter((f) => f.endsWith(".md")); } catch { return out; }
  for (const f of files) {
    let text: string;
    try { text = fs.readFileSync(path.join(boardDir, f), "utf8"); } catch { continue; }
    const m = text.match(ESCALATION_MARKER_RE);
    if (m) out.set(`subject:${m[1].trim()}`, f);
  }
  return out;
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
 *  number of filings ONE routine recorded in the trailing window — `routine` is that dimension
 *  (⛔ `null` = the pre-dimension GLOBAL reading). A record with an unparseable ts is skipped. */
export function countRecentFilings(carrierPath: string, nowMs: number, windowMs: number = FILING_WINDOW_MS, routine: string | null = null): number {
  let text: string;
  try { text = fs.readFileSync(carrierPath, "utf8"); } catch { return 0; }
  // ⚠️ THE ROUTINE DIMENSION (gap-routine-filing-rate-global-window-starves-freshness-refresh): the
  //    window once summed `filed.length` over EVERY routine's `filing-round` records ⇒ it was a
  //    CROSS-ROUTINE GLOBAL budget. Measured: `semantic-dedup-scan` filed 3 every round, exhausting
  //    every other routine's share, while `freshness-refresh` was rejected `rate:` for 11 consecutive
  //    rounds (2026-10-07T23:05 → 2026-10-08T23:03Z) with the board simultaneously EMPTY — a drained
  //    board its own routine could not refill. `routine` scopes the budget to the routine's own
  //    trailing window, so one routine's batch no longer starves another's filings.
  const want = routine === null ? null : String(routine).trim();
  let n = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let r: Record<string, unknown>;
    try { r = JSON.parse(line); } catch { continue; }
    if (r.kind !== "filing-round") continue;
    // ⛔ A `filing-round` whose own `routine` is absent or different is NOT this routine's filing; it
    //    must not be counted against this routine's budget (that leak is the defect above). A `null`
    //    `routine` argument skips this filter and preserves the pre-dimension GLOBAL reading.
    if (want !== null && String(r.routine ?? "").trim() !== want) continue;
    const at = Date.parse(String(r.ts ?? ""));
    if (!Number.isFinite(at) || nowMs - at > windowMs || at > nowMs) continue;
    const filed = Array.isArray(r.filed) ? r.filed.length : 0;
    n += filed;
  }
  return n;
}

/** Everything the ESCALATION variant of the body needs, all of it quoted from declarations (⛔ no
 *  string is invented here): the probe that produced the reading, its verbatim observation, the
 *  declared human remedy, and the finding's own producer command. */
export interface BlockedRemedyContext {
  probeId: string | null;
  /** Verbatim observation that produced the `blocked` reading (the probe's own output). */
  observed: string | null;
  remedy: { host: string | null; action: string; alternative: string | null } | null;
  /** The named producer's OWN `command` from `plugin/freshness-producers.json` (single source). */
  producerCommand: string | null;
}

/** The escalation's `## Requested action` preamble: a step-by-step, human-executable remedy that
 *  names the machine, the command and the `authorized_keys` change. Rendered as list items so it
 *  stays inside the `## Requested action` section (⛔ no new heading — the task-body shape is shared
 *  with the dispatchable variant and a new heading would be a second shape to keep in sync). */
function blockedRemedyBlock(f: FileableFinding, b: BlockedRemedyContext): string[] {
  const lines = [
    "⛔ **本立案的补救在【本机】不可执行** —— 例程机械执行 `plugin/freshness-producers.json` 声明的",
    `可达性探针 \`${b.probeId ?? "<none>"}\`，读到的是**明确的授权拒绝**（`+ "`blocked`" + `），不是网络故障、`,
    "也不是「没读出来」（那两种是另一个取值）。⇒ 本任务⛔ **不进派发候选**，只走人可见通道。",
    "",
    `- 逐字观测：${b.observed ? `\`${b.observed}\`` : "（未记录）"}`,
    ...(b.remedy?.host ? [`- 目标机：\`${b.remedy.host}\``] : []),
    ...(b.remedy?.action ? [`- 补救（一）：${b.remedy.action}`] : []),
    ...(b.remedy?.alternative ? [`- 补救（二）：${b.remedy.alternative}`] : []),
    ...(b.producerCommand ? ["- 本 finding 自己的 producer 命令（逐字，来自 `plugin/freshness-producers.json`）：", `  \`${b.producerCommand}\``] : []),
    `- ⛔ 读数不变（仍是 \`blocked\`）时**不重复立案同一主体**：\`${String(f.subject ?? "").trim() || "<none>"}\` 已在板上 ⇒ 不再升级第二次。`,
  ];
  return lines;
}

/** The task body. Shape = `finding`-shape (`## Finding` + AC + DoD), which is the shape
 *  `ready-pool-check.ts`'s SHAPE_REGISTRY recognizes for a defect report — so a filed task is
 *  author→ready-eligible rather than pool noise. The finding's own evidence is quoted VERBATIM in
 *  `## Finding` so the task and the carrier record are checkably the same fact. */
export function renderRoutineTaskBody(
  f: FileableFinding,
  ctx: { routine: string; probe: string; runId: string; carrier: string; ts: string; taskId: string },
  opts?: { blocked?: BlockedRemedyContext },
): string {
  const files = f.files.map((x) => `- \`${x}\``);
  const blocked = opts?.blocked ?? null;
  return [
    "## Finding",
    // ⛔ 升级形态的标记行是 `## Finding` 的**第一行**（**唯一**的「这是人可见升级、不是可派发 finding
    //   任务」的判据；见 escalationMarkerLine）。位置是判据的一部分，⛔ 不是排版：`proseKey` 取的是本
    //   节的**前 200 字符**，把标记行放在最前 ⇒ 升级体的 prose key **结构上**不可能等于同一条 finding
    //   的可派发形态的 prose key。若把它放在 rationale 之后，当 rationale 长于 200 字符时两者的 key
    //   会**逐字相同** —— 于是一个升级体会把读数恢复 executable 之后该主语的派发立案**永久吃掉**，
    //   而那是静默的（硬规则 5b：修一处 ≠ 只此一处）。
    ...(blocked ? [escalationMarkerLine(String(f.subject ?? "").trim(), blocked.probeId)] : []),
    ...(blocked ? [""] : []),
    String(f.rationale ?? "").trim(),
    "",
    `载体记录（逐字来源）：\`${ctx.carrier}\` · routine \`${ctx.routine}\` · probe \`${ctx.probe}\` · runId \`${ctx.runId}\` · ts \`${ctx.ts}\`。`,
    "",
    // ⚠️ 升级形态说的是**它实际过的那两道闸**（quality / dedup）：这是任务的**人可见通道**，它不进食
    //    派发池，故不占派发侧的 rate 预算（见 gateEscalation）。⛔ 不在这句话里沿用三道闸的说法 ——
    //    任务体是**给人读的**，一句不真的话正是硬规则 2 要防的形态。
    ...(blocked
      ? [
        "该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的",
        "quality / dedup 两道闸机械立案，并按 `remedy-availability` = `blocked` 改走**人可见通道**",
        "（`status: needs-human`，⛔ 不进派发候选）—— ⛔ 不是由人转抄，也不是由探针自行执行。",
      ]
      : [
        "该 finding 由例程的机械通道产出，本任务由**同一条通道**依赖 `plugin/scripts/routine-file-gate.ts` 的三道闸",
        "（quality / dedup / rate）机械立案 —— ⛔ 不是由人转抄，也不是由探针自行执行。",
      ]),
    "",
    // ⛔ 升级形态**不带** `- 观测符号：` 行：符号键是「可派发立案」的 dedup 空间，一个升级体若带符号，
    //   会在读数恢复 executable 之后把同一产出者的**全部**主语永久挡在派发通道之外（那正是本条要
    //   关掉的「越修越堵」形态）。主体由上面的标记行承载，⛔ 信息没有丢失。
    ...(blocked
      ? [`- subject：\`${String(f.subject ?? "").trim() || "<none>"}\``]
      : [`- 观测符号：${f.symbols.map((s) => `\`${s}\``).join("、") || "<none>"}`]),
    ...(files.length ? ["- 涉及文件：", ...files] : []),
    ...(f.kind ? [`- kind：\`${f.kind}\``] : []),
    ...(f.verdict ? [`- verdict：\`${f.verdict}\``] : []),
    "",
    "## Requested action",
    // ⚠️ 升级形态（`blocked`）在这里把**逐字补救**放到最前，并**逐字**保留 finding 自己的
    // suggestedAction —— 派遣链上的读者看到的是「这件事本机做不了 + 谁能做」，⛔ 不是一条假装
    // 本机可执行的指令。见 escalationMarkerLine 的注释（标记行在上面的 ## Finding 里）。
    ...(opts?.blocked ? blockedRemedyBlock(f, opts.blocked) : []),
    ...(opts?.blocked ? ["", "（finding 自己的 suggestedAction，逐字：）"] : []),
    String(f.suggestedAction ?? "").trim() || "（finding 未给出 suggestedAction —— 立案时按 rationale 判定处置）",
    "",
    // ⛔ 平标题，**不加 `（draft）` 后缀**：`SHAPE_SECTIONS` 两种都认，但 **checkbox 闸只认平标题** ——
    // 带后缀时 `quay task check` 报 "AC section has no checkboxes"（实测：第一版用 `## AC（draft）`
    // 立出来的 6 条任务全部 FAIL）⇒ 机械立出来的任务会**结构上无法通过 ready/done 闸**，即又一个
    // 「看起来立了案、其实动不了」的形态。同一个坑在 meta-driver 的 renderAutoDriveBody 里也在（本文
    // 只修例程这一侧，⛔ 不动不在 Touches 内的 meta-driver.ts）。
    "## AC",
    ...(blocked
      ? [
        `- [ ] 上面那台机上那条补救被执行（或本机授权被开通），且 \`${ctx.carrier}\` 里 \`${String(f.subject ?? "").trim() || "<none>"}\` 的证据记录 \`ts\` 晚于本次升级`,
        "- [ ] 处置结论可核：要么真的重跑了产出者并把新记录落进载体，要么写明是哪一侧的授权/磁盘前置仍不满足，⛔ 不以「已注意到」结案",
      ]
      : [
        `- [ ] \`${ctx.carrier}\` 中 finding \`${f.id ?? "<no-id>"}\`（routine \`${ctx.routine}\`，runId \`${ctx.runId}\`）所描述的问题被复核并处置`,
        "- [ ] 处置结论可核：要么修掉，要么写明「已有机制在管、失败在哪一步」，⛔ 不以「已注意到」结案",
      ]),
    "",
    "## DoD",
    "- [ ] 上面的判据实跑通过",
    ...(blocked
      ? ["- [ ] ⛔ 本任务**不是**派发任务：补救在**另一台机**上、或需要目标侧 `authorized_keys` 变更（人授权）；⛔ 例程不代跑，⛔ 也没有「可机械再入队」的路径（人 2026-09-20 裁定）"]
      : ["- [ ] ⛔ 探针只立案不执行：本任务若需要跑产出者/修复，由派发链执行，⛔ 不由例程代跑"]),
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
  // ⛔ 不要把 `boardKeys()` 的返回值**拷成**一个裸 Set（`new Set([...boardKeys(dir)])`）：键集一样，
  //    而每个键的拥有者状态会在拷贝时静默丢掉 ⇒ 已关闭任务重新变成永久阻断项，且看不出是拷贝丢的。
  const existingKeys: Set<string> = board ? boardKeys(board, files[0]) : new Set<string>();
  const r = gateFinding(candidate, { existingKeys, recentCount: recent, K });
  process.stdout.write(`${r.accept ? "ACCEPT" : "REJECT"}: ${r.reason}\n`);
  return r.accept ? 0 : 1;
}

if (isDirectEntry(import.meta, undefined, "routine-file-gate")) { main(process.argv).then((c) => process.exit(c)); }
