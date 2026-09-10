// @test-group engine
// driver-third-party-fixture.test.mjs — gap-third-party-fixture-smoke-test-driver-family: the driver
// family must work against a THIRD-PARTY project face (the quay-init laid-down surface: NO plugin/,
// working branch NOT "author"), not just this repo's own face. This repo can never catch the two root
// cause classes on its own — the A-class (script paths anchored at <root>/plugin/scripts/*) because
// this repo HAS plugin/, and the B-class (DOC_BRANCH hardcoded "author") because this repo's working
// branch IS author. Both only surface on a real third-party machine. This test builds a minimal
// synthetic third-party fixture (git init → main + develop, .quay/config.yml, one todo task, NO plugin/)
// and asserts the key driver-family functions no longer anchor at this repo's own features.
//
// Run: scripts/test.sh plugin/test/driver-third-party-fixture.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { resolveResourceGateScript, resourceGateCheck } from "../scripts/driver-shared.ts";
import { defaultPromotionCheckArgv } from "../scripts/promotion-driver.ts";
import { readBudgetFromGate } from "../scripts/cap-from-gate.ts";
import { analyzeTasks, applyPromotions } from "../scripts/ready-pool-check.ts";
import { syncDocDevelopBidirectional, resolveDocBranch } from "../scripts/driver-filters.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── fixture helpers ──────────────────────────────────────────────────────────────────────────────────

/** 跑一条 git 命令（cwd=root，编码 utf8，非零退出抛错，返回 trimmed stdout）。 */
function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** 写文件（mkdir -p 父目录）。 */
function writeFile(p, content) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf8");
}

/** 最小 .quay/config.yml —— quay-init 布下的面的关键特征（providers map），⛔ 不含任何 plugin/ 引用。 */
const MINIMAL_CONFIG = [
  "providers:",
  "  native:",
  "    enabled: true",
  "    path: \"./quay-native\"",
  "    tasks_dir: \"./tasks\"",
  "    mcp_entry: [\"node\", \"./bin/quay-native.ts\", \"mcp\"]",
  "",
].join("\n");

/** 一条最小 contract-shape todo 任务（四件套 + self-touch，每节 ≥40 非空白字符 ⇒ 合格晋升候选）。
 *  形状与 ready-pool-check.test.mjs 的 fourArtifactBody 同构（已证 eligible），⛔ 不自创新形状。 */
function thirdPartyTask(id) {
  const fm = [
    "---",
    `id: ${id}`,
    `title: fixture ${id}`,
    "status: todo",
    "labels:",
    "  - gap",
    "parent: null",
    "children: []",
    "---",
  ].join("\n");
  const body = [
    "**type:** execution",
    "## Proposal",
    "A real proposal paragraph that is definitely more than forty non-whitespace chars.",
    "## Contract",
    "measure   ready_pool = `node plugin/scripts/ready-pool-check.ts` stdout 的 pool 字段",
    "band      ready_pool = ≥1",
    "invariant promotion_order = gap-first",
    "invoke    `node plugin/scripts/ready-pool-check.ts`",
    "control   pool<3 有合格候选 ⇒ 推荐；否则不推荐",
    "resume    分两次提交",
    "## Touches",
    `- tasks/${id}.md`,
    "## Acceptance Criteria",
    "- [ ] an AC item that is long enough",
    "- [ ] an AC item that is long enough",
    "- [ ] an AC item that is long enough",
    "- [ ] an AC item that is long enough",
    "## Definition of Done",
    "standard DoD — the five clauses; meta-enforcer fixture-pinned.",
  ].join("\n");
  return `${fm}\n\n${body}`;
}

/** 一条命令重建：单次调用重建整个第三方面（无 plugin/、main+develop 双分支、config.yml、一条 todo
 *  任务提交在 main 上）。默认分支显式 `-b main`（⛔ 不叫 develop/author），develop 从同一基线分出。 */
function makeThirdPartyFixture(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `quay-third-party-${tag}-`));
  execFileSync("git", ["init", "-q", "-b", "main", root]);
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "third-party-fixture-test");
  writeFile(path.join(root, ".quay", "config.yml"), MINIMAL_CONFIG);
  writeFile(path.join(root, "tasks", "gap-fixture-candidate.md"), thirdPartyTask("gap-fixture-candidate"));
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "baseline");
  git(root, "branch", "develop");
  return root;
}

// ── AC1：夹具最小可用 ──────────────────────────────────────────────────────────────────────────────

test("AC1 — third-party fixture matches quay-init key features (no plugin/, main+develop, config.yml, one todo)", (t) => {
  const root = makeThirdPartyFixture("ac1");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.equal(fs.existsSync(path.join(root, "plugin")), false, "no plugin/ dir (quay-init face)");
  assert.ok(fs.existsSync(path.join(root, ".quay", "config.yml")), ".quay/config.yml exists");

  const branches = git(root, "branch", "--format", "%(refname:short)").split("\n").map((s) => s.trim()).filter(Boolean);
  assert.ok(branches.includes("main"), "main branch exists");
  assert.ok(branches.includes("develop"), "develop branch exists");
  assert.equal(git(root, "branch", "--show-current"), "main", "working branch is main (⛔ author)");

  const taskFiles = fs.readdirSync(path.join(root, "tasks")).filter((f) => f.endsWith(".md"));
  assert.equal(taskFiles.length, 1, "exactly one task file");
  const raw = fs.readFileSync(path.join(root, "tasks", taskFiles[0]), "utf8");
  assert.match(raw, /^status:\s*todo$/m, "the one task is todo");
});

// ── AC2：A 类回归 —— 路径解析不再锚在 fixture root/plugin/scripts ──────────────────────────────────

test("AC2 (A-class) — defaultPromotionCheckArgv resolves ready-pool-check from the kernel install location, not fixture root", (t) => {
  const root = makeThirdPartyFixture("argv");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const argv = defaultPromotionCheckArgv(root, 5);
  const script = argv.find((a) => a.endsWith("ready-pool-check.ts") || a.endsWith("ready-pool-check.js"));
  assert.ok(script, "argv carries a ready-pool-check script path");
  assert.ok(fs.existsSync(script), "resolved script exists on disk (⛔ root-anchored ⇒ missing)");
  assert.ok(
    !path.resolve(script).startsWith(path.resolve(root) + path.sep),
    "script NOT anchored at fixture root (⛔ root/plugin/scripts ⇒ 假)",
  );
});

test("AC2 (A-class) — resolveResourceGateScript + resourceGateCheck run without a path-resolution error", (t) => {
  const root = makeThirdPartyFixture("gate");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const gate = resolveResourceGateScript();
  assert.ok(gate, "resolveResourceGateScript returns non-null (kernel install location)");
  assert.ok(fs.existsSync(gate), "resolved resource-gate.sh exists on disk");
  assert.ok(
    !path.resolve(gate).startsWith(path.resolve(root) + path.sep),
    "gate NOT anchored at fixture root",
  );

  const res = resourceGateCheck(root, null);
  assert.equal(typeof res.go, "boolean", "resourceGateCheck returns a verdict (no throw)");
  assert.doesNotMatch(
    res.reason,
    /not found|No such file|Cannot find module|ENOENT|exit 127/i,
    "no path-resolution error (⛔ root-anchored ⇒ 假)",
  );
});

test("AC2 (A-class) — readBudgetFromGate resolves process-budget.sh from the kernel install location (env seam), not fixture root", (t) => {
  const root = makeThirdPartyFixture("budget");
  const fakePlugin = fs.mkdtempSync(path.join(os.tmpdir(), "quay-fake-plugin-"));
  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(fakePlugin, { recursive: true, force: true });
  });

  // A hermetic budget script under the QUAY_PLUGIN_ROOT seam. The fix reads env.QUAY_PLUGIN_ROOT ||
  // resolveKernelPluginRoot(); the defect anchored at <root>/plugin/scripts/process-budget.sh and
  // silently fail-opened to null — so a non-null snapshot here falsifies the anchor regression.
  writeFile(
    path.join(fakePlugin, "scripts", "process-budget.sh"),
    "#!/usr/bin/env bash\necho 'total_budget=7 in_use=2 available=5'\n",
  );

  const snap = readBudgetFromGate(root, { ...process.env, QUAY_PLUGIN_ROOT: fakePlugin });
  assert.ok(snap, "budget read through the QUAY_PLUGIN_ROOT seam (⛔ root-anchored ⇒ null)");
  assert.deepEqual(snap, { total_budget: 7, in_use: 2, available: 5 }, "hermetic budget parses (no path error)");
});

test("AC2 (A-class) — analyzeTasks against the fixture does not throw and sees the todo candidate", (t) => {
  const root = makeThirdPartyFixture("analyze");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const r = analyzeTasks({ tasksDir: path.join(root, "tasks"), root, cap: 5 });
  assert.equal(r.pool, 0, "no ready task ⇒ pool 0");
  assert.deepEqual(
    r.promotions.map((p) => p.id),
    ["gap-fixture-candidate"],
    "the one todo task is a promotion candidate (four-artifacts complete, no throw)",
  );
});

// ── AC3：B 类回归 —— 工作分支非 author 时同步不再短路 no-refs ─────────────────────────────────────

test("AC3 (B-class) — syncDocDevelopBidirectional on a non-author working branch (main) ≠ no-refs", (t) => {
  const root = makeThirdPartyFixture("sync");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  assert.equal(resolveDocBranch(root), "main", "doc branch resolves to main (runtime-derived, ⛔ author)");

  // main（工作分支）前进一个提交，develop 停在 baseline。
  writeFile(
    path.join(root, "tasks", "gap-fixture-candidate.md"),
    thirdPartyTask("gap-fixture-candidate").replace("status: todo", "status: ready"),
  );
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "main: flip candidate ready");

  const res = syncDocDevelopBidirectional(root);
  assert.notEqual(res, "no-refs", "non-author branch ⇒ not no-refs (⛔ DOC_BRANCH hardcode ⇒ 假)");
  assert.equal(res, "synced", "real divergence ⇒ bidirectional sync executed");
  assert.equal(
    git(root, "rev-parse", "develop"),
    git(root, "rev-parse", "main"),
    "develop fast-forwarded to main (⛔ still baseline ⇒ 假)",
  );
  const developStatus = execFileSync("git", ["-C", root, "show", "develop:tasks/gap-fixture-candidate.md"], { encoding: "utf8" });
  assert.match(developStatus, /^status:\s*ready$/m, "develop ref reads the promoted status (⛔ still todo ⇒ 假)");
});

// ── Plan：一次晋升写入后 develop ref 能读到新状态（不需要人工 git branch -f）────────────────────────

test("applyPromotions against the third-party fixture lands todo→ready AND develop reads the new state (no manual git branch -f)", (t) => {
  const root = makeThirdPartyFixture("promote");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const opts = { tasksDir: path.join(root, "tasks"), root, cap: 5 };
  const r = applyPromotions(opts);
  assert.equal(r.should_apply, true, "eligible todo ⇒ promotion applies");
  assert.equal(r.applied_promotions.length, 1, "one promotion applied");
  assert.equal(r.applied_promotions[0].id, "gap-fixture-candidate");
  assert.equal(r.applied_promotions[0].ok, true, "promotion write succeeded");

  // develop ref（派发读面）现在读到 ready —— B 类修复让这一步自动发生，⛔ 不需要人工 `git branch -f develop main`。
  const developStatus = execFileSync("git", ["-C", root, "show", "develop:tasks/gap-fixture-candidate.md"], { encoding: "utf8" });
  assert.match(developStatus, /^status:\s*ready$/m, "develop ref reads ready after one promotion write (no manual git branch -f)");
});
