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
