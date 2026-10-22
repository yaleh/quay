// @test-group engine
// needs-human-parking-recheck.test.mjs — tasks/gap-meta-needs-human-parking-recheck
//
// THE DEFECT THIS PINS: a task flipped to `status: needs-human` by a mechanical park decision records
// the criterion in its `## Needs-Human` block, and NOTHING re-runs that criterion afterwards. When the
// criterion was repaired (judgeUnsatisfiableUnannotatedAc's phrase families split, 2026-10-22) the task
// stayed parked and its goal AC kept failing every round — AC-919 read fail for 42 consecutive rounds
// while its only blocking criterion was already clean.
//
// Coverage map:
//   AC1 (a) re-runs the RECORDED judge against the CURRENT body and reports a task whose criterion is
//           clean today — the falsifiable pair is one fixture judged TWICE with the recorded reason
//           left byte-identical: while the AC still declares executor-unsatisfiability the task is
//           `still-blocked` (not reported); after the AC is annotated `（待外部）` the SAME task is
//           `parking-reason-stale` (reported). A check that merely echoed the recorded text could not
//           flip states, and a check that ignored the body could not be clean at all.
//   AC1 (b) a criterion that still fires is NOT reported (still-blocked).
//   AC1 (c) a non-mechanical parking reason is NOT reported (no-registered-judge).
//   AC1 (d) unreadable input is `not-evaluated`, NEVER `clean` (hard rule 3b) — both the raw shape
//           (no `## Needs-Human` record) and the judge-side shape (record present, but the judge
//           returns evaluated:false because the body has no AC/DoD section).
//   AC1 (e) the detector has a LIVE per-round consumer: promotion-driver.ts emits the reading in its
//           round event, persists `.quay/needs-human-parking-recheck.json`, and warns on stderr.
//   AC1 (f) nothing writes `status` — the task files are byte-identical after both the CLI and a full
//           driver round (needs-human has no mechanical re-enqueue path, 人 2026-09-20).
//   AC1 (g) a root without `tasks/` reads `evaluated:false` — an empty stale list must not read as
//           「没有任何失效停放」.
//
// Run: node --no-warnings --experimental-strip-types --test plugin/test/needs-human-parking-recheck.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const CHECKER = path.join(REPO_ROOT, "plugin/scripts/needs-human-parking-recheck.ts");
const DRIVER = path.join(REPO_ROOT, "plugin/scripts/promotion-driver.ts");
const READING_REL = path.join(".quay", "needs-human-parking-recheck.json");

function makeRoot(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nhp-recheck-${tag}-`));
}

/** The recorded parking reason promotion-driver writes for the structural block
 *  (`structuralNeedsHuman` → markNeedsHuman): the judge token + the offending item text + the
 *  driver's own tail sentence. Kept verbatim-shaped so the token match exercises the real string. */
const RECORDED_UNSAT_REASON =
  "unsatisfiableUnannotatedAc=[AC1 人评审门：这条 AC 只能由人裁定]（连续 3 轮被结构上不可派的拦截挡住 ⇒ 作者/人改写；⛔ 不派 fix worker）";

/** Write a task file. `acItems` are the raw `- [ ]` lines; `needsHumanReason` adds the
 *  `## Needs-Human` record exactly as driver-filters.markNeedsHuman writes it (null = no record). */
function writeTask(root, id, { status = "needs-human", acItems = [], needsHumanReason = null, withAcSection = true } = {}) {
  const ac = withAcSection ? `\n## Acceptance Criteria\n\n${acItems.join("\n")}\n` : "";
  const record =
    needsHumanReason === null
      ? ""
      : `\n## Needs-Human\n\n**执行 2026-10-22T10:21:50.889Z — 连续修满重试上限仍不合格（标 needs-human）**\n\n- 阻碍原因：${needsHumanReason}\n- 失败步/判词：step=suite: 1 failing\n`;
  const body =
    `---\nid: ${id}\ntitle: "fixture ${id}"\nstatus: ${status}\nlabels:\n  - gap\nparent: null\nchildren: []\nextra: {}\n---\n` +
    `## Proposal\n\nFixture task for needs-human-parking-recheck (well over forty non-whitespace characters).\n` +
    ac +
    record;
  const file = path.join(root, "tasks", `${id}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

function runCli(root, ...args) {
  return spawnSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", root, "--json", ...args],
    { encoding: "utf8" },
  );
}

function readReading(root) {
  const res = runCli(root);
  assert.equal(res.status, 0, `detector must exit 0, got ${res.status}:\n${res.stdout}${res.stderr}`);
  return JSON.parse(res.stdout);
}

function snapshot(dir) {
  const out = new Map();
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith(".md")) continue;
    out.set(file, fs.readFileSync(path.join(dir, file), "utf8"));
  }
  return out;
}

test("AC1(a/b) — the RECORDED judge is RE-RUN on the CURRENT body: same record, state flips still-blocked → stale", () => {
  const root = makeRoot("flip");
  try {
    const id = "gap-fixture-parked";
    // Run 1: the AC still declares executor-unsatisfiability (unchecked, unannotated) ⇒ the judge
    // still fires ⇒ the parking is still justified ⇒ NOT reported.
    writeTask(root, id, {
      acItems: ["- [ ] AC1 人评审门：这条 AC 不得由执行者代写，等人工评审结论"],
      needsHumanReason: RECORDED_UNSAT_REASON,
    });
    const first = readReading(root);
    const firstTask = first.tasks.find((t) => t.id === id);
    assert.ok(firstTask, `task must be scanned: ${JSON.stringify(first)}`);
    assert.equal(firstTask.judge, "unsatisfiableUnannotatedAc", "the recorded judge is identified by its reason token");
    assert.equal(firstTask.state, "still-blocked", `a still-firing criterion must NOT be reported: ${JSON.stringify(firstTask)}`);
    assert.deepEqual(first.stale, [], "no stale entries while the criterion still fires");
    assert.ok(firstTask.currentHits.length > 0, "the current offending item is carried verbatim");
    assert.ok(firstTask.currentHits[0].includes("不得由执行者代写"), `currentHits names the item: ${JSON.stringify(firstTask.currentHits)}`);

    // Run 2: the SAME task, the SAME recorded reason — only the BODY changed (the AC is now annotated
    // `（待外部）`, the real repair shape: the author, not the executor, satisfies it) ⇒ clean today ⇒
    // the parking reason has expired ⇒ REPORTED. A detector that trusted the recorded text could never
    // produce this flip, which is what makes "it re-runs the judge" falsifiable.
    writeTask(root, id, {
      acItems: ["- [ ] AC1 人评审门：这条 AC 不得由执行者代写，等人工评审结论（待外部）"],
      needsHumanReason: RECORDED_UNSAT_REASON,
    });
    const second = readReading(root);
    const secondTask = second.tasks.find((t) => t.id === id);
    assert.equal(secondTask.state, "parking-reason-stale", `a clean-today criterion MUST be reported: ${JSON.stringify(secondTask)}`);
    assert.equal(second.reported_stale, 1);
    assert.deepEqual(second.stale.map((t) => t.id), [id], "the stale list names the task");
    assert.equal(second.counts["parking-reason-stale"], 1);
    assert.equal(second.counts["still-blocked"], 0);
    assert.equal(secondTask.recordedReason, RECORDED_UNSAT_REASON, "the recorded reason is reported verbatim");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1(c) — a NON-mechanical parking reason is not reported (no-registered-judge)", () => {
  const root = makeRoot("nonmech");
  try {
    writeTask(root, "gap-fixture-human", {
      acItems: ["- [ ] AC1 贴出实现证据"],
      needsHumanReason: "人工裁定：release note 措辞须由人 yale 逐字给出（非机械判据）",
    });
    const out = readReading(root);
    const t = out.tasks.find((x) => x.id === "gap-fixture-human");
    assert.equal(t.state, "no-registered-judge", `non-mechanical park must not be judged: ${JSON.stringify(t)}`);
    assert.equal(t.judge, null);
    assert.deepEqual(out.stale, [], "a non-mechanical park is never reported as a stale criterion");
    assert.equal(out.counts["no-registered-judge"], 1);
    // The reason is still carried verbatim, so a human can see WHY it was not judged.
    assert.ok(t.recordedReason.includes("人工裁定"), "recorded reason surfaced for the unjudged class");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1(d) — unreadable input is not-evaluated, NEVER clean (hard rule 3b)", () => {
  const root = makeRoot("noteval");
  try {
    // (1) no `## Needs-Human` record at all (parked by an older/unknown path).
    writeTask(root, "gap-fixture-norecord", { acItems: ["- [ ] AC1 贴出证据"], needsHumanReason: null });
    // (2) the record names the judge, but the CURRENT body has no AC/DoD section at all ⇒ the judge
    //     returns evaluated:false (its own third state) ⇒ the detector must inherit it, not read it as clean.
    writeTask(root, "gap-fixture-noac", { withAcSection: false, needsHumanReason: RECORDED_UNSAT_REASON });

    const out = readReading(root);
    const norecord = out.tasks.find((t) => t.id === "gap-fixture-norecord");
    const noac = out.tasks.find((t) => t.id === "gap-fixture-noac");
    assert.equal(norecord.state, "not-evaluated", `missing record ⇒ not-evaluated: ${JSON.stringify(norecord)}`);
    assert.equal(noac.state, "not-evaluated", `judge evaluated:false ⇒ not-evaluated: ${JSON.stringify(noac)}`);
    assert.equal(noac.judge, "unsatisfiableUnannotatedAc", "the judge was identified and attempted");
    assert.ok(noac.note.includes("no-ac-or-dod-section"), `the judge's own reason is carried: ${noac.note}`);
    assert.deepEqual(out.stale, [], "未评估 must never be reported as stale/clean — they are different values");
    assert.equal(out.counts["not-evaluated"], 2);
    assert.equal(out.counts["parking-reason-stale"], 0);
    // The four states are mutually exclusive and cover the store.
    assert.equal(
      Object.values(out.counts).reduce((a, b) => a + b, 0),
      out.needs_human_total,
      `counts must partition the needs-human store: ${JSON.stringify(out.counts)} vs ${out.needs_human_total}`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1(f) — the detector writes NO status (the parked task stays parked, byte-identical)", () => {
  const root = makeRoot("readonly");
  try {
    writeTask(root, "gap-fixture-parked", {
      acItems: ["- [ ] AC1 人评审门：只能由人裁定（待外部）"],
      needsHumanReason: RECORDED_UNSAT_REASON,
    });
    const before = snapshot(path.join(root, "tasks"));
    const out = readReading(root);
    assert.equal(out.reported_stale, 1, "precondition: this fixture IS a stale park (else the test proves nothing)");
    const after = snapshot(path.join(root, "tasks"));
    assert.deepEqual([...after.entries()], [...before.entries()], "a stale report must NOT rewrite the task file");
    assert.ok(/^status:\s*needs-human\b/m.test(after.get("gap-fixture-parked.md")), "status is still needs-human");
    assert.ok(!fs.existsSync(path.join(root, READING_REL)), "the detector alone persists nothing — only the driver writes the reading");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1(g) — a root without tasks/ is evaluated:false, not an empty all-clear", () => {
  const root = makeRoot("notasks");
  try {
    const out = readReading(root);
    assert.equal(out.evaluated, false, "no tasks dir ⇒ the store was not read");
    assert.equal(out.reason, "no-tasks-dir");
    assert.deepEqual(out.stale, []);
    assert.equal(out.needs_human_total, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1(e) — promotion-driver is the LIVE consumer: every round carries the reading and persists it", () => {
  const root = makeRoot("driver");
  try {
    writeTask(root, "gap-fixture-parked", {
      acItems: ["- [ ] AC1 人评审门：只能由人裁定（待外部）"],
      needsHumanReason: RECORDED_UNSAT_REASON,
    });
    // A minimal but REAL ready-pool-check output (the driver spawns this as a subprocess): nothing to
    // promote, nothing to classify — the round's only interesting product is the parking reading.
    const fake = path.join(root, "fake-ready.mjs");
    fs.writeFileSync(
      fake,
      'console.log(JSON.stringify({ pool: 0, should_apply: false, promotions: [], applied_promotions: [], candidates: [] }));\n',
    );
    const res = spawnSync(
      process.execPath,
      [
        "--no-warnings", "--experimental-strip-types", DRIVER,
        "--root", root, "--max-rounds", "2", "--interval", "0", "--json",
        "--ready-pool-cmd", `${process.execPath} ${fake}`,
        "--resource-gate-cmd", "node -e process.exit(0)",
      ],
      { encoding: "utf8", timeout: 120_000 },
    );
    assert.equal(res.status, 0, `driver --max-rounds 2 must exit 0:\nstdout=${res.stdout}\nstderr=${res.stderr}`);

    // EVERY round carries it — not just the first (this is the 「每轮真跑」 half of the AC). Two rounds
    // are driven and each round event must carry its own reading.
    const rounds = res.stdout.trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.event === "round");
    assert.equal(rounds.length, 2, `two rounds must be driven:\n${res.stdout}`);
    for (const r of rounds) {
      assert.ok(r.needs_human_parking, `round ${r.round} carries needs_human_parking: ${JSON.stringify(r).slice(0, 400)}`);
      assert.deepEqual(r.needs_human_parking.stale.map((t) => t.id), ["gap-fixture-parked"], `round ${r.round} reports the stale park`);
      assert.equal(r.needs_human_parking.tasks[0].judge, "unsatisfiableUnannotatedAc");
    }

    // Durable carrier: the reading is on disk after the round (an external reader needs no stdout).
    const file = path.join(root, READING_REL);
    assert.ok(fs.existsSync(file), `the driver persists ${READING_REL}`);
    const persisted = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(persisted.reported_stale, 1);
    assert.deepEqual(persisted.stale.map((t) => t.id), ["gap-fixture-parked"]);

    // And the human-visible channel: the driver log says WHICH task and WHICH judge.
    assert.ok(
      res.stderr.includes("gap-fixture-parked") && res.stderr.includes("unsatisfiableUnannotatedAc"),
      `stderr names the stale park and its judge:\n${res.stderr}`,
    );
    // Still read-only end-to-end.
    assert.ok(/^status:\s*needs-human\b/m.test(fs.readFileSync(path.join(root, "tasks", "gap-fixture-parked.md"), "utf8")), "status unchanged");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1 — the REAL store: the reading partitions every needs-human task (no board-count pinning)", () => {
  const res = runCli(REPO_ROOT);
  assert.equal(res.status, 0, `real-repo detector must exit 0:\n${res.stdout}${res.stderr}`);
  const out = JSON.parse(res.stdout);
  assert.equal(out.evaluated, true, "the real repo has a tasks/ dir");
  assert.ok(out.needs_human_total > 0, `the real board carries needs-human tasks (got ${out.needs_human_total})`);
  assert.equal(
    Object.values(out.counts).reduce((a, b) => a + b, 0),
    out.needs_human_total,
    `the four states partition the store: ${JSON.stringify(out.counts)}`,
  );
  assert.equal(out.stale.length, out.counts["parking-reason-stale"]);
  for (const t of out.stale) {
    assert.ok(t.judge, `a reported stale park must name its judge: ${JSON.stringify(t)}`);
    assert.equal(t.currentHits.length, 0, "clean today ⇒ no current hits");
  }
  // The archived needs-human-recheck.ts is NOT the mechanism here: it never re-ran a criterion.
  const archived = path.join(REPO_ROOT, "archive/2026-09-07-zero-call-scripts/plugin/scripts/needs-human-recheck.ts");
  assert.ok(fs.existsSync(archived), "the archived time/survival-axis detector stays archived (not resurrected)");
});
