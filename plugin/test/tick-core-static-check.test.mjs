// @test-group governance
// tick-core-static-check.test.mjs — tasks/gap-tick-core-zero-static-coverage
// (AC2-AC8 — the execution-core static coverage checker's mechanical realization of the
// four gates the 2026-08-10 incidents were all hand-found against: AC30(a) ≤80 lines,
// pointer targets exist, criterion numbering ≠ B3 group, prohibition-doc consistency).
//
// Coverage map (task ACs):
//   AC3 — a core over 80 lines reddens the checker; the three real cores pass (80/80/80).
//   AC4 — a core referencing a nonexistent pointer target reddens; the real cores' pointer
//         targets all resolve (exact / basename / stale-annotated / gitignored-runtime skipped).
//   AC5 — a manager B3 group that renumbers to ①-⑤ (losing 甲乙丙丁戊) reddens; the real
//         manager core's B3 carries all five markers.
//   AC6 — an UNCONDITIONAL prohibition ("外层不直接改代码" without 收窄/单一写入者/共享树) reddens
//         when a core uses run_in_background; a NARROWED prohibition passes. The real four
//         prohibition docs all carry the narrowing.
//   AC7 — the checker is wired into scripts/test.sh run_static_checks with @static-tier always
//         (asserted by reading the wiring comment in this file's sibling registration).
//   AC8 — the scoped gate (`--for-task`) selects this checker because the task's `## Touches`
//         intersect its @static-object (exercised by the scoped run, not this file).
//
// Every fixture is a temp root built from minimal baseline files; nothing is hardcoded to a
// global count — each assertion is relative to the fixture or the live repo's actual state.
//
// Run:
//   scripts/test.sh plugin/test/tick-core-static-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const CHECKER = path.join(REPO_ROOT, "plugin/scripts/tick-core-static-check.ts");

/** Run the checker against a root; returns the spawnSync result. */
function run(root, ...args) {
  return spawnSync(
    "node",
    ["--no-warnings", "--experimental-strip-types", CHECKER, "--root", root, ...args],
    { encoding: "utf8" },
  );
}

/** Run the drift mode against a root. */
function runDrift(root, ...args) {
  return run(root, "--check-drift", ...args);
}

/** The pointerized manager shipped copies (gap-plugin-loop-manager-drifted-copies-pointerize AC3). */
const MGR_CORE_POINTER = "> 正本: orchestration/manager-tick-core.md — 本文件只应存在这一行指针；执行核内容一律读正本。\n";
const MGR_LOOP_POINTER = "> 正本: orchestration/manager-loop-tick.md — 本文件只应存在这一行指针；内容一律读正本。\n";

/** Write a file (creating parent dirs) inside `root`. */
function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

const MGR_CORE = `# manager tick — 执行核
## A. 读数
| A1 | 读 \`.quay/manager-inbox/\` | 目录非空即进决策 (src:1) |
## B. 产出
- **B3 tick-log 追加一行**:本组一律写 \`甲乙丙丁戊\`,禁用 ①-⑤。\`no-action\` 需举证——甲\`a\`;乙\`b\`;丙\`c\`;丁\`d\`;戊\`e\` (src:1)。
## C. 约束
| C1 | 约束一 (src:1) |
## D. 边界
**可以**:写 \`orchestration/\`。
`;

const ORCH_CORE = `# outer tick — 执行核
## A. 读数
| A1 | 读 \`.quay/full-suite-state.json\` | green⇒suiteGreen (src:1) |
## B. 产出
- **B1** 收尾 pass (src:1)。
## C. 约束
| C1 | 约束一 (src:1) |
## D. 边界
**可以**:写 \`orchestration/\`。
`;

const FAST_CORE = `# inner (fast-mode) tick — 执行核
## A. 每轮必跑
| A1 | \`.halt\` 哨兵 | 存在 ⇒ 空转 (src:1) |
## B. 每轮必产出
- **B1** 写回队列文件 (src:1)。
## C. 硬约束
| C1 | 派发形态必须 \`Agent(run_in_background: true)\` (src:1) |
## D. 边界
一律停下等人。
`;

/** The fast-mode pair is checked in `semantic` mode (gap-tick-core-drift-fast-mode-mode-conflict): the
 *  shipped template carries the SAME A/B/C clauses as the 正本 but legitimately different framing +
 *  a consumer-laid source reference (docs/analysis/ — plugin/loop/ is never laid into a consumer,
 *  SKILL.md:68-71). A byte-copy of the 正本 over the 副本 would reference plugin/loop/ and redden. */
const FAST_CORE_SHIPPED = `# inner (fast-mode) tick — 执行核（落地副本）
**切分声明**:本副本为 quay-init --loop 铺出模板、引用目标 \`docs/analysis/fast-mode-loop-tick.md\` 源，非 byte-identical。
## A. 每轮必跑
| A1 | \`.halt\` 哨兵 | 存在 ⇒ 空转 (src:1) |
## B. 每轮必产出
- **B1** 写回队列文件 (src:1)。
## C. 硬约束
| C1 | 派发形态必须 \`Agent(run_in_background: true)\` (src:1) |
## D. 边界
一律停下等人。
`;

const PROHIBITION_DOCS = {
  "orchestration/outer-brief-2026-08-04-third-restart.md":
    "# outer 简报\n## 边界\n你是**外层**——不要自己用 `Agent` 派发实现工作到共享树。**收窄（2026-08-10，理由=单一写入者/共享树）**：外层可在自己的 worktree 里执行基础设施动作。\n",
  "orchestration/QUAY-OUTER-HANDOFF.md":
    "# 交接\n## 不可协商的规则\n1. **外层不直接改【共享检出】的代码**——你下指令，内层执行。（**收窄 2026-08-10，理由=单一写入者/共享树**）\n",
  "orchestration/exp6-phase1-sustained-unattended-operation.md":
    "# exp6 阶段 1\n| 3 | **外层不直接改【共享检出】的代码**。**收窄（2026-08-10，理由=单一写入者/共享树）** | 单一写入者 |\n",
  "orchestration/orchestrator-loop-tick.md":
    "# 外层编排 loop tick 指令\n**外层不直接改代码**——它下指令，内层执行。理由：保持单一写入者。\n",
};

/** Build a temp root with the baseline 3 cores + 4 prohibition docs (all four criteria pass). */
function buildBaselineRoot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tick-core-check-"));
  write(dir, "orchestration/manager-tick-core.md", MGR_CORE);
  write(dir, "orchestration/orchestrator-tick-core.md", ORCH_CORE);
  write(dir, "orchestration/fast-mode-tick-core.md", FAST_CORE);
  for (const [rel, content] of Object.entries(PROHIBITION_DOCS)) write(dir, rel, content);
  return dir;
}

/** Build a drift-GREEN root: byte-identical orchestrator/fast-mode copies + pointerized manager
 *  shipped docs (the state after gap-plugin-loop-manager-drifted-copies-pointerize). */
function buildDriftRoot() {
  const dir = buildBaselineRoot();
  write(dir, "orchestration/manager-loop-tick.md", "# manager loop tick 正本\n| A1 | 读 `.quay/manager-inbox/` | (src:1) |\n");
  write(dir, "plugin/loop/manager-tick-core.md", MGR_CORE_POINTER);
  write(dir, "plugin/loop/orchestrator-tick-core.md", ORCH_CORE);
  write(dir, "plugin/loop/fast-mode-tick-core.md", FAST_CORE_SHIPPED);
  write(dir, "plugin/loop/manager-loop-tick.md", MGR_LOOP_POINTER);
  return dir;
}

test("the baseline fixture root passes all four criteria (green baseline)", () => {
  const dir = buildBaselineRoot();
  try {
    const res = run(dir, "--json");
    assert.equal(res.status, 0, `baseline reddened the checker: ${res.stdout} ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.coverage["orchestration/manager-tick-core.md"].covered, out.coverage["orchestration/manager-tick-core.md"].total);
    assert.equal(out.ac4.ok, true);
    assert.equal(out.ac5.ok, true);
    assert.equal(out.ac6.ok, true);
    assert.equal(out.ac6.precondition, true); // fast-mode core carries run_in_background
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3: an A/B/C item without a (src:N) back-reference reddens", () => {
  const dir = buildBaselineRoot();
  try {
    write(dir, "orchestration/orchestrator-tick-core.md", "# outer tick — 执行核\n## A. 读数\n| A1 | 读 state.json | green⇒green |\n## B. 产出\n- **B1** 收尾 pass (src:1)。\n## C. 约束\n| C1 | 约束一 (src:1) |\n## D. 边界\n**可以**。\n");
    const res = run(dir, "--only", "ac3", "--json");
    assert.equal(res.status, 1, `an item without (src:N) did not redden AC3: ${res.stdout} ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.ac3.ok, false);
    assert.equal(out.ac3.uncovered.length, 1);
    assert.equal(out.ac3.uncovered[0].file, "orchestration/orchestrator-tick-core.md");
    assert.equal(out.ac3.uncovered[0].covered, 2); // B1 + C1 have src:N
    assert.equal(out.ac3.uncovered[0].total, 3); // A1 lacks src:N
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3b: an anchor present ANYWHERE in the archive is green despite line drift (gap-src-n-anchor-coupling AC1/AC4)", () => {
  const dir = buildBaselineRoot();
  try {
    // The manager reason archive: the anchor lives at line 20, but the core claims src:10 — a
    // +10 drift (> the retired ANCHOR_K=5 window). The anchor is STILL in the document ⇒ GREEN
    // (the judge is content, the line number is only a hint). This is the round 137/138 +7-shift
    // shape: every manager-core anchor-miss was exactly N+7 and aborted the whole suite pre-test.
    const arch = [];
    for (let i = 1; i < 20; i++) arch.push(`filler ${i}`);
    arch.push("锚句 target 出现在第 20 行"); // line 20 — the real location
    write(dir, "orchestration/manager-loop-tick.md", arch.join("\n"));
    write(dir, "orchestration/manager-tick-core.md",
      "# manager tick — 执行核\n## A. 读数\n| A1 | 锚定 (src:10 \"锚句 target 出现在第 20 行\") |\n## B. 产出\n- **B1** 收尾 pass (src:1)。\n## C. 约束\n| C1 | 约束一 (src:1) |\n## D. 边界\n**可以**。\n");
    const res = run(dir, "--only", "ac3", "--json");
    assert.equal(res.status, 0, `a drifted-but-present anchor reddened AC3: ${res.stdout} ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.ac3.ok, true);
    assert.equal(out.ac3.anchorViolations.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC3b: a genuinely missing anchor still reddens (anti-false-green, gap-src-n-anchor-coupling AC2)", () => {
  const dir = buildBaselineRoot();
  try {
    // Archive contains no anchor at all ⇒ the (src:N "锚句") pointer reddens (content-anywhere fails).
    const arch = [];
    for (let i = 1; i <= 20; i++) arch.push(`filler ${i}`);
    write(dir, "orchestration/manager-loop-tick.md", arch.join("\n"));
    write(dir, "orchestration/manager-tick-core.md",
      "# manager tick — 执行核\n## A. 读数\n| A1 | 锚定 (src:10 \"锚句 target 出现在第 20 行\") |\n## B. 产出\n- **B1** 收尾 pass (src:1)。\n## C. 约束\n| C1 | 约束一 (src:1) |\n## D. 边界\n**可以**。\n");
    const res = run(dir, "--only", "ac3", "--json");
    assert.equal(res.status, 1, `a missing anchor did not redden AC3: ${res.stdout} ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.ac3.ok, false);
    assert.equal(out.ac3.anchorViolations.length, 1);
    assert.equal(out.ac3.anchorViolations[0].kind, "anchor-miss");
    assert.equal(out.ac3.anchorViolations[0].anchor, "锚句 target 出现在第 20 行");
    assert.deepEqual(out.ac3.anchorViolations[0].actualLines, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC4: a core referencing a nonexistent pointer target reddens", () => {
  const dir = buildBaselineRoot();
  try {
    write(dir, "orchestration/orchestrator-tick-core.md", "引用 `orchestration/nonexistent-archive.md`。\n");
    const res = run(dir, "--only", "ac4", "--json");
    assert.equal(res.status, 1, `a nonexistent pointer target did not redden AC4: ${res.stdout} ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.ac4.ok, false);
    assert.equal(out.ac4.missing.length, 1);
    assert.equal(out.ac4.missing[0].path, "orchestration/nonexistent-archive.md");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC4 negative control: a pointer target that exists passes", () => {
  const dir = buildBaselineRoot();
  try {
    // orchestrator core references a file that IS in the fixture → must not redden.
    write(dir, "orchestration/orchestrator-tick-core.md", "引用 `orchestration/manager-tick-core.md`。\n");
    const res = run(dir, "--only", "ac4", "--json");
    assert.equal(res.status, 0, `an existing pointer target reddened AC4: ${res.stdout} ${res.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC5: a manager B3 group renumbered to ①-⑤ (no 甲乙丙丁戊) reddens", () => {
  const dir = buildBaselineRoot();
  try {
    write(dir, "orchestration/manager-tick-core.md",
      "# manager tick — 执行核\n## B. 产出\n- **B3 tick-log**:`no-action` 需举证——①`a`;②`b`;③`c`;④`d`;⑤`e`。\n");
    const res = run(dir, "--only", "ac5", "--json");
    assert.equal(res.status, 1, `a B3 group without 甲乙丙丁戊 did not redden AC5: ${res.stdout} ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.ac5.ok, false);
    assert.deepEqual(out.ac5.missingMarkers.sort(), ["丙", "乙", "戊", "丁", "甲"].sort());
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC5: a manager core with NO B3 section reddens (fail-closed)", () => {
  const dir = buildBaselineRoot();
  try {
    write(dir, "orchestration/manager-tick-core.md", "# manager tick — 执行核\n## B. 产出\n- **B1** 无 B3。\n");
    const res = run(dir, "--only", "ac5", "--json");
    assert.equal(res.status, 1, `a missing B3 section did not redden AC5: ${res.stdout} ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.ac5.b3Found, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC6: an unconditional prohibition reddens when a core uses run_in_background", () => {
  const dir = buildBaselineRoot();
  try {
    write(dir, "orchestration/QUAY-OUTER-HANDOFF.md",
      "# 交接\n1. **外层不直接改代码**——下指令，内层执行。\n");
    const res = run(dir, "--only", "ac6", "--json");
    assert.equal(res.status, 1, `an unconditional prohibition did not redden AC6: ${res.stdout} ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.ac6.ok, false);
    assert.equal(out.ac6.violations.length, 1);
    assert.equal(out.ac6.violations[0].phrase, "外层不直接改");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC6 negative control: a NARROWED prohibition passes", () => {
  const dir = buildBaselineRoot();
  try {
    // The baseline QUAY-OUTER-HANDOFF carries the 收窄/单一写入者/共享树 narrowing → pass.
    const res = run(dir, "--only", "ac6", "--json");
    assert.equal(res.status, 0, `a narrowed prohibition reddened AC6: ${res.stdout} ${res.stderr}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC6 sibling: the '不要自己用' prohibition phrase is checked too", () => {
  const dir = buildBaselineRoot();
  try {
    write(dir, "orchestration/outer-brief-2026-08-04-third-restart.md",
      "# outer 简报\n不要自己用 `Agent` 派发实现工作。\n");
    const res = run(dir, "--only", "ac6", "--json");
    assert.equal(res.status, 1, `an unconditional 不要自己用 prohibition did not redden AC6: ${res.stdout} ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.ac6.violations[0].phrase, "不要自己用");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the scan surface is a ## Contract invariant — a missing scan target fails loudly, not silently green", () => {
  const dir = buildBaselineRoot();
  try {
    fs.rmSync(path.join(dir, "orchestration/orchestrator-tick-core.md"));
    const res = run(dir, "--json");
    assert.equal(res.status, 1, `a missing scan target did not fail the checker: ${res.stdout} ${res.stderr}`);
    assert.match(res.stderr, /scan target missing/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the real repo passes all four criteria (src:N 100% + pointers + numbering + prohibition)", () => {
  const res = run(REPO_ROOT, "--json");
  assert.equal(res.status, 0, `the real repo reddened the checker: ${res.stdout} ${res.stderr}`);
  const out = JSON.parse(res.stdout);
  for (const rel of ["orchestration/manager-tick-core.md", "orchestration/orchestrator-tick-core.md", "orchestration/fast-mode-tick-core.md"]) {
    assert.equal(out.coverage[rel].covered, out.coverage[rel].total, `${rel} not at 100% src:N coverage: ${JSON.stringify(out.coverage[rel])}`);
  }
  assert.equal(out.ac4.ok, true);
  assert.equal(out.ac5.ok, true);
  assert.equal(out.ac6.ok, true);
});

test("AC8: a dead-annotated item WITHOUT the denominator-exclusion marker reddens (negative control, gap-ac60 AC3)", () => {
  const dir = buildBaselineRoot();
  try {
    // Negative control sample: | A7 | **前提已死** | 不能执行 (src:1) | — a dead/frozen item that
    // stays in the coverage denominator (no "不计入覆盖率分母" marker) MUST redden AC8. This is the
    // exact perverse incentive AC60 kills: honest annotation would otherwise drop coverage.
    write(dir, "orchestration/manager-tick-core.md",
      "# manager tick — 执行核\n## A. 读数\n| A1 | 读 x (src:1) |\n| A7 | **前提已死** | 不能执行 (src:1) |\n## B. 产出\n- **B1** z (src:1)\n## C. 约束\n| C1 | 约束 (src:1) |\n## D. 边界\n**可以**。\n");
    const res = run(dir, "--only", "ac8", "--json");
    assert.equal(res.status, 1, `a dead-annotated item without the exclusion marker did not redden AC8: ${res.stdout} ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.ac8.ok, false);
    assert.equal(out.ac8.violations.length, 1);
    assert.equal(out.ac8.violations[0].file, "orchestration/manager-tick-core.md");
    assert.equal(out.ac8.violations[0].line, 4);
    assert.equal(out.ac8.violations[0].marker, "前提已死");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC8 negative control: a dead-annotated item WITH the exclusion marker passes", () => {
  const dir = buildBaselineRoot();
  try {
    write(dir, "orchestration/manager-tick-core.md",
      "# manager tick — 执行核\n## A. 读数\n| A1 | 读 x (src:1) |\n| A7 | **前提已死,不计入覆盖率分母** | 不能执行 (src:1) |\n## B. 产出\n- **B1** z (src:1)\n## C. 约束\n| C1 | 约束 (src:1) |\n## D. 边界\n**可以**。\n");
    const res = run(dir, "--only", "ac8", "--json");
    assert.equal(res.status, 0, `a dead-annotated item with the exclusion marker reddened AC8: ${res.stdout} ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.ac8.ok, true);
    assert.equal(out.ac8.violations.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC8: the real repo passes, three-layer exclusion notation (manager remaining in-core dead items carry the marker; migrated A7/A12a/B2c/乙/丁 AND inner C7 are archived pointers, not in-core dead lines; outer B4)", () => {
  const res = run(REPO_ROOT, "--only", "ac8", "--json");
  assert.equal(res.status, 0, `the real repo reddened AC8: ${res.stdout} ${res.stderr}`);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ac8.ok, true);
  assert.equal(out.ac8.violations.length, 0);
  // AC2 — manager 的【剩余】在核死条目仍带排除记号 (A4/A14). The historical `>= 6` deduct count
  // (A7/A12a/A14/B2c/乙/丁) is retired: A7/A12a/B2c/乙/丁 were migrated out of the core to the
  // phase-goal archive (2026-08-15 人裁定清死条目), so they are no longer in the denominator or
  // the exclusion count. The surviving invariant is "every remaining in-core dead item still
  // carries the exclusion marker", asserted as `>= 1`.
  assert.ok(out.ac8.excluded["orchestration/manager-tick-core.md"] >= 1,
    `manager has no remaining in-core dead item with the exclusion marker: ${JSON.stringify(out.ac8.excluded)}`);
  // AC1 — 三层记法一致 (AC76 2026-08-15 人裁定「tick core 不留已退役文本」): outer (A2/A11/B3/B4/
  // B5/C3/红窗分诊) AND inner (C7) were ALL migrated out of their cores to archive pointers
  // (AC58-retired-clauses.md R32/R33/R34), so BOTH outer and inner cores now carry ZERO in-core
  // dead-annotated lines (excluded == 0, dead == 0 — verified empirically against the real repo on
  // 2026-08-16; a prior inner-side assertion of outer excluded >= 1 and a prior outer-side assertion
  // of fast-mode excluded >= 1 both postdate the migrations and redden). The surviving invariants:
  // (a) manager still carries in-core dead items with the exclusion marker (asserted above as `>= 1`);
  // (b) the 迁出检查 loops below — a regression that re-introduces any migrated entry as an in-core
  // dead line (or loses the pointer/archive section) reddens.
  assert.equal(out.ac8.excluded["orchestration/orchestrator-tick-core.md"], 0,
    `outer core re-gained an in-core dead-exclusion marker (expected 0 after AC76 migration): ${JSON.stringify(out.ac8.excluded)}`);
  assert.equal(out.ac8.excluded["orchestration/fast-mode-tick-core.md"], 0,
    `inner core re-gained an in-core dead-exclusion marker (expected 0 after AC76 C7 migration): ${JSON.stringify(out.ac8.excluded)}`);
  assert.equal(out.ac8.dead["orchestration/orchestrator-tick-core.md"], 0,
    `outer core has an in-core dead-annotated line (expected none after AC76 migration): ${JSON.stringify(out.ac8.dead)}`);
  assert.equal(out.ac8.dead["orchestration/fast-mode-tick-core.md"], 0,
    `inner core has an in-core dead-annotated line (expected none after AC76 C7 migration): ${JSON.stringify(out.ac8.dead)}`);
  // 迁出检查 (AC76): outer's migrated entries (A2/A11/B3/B4/B5/C3/红窗分诊) must NOT be in-core
  // dead-annotated lines — their bodies live in AC58-retired-clauses.md and the core holds only
  // single-line pointers to the archive anchors. A regression that re-introduces any of them as an
  // in-core dead line (or loses the pointer/archive section) reddens.
  const OUTER_DEAD_ANNOT_RE = /前提已死|来源已冻结|已冻结|前提已失效|前提已被人的裁定移除/;
  const OUTER_MIGRATED = ["A2", "A11", "B3", "B4", "B5", "C3", "红窗分诊"];
  const outerCore = fs.readFileSync(path.join(REPO_ROOT, "orchestration/orchestrator-tick-core.md"), "utf8");
  const ac58Archive = fs.readFileSync(path.join(REPO_ROOT, "orchestration/archive/AC58-retired-clauses.md"), "utf8");
  for (const entry of OUTER_MIGRATED) {
    // (a) 核内只有指针: the core references the archive anchor for this entry.
    assert.ok(outerCore.includes("正身已迁出") && outerCore.includes(entry),
      `migrated outer entry ${entry} lost its single-line archive pointer (not pointerized)`);
    // (b) 不在核内作死标记行: no core line mentioning the entry carries a DEAD_ANNOT_RE marker.
    const deadLines = outerCore.split("\n").filter((l) => l.includes(entry) && OUTER_DEAD_ANNOT_RE.test(l));
    assert.equal(deadLines.length, 0,
      `migrated outer entry ${entry} still appears as an in-core dead-annotated line: ${JSON.stringify(deadLines)}`);
  }
  // (c) 正身在档案: the AC58 archive carries the R32/R33/R34 sections referenced by the pointers.
  for (const anchor of ["## R32", "## R33", "## R34"]) {
    assert.ok(ac58Archive.includes(anchor),
      `AC58 archive lost required section ${anchor}`);
  }
  // 迁出检查 (2026-08-15 人裁定清死条目): the migrated entries A7/A12a/B2c/乙/丁 must NOT be
  // in-core dead-annotated lines — their bodies live in manager-phase-goal-archive.md and the core
  // holds only single-line pointers to the archive anchors. A regression that re-introduces any of
  // them as an in-core dead line (or loses the pointer/archive section) reddens.
  const DEAD_ANNOT_RE = /前提已死|来源已冻结|已冻结|前提已失效|前提已被人的裁定移除/;
  const MIGRATED_ENTRIES = ["A7", "A12a", "B2c", "乙", "丁"];
  const managerCore = fs.readFileSync(path.join(REPO_ROOT, "orchestration/manager-tick-core.md"), "utf8");
  const archive = fs.readFileSync(path.join(REPO_ROOT, "orchestration/manager-phase-goal-archive.md"), "utf8");
  for (const entry of MIGRATED_ENTRIES) {
    // (a) 核内只有指针: the core references the archive anchor for this entry.
    assert.ok(managerCore.includes(`orchestration/manager-phase-goal-archive.md#§${entry}-migrated`),
      `migrated entry ${entry} lost its archive pointer in the manager core (not pointerized)`);
    // (b) 正身在档案: the archive file carries the entry's §-migrated section.
    assert.ok(archive.includes(`### §${entry}-migrated`),
      `migrated entry ${entry} has no §-migrated section in manager-phase-goal-archive.md`);
    // (c) 不在核内作死标记行: no core line mentioning the entry carries a DEAD_ANNOT_RE marker.
    const deadLines = managerCore.split("\n").filter((l) => l.includes(entry) && DEAD_ANNOT_RE.test(l));
    assert.equal(deadLines.length, 0,
      `migrated entry ${entry} still appears as an in-core dead-annotated line: ${JSON.stringify(deadLines)}`);
  }
  // 内层 C7 迁出检查 (AC76 tick-core retirement): C7 is a single-line pointer to the
  // AC58-retired-clauses archive R25, NOT an in-core dead-annotated line. The three sub-assertions
  // mirror the manager migrated-entries check above and are each falsifiable (pointer loss /
  // archive-section loss / C7 re-introduced as a dead line all redden).
  const innerCore = fs.readFileSync(path.join(REPO_ROOT, "orchestration/fast-mode-tick-core.md"), "utf8");
  const innerArchive = fs.readFileSync(path.join(REPO_ROOT, "orchestration/archive/AC58-retired-clauses.md"), "utf8");
  assert.ok(innerCore.includes("orchestration/archive/AC58-retired-clauses.md#R25"),
    `inner migrated C7 lost its archive pointer (not pointerized)`);
  assert.ok(innerArchive.includes("## R25"),
    `inner migrated C7 has no R25 section in AC58-retired-clauses.md`);
  const innerC7Dead = innerCore.split("\n").filter((l) => l.includes("C7") && DEAD_ANNOT_RE.test(l));
  assert.equal(innerC7Dead.length, 0,
    `inner migrated C7 still appears as an in-core dead-annotated line: ${JSON.stringify(innerC7Dead)}`);
});

// ── AC2 — the drift/pointer criterion (gap-plugin-loop-manager-drifted-copies-pointerize) ───────────

test("AC2 drift baseline: byte-identical orchestrator copy + semantic fast-mode copy + pointerized manager docs are green", () => {
  const dir = buildDriftRoot();
  try {
    const res = runDrift(dir, "--json");
    assert.equal(res.status, 0, `drift baseline reddened: ${res.stdout} ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.ok, true);
    // All four pairs present; the two manager pairs are POINTER-mode, orchestrator is
    // byte-identical, and the fast-mode pair is SEMANTIC (the 副本 is a laid-down template that
    // references the consumer docs/analysis source, not a byte copy of the 正本).
    const modes = Object.fromEntries(out.pairs.map((p) => [p.shipped, p.mode]));
    assert.equal(modes["plugin/loop/manager-tick-core.md"], "pointer");
    assert.equal(modes["plugin/loop/manager-loop-tick.md"], "pointer");
    assert.equal(modes["plugin/loop/orchestrator-tick-core.md"], "byte-identical");
    assert.equal(modes["plugin/loop/fast-mode-tick-core.md"], "semantic");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2: a reintroduced large manager copy reddens the drift gate (falsifiable — the manager-loop-tick 2321-line drift was structurally invisible under the old tick-CORE-only pairing)", () => {
  const dir = buildDriftRoot();
  try {
    // Re-copy a stale large manager doc into the shipped pointer location → the pointer criterion
    // must flag it (even though it "is a copy" in the byte-identity sense, the manager path must
    // hold NO content — "该路径无内容可维护").
    write(dir, "plugin/loop/manager-loop-tick.md",
      "# manager loop tick 指令（旧副本）\n## A. 读数\n| A1 | 读 `.quay/manager-inbox/` | (src:1) |\n## B. 产出\n- **B1** 收尾 pass。\n");
    const res = runDrift(dir, "--json");
    assert.equal(res.status, 1, `a reintroduced manager copy did not redden the drift gate: ${res.stdout} ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    assert.equal(out.ok, false);
    const mgrLoop = out.pairs.find((p) => p.shipped === "plugin/loop/manager-loop-tick.md");
    assert.ok(mgrLoop && !mgrLoop.consistent, "the manager-loop-tick pointer pair must be inconsistent");
    assert.match(mgrLoop.diffStat, /POINTER VIOLATION/, "the report must name the pointer violation");
    // The manager-tick-core pair is still a consistent pointer.
    const mgrCore = out.pairs.find((p) => p.shipped === "plugin/loop/manager-tick-core.md");
    assert.ok(mgrCore && mgrCore.consistent, "manager-tick-core pointer must stay consistent");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 negative control: a 1-line shipped manager file that does NOT reference its 正本 reddens", () => {
  const dir = buildDriftRoot();
  try {
    write(dir, "plugin/loop/manager-tick-core.md", "some non-pointer content\n");
    const res = runDrift(dir, "--json");
    assert.equal(res.status, 1, `a non-referencing shipped manager file did not redden: ${res.stdout} ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    const mgrCore = out.pairs.find((p) => p.shipped === "plugin/loop/manager-tick-core.md");
    assert.ok(mgrCore && !mgrCore.consistent, "a shipped manager file must reference its 正本");
    assert.match(mgrCore.diffStat, /does not reference/, "the report must name the missing reference");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 fast-mode semantic: a stale 副本 missing a 正本 clause reddens (falsifiable)", () => {
  const dir = buildDriftRoot();
  try {
    // Remove C1 from the shipped template → the semantic gate must flag the missing clause
    // (the exact shape of the pre-fix staleness: 副本 was missing A16b/A26 the 正本 had gained).
    write(dir, "plugin/loop/fast-mode-tick-core.md",
      FAST_CORE_SHIPPED.replace("| C1 | 派发形态必须 `Agent(run_in_background: true)` (src:1) |\n", ""));
    const res = runDrift(dir, "--json");
    assert.equal(res.status, 1, `a stale 副本 missing a clause did not redden: ${res.stdout} ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    const fm = out.pairs.find((p) => p.shipped === "plugin/loop/fast-mode-tick-core.md");
    assert.ok(fm && !fm.consistent, "fast-mode semantic pair must be inconsistent when a clause is missing");
    assert.match(fm.diffStat, /missing clauses/, "the report must name the missing clause");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 fast-mode semantic negative control: a content edit to the 副本 reddens", () => {
  const dir = buildDriftRoot();
  try {
    write(dir, "plugin/loop/fast-mode-tick-core.md", FAST_CORE_SHIPPED.replace("存在 ⇒ 空转", "存在 ⇒ 空转(改坏)"));
    const res = runDrift(dir, "--json");
    assert.equal(res.status, 1, `an edited 副本 clause did not redden: ${res.stdout} ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    const fm = out.pairs.find((p) => p.shipped === "plugin/loop/fast-mode-tick-core.md");
    assert.ok(fm && !fm.consistent, "fast-mode semantic pair must be inconsistent on content drift");
    assert.match(fm.diffStat, /content drift/, "the report must name the drifted clause");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2 fast-mode semantic role guard: a byte-copied 副本 (referencing plugin/loop) reddens", () => {
  const dir = buildDriftRoot();
  try {
    // The 232e4171 regression: the 副本 is rewritten to reference plugin/loop/ (its template-source
    // path) instead of the consumer-laid docs/analysis/ — breaking referenced⊆landed for consumers.
    // The clauses still match, so ONLY the role guard catches it.
    write(dir, "plugin/loop/fast-mode-tick-core.md",
      FAST_CORE_SHIPPED.replace("docs/analysis/fast-mode-loop-tick.md", "plugin/loop/fast-mode-loop-tick.md"));
    const res = runDrift(dir, "--json");
    assert.equal(res.status, 1, `a byte-copied 副本 did not redden the role guard: ${res.stdout} ${res.stderr}`);
    const out = JSON.parse(res.stdout);
    const fm = out.pairs.find((p) => p.shipped === "plugin/loop/fast-mode-tick-core.md");
    assert.ok(fm && !fm.consistent, "byte-copied 副本 must violate the semantic role");
    assert.match(fm.diffStat, /ROLE VIOLATION/, "the report must name the role violation");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("AC2: the real repo's drift gate is green (orchestrator byte-identical, fast-mode semantic, manager pointers)", () => {
  // gap-tick-core-drift-fast-mode-mode-conflict: the fast-mode pair is now `semantic` — the real
  // 副本's clauses match the 正本's (content modulo (src:N)), so the drift gate is GREEN, not 恒红.
  const res = runDrift(REPO_ROOT, "--json");
  assert.equal(res.status, 0, `real-repo drift reddened: ${res.stdout} ${res.stderr}`);
  const out = JSON.parse(res.stdout);
  assert.equal(out.ok, true, "real-repo drift must be green after the fast-mode semantic fix");
  const fm = out.pairs.find((p) => p.shipped === "plugin/loop/fast-mode-tick-core.md");
  assert.ok(fm, "fast-mode semantic pair present");
  assert.equal(fm.mode, "semantic");
  assert.equal(fm.consistent, true, `fast-mode 副本 must be semantically synced: ${JSON.stringify(fm)}`);
  for (const p of out.pairs) {
    if (p.mode !== "pointer") continue;
    assert.equal(p.consistent, true, `${p.shipped} must be a consistent pointer: ${JSON.stringify(p)}`);
  }
});

test("AC7: the checker is registered in scripts/test.sh run_doc_checks with @static-class doc (AC51 断言面拆分)", () => {
  // AC51 (gap-ac51-assertion-surface-split): the doc-consistency checkers moved OUT of the full
  // suite (run_static_checks) INTO run_doc_checks, whose ONLY caller is the pre-commit guard
  // (`scripts/test.sh --static-checks-doc`). The registration assertion is unchanged in spirit —
  // the checker must still be wired, just into the pre-commit surface, marked @static-class doc.
  const testSh = fs.readFileSync(path.join(REPO_ROOT, "scripts/test.sh"), "utf8");
  const lines = testSh.split("\n");
  const start = lines.findIndex((l) => /^run_doc_checks\(\)\s*\{/.test(l));
  assert.ok(start >= 0, "run_doc_checks() function not found in scripts/test.sh");
  const relEnd = lines.slice(start + 1).findIndex((l) => /^\}/.test(l));
  assert.ok(relEnd >= 0, "run_doc_checks() body not closed in scripts/test.sh");
  const func = lines.slice(start, start + 1 + relEnd).join("\n");
  const funcLines = func.split("\n");
  const checkerLine = funcLines.find((l) => l.includes("tick-core-static-check"));
  assert.ok(checkerLine, "tick-core-static-check not wired into run_doc_checks");
  const classLine = funcLines
    .slice(0, funcLines.indexOf(checkerLine))
    .reverse()
    .find((l) => /@static-class/.test(l));
  assert.ok(classLine && /@static-class\s+doc/.test(classLine), `expected @static-class doc, got: ${classLine}`);
});
