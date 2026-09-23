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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  DEFAULT_RATE,
  boardKeys,
  findingKey,
  findingSubjectKey,
  gateFinding,
  isActionable,
  proseKey,
  recurrenceByKey,
  recurrenceOrder,
  renderRoutineTaskBody,
  routineFindingCandidateText,
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
