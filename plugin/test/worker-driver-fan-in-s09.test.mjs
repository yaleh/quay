// @test-group serial
// worker-driver-fan-in.test.mjs — mechanical fan-in (locks/merge/trace) + dispatch filters + cold-start + retry/backoff. Split from gap-suite-file-split-two-longest.
// FURTHER SPLIT by gap-suite-split-15-over-30s-test-files — shards s14 (step-end 统一 durationMs 时长通道), s15 (同机制负控制: 无 begin), s16 (suite 决策步两载体同写), s17 (同 runId 两次 suite 红日志独立), s18 (真实 runId 回放) carved out; this file keeps the suite-skip/reuse carrier + suiteLog 指针 + failure-line 提取 clusters.

import { test } from "node:test";
import { assert, extractFirstFailureLine, fanInLogFileName, fs, makeMechRepo, makeReuseRepo, mechOpts, os, path, rmSafe, runGit, runMechanicalFanIn } from "./helpers/worker-driver-fan-in-harness.mjs";

test("AC2/AC3 (跳过路径) — doc-only develop 前进 ⇒ suite-skip 也两路都写", async (t) => {
  const m = makeReuseRepo("step-trace-skip", "doc");
  const runId = "mf-run-step-trace-skip";
  t.after(() => rmSafe(m.base));
  const r = await runMechanicalFanIn(mechOpts(m, runId, { task: "gap-reuse", forceSuite: false }));
  assert.equal(r.outcome, "landed", `doc-only develop advance must reuse prev green and land (step=${r.step} reason=${r.reason})`);
  const sharedFile = path.join(m.repo, ".quay", "fan-in-step-trace.jsonl");
  const sharedSkip = fs.readFileSync(sharedFile, "utf8").trim().split("\n").filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((l) => l.runId === runId && ["ac-precheck", "suite-start", "suite-end", "suite-skip"].includes(l.step));
  assert.equal(sharedSkip.length, 1, "skip path ⇒ exactly one suite decision entry in shared carrier (suite-skip)");
  assert.equal(sharedSkip[0].step, "suite-skip");
  assert.match(sharedSkip[0].reason ?? "", /develop-advance-doc-only-reuse/, "shared suite-skip carries the reuse reason");
  const perRun = fs.readFileSync(path.join(m.repo, ".quay", fanInLogFileName("gap-reuse", runId)), "utf8")
    .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((l) => ["ac-precheck", "suite-start", "suite-end", "suite-skip"].includes(l.step));
  assert.equal(perRun.length, 1, "per-run carrier must match (suite-skip only)");
});

// ── gap-worker-execution-history-index-not-reachable-from-task（A：suiteLog 记录）──────────────────
// A 缺口的病根：机械 fan-in 的 suite 步失败时 verdict.logFile 一路 null（183KB 真因文件只能靠命名约定猜，
// 硬规则 4c「穿不过中间层的量」）。修法：suite 红 ⇒ mechanical_fan_in.suiteLog（basename）+ verdict.logFile
// 指向 .quay/fan-in-suite-*.log 绝对路径；非 suite 红 ⇒ suiteLog null（负控制）。


test("A (能取假) — suite 红 ⇒ suiteLog 非 null + verdict.logFile 指向 suite 日志（⛔ 仍 null ⇒ 假）", async (t) => {
  const m = makeMechRepo("suite-log");
  const runId = "mf-run-suitelog";
  t.after(() => rmSafe(m.base));
  const r = await runMechanicalFanIn(mechOpts(m, runId, { suiteCommand: ["bash", "-c", "echo suite-failing; exit 1"] }));
  assert.equal(r.outcome, "red");
  assert.equal(r.step, "suite");
  assert.equal(r.suiteLog, "suite.log", "suite 红 ⇒ suiteLog 落 basename（⛔ null ⇒ 假）");
  assert.equal(r.verdict.logFile, path.join(m.base, "suite.log"), "verdict.logFile 指向 suite 日志绝对路径（⛔ null ⇒ 假）");
  assert.ok(fs.existsSync(path.join(m.base, "suite.log")), "suite 日志文件在盘上（续做/needs-human 可到达）");
});

test("A (负控制) — 非 suite 红（scoped-gate）⇒ suiteLog null（⛔ 别的步误设 suiteLog ⇒ 假）", async (t) => {
  const m = makeMechRepo("suite-log-neg");
  const runId = "mf-run-suitelog-neg";
  t.after(() => rmSafe(m.base));
  const r = await runMechanicalFanIn(mechOpts(m, runId, { scopedGateCommand: ["false"] }));
  assert.equal(r.outcome, "red");
  assert.equal(r.step, "scoped-gate");
  assert.equal(r.suiteLog, null, "非 suite 红 ⇒ suiteLog null（只有 suite 步记 suite 真因日志）");
});

// ── gap-needs-human-note-missing-real-error-line ────────────────────────────────────────────────
// suite 红 needs-human 的「失败步/判词」恒为 step=suite: suite red（failSuite 只拼 sr.error，而 sr.error 对
// red 恒 null）⇒ 人每次要开 500KB-1MB 的 suite log 手动 grep 才拿得到真实报错行。修法：suite 判红处复用
// extractFailureSummary 同源信号正则（extractFirstFailureLine），把 suite 日志第一条真实断言/报错行塞进
// mechanical_fan_in.reason。AC1 取假（记录含真实错误原文）；AC2 负控制（无信号 ⇒ 回退通用文案）。


test("extractFirstFailureLine — 取第一条真实失败信号行；无信号/纯噪声 ⇒ 空串（⛔ 不回退 meaningful）", () => {
  assert.equal(extractFirstFailureLine(""), "");
  assert.equal(
    extractFirstFailureLine("benign line\nAssertionError [ERR_ASSERTION]: probe must be alive\nmore noise"),
    "AssertionError [ERR_ASSERTION]: probe must be alive",
    "returns the first real assertion line",
  );
  // 无信号 ⇒ 空串（extractFailureSummary 会回退 meaningful，本函数必须仍为空——AC2「无匹配行 ⇒ 回退通用文案」）。
  assert.equal(extractFirstFailureLine("benign line only\nanother benign"), "");
  // 噪声行被跳过，取第一个真实信号。
  assert.equal(
    extractFirstFailureLine("(node:1) [MODULE_TYPELESS_PACKAGE_JSON] Warning: x\nnot ok 1 - my-test"),
    "not ok 1 - my-test",
    "MODULE_TYPELESS noise is skipped, first real signal is returned",
  );
});


// ── gap-fan-in-suite-skip-quoted-nonascii-doc-path ──────────────────────────────────────────────
// 病根：`git diff --name-only` 默认 C-quote 非 ASCII 路径（`"meta/META-017-\350\257\267….md"`）。
// 该引号形态喂给 classify-delta 后不再以 `meta/` 开头 ⇒ isDocPath=false ⇒ code delta ⇒ 全量 suite。
// 本用例是【修复前必红】的负控制：delta 恰好只含一个非 ASCII 文档面路径 ⇒ 必须写 suite-skip 且
// suite 命令一次都不执行。⛔ 断言的不是「flag 在源码里」，是分支真的被走到（两条载体同读）。
const NONASCII_DOC_REL = "meta/META-017-请裁定-排除-ac-920-判据-2-1-tail-6-偶-pass-的处理-退休-保持现状-ac-922-已-sup.md";

// 与 makeReuseRepo 同形的 hermetic 树（registry stub ⇒ DOC_SURFACES 生效），差别只有一处：
// 任务分支的唯一提交落在【非 ASCII 文档面路径】上。
function makeNonAsciiDocRepo(tag) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), `fanin-nonascii-doc-${tag}-`));
  const repo = path.join(base, "repo");
  const worktree = path.join(base, "wt");
  fs.mkdirSync(repo, { recursive: true });
  runGit(repo, ["init", "-q"]);
  runGit(repo, ["config", "user.name", "nonascii-doc-test"]);
  runGit(repo, ["config", "user.email", "nonascii@example.com"]);
  runGit(repo, ["branch", "-M", "develop"]);
  fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(repo, "scripts", "test.sh"), "#!/usr/bin/env bash\nexit 0\n", "utf8");
  fs.mkdirSync(path.join(repo, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(repo, "plugin", "scripts", "runner-static-gate.ts"), "// hermetic registry stub — empty registry\n", "utf8");
  fs.mkdirSync(path.join(repo, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(repo, "tasks", "gap-nonascii-doc.md"), [
    "---", "id: gap-nonascii-doc", "title: non-ascii doc delta", "status: ready",
    "labels: []", "extra: {}", "---",
    "## Proposal", "test", "## Plan", "test",
    "## Touches", `- ${NONASCII_DOC_REL}`,
    "## Acceptance Criteria", "- [x] AC1 landed",
    "## Definition of Done", "- [x] landed", "",
  ].join("\n"), "utf8");
  runGit(repo, ["add", "-A"]);
  runGit(repo, ["commit", "-q", "-m", "base"]);
  runGit(repo, ["worktree", "add", "-q", worktree, "-b", "task/gap-nonascii-doc"]);
  // develop 脱离主检出（同 makeReuseRepo：ff 退化纯 ref 更新）。
  runGit(repo, ["checkout", "-q", "-b", "develop-work"]);
  fs.mkdirSync(path.join(worktree, "meta"), { recursive: true });
  fs.writeFileSync(path.join(worktree, NONASCII_DOC_REL), "# META-017\n", "utf8");
  runGit(worktree, ["add", "-A"]);
  runGit(worktree, ["commit", "-q", "-m", "meta: META-017 create (doc-only)"]);
  return { base, repo, worktree, slotBase: path.join(base, "full-suite.lock"), capture: path.join(base, "suite.env") };
}

test("AC4 (负控制, 修复前必红) — delta 只含一个 C-quoted 非 ASCII 文档面路径 ⇒ suite-skip 且 suite 未执行", async (t) => {
  const m = makeNonAsciiDocRepo("skip");
  const runId = "mf-run-nonascii-doc-skip";
  const marker = path.join(m.base, "suite-ran.marker");
  t.after(() => rmSafe(m.base));
  const r = await runMechanicalFanIn(mechOpts(m, runId, {
    task: "gap-nonascii-doc",
    forceSuite: false,
    // 执行即留痕：⛔ 不靠「suite 输出里没写」推断未执行。
    suiteCommand: ["bash", "-c", `printf executed > ${JSON.stringify(marker)}`],
  }));
  assert.equal(r.outcome, "landed", `non-ASCII doc-only delta must land via the skip branch (step=${r.step} reason=${r.reason})`);
  assert.equal(fs.existsSync(marker), false, "suite 命令必须【一次都没执行】（执行过 ⇒ 留下 marker）");
  const shared = fs.readFileSync(path.join(m.repo, ".quay", "fan-in-step-trace.jsonl"), "utf8").trim().split("\n").filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((l) => l.runId === runId && ["ac-precheck", "suite-start", "suite-end", "suite-skip"].includes(l.step));
  assert.equal(shared.length, 1, "skip 路径 ⇒ 共享载体里恰好一条 suite 决策记录");
  assert.equal(shared[0].step, "suite-skip", "共享载体记录必须是 suite-skip（⛔ suite-start）");
  assert.equal(shared[0].reason, "doc-only-delta", "reason 说明判据（⛔ 复用 develop-advance 的理由）");
  const perRun = fs.readFileSync(path.join(m.repo, ".quay", fanInLogFileName("gap-nonascii-doc", runId)), "utf8")
    .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((l) => ["ac-precheck", "suite-start", "suite-end", "suite-skip"].includes(l.step));
  assert.deepEqual(perRun.map((l) => l.step), ["suite-skip"], "per-run 载体与共享载体同形（没有 suite-start/suite-end）");
});

test("extractFirstFailureLine — 标题行/静态检查良性判词/✔通过测试排在真实失败前 ⇒ 取真实断言（⛔ 归因错位到 split-or-commit 标题）", () => {
  const log = [
    "== split-or-commit whole-store check (DIR-026, gap-split-or-commit-not-continuously-checked) ==",
    "checker-mechanical-spine-check — 115 checker(s), 0 violation(s), 0 exempted",
    "PASS: 1711 task(s) checked — no split-or-commit violations",
    "✔ assertionSignaturesFromSuiteLog — 提取并归一化 AssertionError 签名（[ERR_ASSERTION] 变体）",
    "✖ AC3 负控制 — 饱和且静默但在飞变 ⇒ 不发 (in-flight worktree set changes every round)",
    "  AssertionError [ERR_ASSERTION]: worktree add wt-2 failed: cannot change to session-liveness repo",
    "__PERFILE__ duration_ms=18921 plugin/test/session-liveness-scd-inflight-changing.test.mjs passed=false end_ms=1",
  ].join("\n");
  const line = extractFirstFailureLine(log);
  assert.match(line, /AssertionError \[ERR_ASSERTION\]: worktree add wt-2 failed/, "取真实断言原文");
  assert.doesNotMatch(line, /split-or-commit whole-store check/, "⛔ 标题行被当失败摘要");
  assert.doesNotMatch(line, /0 violation\(s\)/, "⛔ 静态检查良性判词被当失败摘要");
});
