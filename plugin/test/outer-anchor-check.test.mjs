// @test-group engine
// outer-anchor-check.test.mjs — AC80 三层 prompt 正本 + 不变式检查器测试
// (tasks/gap-ac80-prompt-canonical-and-invariant-checker, AC1-AC4 + DoD).
//
// 检查器 plugin/scripts/outer-anchor-check.ts 回答：「outer/inner 的 CronCreate 锚 prompt 是否
// （①）有 git 跟踪正本、（②）保持纯指针形式、（③）正本内容与活 prompt 逐字节一致（判据3）」。
//
// This file pins:
//   (a) pure logic — extractCanonical (outer whole-file-minus-newline / inner between AC80 markers),
//       byteDiff (Buffer byte-exact, first-diff-byte, whitespace-sensitive), pointerFormFindings
//       (required pointers / sentinel rule / no state / no decision words), gitUncommitted.
//   (b) REAL-DATA tests (硬规则 4 推论三 —— 判据3 必须比对真实 prompt，不只 fixture 形）：
//       实际内层 prompt（任务体给出的 inner CronCreate 原文）与 实际外层 prompt
//       （develop 上 outer 已落的 orchestration/outer-tick-prompt.txt，commit 72b99cda）
//       同时作为 正本 与 --cron-prompt，断言 byte-equality（exit 0）。
//   (c) NEGATIVE CONTROLS（判据3 逐字节，含空白）：
//       (1) 一个字符漂移 ⇒ exit 1（非 0）；
//       (2) 仅空白漂移（多一个空格）⇒ exit 1 —— 逐字节含空白，不是词法等价；
//       (3) 指针形式违反（缺 required pointer）即使 byte 相同 ⇒ exit 1；
//       (4) 正本缺失（default 路径）⇒ exit 2（NOT-EVALUATED ≠ 0，硬规则 3b）；
//       (5) 未提供活 prompt ⇒ exit 2（判据3 无法评估 ≠ 通过）。
//
// Run:
//   scripts/test.sh plugin/test/outer-anchor-check.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

import {
  extractCanonical,
  byteDiff,
  pointerFormFindings,
  gitUncommitted,
  checkAnchor,
  LAYERS,
  DECISION_WORDS,
  INNER_ANCHOR_BEGIN_MARK,
  INNER_ANCHOR_END_MARK,
  EXIT_OK,
  EXIT_VIOLATED,
  EXIT_NOT_EVALUATED,
} from "../scripts/outer-anchor-check.ts";
import { driverResultToExit } from "../scripts/checker-io.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CHECKER = path.join(REPO_ROOT, "plugin", "scripts", "outer-anchor-check.ts");

// ── 真实数据（AC80 判据3 的 canonical 输入）──────────────────────────────────────────────────────────────

// 内层 CronCreate（job 025f4132）prompt 原文 —— 任务体给定的权威字符串（AC80 C17 建议落进
// plugin/loop/fast-mode-loop-tick.md 的正本段）。**字面原样，勿改字符。**
// 2026-08-15 gap-ac80-anchor-prompt-consumer-path-fix：rationale 指针改为 consumer-resolvable
// $REPO_ROOT/docs/analysis/fast-mode-loop-tick.md（AC1c：tick 模板 live 行不得引用未落地的 plugin/loop/）。
const INNER_PROMPT =
  "[inner-tick] 执行内层 tick。不要依赖上下文记忆——本 prompt 只是指针，内容现读：(1) 读 orchestration/fast-mode-tick-core.md 拿本轮步骤（执行核；理由/实测/代价在 $REPO_ROOT/docs/analysis/fast-mode-loop-tick.md，仅需「为什么」时按 src:N 查，不要每轮全读）；(2) `tail -10 .quay/inner-tick-log.jsonl` 拿上一轮状态（只 tail，全读不可行）；(3) 读 orchestration/manager-phase-goal.md 拿当前阶段目标与 AC（当前阶段在文件后段，按节标题定位，勿全读）。执行完必须向 .quay/inner-tick-log.jsonl 追加一行。唤醒锚核实（AC81）：每轮先核实——CronList 恰一条 + 其 id 等于注册表记录 + --verify 报 registry-verified；三条全真则不动，任一为假才清扫重建，绝不靠记住的 ID。";

// 外层 CronCreate（job 4e88cb1b）prompt 原文 —— develop commit 72b99cda 的
// orchestration/outer-tick-prompt.txt 内容（去掉该文件尾部换行后的 166 字节 prompt 串）。
// **字面原样，勿改字符。**
const OUTER_PROMPT =
  "执行 /home/yale/work/quay/orchestration/orchestrator-tick-core.md 中的 tick 指令（入口直指执行核，1 跳；理由档案按需查 src:N，不要全读）";

function tmpFile(ext) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac80-"));
  const p = path.join(dir, `anchor.${ext}`);
  return { dir, p };
}

/** 构造 inner 正本段 fixture（与 C17 建议落进 fast-mode-loop-tick.md 的格式一致）。 */
function writeInnerSection(p, prompt) {
  fs.writeFileSync(
    p,
    `<!-- ${INNER_ANCHOR_BEGIN_MARK}: inner CronCreate prompt 正本（AC80）——勿单边改，改即漂移 -->\n${prompt}\n<!-- ${INNER_ANCHOR_END_MARK} -->\n`,
  );
}

function runChecker(args) {
  const r = spawnSync("node", ["--no-warnings", "--experimental-strip-types", CHECKER, ...args], {
    encoding: "utf8",
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// ── extractCanonical ─────────────────────────────────────────────────────────────────────────────────────

test("extractCanonical: outer = whole file minus one trailing newline (167b file → 166b prompt)", () => {
  const text = OUTER_PROMPT + "\n";
  assert.equal(extractCanonical(text, "outer"), OUTER_PROMPT);
  assert.equal(extractCanonical(OUTER_PROMPT, "outer"), OUTER_PROMPT); // no trailing newline → unchanged
});

test("extractCanonical: inner = text between AC80 markers, byte-exact", () => {
  const { p } = tmpFile("md");
  try {
    writeInnerSection(p, INNER_PROMPT);
    const text = fs.readFileSync(p, "utf8");
    const extracted = extractCanonical(text, "inner");
    assert.equal(extracted, INNER_PROMPT); // byte-exact incl. backticks + full-width punctuation
    assert.equal(Buffer.byteLength(extracted, "utf8"), Buffer.byteLength(INNER_PROMPT, "utf8"));
  } finally {
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
  }
});

test("extractCanonical: inner returns null when markers absent (MISSING-正本 ⇒ NOT-EVALUATED)", () => {
  assert.equal(extractCanonical("# just a doc\nno markers here\n", "inner"), null);
  assert.equal(extractCanonical(`<!-- ${INNER_ANCHOR_BEGIN_MARK} -->\n${INNER_PROMPT}\n`, "inner"), null);
});

// ── byteDiff（判据3 的机械核）────────────────────────────────────────────────────────────────────────────

test("byteDiff: byte-exact equality (including full-width punctuation)", () => {
  const d = byteDiff(INNER_PROMPT, INNER_PROMPT);
  assert.equal(d.match, true);
  assert.equal(d.firstDiffByte, -1);
  assert.equal(d.actualBytes, Buffer.byteLength(INNER_PROMPT, "utf8"));
});

test("byteDiff: one-char drift ⇒ mismatch with correct first-diff byte", () => {
  const drift = INNER_PROMPT.slice(0, -1) + "。x";
  const d = byteDiff(INNER_PROMPT, drift);
  assert.equal(d.match, false);
  assert.equal(d.firstDiffByte, Buffer.byteLength(INNER_PROMPT, "utf8"));
});

test("byteDiff: whitespace-only drift is a mismatch (逐字节含空白，不是词法等价)", () => {
  const extraSpace = INNER_PROMPT.replace("（执行核", "（ 执行核");
  const d = byteDiff(INNER_PROMPT, extraSpace);
  assert.equal(d.match, false);
  const idx = Buffer.from(INNER_PROMPT, "utf8").indexOf(Buffer.from("（执行核", "utf8"));
  // 「（」两版都在（字节相同），首个差异字节是「（」之后插入的空格位 = idx + 一个「（」的字节长。
  assert.equal(d.firstDiffByte, idx + Buffer.byteLength("（", "utf8"));
});

// ── pointerFormFindings（指针形式判据，镜像 manager-anchor-check.py ①-④）────────────────────────────────

test("pointerFormFindings: real inner prompt is pointer-form-clean (all required pointers + sentinel rule)", () => {
  assert.deepEqual(pointerFormFindings(INNER_PROMPT, "inner"), []);
});

test("pointerFormFindings: real outer prompt is pointer-form-clean (1-hop pointer, no state/decisions)", () => {
  assert.deepEqual(pointerFormFindings(OUTER_PROMPT, "outer"), []);
});

test("pointerFormFindings: missing a required pointer is a violation even when byte-identical", () => {
  // 用「改名」而不是「追加后缀」——`md-renamed` 不含 `md` 后紧跟子串的精确指针。
  const missing = INNER_PROMPT.replace("orchestration/manager-phase-goal.md", "orchestration/manager-phase-goal-renamed.md");
  const f = pointerFormFindings(missing, "inner");
  assert.ok(f.some((x) => x.includes("缺指向 orchestration/manager-phase-goal.md")));
});

test("pointerFormFindings: inner sentinel-cleanup rule required (CronList + 清扫)", () => {
  const noSentinel = INNER_PROMPT.replace("绝不靠记住的 ID。", "绝不靠记住的 ID。"); // keep text, remove the rule
  const stripped = INNER_PROMPT
    .replace("唤醒锚核实（AC81）：每轮先核实——CronList 恰一条 + 其 id 等于注册表记录 + --verify 报 registry-verified；三条全真则不动，任一为假才清扫重建，", "");
  const f = pointerFormFindings(stripped, "inner");
  assert.ok(f.some((x) => x.includes("哨兵清扫")));
});

test("pointerFormFindings: state leakage caught (ISO date / commit hash / task name)", () => {
  const dated = INNER_PROMPT + "（2026-08-14 起）";
  const hashed = INNER_PROMPT + " abc1234567890";
  const tasked = INNER_PROMPT + " gap-some-task-name";
  assert.ok(pointerFormFindings(dated, "inner").some((x) => x.includes("ISO 日期")));
  assert.ok(pointerFormFindings(hashed, "inner").some((x) => x.includes("提交号")));
  assert.ok(pointerFormFindings(tasked, "inner").some((x) => x.includes("任务名")));
});

test("pointerFormFindings: decision words caught", () => {
  for (const w of DECISION_WORDS) {
    const withWord = OUTER_PROMPT + ` ${w}`;
    assert.ok(pointerFormFindings(withWord, "outer").some((x) => x.includes(`决策词「${w}」`)));
  }
});

// ── 判据3 real-data（真实 prompt 走真实比对路径，硬规则 4 推论三）───────────────────────────────────────

test("CLI real-data: inner actual prompt as both 正本 and live ⇒ PASS (exit 0)", () => {
  const { p } = tmpFile("md");
  try {
    writeInnerSection(p, INNER_PROMPT);
    const r = runChecker(["--layer", "inner", "--canonical-file", p, "--cron-prompt", INNER_PROMPT]);
    assert.equal(r.status, EXIT_OK, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /PASS/);
  } finally {
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
  }
});

test("CLI real-data negative: one-char drift in inner live prompt ⇒ VIOLATED (exit 1)", () => {
  const { p } = tmpFile("md");
  try {
    writeInnerSection(p, INNER_PROMPT);
    const drift = INNER_PROMPT.slice(0, -1) + "。x";
    const r = runChecker(["--layer", "inner", "--canonical-file", p, "--cron-prompt", drift]);
    assert.equal(r.status, EXIT_VIOLATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /判据3/);
    assert.match(r.stdout, /first differing byte/);
  } finally {
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
  }
});

test("CLI real-data negative: whitespace-only drift ⇒ VIOLATED (byte-exact incl. whitespace)", () => {
  const { p } = tmpFile("md");
  try {
    writeInnerSection(p, INNER_PROMPT);
    const extraSpace = INNER_PROMPT.replace("（执行核", "（ 执行核");
    const r = runChecker(["--layer", "inner", "--canonical-file", p, "--cron-prompt", extraSpace]);
    assert.equal(r.status, EXIT_VIOLATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /逐字节不一致/);
  } finally {
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
  }
});

test("CLI 判据3 诊断: 活输入是手工缩写（缺 required pointer）⇒ VIOLATED + 根因诊断（gap-ac81 578B 假活值同形）", () => {
  // gap-ac81 2026-08-16 实证：把活值手写成删掉括号段的短版（578B），缺 docs/analysis 指针 ⇒
  // 字节不符恒 VIOLATED。检查器须把「活值本身非合格指针」作为诊断输出，区分「canonical 过时」与「live 喂错」。
  const { p } = tmpFile("md");
  try {
    writeInnerSection(p, INNER_PROMPT);
    const shortened = INNER_PROMPT.replace(
      "（执行核；理由/实测/代价在 $REPO_ROOT/docs/analysis/fast-mode-loop-tick.md，仅需「为什么」时按 src:N 查，不要每轮全读）",
      "",
    );
    assert.ok(shortened.length < INNER_PROMPT.length, "短缩版应比正本短");
    const r = runChecker(["--layer", "inner", "--canonical-file", p, "--cron-prompt", shortened]);
    assert.equal(r.status, EXIT_VIOLATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /判据3/);
    assert.match(r.stdout, /诊断/);
    assert.match(r.stdout, /缺指向 docs\/analysis\/fast-mode-loop-tick\.md/);
  } finally {
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
  }
});

test("CLI real-data: outer actual prompt (develop 72b99cda) as both 正本 and live ⇒ PASS (exit 0)", () => {
  const { p } = tmpFile("txt");
  try {
    fs.writeFileSync(p, OUTER_PROMPT + "\n"); // 正本文件带尾部换行；检查器剥一个尾部换行
    const r = runChecker(["--layer", "outer", "--canonical-file", p, "--cron-prompt", OUTER_PROMPT]);
    assert.equal(r.status, EXIT_OK, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /PASS/);
  } finally {
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
  }
});

test("CLI real-data negative: outer one-char drift ⇒ VIOLATED (exit 1)", () => {
  const { p } = tmpFile("txt");
  try {
    fs.writeFileSync(p, OUTER_PROMPT + "\n");
    const drift = OUTER_PROMPT.replace("不要全读", "不要全读哈");
    const r = runChecker(["--layer", "outer", "--canonical-file", p, "--cron-prompt", drift]);
    assert.equal(r.status, EXIT_VIOLATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /逐字节不一致/);
  } finally {
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
  }
});

test("CLI stdin: live prompt via --stdin ⇒ PASS (exit 0)", () => {
  const { p } = tmpFile("md");
  try {
    writeInnerSection(p, INNER_PROMPT);
    const r = spawnSync(
      "bash",
      ["-c", `printf '%s' "$LIVE" | node --no-warnings --experimental-strip-types "$CHECKER" --layer inner --canonical-file "$P" --stdin`],
      { encoding: "utf8", env: { ...process.env, LIVE: INNER_PROMPT, CHECKER, P: p } },
    );
    assert.equal(r.status, EXIT_OK, `stdout: ${r.stdout}`);
  } finally {
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
  }
});

// ── 指针形式 vs 判据3 独立判定 ─────────────────────────────────────────────────────────────────────────────

test("CLI: pointer-form violation is VIOLATED even when byte-identical (判据3 ≠ 唯一闸)", () => {
  const { p } = tmpFile("md");
  try {
    // 缺 required pointer，但 live 与正本逐字节一致 ⇒ 应报 VIOLATED（不是 0）。
    const missing = INNER_PROMPT.replace("orchestration/manager-phase-goal.md", "orchestration/manager-phase-goal-renamed.md");
    writeInnerSection(p, missing);
    const r = runChecker(["--layer", "inner", "--canonical-file", p, "--cron-prompt", missing]);
    assert.equal(r.status, EXIT_VIOLATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /缺指向 orchestration\/manager-phase-goal\.md/);
  } finally {
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
  }
});

// ── NOT-EVALUATED（硬规则 3b：无法评估 ≠ 通过）───────────────────────────────────────────────────────────

test("CLI: no live prompt provided ⇒ NOT-EVALUATED (exit 2), NOT pass", () => {
  const { p } = tmpFile("md");
  try {
    writeInnerSection(p, INNER_PROMPT);
    const r = runChecker(["--layer", "inner", "--canonical-file", p]);
    assert.equal(r.status, EXIT_NOT_EVALUATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /NOT-EVALUATED/);
    assert.match(r.stdout, /判据3 无法评估/);
  } finally {
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
  }
});

test("CLI: missing 正本 via canonical-file (inner markers absent) ⇒ NOT-EVALUATED (exit 2)", () => {
  const { p } = tmpFile("md");
  try {
    fs.writeFileSync(p, "# doc without markers\n");
    const r = runChecker(["--layer", "inner", "--canonical-file", p, "--cron-prompt", INNER_PROMPT]);
    assert.equal(r.status, EXIT_NOT_EVALUATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /MISSING-正本/);
  } finally {
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
  }
});

// ── 默认路径（当前 worktree 状态：outer 正本尚未合入 → 报 NOT-EVALUATED；合入后 → 走真实比对）──────────

test("CLI default path: outer 正本 absent in this tree ⇒ NOT-EVALUATED (exit 2); if present ⇒ compares", () => {
  const outerPath = path.join(REPO_ROOT, "orchestration", "outer-tick-prompt.txt");
  if (!fs.existsSync(outerPath)) {
    const r = runChecker(["--layer", "outer"]);
    assert.equal(r.status, EXIT_NOT_EVALUATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /MISSING-正本/);
  } else {
    // outer 正本已合入（fan-in 后）：正本 = 文件内容去尾部换行，作为活 prompt ⇒ PASS。
    const canonical = fs.readFileSync(outerPath, "utf8").replace(/\n$/, "");
    const r = runChecker(["--layer", "outer", "--cron-prompt", canonical]);
    assert.equal(r.status, EXIT_OK, `stdout: ${r.stdout}`);
  }
});

test("CLI default path: inner 正本段 absent in this tree ⇒ NOT-EVALUATED (exit 2); if present ⇒ compares", () => {
  const innerDoc = path.join(REPO_ROOT, "plugin", "loop", "fast-mode-loop-tick.md");
  if (!fs.existsSync(innerDoc)) {
    return; // 文件都不存在 → 无可断言
  }
  const text = fs.readFileSync(innerDoc, "utf8");
  const hasMarkers = text.includes(INNER_ANCHOR_BEGIN_MARK) && text.includes(INNER_ANCHOR_END_MARK);
  if (!hasMarkers) {
    const r = runChecker(["--layer", "inner"]);
    assert.equal(r.status, EXIT_NOT_EVALUATED, `stdout: ${r.stdout}`);
    assert.match(r.stdout, /MISSING-正本/);
  } else {
    const canonical = extractCanonical(text, "inner");
    assert.ok(canonical !== null);
    const r = runChecker(["--layer", "inner", "--cron-prompt", canonical]);
    assert.equal(r.status, EXIT_OK, `stdout: ${r.stdout}`);
  }
});

// ── gitUncommitted（工作树未提交检查，镜像 manager-anchor-check.py ⑤）───────────────────────────────────

function makeGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ac80-git-"));
  execFileSync("git", ["init", "-q", dir], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "config", "user.email", "t@example.com"], { stdio: "ignore" });
  execFileSync("git", ["-C", dir, "config", "user.name", "t"], { stdio: "ignore" });
  return dir;
}

test("gitUncommitted: committed+clean file ⇒ '' ; modified ⇒ non-empty ; untracked new ⇒ non-empty", () => {
  const dir = makeGitRepo();
  try {
    fs.writeFileSync(path.join(dir, "f.txt"), "a\n");
    execFileSync("git", ["-C", dir, "add", "f.txt"], { stdio: "ignore" });
    execFileSync("git", ["-C", dir, "commit", "-m", "init"], { stdio: "ignore" });
    assert.equal(gitUncommitted(dir, "f.txt"), "");

    fs.writeFileSync(path.join(dir, "f.txt"), "b\n");
    assert.notEqual(gitUncommitted(dir, "f.txt"), "");

    execFileSync("git", ["-C", dir, "checkout", "--", "f.txt"], { stdio: "ignore" });
    assert.equal(gitUncommitted(dir, "f.txt"), "");

    fs.writeFileSync(path.join(dir, "g.txt"), "new\n"); // untracked
    assert.notEqual(gitUncommitted(dir, "g.txt"), "");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 层配置（per-layer 适配记录）───────────────────────────────────────────────────────────────────────────

test("LAYERS: outer requires 1-hop pointer to orchestrator-tick-core.md; inner requires 4 pointers + sentinel", () => {
  assert.deepEqual(LAYERS.outer.requiredPointers, ["orchestrator-tick-core.md"]);
  assert.equal(LAYERS.outer.requireSentinel, false); // outer 由执行核持有哨兵规则，不内联
  assert.ok(LAYERS.inner.requiredPointers.includes("orchestration/fast-mode-tick-core.md"));
  assert.ok(LAYERS.inner.requiredPointers.includes("docs/analysis/fast-mode-loop-tick.md"));
  assert.ok(LAYERS.inner.requiredPointers.includes("inner-tick-log.jsonl"));
  assert.ok(LAYERS.inner.requiredPointers.includes("orchestration/manager-phase-goal.md"));
  assert.equal(LAYERS.inner.requireSentinel, true); // inner prompt 自带 AC81 哨兵规则
});

// ── B4 DriverResult（gap-b4-checker-reuse-driver-result：判定收敛到 DriverResult<T> 词表）────────────

test("B4 AC2/AC3: checkAnchor 的判定是 DriverResult —— verified/failed/not-evaluated 三态独立，code 由 driverResult 派生", () => {
  const { p } = tmpFile("md");
  try {
    writeInnerSection(p, INNER_PROMPT);

    // verified：正本存在 + 指针形式合格 + 判据3 逐字节一致。
    const ok = checkAnchor({ layer: "inner", root: process.cwd(), canonicalFileOverride: p, cronPrompt: INNER_PROMPT });
    assert.equal(ok.driverResult.state, "verified", "byte-identical + pointer-clean ⇒ verified");
    assert.equal(ok.code, driverResultToExit(ok.driverResult), "code 由 DriverResult 派生（⛔ 非并行常量）");
    assert.equal(ok.code, EXIT_OK);

    // failed：一个字符漂移 ⇒ 判据3 逐字节不一致。
    const drift = INNER_PROMPT.slice(0, -1) + "。x";
    const bad = checkAnchor({ layer: "inner", root: process.cwd(), canonicalFileOverride: p, cronPrompt: drift });
    assert.equal(bad.driverResult.state, "failed", "byte drift ⇒ failed");
    assert.equal(bad.code, driverResultToExit(bad.driverResult));
    assert.equal(bad.code, EXIT_VIOLATED);

    // not-evaluated：正本存在但未提供活 prompt ⇒ 判据3 无法评估（读不到输入 ≠ 合格）。
    const noLive = checkAnchor({ layer: "inner", root: process.cwd(), canonicalFileOverride: p, cronPrompt: null });
    assert.equal(noLive.driverResult.state, "not-evaluated", "no live prompt ⇒ not-evaluated（硬规则 3b）");
    assert.equal(noLive.code, driverResultToExit(noLive.driverResult));
    assert.equal(noLive.code, EXIT_NOT_EVALUATED);
  } finally {
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
  }

  // not-evaluated（正本缺失）：第三态由 DriverResult.not-evaluated 承载，⛔ 非二值塌回。
  const missing = checkAnchor({ layer: "outer", root: process.cwd(), cronPrompt: INNER_PROMPT });
  // 正本可能缺失（⇒ not-evaluated）或存在（⇒ 判据3 与 INNER_PROMPT 逐字节不符 ⇒ failed）——两者都非 verified。
  assert.notEqual(missing.driverResult.state, "verified");
  assert.equal(missing.code, driverResultToExit(missing.driverResult));
});

test("B4 AC2 negative control: 删 import 后第三态塌回 —— notEvaluated 构造在源码的代码位置（删掉该 import 则本断言红）", () => {
  // 结构性负控制：not-evaluated 态必须由 checker-io 的 notEvaluated(...) 构造，且 import 在代码位置。
  // 若删掉该 import，checkAnchor 无法产出 DriverResult.not-evaluated ⇒ 上面三态断言红。
  const src = fs.readFileSync(CHECKER, "utf8");
  assert.match(src, /from "\.\/checker-io\.ts"/, "checker 必须 import checker-io（DriverResult 桥）");
  assert.match(src, /notEvaluated\(/, "第三态必须经 notEvaluated(...) 构造（⛔ 硬编码 code=2）");
});
