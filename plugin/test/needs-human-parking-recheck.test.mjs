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
//   AC1 (h) EVERY producer of a parking record is read (tasks/gap-meta-readparkingrecord): the worker's
//           `## Blocker` / `未落地原因` record (built by the producer itself), a hand-written dated
//           `人工暂停` park, the LATEST record winning across producers, a fenced `## Blocker` being a
//           citation rather than a record, and the producer's 「原因读不出」sentinel staying unreadable.
//
// Run: node --no-warnings --experimental-strip-types --test plugin/test/needs-human-parking-recheck.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
// The `## Blocker` producer ITSELF (tasks/gap-meta-readparkingrecord): the fixture is built by the real
// writer and the record is located by the real reader, so a drift between the two fails HERE — a
// hand-copied paragraph in this file would keep passing while production silently stopped matching.
import { buildBlockerSection, blockerRecordInBody, UNREADABLE_BLOCKER_REASON } from "../scripts/worker-driver.ts";

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
 *  `## Needs-Human` record exactly as driver-filters.markNeedsHuman writes it (null = no record);
 *  `blockerSection` adds a `## Blocker` record (raw text — callers pass buildBlockerSection's output so
 *  the fixture is the PRODUCER's real shape); `tail` appends arbitrary body text after everything (the
 *  hand-written `人工暂停` park line goes here). */
function writeTask(
  root,
  id,
  { status = "needs-human", acItems = [], needsHumanReason = null, withAcSection = true, blockerSection = null, tail = "" } = {},
) {
  const ac = withAcSection ? `\n## Acceptance Criteria\n\n${acItems.join("\n")}\n` : "";
  const record =
    needsHumanReason === null
      ? ""
      : `\n## Needs-Human\n\n**执行 2026-10-22T10:21:50.889Z — 连续修满重试上限仍不合格（标 needs-human）**\n\n- 阻碍原因：${needsHumanReason}\n- 失败步/判词：step=suite: 1 failing\n`;
  const blocker = blockerSection === null ? "" : `\n${blockerSection}\n`;
  const body =
    `---\nid: ${id}\ntitle: "fixture ${id}"\nstatus: ${status}\nlabels:\n  - gap\nparent: null\nchildren: []\nextra: {}\n---\n` +
    `## Proposal\n\nFixture task for needs-human-parking-recheck (well over forty non-whitespace characters).\n` +
    ac +
    record +
    blocker +
    tail;
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// AC1(h) — EVERY PRODUCER OF A PARKING RECORD IS READ (tasks/gap-meta-readparkingrecord)
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// THE DEFECT THIS PINS: `readParkingRecord` knew only `## Needs-Human` + `阻碍原因`, while the worker
// path parks a task via `## Blocker` + `未落地原因` (worker-driver.projectBlockerToTaskRecord) and a human
// park is a hand-written dated `人工暂停` line. Measured 2026-11-06: 4 of 4 needs-human tasks read
// `not-evaluated` while every one of them carried a readable parking reason — the reason was then never
// re-judged, so a stale park could never be reported for those populations.
//
//   (a) the `## Blocker` record the WORKER writes is read — built by the producer itself, not by hand
//   (b) the hand-written `人工暂停` record is read — a human park is a READING, not a failure to read
//   (c) the LATEST record wins when one task was parked twice by DIFFERENT producers
//   (d) a `## Blocker` quoted inside a fenced block is a CITATION, not a record (位置判定)
//   (e) the producer's 「原因读不出」sentinel is NOT a reason ⇒ still `not-evaluated` (硬规则 3b)

const RECORDED_WORKER_BLOCKER =
  "step=suite: incomplete suite (897/994 files) oomKill=1 — recovery baseline-equivalence not evaluable at concurrency 16";
const MANUAL_PARK_LINE =
  "2026-11-06 人工暂停（宿主降载期间）：本机被套件并发打满，恢复条件：宿主 loadavg 稳定低于核数后改回 ready。";

test("AC1(h)(a) — the `## Blocker` record the WORKER writes is read (not not-evaluated)", () => {
  const root = makeRoot("blocker");
  try {
    writeTask(root, "gap-fixture-worker-parked", {
      acItems: ["- [ ] AC1 贴出证据"],
      blockerSection: buildBlockerSection(RECORDED_WORKER_BLOCKER, { ts: "2026-11-06T17:28:52.000Z", runId: "r-1" }),
    });
    const out = readReading(root);
    const t = out.tasks.find((x) => x.id === "gap-fixture-worker-parked");
    assert.notEqual(t.state, "not-evaluated", `the worker's own record must be READABLE: ${JSON.stringify(t)}`);
    assert.equal(t.recordedReason, RECORDED_WORKER_BLOCKER, "the recorded 未落地原因 is carried verbatim");
    // A suite-block reason names no registered mechanical judge — that is a READING, not a failure to read.
    assert.equal(t.state, "no-registered-judge", `a readable non-mechanical reason: ${JSON.stringify(t)}`);
    assert.equal(out.counts["not-evaluated"], 0, `the whole population must leave not-evaluated: ${JSON.stringify(out.counts)}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1(h)(b) — a hand-written `人工暂停` park is read (a human park is a reading, not unreadable)", () => {
  const root = makeRoot("manual");
  try {
    writeTask(root, "gap-fixture-human-paused", { acItems: ["- [ ] AC1 贴出证据"], tail: `\n${MANUAL_PARK_LINE}\n` });
    const t = readReading(root).tasks.find((x) => x.id === "gap-fixture-human-paused");
    assert.notEqual(t.state, "not-evaluated", `a dated 人工暂停 line IS the record: ${JSON.stringify(t)}`);
    assert.equal(t.state, "no-registered-judge", `a human decision has no mechanical judge: ${JSON.stringify(t)}`);
    assert.ok(t.recordedReason.includes("人工暂停"), `the pause line is carried verbatim: ${JSON.stringify(t)}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1(h)(c) — the LATEST record wins when a task is parked twice by DIFFERENT producers", () => {
  const root = makeRoot("latest");
  try {
    const id = "gap-fixture-reparked";
    // (1) mechanical judge token first, (2) a LATER human pause ⇒ the live reason is the HUMAN one.
    writeTask(root, id, {
      acItems: ["- [ ] AC1 人评审门：只能由人裁定（待外部）"],
      needsHumanReason: RECORDED_UNSAT_REASON,
      tail: `\n${MANUAL_PARK_LINE}\n`,
    });
    const t = readReading(root).tasks.find((x) => x.id === id);
    assert.equal(t.state, "no-registered-judge", `the LATER record (human pause) is the live one: ${JSON.stringify(t)}`);
    assert.ok(t.recordedReason.includes("人工暂停"), `recorded reason is the pause line: ${JSON.stringify(t)}`);
    // Negative control: the SAME mechanical record WITHOUT the later pause IS judged (else the arm
    // above could pass because the Needs-Human record was never read at all).
    writeTask(root, id, {
      acItems: ["- [ ] AC1 人评审门：只能由人裁定（待外部）"],
      needsHumanReason: RECORDED_UNSAT_REASON,
    });
    const t2 = readReading(root).tasks.find((x) => x.id === id);
    assert.equal(t2.state, "parking-reason-stale", `without the later pause the mechanical judge is re-run: ${JSON.stringify(t2)}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1(h)(d) — a `## Blocker` quoted inside a fenced block is a CITATION, not a record", () => {
  const root = makeRoot("fenced");
  try {
    const quoted = ["```markdown", "## Blocker", "", `- 未落地原因：${RECORDED_WORKER_BLOCKER}`, "```"].join("\n");
    writeTask(root, "gap-fixture-fenced", { acItems: ["- [ ] AC1 贴出证据"], tail: `\n${quoted}\n` });
    const t = readReading(root).tasks.find((x) => x.id === "gap-fixture-fenced");
    assert.equal(t.state, "not-evaluated", `a quoted record is not this task's parking record: ${JSON.stringify(t)}`);
    assert.equal(t.recordedReason, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC1(h)(e) — the producer's 「原因读不出」sentinel is not a reason: still not-evaluated", () => {
  const root = makeRoot("sentinel");
  try {
    // Written by the REAL producer with reason=null — exactly what an exited-not-landed round with an
    // unreadable failure produces. Reading the sentinel as a reason would be 「读不懂伪装成读懂了」.
    const section = buildBlockerSection(null, { ts: "2026-11-06T17:28:52.000Z" });
    assert.ok(section.includes(UNREADABLE_BLOCKER_REASON), "precondition: the producer wrote its sentinel");
    assert.equal(blockerRecordInBody(`## Proposal\n\n${section}\n`).reason, null, "the producer's own reader refuses the sentinel");
    writeTask(root, "gap-fixture-sentinel", { acItems: ["- [ ] AC1 贴出证据"], blockerSection: section });
    const t = readReading(root).tasks.find((x) => x.id === "gap-fixture-sentinel");
    assert.equal(t.state, "not-evaluated", `an unreadable reason stays unreadable: ${JSON.stringify(t)}`);
    assert.equal(t.recordedReason, null);
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

test("AC1 — the REAL store: the reading partitions every needs-human task (no board-count pinning)", (t) => {
  const res = runCli(REPO_ROOT);
  assert.equal(res.status, 0, `real-repo detector must exit 0:\n${res.stdout}${res.stderr}`);
  const out = JSON.parse(res.stdout);
  assert.equal(out.evaluated, true, "the real repo has a tasks/ dir");
  // ⛔ The real board's needs-human count is DATA, not a product invariant: the loop flips needs-human
  // tasks to done as their criteria are repaired, and it periodically reaches 0. When it does, the
  // partitioning arm below has nothing to partition — so this test must NOT read that state as a
  // product defect (it is not one) NOR as a pass (the arm would be vacuous). Skip, honestly named.
  if (out.needs_human_total === 0) {
    t.skip("the real board currently carries no needs-human tasks — the partitioning reading is not evaluable");
    return;
  }
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

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ARM 2 — body-PARKED tasks (tasks/gap-meta-needs-human-parking-recheck-2)
//
// THE DEFECT THIS PINS: `ready-pool-check.isParked` is only the EXCLUSION half. A task stamping a
// line-start `**PARKED` drops out of the dispatch pool, and the un-park instruction printed in its own
// body is re-run by NOTHING. Measured 2026-11-06: gap-goal-driver-filing-ledger's declared check had
// been printing `landed` for hours while the five remaining GOAL-914 tasks sat behind its depends_on
// edge, every round reading stalled/world-gated with nobody told the block had cleared.
//
// Coverage map:
//   AC2(a) the DECLARED command is really RE-RUN — the falsifiable pair is two tasks carrying the
//          byte-identical marker, one declaring `true` (reported) and one declaring `false` (not).
//          A detector that echoed the declaration could not separate them.
//   AC2(b) the declared EXPECTED TOKEN is part of the pass predicate: `echo offline` under
//          `输出 online` is NOT a pass, though it exits 0. Without this arm, `gh api …` printing
//          `offline` would report a stale park — a false un-park signal.
//   AC2(c) prose-only / absent declarations are `no-unpark-check` (a condition only a human can
//          judge), which is a DIFFERENT value from `not-evaluated`.
//   AC2(d) an un-readable declaration is `not-evaluated`, never `no-unpark-check` and never a pass.
//   AC2(e) the deadline is real: a hanging command is killed and reads `not-evaluated (timeout)`.
//   AC2(f) the capability judge runs BEFORE execution: a declared write-capable command is refused
//          and its side effect does not happen.
//   AC2(g) a root without tasks/ is `parked.evaluated:false`, not an empty all-clear.
//   AC2(h) promotion-driver is the LIVE per-round consumer of this arm too.
//   AC2(i) nothing writes `status` and nothing deletes the marker.
//   AC2(j) the REAL store partitions the parked population and reports only re-run-green checks.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/** Write a fixture task carrying a LINE-START `**PARKED` marker plus an optional declaration block. */
function writeParkedTask(root, id, { status = "ready", declaration = null } = {}) {
  const decl = declaration === null ? "" : `\n## Unpark\n\n${declaration}\n`;
  const body =
    `---\nid: ${id}\ntitle: "fixture ${id}"\nstatus: ${status}\nlabels:\n  - gap\nparent: null\nchildren: []\nextra: {}\n---\n` +
    `**PARKED**（fixture, 2026-11-06 — execution suspended pending the check below）\n\n` +
    `## Proposal\n\nFixture task for the body-PARKED arm of needs-human-parking-recheck (well over forty non-whitespace characters).\n` +
    decl;
  const file = path.join(root, "tasks", `${id}.md`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
  return file;
}

/** Run the detector and return the whole reading (both arms). `extraArgs` = CLI flags (e.g. a timeout). */
function readBoard(root, ...extraArgs) {
  const res = spawnSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", root, "--json", ...extraArgs],
    { encoding: "utf8" },
  );
  assert.equal(res.status, 0, `detector must exit 0, got ${res.status}:\n${res.stdout}${res.stderr}`);
  return JSON.parse(res.stdout);
}

test("AC2(a) — the DECLARED unpark command is really RE-RUN (identical marker, opposite commands)", () => {
  const root = makeRoot("unpark-run");
  try {
    writeParkedTask(root, "gap-fixture-unpark-ok", {
      declaration: "- **unpark 检查（只读、可直接跑）**：`true`",
    });
    writeParkedTask(root, "gap-fixture-unpark-no", {
      declaration: "- **unpark 检查（只读、可直接跑）**：`false`",
    });
    const out = readBoard(root).parked;

    const ok = out.tasks.find((t) => t.id === "gap-fixture-unpark-ok");
    const no = out.tasks.find((t) => t.id === "gap-fixture-unpark-no");
    assert.equal(ok.command, "true", "the declared command is extracted verbatim from the inline code span");
    assert.equal(ok.state, "unpark-passed", `a check that passes today MUST be reported: ${JSON.stringify(ok)}`);
    assert.equal(ok.exitCode, 0, "the REAL exit code is carried");
    assert.equal(no.command, "false");
    assert.equal(no.state, "unpark-still-blocked", `a check that still fails must NOT be reported: ${JSON.stringify(no)}`);
    assert.notEqual(no.exitCode, 0);
    assert.deepEqual(out.entries.map((t) => t.id), ["gap-fixture-unpark-ok"], "only the passing one is reported");
    assert.equal(out.reported_passed, 1);
    assert.equal(out.counts["unpark-still-blocked"], 1);
    assert.equal(out.parked_total, 2);
    // The four states partition the parked population.
    assert.equal(
      Object.values(out.counts).reduce((a, b) => a + b, 0),
      out.parked_total,
      `counts must partition the PARKED store: ${JSON.stringify(out.counts)} vs ${out.parked_total}`,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2(b) — the declared EXPECTED TOKEN is part of the pass predicate (exit 0 alone is not enough)", () => {
  const root = makeRoot("unpark-token");
  try {
    // Both declarations are shaped exactly like gap-ci-self-hosted-runner-shares-fleet-host's live one:
    // the command exits 0 in BOTH cases; only the printed token differs.
    writeParkedTask(root, "gap-fixture-token-hit", {
      declaration: "- **unpark 检查（只读、可直接跑）**：`echo online` —— 输出 `online` 即解除 park。",
    });
    writeParkedTask(root, "gap-fixture-token-miss", {
      declaration: "- **unpark 检查（只读、可直接跑）**：`echo offline` —— 输出 `online` 即解除 park。",
    });
    const out = readBoard(root).parked;
    const hit = out.tasks.find((t) => t.id === "gap-fixture-token-hit");
    const miss = out.tasks.find((t) => t.id === "gap-fixture-token-miss");
    assert.equal(hit.expectedOutput, "online", "the declared expected token is parsed out of the prose");
    assert.equal(hit.state, "unpark-passed", `output carries the token ⇒ reported: ${JSON.stringify(hit)}`);
    assert.equal(miss.expectedOutput, "online");
    assert.equal(miss.exitCode, 0, "precondition: the command DID exit 0 — the miss must come from the token");
    assert.equal(
      miss.state,
      "unpark-still-blocked",
      `exit 0 WITHOUT the declared token must NOT be reported as unparked: ${JSON.stringify(miss)}`,
    );
    assert.deepEqual(out.entries.map((t) => t.id), ["gap-fixture-token-hit"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2(c) — no declaration / a prose-only declaration are no-unpark-check (distinct from not-evaluated)", () => {
  const root = makeRoot("unpark-prose");
  try {
    writeParkedTask(root, "gap-fixture-no-decl");
    // The live shape of gap-official-dist-delivery-…: a runnable-looking LABEL, but a condition only a
    // human can judge ("a recorded authorization naming (i)…(ii)…(iii)…").
    writeParkedTask(root, "gap-fixture-prose-decl", {
      declaration: "Unpark condition: a recorded authorization naming (i) which host, and (ii) which artifact.",
    });
    const out = readBoard(root).parked;
    for (const id of ["gap-fixture-no-decl", "gap-fixture-prose-decl"]) {
      const t = out.tasks.find((x) => x.id === id);
      assert.equal(t.state, "no-unpark-check", `${id} declares no runnable command: ${JSON.stringify(t)}`);
      assert.equal(t.command, null);
    }
    assert.deepEqual(out.entries, [], "a prose condition is never reported as a satisfied check");
    assert.equal(out.counts["no-unpark-check"], 2);
    assert.equal(out.counts["not-evaluated"], 0, "「no runnable command」 must not be counted as 「could not read」");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2(d) — an unreadable declaration is not-evaluated, never a pass (hard rule 3b)", () => {
  const root = makeRoot("unpark-unreadable");
  try {
    // A declaration label that carries a code span which is plainly NOT a command (a CJK prose
    // quotation). Reading it as `no-unpark-check` would silently drop the task; reading it as a pass
    // would be the 3b inversion. It must be its own value.
    writeParkedTask(root, "gap-fixture-bad-span", {
      declaration: "- **unpark 检查（只读、可直接跑）**：`须由人工评审结论` —— 输出 `通过`。",
    });
    const out = readBoard(root).parked;
    const t = out.tasks.find((x) => x.id === "gap-fixture-bad-span");
    assert.equal(t.state, "not-evaluated", `unreadable declaration ⇒ not-evaluated: ${JSON.stringify(t)}`);
    assert.ok(t.note.includes("not command-shaped"), `the note says WHY it could not be read: ${t.note}`);
    assert.deepEqual(out.entries, [], "未评估 must never be reported as a satisfied check");
    assert.equal(out.counts["not-evaluated"], 1);
    assert.equal(out.counts["no-unpark-check"], 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2(e) — the deadline is real: a hanging unpark command is killed and reads not-evaluated", () => {
  const root = makeRoot("unpark-timeout");
  try {
    writeParkedTask(root, "gap-fixture-hangs", {
      declaration: "- **unpark 检查（只读、可直接跑）**：`sleep 3`",
    });
    const started = Date.now();
    const out = readBoard(root, "--unpark-timeout-ms", "400").parked;
    const elapsed = Date.now() - started;
    const t = out.tasks.find((x) => x.id === "gap-fixture-hangs");
    assert.equal(t.state, "not-evaluated", `a killed command has NO verdict — ⛔ not 「still blocked」: ${JSON.stringify(t)}`);
    assert.ok(t.note.includes("400ms deadline"), `the note names the deadline that fired: ${t.note}`);
    assert.ok(elapsed < 3000, `the command must be killed at the deadline, not left to finish (took ${elapsed}ms)`);
    assert.deepEqual(out.entries, [], "a timeout is never reported as a satisfied check");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2(f) — the capability judge runs BEFORE execution: a write-capable command is refused, not run", () => {
  const root = makeRoot("unpark-capability");
  try {
    // The workspace declares `touch ` write-capable (the SAME declaration file the goal paths read).
    fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".quay", "criterion-capabilities.json"),
      JSON.stringify({ writeCapableCommands: [{ id: "fixture-touch", pattern: "^touch\\s" }] }),
    );
    const canary = path.join(root, "created-by-unpark");
    writeParkedTask(root, "gap-fixture-writes", {
      declaration: `- **unpark 检查（只读、可直接跑）**：\`touch ${canary}\``,
    });
    const out = readBoard(root).parked;
    const t = out.tasks.find((x) => x.id === "gap-fixture-writes");
    assert.equal(t.state, "not-evaluated", `a refused command has no verdict: ${JSON.stringify(t)}`);
    assert.ok(t.note.includes("criterion-side-effect"), `the capability judge's stable code is carried: ${t.note}`);
    assert.equal(fs.existsSync(canary), false, "⛔ the refused command must NOT have run — its side effect is absent");
    assert.deepEqual(out.entries, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2(g) — a root without tasks/ is parked.evaluated:false, not an empty all-clear", () => {
  const root = makeRoot("unpark-notasks");
  try {
    const out = readBoard(root).parked;
    assert.equal(out.evaluated, false, "no tasks dir ⇒ the PARKED population was not read");
    assert.equal(out.reason, "no-tasks-dir");
    assert.deepEqual(out.entries, []);
    assert.equal(out.parked_total, 0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2(i) — nothing writes status and the PARKED marker survives the scan", () => {
  const root = makeRoot("unpark-readonly");
  try {
    const file = writeParkedTask(root, "gap-fixture-unpark-ok", {
      declaration: "- **unpark 检查（只读、可直接跑）**：`true`",
    });
    const before = fs.readFileSync(file, "utf8");
    const out = readBoard(root).parked;
    assert.equal(out.reported_passed, 1, "precondition: this fixture IS a satisfied park (else the test proves nothing)");
    assert.equal(fs.readFileSync(file, "utf8"), before, "a report must NOT rewrite the task file");
    assert.ok(/^\*\*PARKED\b/m.test(before), "the marker is still there — deleting it stays the human/manager's act");
    assert.ok(/^status:\s*ready\b/m.test(before), "status unchanged");
    // ⛔ The detector alone persists nothing; only the driver writes the reading file.
    assert.equal(fs.existsSync(path.join(root, READING_REL)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2(h) — promotion-driver is the LIVE consumer of the PARKED arm: every round carries it and persists it", () => {
  const root = makeRoot("unpark-driver");
  try {
    writeParkedTask(root, "gap-fixture-unpark-ok", {
      declaration: "- **unpark 检查（只读、可直接跑）**：`true`",
    });
    writeParkedTask(root, "gap-fixture-unpark-no", {
      declaration: "- **unpark 检查（只读、可直接跑）**：`false`",
    });
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

    const rounds = res.stdout.trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.event === "round");
    assert.equal(rounds.length, 2, `two rounds must be driven:\n${res.stdout}`);
    for (const r of rounds) {
      assert.ok(r.parked_unpark, `round ${r.round} carries parked_unpark: ${JSON.stringify(r).slice(0, 400)}`);
      assert.deepEqual(r.parked_unpark.entries.map((t) => t.id), ["gap-fixture-unpark-ok"], `round ${r.round} reports the satisfied park`);
      assert.equal(r.parked_unpark.counts["unpark-still-blocked"], 1, "the still-failing one is counted, not reported");
    }

    // Durable carrier (the ONE file, both arms) — an external reader needs no stdout.
    const persisted = JSON.parse(fs.readFileSync(path.join(root, READING_REL), "utf8"));
    assert.ok(persisted.parked, "the reading file carries the PARKED arm");
    assert.equal(persisted.parked.reported_passed, 1);
    assert.deepEqual(persisted.parked.entries.map((t) => t.id), ["gap-fixture-unpark-ok"]);

    // And the human-visible channel: the driver log says WHICH task.
    assert.ok(
      res.stderr.includes("gap-fixture-unpark-ok") && res.stderr.includes("body-PARKED task(s) whose DECLARED unpark check"),
      `stderr names the satisfied park:\n${res.stderr}`,
    );
    // Still read-only end-to-end: neither task's marker nor status moved.
    for (const f of ["gap-fixture-unpark-ok.md", "gap-fixture-unpark-no.md"]) {
      const text = fs.readFileSync(path.join(root, "tasks", f), "utf8");
      assert.ok(/^\*\*PARKED\b/m.test(text), `${f}: marker untouched by the driver`);
      assert.ok(/^status:\s*ready\b/m.test(text), `${f}: status untouched by the driver`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("AC2(j) — the REAL store: the PARKED arm partitions the population and reports only re-run-green checks", (t) => {
  const out = readBoard(REPO_ROOT).parked;
  assert.equal(out.evaluated, true, "the real repo has a tasks/ dir");
  assert.equal(
    Object.values(out.counts).reduce((a, b) => a + b, 0),
    out.parked_total,
    `the four states partition the PARKED store: ${JSON.stringify(out.counts)} vs ${out.parked_total}`,
  );
  assert.equal(out.entries.length, out.counts["unpark-passed"]);
  for (const e of out.entries) {
    assert.ok(e.command, `a reported PARKED task must carry the command that passed: ${JSON.stringify(e)}`);
    assert.equal(e.exitCode, 0, `a reported park's command exited 0: ${JSON.stringify(e)}`);
    if (e.expectedOutput) {
      assert.ok(e.output.includes(e.expectedOutput), `the declared token really appears in the output: ${JSON.stringify(e)}`);
    }
  }
  // ⛔ Not vacuous: if the real board carries NO runnable declaration at all, this arm has no live
  // subject and its `entries: []` would be indistinguishable from a broken detector. Say so honestly
  // instead of passing silently (hard rule 3b).
  if (out.counts["unpark-passed"] + out.counts["unpark-still-blocked"] === 0) {
    t.skip("no body-PARKED task on the real board declares a runnable unpark check — the arm is not exercisable here");
    return;
  }
  assert.ok(out.parked_total > 0, "the real board carries body-PARKED tasks");
});
