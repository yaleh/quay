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
