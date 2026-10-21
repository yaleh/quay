// @test-group engine
// routine-file-gate.test.mjs — the dedup key's cross-round stability.
// (plugin/scripts/routine-file-gate.ts, tasks/gap-routine-semantic-dedup-scan-routine-dedup-branch-never-fires)
//
// THE DEFECT (measured 2026-09-22, from `.quay/routine-findings.jsonl` — the routine carrier itself):
// `findingKey` keyed on the first 200 chars of the `## Finding` PROSE. For the `semantic-dedup-scan`
// routine that prose is re-paraphrased by a fresh-context LLM every round, so the key had no
// cross-round persistence. Grouping the routine's 476 carrier records by their mechanical subject
// (the symbol set the probe extracts from its inventory) yields 76 clusters recurring across ≥2
// rounds — 129 round-instances — and **0 of them ever produced the same prose key twice**. The gate's
// own output carries the consequence: across every `semantic-dedup-scan` filing round, 0 rejections
// read `dedup:` (277 `rate:`, 36 `action:`), while the same clusters were re-reported every round
// under a regenerated slug. ⇒ The dedup BRANCH was fine; the quantity it keyed on was not stable.
//
// THE FIX under test: the key comes from the finding's SUBJECT (the symbols it names — the axis the
// probe produces mechanically), with the prose kept as the fallback for a finding that names none
// (the freshness routine templates its prose from the subject id, and its dedup branch demonstrably
// fires — 2 `dedup:` rejections recorded 2026-09-18 — so that path is a live one, not dead weight).
//
// Fixtures ① and ② are the production carrier's OWN records, quoted VERBATIM (runId + findingId
// given below), NOT invented prose: the two rounds really do describe one subject in two wordings,
// and really do disagree about the file list (goal-store.ts:1117 vs :1343) — which is why the key
// cannot be the file set. A test that reproduced the defect with a hand-written "different wording"
// would be testing the fixture, not the corpus (硬规则 4 推论三).
//
// Run:
//   node --no-warnings --test --experimental-strip-types plugin/test/routine-file-gate.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_RATE,
  FILING_WINDOW_MS,
  boardKeys,
  collisionEscapeId,
  countRecentFilings,
  dedupReading,
  escalationKey,
  escalationMarkerByKey,
  escalationMarkerLine,
  findingKey,
  findingSubjectKey,
  gateEscalation,
  gateFinding,
  isActionable,
  isThrottleRejection,
  proseKey,
  readTaskStatus,
  recurrenceByKey,
  resolveTaskCliEntry,
  recurrenceOrder,
  renderRoutineTaskBody,
  repeatRejectionDecision,
  repeatRejectionMarkerLine,
  REPEAT_REJECTION_ROUNDS,
  routineFindingCandidateText,
  routineQuotaDecision,
  routineTaskId,
  throttleRejectionStreakByKey,
} from "../scripts/routine-file-gate.ts";

// ── the production fixtures (verbatim from the carrier) ──────────────────────────────────────────
// runId semantic-dedup-scan-1789322638156 / findingId assertsafeid-four-copies
const ROUND_A = {
  id: "assertsafeid-four-copies",
  kind: "same-symbol-multi-file",
  symbols: ["assertSafeId"],
  files: [
    "packages/quay/src/adr-store.ts:81",
    "packages/quay/src/document-store.ts:69",
    "packages/quay/src/goal-store.ts:1117",
    "packages/quay/src/meta-store.ts:98",
  ],
  verdict: "real-duplication",
  rationale:
    "Four identical 5-line ID guards differing only in the regex constant and the noun; all four already import frontmatter-store-base.ts, so the shared base exists but was not given this parameterizable helper.",
  suggestedAction: "extract",
};
// runId semantic-dedup-scan-1789723686226 / findingId assertsafeid-four-stores
const ROUND_B = {
  id: "assertsafeid-four-stores",
  kind: "same-symbol-multi-file",
  symbols: ["assertSafeId"],
  files: [
    "packages/quay/src/adr-store.ts:81",
    "packages/quay/src/document-store.ts:69",
    "packages/quay/src/goal-store.ts:1343",
    "packages/quay/src/meta-store.ts:98",
  ],
  verdict: "real-duplication",
  rationale:
    "Four store copies identical modulo their ID regex; quay-native/src/store.ts:426 shares the name but is a path-traversal guard and must NOT be folded in.",
  suggestedAction: "extract",
};

const CONTEXT = {
  routine: "semantic-dedup-scan",
  probe: "semantic-dedup-scan",
  runId: "semantic-dedup-scan-1789723686226",
  carrier: ".quay/routine-findings.jsonl",
  ts: "2026-09-20T07:38:25.875Z",
  taskId: "gap-routine-semantic-dedup-scan-assertsafeid",
};

const candidateA = () => routineFindingCandidateText(ROUND_A);
const candidateB = () => routineFindingCandidateText(ROUND_B);

// ── ① the defect itself, on the real pair ───────────────────────────────────────────────────────
test("DEFECT: one subject re-found in a later round kept a DIFFERENT prose key (and now keeps the same subject key)", () => {
  // RED HALF — the pre-fix quantity. Both rounds describe `assertSafeId`'s four copies; their prose
  // is paraphrased, so no 200-char prefix of one equals any prefix of the other.
  assert.notEqual(proseKey(candidateA()), proseKey(candidateB()),
    "the two rounds really do word the SAME finding differently — if this ever becomes equal, the " +
    "defect this task filed is no longer reproducible with the production fixtures");

  // GREEN HALF — the fixed quantity. Same named subject ⇒ same key, whatever the prose says.
  assert.equal(findingSubjectKey(candidateA()), "symbols:assertsafeid");
  assert.equal(findingKey(candidateA()), findingKey(candidateB()),
    "the dedup key MUST survive a round boundary, or the dedup branch can never fire for this routine");
});

// ── ② the key's two sources must not share a shape (硬规则 3b) ───────────────────────────────────
test("findingKey: subject and prose keys are distinguishable by prefix, and a symbol-less finding falls back", () => {
  assert.equal(findingKey(candidateA()), "symbols:assertsafeid");
  const noSymbols = "## Finding\nrolling-slope-check.mjs windowSlope returns NaN when deltas=[]; repro `node scripts/rolling-slope-check.mjs x.json` exit 2.\n## Requested action\nfix";
  assert.equal(findingSubjectKey(noSymbols), "", "a finding that names no symbols has NO subject key — not a key of some placeholder");
  assert.match(findingKey(noSymbols), /^prose:/, "and it falls back to the prose key, exactly as before the fix");
  assert.equal(findingKey("## Proposal\nno finding section"), "", "no finding section ⇒ no key (⛔ never a key that would match everything)");
});

// ── ③ symmetry: the candidate and the filed task body MUST key identically ───────────────────────
// Without this the dedup can never fire end-to-end, however stable the key is: `gateFinding` keys
// the CANDIDATE, `boardKeys` keys the TASK MARKDOWN. Two renderers, one key.
test("SYMMETRY: routineFindingCandidateText and renderRoutineTaskBody produce the same key", () => {
  for (const f of [ROUND_A, ROUND_B]) {
    assert.equal(findingKey(routineFindingCandidateText(f)), findingKey(renderRoutineTaskBody(f, CONTEXT)),
      "the two renderers spell the symbols line differently (`symbols: …` vs `- 观测符号：…`) — ONE parser must read both");
  }
});

// ── ④ retro-fit: tasks filed BEFORE the fix already carry the task-body spelling ─────────────────
test("RETRO-FIT: a pre-fix task body (the `- 观测符号：` bullet) keys the same as a new candidate", () => {
  const preFixBody = renderRoutineTaskBody(ROUND_A, CONTEXT); // the shape every existing board task has
  assert.match(preFixBody, /- 观测符号：`assertSafeId`/, "fixture must actually carry the pre-fix spelling");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-retrofit-"));
  try {
    fs.writeFileSync(path.join(dir, "gap-routine-semantic-dedup-scan-assertsafeid.md"), preFixBody, "utf8");
    const keys = boardKeys(dir);
    assert.equal(keys.has(findingKey(candidateB())), true,
      "a cluster already on the board (filed in the OLD format) must dedup the new candidate — no migration");
    assert.equal(gateFinding(candidateB(), { existingKeys: keys, recentCount: 0, K: DEFAULT_RATE }).accept, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── ⑤ the dedup reason must name the key it matched (a suppression you cannot audit) ─────────────
test("gateFinding: a re-found subject is rejected as `dedup`, and the reason names the matched key", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-dedup-"));
  try {
    fs.writeFileSync(path.join(dir, "T-1.md"), renderRoutineTaskBody(ROUND_A, CONTEXT), "utf8");
    const g = gateFinding(candidateB(), { existingKeys: boardKeys(dir), recentCount: 0, K: DEFAULT_RATE });
    assert.equal(g.accept, false);
    assert.match(g.reason, /^dedup:/);
    assert.match(g.reason, /symbols:assertsafeid/, "⛔ an over-block that names no key reads exactly like a correct suppression");

    // RED CONTROL for the same call: with the board entry about a DIFFERENT subject, the candidate is
    // accepted — so the rejection above is caused by the key match, not by the candidate being bad.
    fs.writeFileSync(path.join(dir, "T-2.md"),
      renderRoutineTaskBody({ ...ROUND_A, symbols: ["someOtherSymbol"] }, CONTEXT), "utf8");
    const other = boardKeys(dir);
    other.delete(findingKey(candidateA()));
    assert.equal(gateFinding(candidateB(), { existingKeys: other, recentCount: 0, K: DEFAULT_RATE }).accept, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── ⑥ no over-block: subjects stay distinct even when their FILE sets are identical ─────────────
// The measured reason the key is not the file set: a files-only key swallowed 121 distinct clusters
// under 40 key values on this very corpus (and the two fixture rounds disagree about goal-store.ts's
// line). Two different subjects over one file set must not collapse.
test("NO OVER-BLOCK: two different subjects sharing a file set keep distinct keys", () => {
  const a = { ...ROUND_A, symbols: ["walk"] };
  const b = { ...ROUND_A, symbols: ["collectShellScripts"] };
  assert.deepEqual(a.files, b.files, "fixtures must share the exact file list — that is the trap");
  assert.notEqual(findingKey(routineFindingCandidateText(a)), findingKey(routineFindingCandidateText(b)));

  // ...and the file list's LINE NUMBERS must not enter the key at all (they drift; the two production
  // fixture rounds disagree on goal-store.ts:1117 vs :1343).
  const moved = { ...ROUND_A, files: ROUND_B.files };
  assert.equal(findingKey(routineFindingCandidateText(ROUND_A)), findingKey(routineFindingCandidateText(moved)),
    "a line-number shift is not a new finding");
});

// ── ⑧-⑩ the round's filing PRIORITY (recurrence) ────────────────────────────────────────────────
//
// The sibling defect to ①-⑦ above: the key fix made re-found clusters DEDUPABLE, but dedup only stops
// a cluster from being filed twice — it says nothing about which of a round's ~50-120 candidates gets
// the round's rate budget, which the loop spent in the probe's emission order. The recurring clusters
// were therefore rejected `rate:` every round while first-seen findings walked in (measured on the
// real round in probe-routine.test.mjs, AC "PRODUCTION REPLAY"). These cases pin the READING and the
// ORDER; the reader/writer pair must agree (⑧'s symmetry case), and "cannot read the carrier" must
// not be renderable as "nothing recurred" (⑨ — 硬规则 3b).

const carrierLine = (rec) => `${JSON.stringify(rec)}\n`;
const findingRec = (runId, id, symbols, extra = {}) => ({
  ts: "2026-09-22T23:05:32.027Z", kind: "finding", routine: "semantic-dedup-scan", probe: "semantic-dedup-scan",
  runId, findingId: id, dupKind: "same-symbol-multi-file", symbols, files: ["packages/quay/src/x.ts:1"],
  verdict: "real-duplication", rationale: `a real finding about ${symbols.join("+")} — repro \`node x.mjs\` exit 2`,
  suggestedAction: "extract", ...extra,
});

test("⑧ recurrenceByKey counts DISTINCT ROUNDS (not records) and reads the SAME key the gate keys", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-recurrence-"));
  try {
    const carrier = path.join(dir, "routine-findings.jsonl");
    const A = findingRec("round-A", "f-one", ["assertSafeId"]);
    fs.writeFileSync(carrier, [
      // one sharded round emits the SAME subject TWICE — one round, not two (the reason the count is
      // over distinct runIds: counting records would make a sharded scan look like recurrence)
      carrierLine(A),
      carrierLine(findingRec("round-A", "f-one-bis", ["assertSafeId"])),
      carrierLine(findingRec("round-B", "f-two", ["assertSafeId"])),
      // non-finding records name the same symbols and MUST NOT count (the carrier is a mix of kinds)
      carrierLine({ ts: "2026-09-22T23:05:32.027Z", kind: "scan-round", routine: "semantic-dedup-scan",
        runId: "round-B", symbols: ["assertSafeId"] }),
      carrierLine({ ts: "2026-09-22T23:05:32.027Z", kind: "filing-round", routine: "semantic-dedup-scan",
        runId: "round-B", filed: [] }),
      carrierLine(findingRec("round-C", "f-three", ["someOtherThing"])),
    ].join(""), "utf8");
    const rec = recurrenceByKey(carrier);
    assert.ok(rec instanceof Map, "a readable carrier yields a reading");
    assert.equal(rec.get(findingKey(routineFindingCandidateText(A))), 2,
      "two rounds reported assertSafeId — the shard's second record must not inflate it to 3");
    assert.equal(rec.size, 2, "one entry per distinct subject");
    // SYMMETRY (the reason the priority and the dedup branch can never disagree): the reading's key for
    // a carrier record IS the key the gate computes for the same finding's candidate text.
    for (const f of [A, findingRec("round-C", "f-three", ["someOtherThing"])]) {
      assert.ok(rec.has(findingKey(routineFindingCandidateText(f))), "carrier records key through the same renderer");
    }
    // ⛔ And a subject the carrier never reported is absent, not 0-by-accident: absence is informative
    // only because the reading is COMPLETE (硬规则 6) — the caller reads it as 0.
    assert.equal(rec.has(findingKey(routineFindingCandidateText(findingRec("round-Z", "z", ["neverSeen"])))), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("⑨ recurrenceByKey is THREE-valued: unreadable ⇒ null, readable-but-unintelligible ⇒ null, empty ⇒ a real empty reading", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-recurrence3-"));
  try {
    // (a) no file at all — the reading was never taken
    assert.equal(recurrenceByKey(path.join(dir, "absent.jsonl")), null);
    // (b) a file whose every non-blank line is unreadable — ⛔ must NOT come back as "nothing recurred"
    const garbage = path.join(dir, "garbage.jsonl");
    fs.writeFileSync(garbage, "not json\n{broken\n<<<<<<\n", "utf8");
    assert.equal(recurrenceByKey(garbage), null,
      "「读不懂」must not be shaped like 「都只报过一次」 (硬规则 3b) — the caller falls back to probe order, ⛔ not to 「复现 0」");
    // (c) an empty (or all-blank) carrier — read it; nothing recurred. A legitimate empty Map.
    const blank = path.join(dir, "blank.jsonl");
    fs.writeFileSync(blank, "\n\n", "utf8");
    assert.deepEqual([...recurrenceByKey(blank)], [], "readable + no records ⇒ a real empty reading, ⛔ not null");
    // (d) readable, records present, no FINDING record among them ⇒ still a real empty reading
    const other = path.join(dir, "other.jsonl");
    fs.writeFileSync(other, carrierLine({ ts: "2026-09-22T23:05:32.027Z", kind: "scan-round", runId: "r" }), "utf8");
    assert.deepEqual([...recurrenceByKey(other)], [], "no finding records ⇒ nothing recurred, ⛔ not 「读不懂」");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("⑩ recurrenceOrder: recurrence desc, probe order on ties, and an UNREADABLE carrier keeps probe order without faking 0", () => {
  const subject = (name) => findingRec("round-X", `id-${name}`, [name]);
  const [a, b, c, d] = [subject("alpha"), subject("beta"), subject("gamma"), subject("delta")];
  const keyOf = (f) => findingKey(routineFindingCandidateText(f));
  const rec = new Map([[keyOf(b), 3], [keyOf(d), 3], [keyOf(a), 1]]); // c never reported ⇒ 0
  const order = recurrenceOrder([a, b, c, d], rec);
  assert.deepEqual(order.map((r) => r.index), [1, 3, 0, 2],
    "β(3) and δ(3) first — β before δ because they tie and β came first in probe order; then α(1), then γ(0)");
  assert.deepEqual(order.map((r) => r.recurrence), [3, 3, 1, 0]);
  assert.equal(order[0].key, keyOf(b), "each rank carries the key it was ranked by (an audit surface, not an opaque sort)");

  // Withholding the reading is NOT "everything is fresh": it is the pre-recurrence decision order,
  // and the ranks say so (null), so a caller can never render it as 「复现 0」 (硬规则 3b).
  const off = recurrenceOrder([a, b, c, d], null);
  assert.deepEqual(off.map((r) => r.index), [0, 1, 2, 3], "no reading ⇒ probe order, byte for byte");
  assert.deepEqual(off.map((r) => r.recurrence), [null, null, null, null], "⛔ null ≠ 0 — 「没测到」 must stay distinct from 「没复现过」");
});

// ── ⑪-⑭ the dedup space's STATUS DIMENSION ──────────────────────────────────────────────────────
//
// THE DEFECT (tasks/gap-ac214-eighth-crossing-done-key-permanently-suppresses-escalation; measured
// 2026-09-25, `.quay/routine-findings.jsonl` line 974, runId `freshness-refresh-1790308195712`):
// `boardKeys()` was status-BLIND — a key supplied ONLY by a `done` task blocked forever. It blocked
// exactly the two subjects that were over the freshness margin (AC-238/239: `symbols:goal-009-ac-238,
// upgrade-face` / `…-239…`, each held by one `status: done` routine task), every round, through 790
// consecutive failures — so the escalation channel built one crossing earlier was structurally
// unreachable for them. The seventh crossing's fixture could not see this: its board held **no done
// task at all**, so the state was structurally unreachable in that fixture (硬规则 4 推论三).
//
// THE THREE STATES pinned below, each able to TAKE FALSE in the others' arm (硬规则 3b):
//   `live`      an OPEN equivalent (`todo`/`ready`/`needs-human`) ⇒ reject, exactly as before — this
//               arm is the negative control that proves dedup was not switched off;
//   `done-only` every owner's status was READ and all are `done`/`superseded` ⇒ ACCEPT, with the
//               fact NAMED (an acceptance that silently matched a closed key would be
//               indistinguishable from 「板上没有这个键」);
//   `unknown`   no owner status could be read ⇒ its OWN value, fail-closed.

const SUBJECT_KEY = "symbols:assertsafeid";
// The routine-shaped body (THE dispatchable shape — it carries the `- 观测符号：` bullet the board
// reader keys on). ROUND_A's subject is `assertSafeId` ⇒ SUBJECT_KEY above.
const BOARD_BODY = renderRoutineTaskBody(ROUND_A, CONTEXT);

/** A board file: optional frontmatter `status:` + the routine body. `status = null` ⇒ NO frontmatter
 *  at all (the shape whose status is genuinely unreadable). */
const boardTask = (status) => `${status === null ? "" : `---\nid: t\nstatus: ${status}\n---\n`}${BOARD_BODY}`;

/** Read ONE board (fresh dir per call, so each arm is isolated) and return its `DedupReading`. */
function readBoard(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-status-"));
  try {
    for (const [name, status] of entries) fs.writeFileSync(path.join(dir, `${name}.md`), boardTask(status), "utf8");
    const keys = boardKeys(dir);
    assert.equal(keys instanceof Set, true, "the board reading is still a Set<string> — every pre-status caller reads unchanged");
    assert.equal(keys.has(SUBJECT_KEY), true, `the fixture must really supply ${SUBJECT_KEY}`);
    return { keys, reading: dedupReading(keys, SUBJECT_KEY), dir };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

test("⑪ boardKeys carries the OWNER'S STATUS — three distinct states, ⛔ not a boolean", () => {
  // the reader itself (硬规则 6: 缺值 = 未查 — ⛔ never a default status)
  assert.equal(readTaskStatus(boardTask("done")), "done");
  assert.equal(readTaskStatus(boardTask("needs-human")), "needs-human");
  assert.equal(readTaskStatus(boardTask(null)), null, "no frontmatter ⇒ no status");
  assert.equal(readTaskStatus("---\nid: t\ntitle: x\n---\nbody"), null, "frontmatter without `status:` ⇒ null");

  const live = readBoard([["open", "ready"]]).reading;
  const todo = readBoard([["open", "todo"]]).reading;
  const human = readBoard([["open", "needs-human"]]).reading;
  const done = readBoard([["closed", "done"]]).reading;
  const superseded = readBoard([["closed", "superseded"]]).reading;
  const unreadable = readBoard([["nostatus", null]]).reading;
  const mixed = readBoard([["closed", "done"], ["open", "ready"]]).reading;
  const halfUnknown = readBoard([["closed", "done"], ["nostatus", null]]).reading;

  assert.equal(live.state, "live");
  assert.equal(todo.state, "live");
  assert.equal(human.state, "live", "`needs-human` is OPEN — it waits on a human, it is not finished");
  assert.equal(done.state, "done-only");
  assert.equal(superseded.state, "done-only", "a replaced task is finished too");
  assert.equal(unreadable.state, "unknown");
  assert.equal(mixed.state, "live", "one OPEN owner is a definite reading whatever its siblings say");
  assert.equal(halfUnknown.state, "unknown",
    "⛔ one closed owner + one unreadable owner must NOT be reported as 「只有已关闭的」 (硬规则 3b)");

  // the three states must not share an output (硬规则 3b), and the VERDICTS differ where they must
  assert.equal(new Set([live.state, done.state, unreadable.state]).size, 3, "three distinct values");
  assert.equal(live.block, true);
  assert.equal(unreadable.block, true, "⛔ fail-closed: 「读不出拥有者状态」 must not be shaped like 「合格」");
  assert.equal(done.block, false, "⛔ a FINISHED task is not an OPEN equivalent — this is the crossing-closing state");

  // ⛔ a bare key set has NO board provenance ⇒ NOT-EVALUATED (fail-closed) — byte-for-byte the
  //    pre-status behaviour, and ⛔ not a silent 「no duplicate」.
  const bare = dedupReading(new Set([SUBJECT_KEY]), SUBJECT_KEY);
  assert.equal(bare.state, "unknown");
  assert.equal(bare.block, true);
  assert.match(bare.reason, /without board provenance/);
  // ...and the reverse: a key nobody supplies is `novel` on any space (the pre-existing value)
  assert.equal(dedupReading(new Set([SUBJECT_KEY]), "symbols:nobody").state, "novel");
  assert.equal(dedupReading(new Set([SUBJECT_KEY]), "symbols:nobody").block, false);
});

test("⑫ NEGATIVE CONTROL — a LIVE equivalent finding still rejects on BOTH channels (⛔ dedup was not switched off)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-live-"));
  try {
    fs.writeFileSync(path.join(dir, "open.md"), boardTask("ready"), "utf8");
    const keys = boardKeys(dir);
    const cand = candidateB();

    const finding = gateFinding(cand, { existingKeys: keys, recentCount: 0, K: DEFAULT_RATE });
    assert.equal(finding.accept, false, "the dispatch channel still dedups a live equivalent");
    assert.match(finding.reason, /^dedup:/);
    assert.match(finding.reason, /symbols:assertsafeid/, "an over-block that names no key reads exactly like a correct suppression");
    assert.match(finding.reason, /open\.md \[status: ready\]/, "the holder and its status must be named");
    assert.equal(finding.dedup.state, "live");

    const esc = gateEscalation(cand, { existingKeys: keys });
    assert.equal(esc.accept, false, "⛔ the human channel's dedup is not a hole either");
    assert.match(esc.reason, /^dedup:/);
    assert.equal(esc.dedup.state, "live");

    // the arm TAKES FALSE: the SAME candidate against the SAME board, only the `status:` changed
    fs.writeFileSync(path.join(dir, "open.md"), boardTask("done"), "utf8");
    const closed = boardKeys(dir);
    assert.equal(gateFinding(cand, { existingKeys: closed, recentCount: 0, K: DEFAULT_RATE }).accept, true,
      "the rejection above is caused by the OWNER BEING OPEN, not by the candidate being unfileable");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("⑬ done-only ⇒ ACCEPT on both channels, and the closed-owner fact is NAMED", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-closed-"));
  try {
    fs.writeFileSync(path.join(dir, "closed.md"), boardTask("done"), "utf8");
    const keys = boardKeys(dir);
    const cand = candidateB();

    const g = gateFinding(cand, { existingKeys: keys, recentCount: 0, K: DEFAULT_RATE });
    assert.equal(g.accept, true, "⛔ a FINISHED task must not block a re-finding (the whole point)");
    assert.equal(g.dedup.state, "done-only");
    assert.match(g.reason, /CLOSED task/, "an accepted finding that matched a closed key must SAY so");
    assert.match(g.reason, /closed\.md \[status: done\]/, "and name the holder");
    // ⛔ the rate window is untouched by this: a closed key is not an exemption from the budget
    assert.equal(gateFinding(cand, { existingKeys: keys, recentCount: DEFAULT_RATE, K: DEFAULT_RATE }).accept, false);

    const esc = gateEscalation(cand, { existingKeys: keys });
    assert.equal(esc.accept, true, "the escalation channel must reach the human — that is the crossing this closes");
    assert.equal(esc.dedup.state, "done-only");
    assert.match(esc.reason, /HUMAN-VISIBLE channel/);
    assert.match(esc.reason, /CLOSED task/, "the escalation's acceptance must say WHY a finished task did not block it");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("⑭ an unreadable owner status is its OWN value, fails closed, and is ⛔ NOT shaped like done-only", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-unknown-"));
  try {
    fs.writeFileSync(path.join(dir, "nostatus.md"), boardTask(null), "utf8");
    const keys = boardKeys(dir);
    const cand = candidateB();

    const r = dedupReading(keys, SUBJECT_KEY);
    assert.equal(r.state, "unknown");
    assert.equal(r.block, true, "fail-closed");
    assert.match(r.reason, /NOT EVALUATED/);
    assert.doesNotMatch(r.reason, /only under CLOSED task/, "⛔ 「读不出状态」 must not be rendered as 「已关闭」");
    // the two blocking states are still distinguishable from each other (硬规则 3b)
    assert.notEqual(r.reason, dedupReading(new Set([SUBJECT_KEY]), SUBJECT_KEY).reason);
    assert.match(dedupReading(new Set([SUBJECT_KEY]), SUBJECT_KEY).reason, /without board provenance/);

    // and the same reading through both gates: a rejection, ⛔ not a silent acceptance
    assert.equal(gateFinding(cand, { existingKeys: keys, recentCount: 0, K: DEFAULT_RATE }).accept, false);
    assert.equal(gateEscalation(cand, { existingKeys: keys }).accept, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── ⑦ the QUALITY bar is unmoved by any of this (it reads the text, not the identity) ───────────
test("isActionable: unchanged — the quality bar reads the prose, and the subject is not evidence", () => {
  const actionable = "## Finding\nrolling-slope-check.mjs windowSlope returns NaN when deltas=[]; repro `node scripts/rolling-slope-check.mjs x.json` exit 2.\n## Requested action\nfix";
  assert.equal(isActionable(actionable), true);
  assert.equal(isActionable("## Finding\nthe code could be cleaner\n## Requested action\nimprove"), false);
  assert.equal(isActionable("## Proposal\nno finding section"), false);
  assert.equal(isActionable(candidateA()), true, "a real routine candidate still passes the quality gate");
  // a bare symbol list with no evidence is NOT actionable, however well-identified it is:
  assert.equal(isActionable("## Finding\nsymbols: `a`, `b`\n"), false);
});

// ── ⑮ the RATE WINDOW's routine dimension ────────────────────────────────────────────────────────
// Task gap-routine-filing-rate-global-window-starves-freshness-refresh.
//
// THE DEFECT (measured from `.quay/routine-findings.jsonl`): `countRecentFilings` summed
// `filed.length` over EVERY routine's `filing-round` records ⇒ a CROSS-ROUTINE GLOBAL budget of
// `DEFAULT_RATE`. One routine's batch exhausted every other routine's share — `semantic-dedup-scan`
// filed 3 every round while `freshness-refresh` was rejected `rate:` for 11 consecutive rounds
// (2026-10-07T23:05 → 2026-10-08T23:03Z) with the board simultaneously EMPTY. A drained board that
// the routine whose job is to refill it could not refill.
//
// THE FIX under test: `countRecentFilings(…, routine)` scopes the window to ONE routine's own
// trailing `filing-round` records. The case below takes BOTH arms on ONE fixture so 「按 routine 分账」
// can be told from 「把窗口整个关掉」 (硬规则 3b): the same carrier counts 3 for the routine that
// filed, and 0 for a routine that filed nothing.

/** One `filing-round` carrier record. `routine = null` ⇒ the field is absent (the shape whose owner
 *  cannot be shown to be any named routine). */
const filingRound = (ts, routine, filed) => ({
  ts, kind: "filing-round",
  ...(routine === null ? {} : { routine }),
  probe: routine ?? "unknown", runId: `run-${ts}`,
  candidates: filed.length, filed,
});
const writeCarrier = (dir, records) => {
  const p = path.join(dir, "routine-findings.jsonl");
  fs.writeFileSync(p, records.map((r) => `${JSON.stringify(r)}\n`).join(""), "utf8");
  return p;
};

test("⑮ WINDOW POSITION — the SAME carrier rejects inside the window and accepts once the ts leaves it (single input, only the window moves)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-rate-window-"));
  try {
    const nowMs = Date.parse("2026-10-09T07:00:00Z");
    const inWindow = filingRound(new Date(nowMs - 60 * 60 * 1000).toISOString(), "freshness-refresh",
      ["a", "b", "c"]);
    // ── arm ①: the record is INSIDE the trailing window ⇒ the budget is spent ⇒ reject ────────────
    const carrier = writeCarrier(dir, [inWindow]);
    const recentIn = countRecentFilings(carrier, nowMs, FILING_WINDOW_MS, "freshness-refresh");
    assert.equal(recentIn, 3, "the in-window routine filing counts against the window");
    const gIn = gateFinding(candidateA(), { existingKeys: new Set(), recentCount: recentIn, K: DEFAULT_RATE });
    assert.equal(gIn.accept, false);
    assert.match(gIn.reason, /^rate:/, "the rejection must be the rate gate's own reason, ⛔ not dedup/quality");

    // ── arm ②: the SAME record, only its `ts` moved OUT of the window ⇒ the budget is free ⇒ accept ─
    const outOfWindow = filingRound(new Date(nowMs - FILING_WINDOW_MS - 60 * 1000).toISOString(),
      "freshness-refresh", ["a", "b", "c"]);
    const carrier2 = writeCarrier(dir, [outOfWindow]);
    const recentOut = countRecentFilings(carrier2, nowMs, FILING_WINDOW_MS, "freshness-refresh");
    assert.equal(recentOut, 0, "⛔ a filing older than the window is not in it");
    const gOut = gateFinding(candidateA(), { existingKeys: new Set(), recentCount: recentOut, K: DEFAULT_RATE });
    assert.equal(gOut.accept, true, "⛔ the flip must come ONLY from the window position, nothing else changed");
    assert.match(gOut.reason, /^accepted:/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("⑮ CROSS-ROUTINE ISOLATION — another routine's batch does NOT spend this routine's budget (and still spends its own)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-rate-routine-"));
  try {
    const nowMs = Date.parse("2026-10-09T07:00:00Z");
    const ts = new Date(nowMs - 60 * 60 * 1000).toISOString();
    // The measured shape: `semantic-dedup-scan` filed its 3 this window; `freshness-refresh` filed 0.
    const carrier = writeCarrier(dir, [
      filingRound(ts, "semantic-dedup-scan", ["x", "y", "z"]),
      filingRound(ts, "freshness-refresh", []),
    ]);

    // the routine that filed NOTHING reads its OWN budget as empty ⇒ it may refill a drained board
    const mine = countRecentFilings(carrier, nowMs, FILING_WINDOW_MS, "freshness-refresh");
    assert.equal(mine, 0, "another routine's filings must not count against this routine (the defect)");
    assert.equal(gateFinding(candidateA(), { existingKeys: new Set(), recentCount: mine, K: DEFAULT_RATE }).accept,
      true, "with its own budget free, freshness-refresh can refill the board");

    // ⛔ the SAME carrier still spends the budget of the routine that DID file — so this is 「分账」,
    //    ⛔ not 「把窗口关掉」 (the reason the two values must come off one carrier, not two fixtures)
    const theirs = countRecentFilings(carrier, nowMs, FILING_WINDOW_MS, "semantic-dedup-scan");
    assert.equal(theirs, 3, "the filing routine's own window is still enforced");
    assert.equal(gateFinding(candidateA(), { existingKeys: new Set(), recentCount: theirs, K: DEFAULT_RATE }).accept,
      false, "the routine that spent the budget is still throttled");

    // and `null` preserves the pre-dimension GLOBAL reading (sum of both) — the honest fallback
    assert.equal(countRecentFilings(carrier, nowMs, FILING_WINDOW_MS, null), 3, "global = both routines' filings");
    assert.equal(countRecentFilings(carrier, nowMs), 3, "the default argument is the global reading, unchanged");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("⑮ a record whose OWN routine is absent is not counted against a NAMED routine (⛔ no leak back in)", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-rate-noroutine-"));
  try {
    const nowMs = Date.parse("2026-10-09T07:00:00Z");
    const ts = new Date(nowMs - 60 * 60 * 1000).toISOString();
    const carrier = writeCarrier(dir, [filingRound(ts, null, ["a", "b", "c"])]);
    assert.equal(countRecentFilings(carrier, nowMs, FILING_WINDOW_MS, "freshness-refresh"), 0,
      "a filing that names no routine cannot be shown to be this routine's ⇒ ⛔ not counted against it");
    assert.equal(countRecentFilings(carrier, nowMs, FILING_WINDOW_MS, null), 3,
      "…but it IS in the global reading (the pre-dimension value is preserved, not silently dropped)");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("⑯ KNOWN GAP (gap-routine-filing-rate-global-window-starves-freshness-refresh 的方案 B 轴，未关闭，⛔ 非重新发现) — 同一 routine 自身板排空仍被它自己已 done 批次的旧计数挡住", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-rate-boardpressure-"));
  try {
    const nowMs = Date.parse("2026-10-09T07:00:00Z");
    const ts = new Date(nowMs - 60 * 60 * 1000).toISOString();
    // 生产实测的病理（见本任务 Finding）：freshness-refresh 本窗口已花满 K=3，三条任务此刻全部 done
    // （板排空）。countRecentFilings 的输入只有 filing-round 记录，没有任何读板/读任务状态的参数，
    // 因此无法区分「这 3 条还开着」与「这 3 条已经 done、板是空的」。
    const carrier = writeCarrier(dir, [filingRound(ts, "freshness-refresh", ["a", "b", "c"])]);

    // 正面（缺口本身）：自己的窗口计数仍是 3，即便它产出的 3 个任务现在全是 done。
    const mine = countRecentFilings(carrier, nowMs, FILING_WINDOW_MS, "freshness-refresh");
    assert.equal(mine, 3,
      "KNOWN GAP: 该 routine 过去的立案计数不随它产出的任务是否已 done 而改变");
    assert.equal(
      gateFinding(candidateA(), { existingKeys: new Set(), recentCount: mine, K: DEFAULT_RATE }).accept,
      false,
      "KNOWN GAP: 板已排空、自身预算却仍判饱和 ⇒ 仍被拒——这是 gap-routine-filing-rate-global-window-" +
        "starves-freshness-refresh 自己标注的方案 B 残留轴，不是本任务重新发现的问题",
    );

    // 负对照（证明上面不是空转）：同一 routine，本窗口真的没立过任何东西 ⇒ 预算真正空闲 ⇒ 应该通过。
    const emptyCarrier = writeCarrier(dir, []);
    const none = countRecentFilings(emptyCarrier, nowMs, FILING_WINDOW_MS, "freshness-refresh");
    assert.equal(none, 0);
    assert.equal(
      gateFinding(candidateA(), { existingKeys: new Set(), recentCount: none, K: DEFAULT_RATE }).accept,
      true,
      "负对照：本窗口确实没有旧立案时,同一 routine 可以正常通过——证明上面的红不是闸恒红，" +
        "而是精确命中「旧批次计数跟不上任务终态」这一条",
    );
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("⑰ KNOWN GAP (quota-policy-ownership，独立发现) — DEFAULT_RATE/FILING_WINDOW_MS 是孤儿字面量，不经 drivers.yml/driver-config.ts 的统一声明式配置面派生", () => {
  // 固化当前取值（特征化，不是认可）——见 routine-file-gate.ts:18 / :513。
  assert.equal(DEFAULT_RATE, 3,
    "固化当前字面量；若未来接入 drivers.yml 式配置面，这条断言需要连带更新，⛔ 不要只删掉它");
  assert.equal(FILING_WINDOW_MS, 24 * 60 * 60 * 1000,
    "固化当前字面量；若未来接入 drivers.yml 式配置面，这条断言需要连带更新，⛔ 不要只删掉它");
});

// ── gap-routine-quota-canonical-config-and-policy-gate：独立纯 Policy 函数 ───────────────────────
// 人裁定②：准入决策由独立纯 Policy/Gate 执行。⛔ 本组【不经 gateFinding，直接调用 routineQuotaDecision】。
// 纯函数：不读文件 / 不读 env / 不 I/O —— 两个入参都由调用方传。
test("routineQuotaDecision (AC4) — 三组对照：accept / `rate:` 拒绝 / `global-rate:` 拒绝（⛔ 两种拒绝理由不同形）", () => {
  const cfg = { k: 3, globalCeiling: 12 };

  // ① 全局未满 / per-routine 未满 ⇒ accept。
  const a = routineQuotaDecision({ perRoutine: 0, global: 0 }, cfg);
  assert.equal(a.accept, true, "两者都未满 ⇒ 准入");
  // 边界：刚好差一（k-1 / ceiling-1）仍应准入（>= 才是拒绝，不是 >）。
  assert.equal(routineQuotaDecision({ perRoutine: cfg.k - 1, global: cfg.globalCeiling - 1 }, cfg).accept, true,
    "差一仍准入——拒绝判据是 ≥，不是 >");

  // ② 全局未满 / per-routine 满 ⇒ `rate:` 拒绝。
  const b = routineQuotaDecision({ perRoutine: 3, global: 5 }, cfg);
  assert.equal(b.accept, false, "per-routine 满 ⇒ 拒绝");
  assert.match(b.reason, /^rate:/, "per-routine 拒绝读作 `rate:`");
  assert.doesNotMatch(b.reason, /^global-rate:/, "per-routine 拒绝 ⛔ 不得与全局拒绝同形");

  // ③ 全局满（即使 per-routine 未满）⇒ `global-rate:` 拒绝 —— 这正是全局天花板存在的意义。
  const c = routineQuotaDecision({ perRoutine: 0, global: 12 }, cfg);
  assert.equal(c.accept, false, "全局满、per-routine 未满 ⇒ 仍拒");
  assert.match(c.reason, /^global-rate:/, "全局拒绝读作 `global-rate:`");
  assert.doesNotMatch(c.reason, /^rate:/, "全局拒绝 ⛔ 不得与 per-routine 拒绝同形");

  // 两个拒绝理由的前缀【必须可由 regex 区分】（硬规则 3b：两种原因不得同形）。
  assert.notEqual(b.reason.split(":")[0], c.reason.split(":")[0], "`rate` 与 `global-rate` 前缀不同");

  // 全局满优先于 per-routine 满（全局是更外层的硬顶）：两者都满 ⇒ 读作 global-rate。
  const d = routineQuotaDecision({ perRoutine: 9, global: 99 }, cfg);
  assert.match(d.reason, /^global-rate:/, "两者都满 ⇒ 报更外层的 global-rate");
});

// ── ⑱–㉓ THE ELEVENTH CROSSING (gap-ac214-eleventh-crossing-repeat-remedy-rejected-by-…) ─────────
//
// THE DEFECT, read off the routine's own carrier (`.quay/routine-findings.jsonl`, routine
// `freshness-refresh`): the upgrade face's finding for AC-238/239 was re-produced every round and
// refused every round — once `collision:` (2026-10-12T21:38:59Z) and then SIX consecutive `rate:`
// rounds on 2026-10-13 (`03:41:42Z` … `16:03:42Z`) — and NOTHING consumed those refusals. Two
// independent causes, one shape:
//
//   (a) THE FILE-NAME SPACE RAN OUT. The base slug
//       `gap-routine-freshness-refresh-stale-goal-009-ac-238` AND its deterministic
//       `-<sha1(findingKey)[0:8]>` suffix `-79f43e79` were BOTH already on disk. The hash is a pure
//       function of the finding key, and the key is a pure function of the prose the probe
//       regenerates from the subject id — so the same finding produces the same two names forever,
//       and `reject("collision")` SEALED the subject. The old code read 「这条 remedy 以前立过案」 as
//       「以后不必再立」, while the STATE it names (evidence going stale as develop advances) comes back
//       by construction.
//   (b) THE THROTTLE REFUSED AND FORGOT. Six consecutive rounds recorded `rejected: [{…}]` for the
//       same subject while its remedy was `executable`; `rejected` is an array nobody reads, so
//       「the work was refused six times running」 and 「the round found nothing」 are the SAME SHAPE on
//       the carrier (硬规则 3b / 4b).
//
// Both are 「一旦转绿即永久绿」 in the FILING-GATE space — the parent AC's own theme, one layer below
// the criterion the ninth/tenth crossings fixed. What follows makes each fix TAKEABLE-FALSE.
//
// ⛔ NOT under test here: the throttle POLICY (K, the window width, who owns the budget). That is a
// human question (人 2026-09-20 裁定) and nothing below changes it.

const CROSSING_NOW = Date.parse("2026-10-13T16:03:42.469Z");
const AC238_SUBJECT = "GOAL-009-AC-238";
const AC238_FINDING = {
  id: "stale-goal-009-ac-238",
  kind: "stale-subject",
  subject: AC238_SUBJECT,
  symbols: [AC238_SUBJECT, "upgrade-face"],
  files: [".quay/goal-freshness-margin.json", "plugin/freshness-producers.json"],
  verdict: "act-now",
  rationale: "only 7 of the 200-commit window remain and the upgrade face has not produced a record since 2026-10-09",
  suggestedAction: "re-run upgrade-face on host B",
  producer: "upgrade-face",
  margin: 7,
};

/** One carrier `finding` record + one `filing-round` record, in the PRODUCTION shape (the records
 *  the probe-routine actually appends), so the reader is exercised against its real input. */
function crossingRound({ ts, runId, findingId, subject = AC238_SUBJECT, rejected = [], accepted = false }) {
  return [
    {
      ts: new Date(ts).toISOString(), kind: "finding", routine: "freshness-refresh", probe: "freshness-refresh",
      runId, findingId, dupKind: "stale-subject", subject, symbols: [subject, "upgrade-face"],
      files: [".quay/goal-freshness-margin.json"], verdict: "act-now",
      rationale: `${subject} is out of window`, suggestedAction: "re-run upgrade-face on host B", margin: 7,
    },
    {
      ts: new Date(ts).toISOString(), kind: "filing-round", routine: "freshness-refresh", probe: "freshness-refresh",
      runId, evaluated: true, candidates: 1, filed: accepted ? [`gap-routine-freshness-refresh-x`] : [],
      escalated: [], remedy_availability: "executable",
      rejected: rejected.map((r) => ({ findingId, gate: r.gate, reason: r.reason })),
      dedup_state: [{ findingId, taskId: null, accepted, state: "novel", matchedKey: null }],
      errors: [],
    },
  ];
}

function writeCrossingCarrier(records) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-crossing-"));
  const p = path.join(dir, "routine-findings.jsonl");
  fs.writeFileSync(p, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  return p;
}

test("⑱ isThrottleRejection — ONLY the two bookkeeping axes, read BY POSITION (⛔ not by keyword)", () => {
  // the throttle axes: the finding was good work the BOOKKEEPING could not place
  assert.equal(isThrottleRejection("quality-dedup-rate", "rate: 3 routine-filed tasks this window ≥ cap 3 (subject recurrence: 31 round(s))"), true);
  assert.equal(isThrottleRejection("quality-dedup-rate", "global-rate: 9 total routine-filed tasks this window ≥ global ceiling 8"), true);
  assert.equal(isThrottleRejection("collision", "collision: tasks/x.md already exists and is not this finding ⇒ not overwriting"), true);

  // the axes that JUDGE the finding itself — repetition says nothing new about them
  assert.equal(isThrottleRejection("quality-dedup-rate", "quality: no actionable `## Finding` with reproduction evidence"), false);
  assert.equal(isThrottleRejection("quality-dedup-rate", "dedup: an equivalent finding is already OPEN on the board (matched key: symbols:…, holder: x.md [status: ready])"), false);
  assert.equal(isThrottleRejection("action", "action: finding declares no requested action (suggestedAction=\"leave\")"), false);
  assert.equal(isThrottleRejection("producer", "producer: 'ghost-face' is not registered"), false);

  // 硬规则 2 — a MENTION is not a match: this line names the rate gate but is a `dedup:` rejection.
  assert.equal(isThrottleRejection("quality-dedup-rate", "dedup: matched key 'rate: 3 routine-filed tasks'"), false);
});

test("⑲ collisionEscapeId — a FREE name or `null`; it can never hand back a name that exists", () => {
  const base = "gap-routine-freshness-refresh-stale-goal-009-ac-238-79f43e79";
  const taken = new Set([base]);
  const exists = (x) => taken.has(x);

  const first = collisionEscapeId(base, CROSSING_NOW, exists);
  assert.equal(first, `${base}-r20261013T160342Z`, "the round's own UTC stamp is the one component that is NOT a function of the finding");
  assert.equal(exists(first), false, "⛔ it must never return a taken name — that is what 「绝不覆盖既有任务体」 reduces to here");

  // deterministic given the clock ⇒ a second filing in the SAME round walks to `-2` (not random)
  taken.add(first);
  assert.equal(collisionEscapeId(base, CROSSING_NOW, exists), `${base}-r20261013T160342Z-2`);

  // a LATER round gets a DIFFERENT name — the property the old (pure-function-of-the-finding) suffix
  // could never have, and the whole reason the subject was sealed.
  const later = collisionEscapeId(base, CROSSING_NOW + 7_200_000, exists);
  assert.equal(later, `${base}-r20261013T180342Z`);
  assert.notEqual(later, first);

  // exhaustion is a NAMED outcome (the caller reports it), ⛔ never a name that could overwrite
  assert.equal(collisionEscapeId(base, CROSSING_NOW, () => true), null);
});

test("⑳ throttleRejectionStreakByKey — counts CONSECUTIVE rounds, keyed by SUBJECT across regenerated findingIds", () => {
  // The production findingIds really did differ across the six rounds (the probe regenerates the slug):
  // `stale-goal-009-ac-238`, `stale-goal-009-ac-238-upgrade-face`, `freshness-stale-goal-009-ac-238`.
  // Keying on the findingId would read one 6-round run as three 1-round ones ⇒ the subject key is what
  // the reader must count by.
  const rate = { gate: "quality-dedup-rate", reason: "rate: 3 routine-filed tasks this window ≥ cap 3 (subject recurrence: 31 round(s))" };
  const rounds = [
    ...crossingRound({ ts: CROSSING_NOW - 1_500_000, runId: "r-a", findingId: "stale-goal-009-ac-238-upgrade-face", rejected: [rate] }),
    ...crossingRound({ ts: CROSSING_NOW - 1_200_000, runId: "r-b", findingId: "freshness-stale-goal-009-ac-238", rejected: [rate] }),
    ...crossingRound({ ts: CROSSING_NOW - 900_000, runId: "r-c", findingId: "stale-goal-009-ac-238", rejected: [rate] }),
  ];
  const p = writeCrossingCarrier(rounds);
  const map = throttleRejectionStreakByKey(p, "freshness-refresh", CROSSING_NOW);
  assert.ok(map instanceof Map, "a readable carrier is a Map (⛔ not null)");
  assert.equal(map.get(`subject:${AC238_SUBJECT}`).rounds, 3, "three consecutive throttle refusals, counted by SUBJECT");
  assert.deepEqual(map.get(`subject:${AC238_SUBJECT}`).gates, ["rate:", "rate:", "rate:"], "newest-first, one per round — ⛔ a bare count would collapse `rate:`/`collision:` refusals into one number");

  // ① a round that does NOT mention the subject BREAKS the run — 「连续」 means consecutive, and a
  //    silence (the finding was inside its window that round) is not a refusal. The middle round here
  //    RAN and filed a `filing-round`; it simply carried a different subject.
  const broken = writeCrossingCarrier([
    ...crossingRound({ ts: CROSSING_NOW - 1_500_000, runId: "r-a", findingId: "f1", rejected: [rate] }),
    ...crossingRound({ ts: CROSSING_NOW - 1_200_000, runId: "r-b", findingId: "f2", subject: "GOAL-009-AC-999", rejected: [] }),
    ...crossingRound({ ts: CROSSING_NOW - 900_000, runId: "r-c", findingId: "f3", rejected: [rate] }),
  ]);
  assert.equal(throttleRejectionStreakByKey(broken, "freshness-refresh", CROSSING_NOW).get(`subject:${AC238_SUBJECT}`).rounds, 1,
    "a silent round ends the run (⛔ silence is not continuation)");

  // ② a round in which the subject was ACCEPTED also ends it
  const acceptedMid = writeCrossingCarrier([
    ...crossingRound({ ts: CROSSING_NOW - 1_500_000, runId: "r-a", findingId: "f1", rejected: [rate] }),
    ...crossingRound({ ts: CROSSING_NOW - 1_200_000, runId: "r-b", findingId: "f2", accepted: true }),
    ...crossingRound({ ts: CROSSING_NOW - 900_000, runId: "r-c", findingId: "f3", rejected: [rate] }),
  ]);
  assert.equal(throttleRejectionStreakByKey(acceptedMid, "freshness-refresh", CROSSING_NOW).get(`subject:${AC238_SUBJECT}`).rounds, 1,
    "a filing ends the run — the subject was placed, so the refusals are no longer consecutive");

  // ③ a NON-throttle refusal ends it too (the axes must not be merged)
  const dedupRefused = writeCrossingCarrier([
    ...crossingRound({ ts: CROSSING_NOW - 1_500_000, runId: "r-a", findingId: "f1", rejected: [{ gate: "quality-dedup-rate", reason: "dedup: an equivalent finding is already OPEN on the board (matched key: symbols:x)" }] }),
    ...crossingRound({ ts: CROSSING_NOW - 900_000, runId: "r-c", findingId: "f3", rejected: [rate] }),
  ]);
  assert.equal(throttleRejectionStreakByKey(dedupRefused, "freshness-refresh", CROSSING_NOW).get(`subject:${AC238_SUBJECT}`).rounds, 1,
    "a `dedup:` refusal is a judgment about the finding ⇒ it is not part of the throttle run");

  // ④ another routine's rounds are not this routine's history
  assert.equal(throttleRejectionStreakByKey(p, "semantic-dedup-scan", CROSSING_NOW).size, 0);

  // ⑤ THREE-VALUED (硬规则 3b): an absent carrier and an unreadable one are NOT 「0 rounds」.
  assert.equal(throttleRejectionStreakByKey(path.join(os.tmpdir(), "does-not-exist-9f3a.jsonl"), "freshness-refresh", CROSSING_NOW), null);
  const garbage = writeCrossingCarrier([]);
  fs.writeFileSync(garbage, "not json at all\nstill not json\n", "utf8");
  assert.equal(throttleRejectionStreakByKey(garbage, "freshness-refresh", CROSSING_NOW), null,
    "readable-but-unintelligible ⇒ null, ⛔ never a Map that reads as 「没有连续拒绝」");
  fs.writeFileSync(garbage, "", "utf8");
  assert.equal(throttleRejectionStreakByKey(garbage, "freshness-refresh", CROSSING_NOW).size, 0, "an EMPTY carrier is a legitimate reading (nothing was ever refused)");
  fs.rmSync(path.dirname(p), { recursive: true, force: true });
  fs.rmSync(path.dirname(broken), { recursive: true, force: true });
  fs.rmSync(path.dirname(acceptedMid), { recursive: true, force: true });
  fs.rmSync(path.dirname(dedupRefused), { recursive: true, force: true });
  fs.rmSync(path.dirname(garbage), { recursive: true, force: true });
});

test("㉑ repeatRejectionDecision — four premises, EACH able to take false, and 未评估 kept apart from 不该升级", () => {
  const rate = "rate: 3 routine-filed tasks this window ≥ cap 3 (subject recurrence: 31 round(s))";
  const all = { gate: "quality-dedup-rate", reason: rate, priorRounds: 1, margin: -1, remedyStatus: "executable" };

  const yes = repeatRejectionDecision(all);
  assert.equal(yes.escalate, true, "negative margin + executable remedy + 2nd consecutive throttle refusal ⇒ human channel");
  assert.equal(yes.evaluated, true);
  assert.match(yes.reason, /rejection #2 in a row/);

  // ① 轴：a non-throttle refusal is not this question
  assert.equal(repeatRejectionDecision({ ...all, reason: "dedup: already OPEN on the board" }).escalate, false);
  assert.equal(repeatRejectionDecision({ ...all, reason: "dedup: already OPEN on the board" }).evaluated, true);
  // ② remedy：ONLY 'executable' — 'blocked' has its own channel, and the other two are readings we did
  //    not take (routing them here would print a cause the round did not observe).
  for (const st of ["blocked", "not-evaluated", "not-declared"]) {
    const r = repeatRejectionDecision({ ...all, remedyStatus: st });
    assert.equal(r.escalate, false, `remedy '${st}' must not reach this channel`);
    assert.equal(r.evaluated, true, `remedy '${st}' is a READING, not a missing premise`);
  }
  // ③ margin：the finding's OWN declared margin. `null` (the probe did not report it) is
  //    NOT-EVALUATED — ⛔ 缺值 ≠ 负值 (硬规则 6/3b).
  const noMargin = repeatRejectionDecision({ ...all, margin: null });
  assert.equal(noMargin.escalate, false);
  assert.equal(noMargin.evaluated, false, "「探针没报 margin」 ⇒ 未评估，⛔ 不得写成「不该升级」的形态");
  assert.match(noMargin.reason, /NOT-EVALUATED/);
  // and a non-negative margin is a READING that says the policy is working as designed
  const healthy = repeatRejectionDecision({ ...all, margin: 7 });
  assert.equal(healthy.escalate, false);
  assert.equal(healthy.evaluated, true, "margin +7 is evaluated — it is a reading, NOT a missing premise");
  // ④ 连续：one refusal is a normal throttle event; the SECOND in a row is the stuck state.
  const once = repeatRejectionDecision({ ...all, priorRounds: 0 });
  assert.equal(once.escalate, false);
  assert.equal(once.evaluated, true);
  assert.match(once.reason, /not yet — this is rejection #1/);
  assert.equal(REPEAT_REJECTION_ROUNDS, 2, "the declared threshold is what the message above says");
  // a carrier we could not read ⇒ 「连续几轮」 UNKNOWN ⇒ ⛔ escalate nothing, and say so
  const unreadable = repeatRejectionDecision({ ...all, priorRounds: null });
  assert.equal(unreadable.escalate, false);
  assert.equal(unreadable.evaluated, false);
  assert.match(unreadable.reason, /NOT-EVALUATED/);
});

test("㉒ the repeat-rejection escalation body: its OWN marker on the channel, and a prose key ⛔ different from the dispatchable one", () => {
  const body = renderRoutineTaskBody({ ...AC238_FINDING }, {
    routine: "freshness-refresh", probe: "freshness-refresh", runId: "r1",
    carrier: ".quay/routine-findings.jsonl", ts: "2026-10-13T16:03:42.469Z",
    taskId: "gap-routine-freshness-refresh-stale-goal-009-ac-238-r20261013T160342Z",
  }, { repeatRejection: { priorRounds: 5, gates: ["rate:"], currentReason: "rate: 3 routine-filed tasks this window ≥ cap 3", margin: -1 } });

  // the marker IS the first line of `## Finding` (that is what keeps the two prose keys structurally
  // different — a marker placed after a >200-char rationale would collide, and the escalation would
  // then eat the dispatchable filing of the same subject forever, silently).
  const firstLine = body.split("\n")[1];
  assert.match(firstLine, /^- repeat-rejection：`6` consecutive filing-round\(s\) rejected this subject on the throttle gate · subject：`GOAL-009-AC-238` · remedy-availability：`executable`$/);
  assert.notEqual(proseKey(body), proseKey(routineFindingCandidateText(AC238_FINDING)),
    "⛔ 升级体与可派发体的 prose key 必须不同，否则升级体会永久吃掉该主体的派发立案");

  // ⛔ the escalation body carries NO `- 观测符号：` bullet (the symbol key is the DISPATCH space)
  assert.doesNotMatch(body, /观测符号/);
  assert.match(body, /- subject：`GOAL-009-AC-238`/);
  // ⛔ and it does not claim the REMEDY is unperformable — that is the OTHER form's cause
  assert.doesNotMatch(body, /不可执行/);
  assert.match(body, /连续 6 轮/);
  assert.match(body, /不裁定限流策略/);
  assert.match(body, /## AC/);
  assert.match(body, /## DoD/);

  // ONE grammar, two forms: BOTH round-trip through the board reader (硬规则 5b — a second regex
  // would let reader and renderer drift apart silently), and the two keys stay distinguishable.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-marker-"));
  fs.writeFileSync(path.join(dir, "repeat.md"), body, "utf8");
  fs.writeFileSync(path.join(dir, "blocked.md"),
    `---\nid: blocked\n---\n## Finding\n${escalationMarkerLine("GOAL-009-AC-999", "host-b-ssh")}\n`, "utf8");
  const map = escalationMarkerByKey(dir);
  assert.deepEqual([...map.keys()].sort(), ["subject:GOAL-009-AC-238", "subject:GOAL-009-AC-999"],
    "the reader recognizes BOTH forms (a repeat-rejection escalation must be re-readable from the board)");
  assert.equal(map.get("subject:GOAL-009-AC-238"), "repeat.md");
  // escalationKey is the same identity the streak is keyed by — one subject, one escalation
  assert.equal(escalationKey(AC238_FINDING), `subject:${AC238_SUBJECT}`);
  // a plain dispatchable task is NOT an escalation (the reverse control)
  fs.writeFileSync(path.join(dir, "plain.md"), `---\nid: plain\n---\n## Finding\nordinary body\n`, "utf8");
  assert.equal(escalationMarkerByKey(dir).has("subject:plain"), false);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("㉓ routineTaskId + collisionEscapeId compose into the OLD two names the live carrier actually held", () => {
  // The 2026-10-12T21:38:59Z record names them verbatim:
  //   collision: tasks/gap-routine-freshness-refresh-stale-goal-009-ac-238-79f43e79.md already exists
  // so both the base and the hash-suffixed name are reconstructible — this pins that the escape is a
  // THIRD name, not a re-derivation of either.
  const base = routineTaskId("freshness-refresh", "stale-goal-009-ac-238");
  assert.equal(base, "gap-routine-freshness-refresh-stale-goal-009-ac-238");
  const hash8 = createHash("sha1").update(findingKey(routineFindingCandidateText(AC238_FINDING))).digest("hex").slice(0, 8);
  const hashed = `${base}-${hash8}`;
  const taken = new Set([base, hashed]);
  const escaped = collisionEscapeId(hashed, CROSSING_NOW, (x) => taken.has(x));
  assert.equal(escaped, `${hashed}-r20261013T160342Z`);
  assert.notEqual(escaped, base);
  assert.notEqual(escaped, hashed);
  assert.equal(taken.has(escaped), false, "the third name is free ⇒ the subject is no longer sealed in name space");
});

// ── ㉔ resolveTaskCliEntry — the two store layouts
// (gap-probe-routine-kernel-plugin-root-not-passed-third-party-host-filing-fails)
// The defect: `probeRoutinesFromConfig` never passed `kernelPluginRoot`, so the SECOND branch below
// could not be taken and a third-party host (no `packages/quay-native`) could never file — silently,
// while the round still read `verified`. This pins the branch itself; the end-to-end landing is pinned
// in probe-routine.test.mjs (driver --once on a workspace with no source store).
test("resolveTaskCliEntry — a third-party host resolves the VENDORED bundle from kernelPluginRoot (and null when there is none)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gate-store-thirdparty-"));
  const kernel = fs.mkdtempSync(path.join(os.tmpdir(), "gate-kernel-plugin-"));
  try {
    // premise, asserted: this workspace is the third-party shape (the first branch cannot mask anything)
    assert.equal(fs.existsSync(path.join(root, "packages", "quay-native")), false);
    // negative control: with NO kernel anchor neither branch exists ⇒ null (never an empty success)
    assert.equal(resolveTaskCliEntry(root, null), null,
      "⛔ unresolved must be null — the caller reports it as unresolvable, never as 'nothing to file'");
    // installation-shaped plugin root: <kernel>/vendor/quay-native/dist/quay-native.js
    const vendored = path.join(kernel, "vendor", "quay-native", "dist", "quay-native.js");
    fs.mkdirSync(path.dirname(vendored), { recursive: true });
    fs.writeFileSync(vendored, "// fixture stand-in for the shipped bundle\n", "utf8");
    assert.deepEqual(resolveTaskCliEntry(root, kernel), ["--no-warnings", vendored],
      "the SECOND branch is the one a shipped install takes (⛔ a source-only flag like --experimental-strip-types would be wrong here)");
    // and a source checkout still takes the FIRST branch even when a kernel root is supplied
    fs.mkdirSync(path.join(root, "packages", "quay-native", "bin"), { recursive: true });
    fs.writeFileSync(path.join(root, "packages", "quay-native", "bin", "quay-native.ts"), "// fixture\n", "utf8");
    assert.deepEqual(resolveTaskCliEntry(root, kernel),
      ["--no-warnings", "--experimental-strip-types", path.join(root, "packages", "quay-native", "bin", "quay-native.ts")]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(kernel, { recursive: true, force: true });
  }
});
