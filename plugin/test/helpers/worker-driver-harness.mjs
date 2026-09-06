// worker-driver-harness.mjs — shared test harness for the split worker-driver test files
// (gap-suite-file-split-two-longest). Single source (⛔ 多份拆分文件各复制一份) for the temp-root
// git/task fixtures + driver spawn helpers that every worker-driver*.test.mjs file depends on. Each
// split file imports this module instead of re-declaring the harness.
//
// DRIVER and REPO_ROOT are derived from THIS file's location (plugin/test/helpers/), NOT from the
// importing test file — so they resolve correctly regardless of which test file imports them.

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WORKER_OUTCOME_REL, WORKER_ROUND_REL } from "../../scripts/worker-driver.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DRIVER = path.resolve(__dirname, "..", "..", "scripts", "worker-driver.ts");
export const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

export function makeRoot(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `worker-driver-${tag}-`));
  fs.mkdirSync(path.join(dir, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".quay"), { recursive: true });
  return dir;
}

// A REAL git repo root (for main-checkout observation / clean-main-checkout / worktree-preservation tests).
// `.quay/` is gitignored (mirroring the real repo's runtime-state ignore of worker-outcome.jsonl)
// so the driver's own outcome write never dirties the main checkout.
export function makeGitRoot(tag) {
  const dir = makeRoot(tag);
  runGit(dir, ["init", "-q"]);
  runGit(dir, ["config", "user.email", "test@example.com"]);
  runGit(dir, ["config", "user.name", "Test"]);
  fs.writeFileSync(path.join(dir, ".gitignore"), ".quay/\n");
  runGit(dir, ["add", ".gitignore"]);
  runGit(dir, ["commit", "-q", "-m", "gitignore .quay"]);
  return dir;
}

export function runGit(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
}

// L3 后 launchArgv 经 L2 policy 需要 `.quay/profiles.yml` + `.claude/launch.settings.json` 两个载体。
// 给 temp root 铺一份最小载体（缺省 launcher=claude / model=test-model），供默认 argv 路径的测试用。
export function writeProfileCarrier(root, { launcher = "claude", model = "test-model" } = {}) {
  fs.writeFileSync(path.join(root, ".quay", "profiles.yml"),
    "version: 1\n" +
    "profiles:\n  w:\n    launcher: " + launcher + "\n    model: " + model + "\n    bare: false\n    auth: key\n" +
    "roles:\n  task-worker:\n    profile: w\n    name: quay-test-worker\n" +
    "  selector:\n    profile: w\n    name: quay-selector\n" +
    "  fix-worker:\n    profile: w\n    name: quay-fix-worker\n");
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude", "launch.settings.json"),
    JSON.stringify({ $schema: "x", permissions: {}, env: {} }));
}

export function runDriver(root, args) {
  return execFileSync(process.execPath, [
    "--no-warnings", "--experimental-strip-types", DRIVER, "--root", root, ...args,
  ], { encoding: "utf8" });
}

// Parse newline-delimited JSON, dropping any line that fails to parse. The resident driver appends
// one complete line at a time, so a torn line can only be the trailing one (a concurrent writer
// mid-append) — treating it as "not yet written" lets the caller's waitFor re-poll instead of
// throwing a JSON.parse error (gap-driver-test-fixture-json-read-before-write-complete-race).
function parseJsonLines(text) {
  return text.trim().split("\n").filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
}

export function readOutcomeLines(root) {
  const file = path.join(root, WORKER_OUTCOME_REL);
  if (!fs.existsSync(file)) return [];
  return parseJsonLines(fs.readFileSync(file, "utf8"));
}

export function readRoundLines(root) {
  const file = path.join(root, WORKER_ROUND_REL);
  if (!fs.existsSync(file)) return [];
  return parseJsonLines(fs.readFileSync(file, "utf8"));
}

// 常驻驱动（无 --task）现在【不退出】——瞬时 WAIT（resource-gate / pool-empty）轮询而非 latch
// （gap-worker-driver-stopreason-latch-permanent-stop）。故常驻测试不能再用 execFileSync 等退出码：
// spawn 收集 stdout JSON 事件 + 显式 stop（SIGKILL）。--json 由本 helper 恒追加（events() 依赖它）。
export function spawnResident(root, args) {
  // detached:true ⇒ driver 是独立进程组组长。stop() 杀整个组（driver + worker + counter 子进程一起死），
  // ⛔ 只杀 driver 会留孤儿：孤儿 worker（stdio:"inherit"）持 stdout pipe 写端 ⇒ node --test 等不到 EOF
  // 挂死；孤儿 counter 子进程写 root/*.cnt ⇒ 与 after 钩 rmSync 竞态 ENOTEMPTY。二者都是本文件的
  // 间歇挂起根因（gap-worker-driver-resident-loop-intermittent-hang）。
  const child = spawn(process.execPath, [
    "--no-warnings", "--experimental-strip-types", DRIVER, "--root", root, ...args, "--json",
  ], { stdio: ["ignore", "pipe", "ignore"], detached: true });
  let buf = "";
  child.stdout.on("data", (d) => { buf += d; });
  const events = () => buf.trim().split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
  // stop() 返回在【驱动真退出】后 resolve 的 promise（⛔ 只发 SIGKILL 就返回 ⇒ after 钩里的 rmSync
  // 会在驱动还在写 round/cnt 时跑 ⇒ ENOTEMPTY）。idempotent：多次调用复用同一 promise。inline 调用
  // （测试体末）fire-and-forget，after 钩里 `await drv.stop()` 会等它。
  let stopPromise = null;
  const stop = () => {
    if (stopPromise) return stopPromise;
    stopPromise = new Promise((resolve) => {
      let timer = null;
      const finish = () => { if (timer) clearTimeout(timer); resolve(); };
      if (child.exitCode !== null) { finish(); return; }
      child.once("exit", finish);
      try { process.kill(-child.pid, "SIGKILL"); } catch { try { child.kill("SIGKILL"); } catch { /* already gone */ } }
      timer = setTimeout(finish, 2000); // 兜底：SIGKILL 后驱动应在 ms 级死；2s 上限防 after 钩永挂
    });
    return stopPromise;
  };
  return { child, events, stop, pid: child.pid };
}

// 轮询谓词直到真值或超时（返回最后一次谓词值）。断言写在 waitFor 之后，超时 ⇒ 断言取假 ⇒ 测试干净失败。
// timeoutMs 留足驱动冷启动余量（node --experimental-strip-types 起步 + /proc 冷启动枚举在满载 16 核机上可 >1s）。
export async function waitFor(fn, timeoutMs = 10000, stepMs = 20) {
  const deadline = Date.now() + timeoutMs;
  let v;
  while (Date.now() < deadline) {
    v = fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return v;
}

// A real task file committed with a given frontmatter status. Used to make an exit-0 worker "land"
// (status=done + no leftover worktree) under the real landing check — the git repo IS the seam.
export function writeTaskFile(root, taskId, status = "done") {
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.writeFileSync(path.join(root, "tasks", `${taskId}.md`), `---\nid: ${taskId}\nstatus: ${status}\n---\n\n## Proposal\n\nbody\n`);
  runGit(root, ["add", `tasks/${taskId}.md`]);
  runGit(root, ["commit", "-q", "-m", `task ${taskId} ${status}`]);
}

// A committed task file carrying a `## Touches` section (gap-launch-script-worker-cap-broken AC3):
// the resident loop's filterTouchesDisjoint reads each task's ## Touches from disk. The file is
// COMMITTED (clean) so the driver's main-checkout observation (stash-decision, gap-worker-driver-
// stashifdirty-stashes-others-uncommitted) and the landing check see a clean tree — the test's own
// task-file write must not count as a foreign uncommitted change. status=done so an exit-0 worker
// "lands" (completed, driver exit 0), not exited-not-landed.
export function writeTouchedTask(root, taskId, touchesLine) {
  fs.mkdirSync(path.join(root, "tasks"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "tasks", `${taskId}.md`),
    `---\nid: ${taskId}\nstatus: done\n---\n\n## Proposal\n\nprose\n\n## Touches\n\n- ${touchesLine}\n`,
    "utf8",
  );
  runGit(root, ["add", `tasks/${taskId}.md`]);
  runGit(root, ["commit", "-q", "-m", `task ${taskId} touched`]);
}

// The driver shells out to THREE injectable commands in resident mode (no --task):
//   --ready-pool-cmd (must emit ready-pool-check analyzeTasks JSON), --selector-cmd (must emit
//   `<task-id> <one-line reason>`), --resource-gate-cmd (exit 0=GO / non-0=WAIT). All three are
//   split by splitArgs (whitespace) — so the `node -e` script bodies are SPACE-FREE, and a runtime
//   space in the selector output is emitted via the `\x20` string escape. The counterNodeE helper
//   builds a space-free counter command whose output depends on how many times it has run (n).
export function counterNodeE(counterFile, logExpr) {
  const f = JSON.stringify(counterFile);
  return `node -e n=0;try{n=Number(require('fs').readFileSync(${f},'utf8'))}catch{};require('fs').writeFileSync(${f},String(n+1));console.log(${logExpr})`;
}
