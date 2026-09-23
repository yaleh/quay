// @test-group serial
// worker-driver-fan-in.test.mjs — mechanical fan-in (locks/merge/trace) + dispatch filters + cold-start + retry/backoff. Split from gap-suite-file-split-two-longest.
// SPLIT from worker-driver-fan-in.test.mjs by gap-suite-split-15-over-30s-test-files — shard 6/10 (11 tests). Shared fixtures: ./helpers/worker-driver-fan-in-harness.mjs (single source).

import { test } from "node:test";
import { DRIVER, acquireFanInLock, after, appendFanInStepTrace, appendFanInTrace, assert, counterNodeE, fanInLockFile, fanInLogFileName, fs, makeGitRoot, makeRoot, markNeedsHuman, mechSh, os, path, pathToFileURL, readOutcomeLines, readTaskStatus, rmSafe, runMechanicalFanIn, spawn, spawnMechanicalFanIn, spawnResident, spawnSync, waitFor, writeTaskFile } from "./helpers/worker-driver-fan-in-harness.mjs";

// gap-arch-worker-fan-in-extract-from-worker-driver：机械 fan-in 区域（runMechanicalFanIn / step() /
// spawnMechanicalFanIn …）的正本已迁 worker-fan-in.ts。worker-driver.ts 经 re-export 保持【import 面】
// 逐字不变（AC2），但【读源码的结构判据】必须按代码实际所在处取——否则判据会从「查过了」退化为
// 「查了一个不再持有该代码的文件」而仍报绿（硬规则 3b 的镜像：判据读错载体）。
const FAN_IN = path.join(path.dirname(DRIVER), "worker-fan-in.ts");

test("AC1 (integration) — worker 快速死亡后 driver 退避：不立即重派（worker-backoff 事件 + 无第二次立即派发）", async (t) => {
  const root = makeGitRoot("backoff-ac1");
  writeTaskFile(root, "gap-qd", "ready");
  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-qd'],pool:1}))",
    "--selector-cmd", "node -e console.log('gap-qd\\x20quick-death')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(1)",
    "--backoff-base-ms", "3000",     // 3s 退避 ⇒ 第二次派发至少 3s 后
    "--backoff-threshold", "1",       // 第一次快速死亡即退避
    "--max-retries", "5",             // 高上限，避免标 needs-human 干扰「退避」观测
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => rmSafe(root));

  // 第一次派发 → 快速死亡 → worker-backoff 事件（退避生效的直接量）。
  await waitFor(() => drv.events().filter((e) => e.event === "worker-backoff").length >= 1, 30000);
  const backoffs = drv.events().filter((e) => e.event === "worker-backoff");
  assert.equal(backoffs[0].task, "gap-qd");
  assert.equal(backoffs[0].backed_off, true, "AC1: quick death ⇒ backed_off=true（退避，⛔ 立即重派）");
  assert.equal(backoffs[0].needs_human, false);

  // 负控制：退避窗口（3s）内无第二次派发——给一个 1s 窗口断言仍只有 1 次 selector-picked。
  await new Promise((r) => setTimeout(r, 1000));
  let picks = drv.events().filter((e) => e.event === "selector-picked");
  assert.equal(picks.length, 1, "AC1: 退避期间（<3s）不立即重派——仍只有 1 次派发（⛔ 仍 <60s 立即重派 ⇒ 假）");

  // 退避到期（3s）后第二次派发发生（退避是延迟，⛔ 永久不派）。
  await waitFor(() => drv.events().filter((e) => e.event === "selector-picked").length >= 2, 20000);
  picks = drv.events().filter((e) => e.event === "selector-picked");
  assert.equal(picks.length, 2, "AC1: 退避到期后第二次派发发生");
});


test("AC2 (integration) — 一个任务退避时其它任务照常派发（退避按 task，⛔ 不全局）", async (t) => {
  const root = makeGitRoot("backoff-ac2");
  writeTaskFile(root, "gap-a", "ready");
  writeTaskFile(root, "gap-b", "ready");
  const selFile = path.join(root, "sel.cnt");
  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-a','gap-b'],pool:2}))",
    "--selector-cmd", counterNodeE(selFile, "n===0?'gap-a\\x20first':n===1?'gap-b\\x20second':'gap-a\\x20again'"),
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(1)",
    "--backoff-base-ms", "5000",     // gap-a 退避 5s（gap-b 派发发生在退避窗口内）
    "--backoff-threshold", "1",
    "--max-retries", "5",
    "--concurrency", "1",
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => rmSafe(root));

  // gap-a 派发 → 快速死亡 → 退避。gap-a 退避期间 gap-b 仍被派发（退避不拖垮全局）。
  await waitFor(() => drv.events().filter((e) => e.event === "selector-picked").map((e) => e.task).includes("gap-b"), 30000);
  const picks = drv.events().filter((e) => e.event === "selector-picked");
  assert.deepEqual(picks.map((p) => p.task).slice(0, 2), ["gap-a", "gap-b"],
    "AC2: gap-a 退避期间 gap-b 仍照常派发（退避按 task，⛔ 不全局）");
});


test("AC3 (integration) — 退避到上限转 markNeedsHuman（⛔ 不无限退避）", async (t) => {
  const root = makeGitRoot("backoff-ac3");
  writeTaskFile(root, "gap-cap", "ready");
  const drv = spawnResident(root, [
    "--ready-pool-cmd", "node -e console.log(JSON.stringify({ready:['gap-cap'],pool:1}))",
    "--selector-cmd", "node -e console.log('gap-cap\\x20quick-death')",
    "--resource-gate-cmd", "node -e process.exit(0)",
    "--worker-cmd-exact", "node -e process.exit(1)",
    "--backoff-base-ms", "100",   // 小退避，让多次快速死亡快速推进到上限
    "--backoff-threshold", "1",
    "--max-retries", "2",         // 2 次快速死亡 ⇒ needs-human
    "--interval", "20",
  ]);
  t.after(() => drv.stop());
  t.after(() => rmSafe(root));

  // 2 次快速死亡（每次之间隔 100ms 退避）⇒ 标 needs-human。
  await waitFor(() => readTaskStatus(root, "gap-cap") === "needs-human", 30000);
  assert.equal(readTaskStatus(root, "gap-cap"), "needs-human", "AC3: 退避到上限（max-retries=2）⇒ needs-human");
  const body = fs.readFileSync(path.join(root, "tasks", "gap-cap.md"), "utf8");
  assert.ok(body.includes("## Needs-Human"), "AC3: ## Needs-Human audit record written");
  assert.match(body, /快速死亡/, "AC3: reason mentions 快速死亡（退避上限）");

  // 负控制：不再无限重派——恰好 2 次派发。
  const picks = drv.events().filter((e) => e.event === "selector-picked");
  assert.equal(picks.length, 2, "AC3: exactly 2 dispatches — 退避到上限后不再重派（⛔ 无限退避 ⇒ 假）");
  assert.equal(readOutcomeLines(root).length, 2, "AC3: still exactly 2 outcomes — no 3rd attempt wrote a record");
});

// ── gap-adr034-fan-in-lock-holder-supervised（ADR-034）— driver 死（SIGKILL）→ 锁自动释放 ──────────
// fan-in 锁的持锁者由「分离 holder + flag 释放协议」（fan-in-ff-merge.sh --acquire/--release-
// fan-in-lock 的 setsid & disown）收进 driver：worker-driver.ts 经非分离直接子进程持锁，锁的生死 =
// 工作的进程生死。本测试负控制：spawn 一个「driver」子进程经 acquireFanInLock 持锁 → 独立
// flock -n 竞争者确认被挡 → SIGKILL driver → 内核关 stdin 写端 ⇒ holder 写 release + flock -u 退出 ⇒
// 锁自动释放（flock -n 成功 + holder 进程死、无 PPID=1 持锁孤儿）→ 新 driver 可再 acquire 同一锁。


test("AC1/AC5 (gap-adr034-fan-in-lock-holder-supervised) — driver 死（SIGKILL）→ flock 自动释放；无孤儿 holder 挡排队 acquire", async () => {
  const root = makeGitRoot("adr034-lock");
  const task = "gap-adr034-holder";
  const lockFile = fanInLockFile(root);
  const holdScript = `
import { acquireFanInLock } from ${JSON.stringify(pathToFileURL(DRIVER).href)};
const lock = await acquireFanInLock({ root: ${JSON.stringify(root)}, task: ${JSON.stringify(task)}, runId: "r1" });
console.log("HELD " + lock.holderPid);
await new Promise(() => {});
`;
  const driver = spawn(process.execPath, ["--no-warnings", "--experimental-strip-types", "--input-type=module", "-e", holdScript], { stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  let err = "";
  driver.stdout.on("data", (d) => { out += d; });
  driver.stderr.on("data", (d) => { err += d; });
  try {
    // 等 driver 子进程确认持锁（holder 写出 acquire 事件后打印 HELD <pid>）。
    await waitFor(() => /HELD \d+/.test(out), 15000);
    const holderPid = Number(out.match(/HELD (\d+)/)?.[1]);
    assert.ok(Number.isInteger(holderPid) && holderPid > 0, `driver must report a valid holder pid (out=${JSON.stringify(out)} err=${JSON.stringify(err)})`);

    // 锁正被 holder 持有：独立 flock -n 竞争者应失败（flock -n 拿不到 ⇒ 非零）。
    const heldProbe = spawnSync("bash", ["-c", `exec {fd}>"$1"; flock -n "$fd"`, "probe", lockFile], { encoding: "utf8" });
    assert.notEqual(heldProbe.status, 0, "while the driver holds the lock, an independent flock -n must FAIL (lock is held)");

    // SIGKILL driver（⛔ 不是 graceful release）——内核关 driver 的 stdin 写端 ⇒ holder 读 EOF ⇒ 释放。
    driver.kill("SIGKILL");

    // 锁自动释放：独立 flock -n 竞争者随后成功。
    await waitFor(() => {
      const p = spawnSync("bash", ["-c", `exec {fd}>"$1"; flock -n "$fd"`, "probe", lockFile], { encoding: "utf8" });
      return p.status === 0;
    }, 15000);

    // 无 PPID=1 持锁孤儿：holder 进程随 driver 死退出（kill -0 失败）。
    await waitFor(() => {
      try { process.kill(holderPid, 0); return false; } catch { return true; }
    }, 15000);

    // 新 driver 能再 acquire 同一锁并干净 release（端到端「重启不残留」）。
    const lock2 = await acquireFanInLock({ root, task: "gap-adr034-holder", runId: "r2" });
    assert.ok(Number.isInteger(lock2.holderPid) && lock2.holderPid > 0, "a fresh acquire after restart must succeed (no orphan holder blocking)");
    await lock2.release();
  } finally {
    try { driver.kill("SIGKILL"); } catch { /* already dead */ }
    rmSafe(root);
  }
});

// ── gap-mech-fan-in-log-webui-visible-clickable（AC1）— 机械 fan-in 过程日志 ───────────────────
// 机械 fan-in 的每一步 trace 持久化到 .quay/fan-in-<task>-<runId>.log（gitignored 运行时日志），
// 每行 {ts, step, exit, wall_ms, ok}、失败步附 reason。runId 唯一后缀 ⇒ 跨 relaunch 不复用
// （同 gap-fan-in-suite-log-cross-relaunch-reuse 防护：旧轮内容不残留、新 runId 写新文件）。


test("AC1 (unit) — fanInLogFileName sanitizes runId; appendFanInTrace appends one {ts,step,exit,wall_ms,ok} JSON line per call", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fanin-trace-unit-"));
  try {
    const file = path.join(dir, fanInLogFileName("gap-trace-ac1", "wk/prod 123"));
    assert.equal(path.basename(file), "fan-in-gap-trace-ac1-wk_prod_123.log", "runId sanitized to [A-Za-z0-9_.-] (slash/space → _)");
    appendFanInTrace(file, { step: "merge-develop", exit: 128, wall_ms: 12, ok: false, reason: "boom" });
    appendFanInTrace(file, { step: "acquire-fan-in-lock", exit: 0, wall_ms: 3, ok: true });
    const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(lines.length, 2, "one JSON line per call (append, not overwrite)");
    for (const ln of lines) {
      assert.ok("ts" in ln && "step" in ln && "exit" in ln && "wall_ms" in ln && "ok" in ln, `line carries {ts, step, exit, wall_ms, ok} (got ${JSON.stringify(ln)})`);
    }
    assert.equal(lines[0].step, "merge-develop");
    assert.equal(lines[0].exit, 128);
    assert.equal(lines[0].wall_ms, 12);
    assert.equal(lines[0].ok, false);
    assert.equal(lines[0].reason, "boom");
  } finally {
    rmSafe(dir);
  }
});


test("AC1 (integration) — runMechanicalFanIn writes a per-step trace covering the steps up to the first failure; a new runId writes a NEW file (old one untouched)", async () => {
  const root = makeGitRoot("fanin-trace");
  const task = "gap-trace-ac1";
  const worktree = fs.mkdtempSync(path.join(os.tmpdir(), "fanin-wt-"));
  try {
    const r1 = await runMechanicalFanIn({ task, worktree, root, runId: "r1" });
    assert.equal(r1.outcome, "red", "non-git worktree merge fails → red");
    assert.equal(r1.step, "merge-develop", "first failing step is merge-develop");
    assert.equal(r1.fanInLog, `fan-in-${task}-r1.log`, "outcome carries the fan-in log file name (A3)");

    const log1 = path.join(root, ".quay", `fan-in-${task}-r1.log`);
    assert.ok(fs.existsSync(log1), "fan-in trace log exists after a real run");
    const lines1 = fs.readFileSync(log1, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    assert.ok(lines1.length >= 2, "trace covers acquire + at least the failing merge step");
    for (const ln of lines1) {
      assert.ok("step" in ln && "exit" in ln && "wall_ms" in ln && "ok" in ln, `each line carries {step, exit, wall_ms, ok} (got ${JSON.stringify(ln)})`);
      assert.ok(typeof ln.wall_ms === "number", "wall_ms is a number");
    }
    const steps1 = lines1.map((l) => l.step);
    assert.ok(steps1.includes("acquire-fan-in-lock"), "acquire step traced");
    assert.ok(steps1.includes("merge-develop"), "merge step traced");
    const mergeLine = lines1.find((l) => l.step === "merge-develop");
    assert.equal(mergeLine.ok, false, "failing merge step is marked ok=false");
    assert.ok(typeof mergeLine.reason === "string" && mergeLine.reason.length > 0, "failing step carries a reason");

    // 跨 relaunch：新 runId 写新文件、旧文件不被覆盖。
    const before = fs.readFileSync(log1, "utf8");
    const r2 = await runMechanicalFanIn({ task, worktree, root, runId: "r2" });
    assert.equal(r2.fanInLog, `fan-in-${task}-r2.log`, "second run's outcome carries a distinct file name");
    const log2 = path.join(root, ".quay", `fan-in-${task}-r2.log`);
    assert.ok(fs.existsSync(log2), "second run writes a NEW file");
    assert.notEqual(path.join(root, ".quay", r1.fanInLog), path.join(root, ".quay", r2.fanInLog), "distinct files per runId");
    assert.equal(fs.readFileSync(log1, "utf8"), before, "old run's file is NOT overwritten by the new runId");
  } finally {
    rmSafe(worktree);
    rmSafe(root);
  }
});

// ── gap-fan-in-token-gate-version-mismatch-self-lock：每任务新进程（版本错位类级修法）──────────────
// 机械 fan-in 不再在守护进程 in-process 跑（守护是主检出旧代码、但 fan-in 编排脚本从 worktree 加载
// ⇒ 版本错位），改为每任务 spawn 一个 fresh node 进程加载 worker-driver.ts（entry = 主检出 opts.root，
// ⛔ 非 worktree——gap-fan-in-spawn-stale-worktree-executor-missing-argv）--mechanical-fan-in。
// 锁半（acquireFanInLock，ADR-034）与编排半（fan-in-ff-merge.sh）同源（仍在 worktree）。
// ⛔ token 闸（L1）已由 fd902a824 重定范围到 P2 的 TS 模块 ff 入口，本任务不再实现 token 闸。


test("AC1 (gap-fan-in-token-gate-version-mismatch-self-lock) — 每任务新进程：finishAsync 调 spawnMechanicalFanIn 加载当前代码（⛔ 不再 in-process）", () => {
  const src = fs.readFileSync(DRIVER, "utf8");
  // gap-arch-worker-fan-in-extract-from-worker-driver：spawnMechanicalFanIn 本体已迁 worker-fan-in.ts
  // ⇒ 它的两条断言按【代码所在模块】读（⛔ 不是删断言、也不是去 worker-driver.ts 里假装还在）。
  const fanSrc = fs.readFileSync(FAN_IN, "utf8");
  assert.match(src, /mechResult = await spawnMechanicalFanIn\(\{ task: taskId, worktree: paths\[0\], root: rootDir, runId \}\)/, "finishAsync spawns a fresh mechanical fan-in process (⛔ in-process runMechanicalFanIn)");
  assert.match(fanSrc, /const entry = kernelSiblingArgv\("worker-driver\.ts"\)/, "spawnMechanicalFanIn anchors the executor at the kernel install location (⛔ opts.root/plugin/scripts/worker-driver.ts — gap-plugin-root-resolution-remaining-callsites-round2)");
  assert.match(fanSrc, /process\.execPath, \.\.\.entry,\s*\n\s*"--mechanical-fan-in"/, "the fresh process is node <kernel-sibling>/worker-driver.(ts|js) --mechanical-fan-in");
  assert.match(src, /if \(mechanicalFanIn\) \{\s*\n\s*const task = tasks\[0\]/, "--mechanical-fan-in mode exists in main()");
  assert.match(src, /worktree: mechWorktree,/, "--mechanical-fan-in mode passes the worktree to runMechanicalFanIn");
});

// ── gap-fan-in-spawn-stale-worktree-executor-missing-argv：执行器 entry 用 kernel 安装位置（⛔ worktree）────
// fresh-process fan-in spawn 用 worktree 的 worker-driver.ts 当执行器时，stale worktree（未 merge
// develop）的旧 worker-driver.ts 缺新 argv（--mechanical-fan-in）⇒ fresh 进程报 unknown argument ⇒
// 无 JSON 输出 ⇒ parse-mechanical-fan-in red。修法：entry = kernel 安装位置（resolveKernelSibling，与
// driver 同版；⛔ opts.root/plugin/scripts/worker-driver.ts —— gap-plugin-root-resolution-remaining-
// callsites-round2：第三方项目无 plugin/scripts/），worktree 只提供任务 delta、不提供执行器代码。
// AC2 负控制：kernel entry（有 argv）与 stale worktree entry（无 argv）两个 stub——entry 若指回
// worktree 则 spawn 加载 stale stub ⇒ unknown argument ⇒ red（本测试断言 outcome=landed，改回即红）。


test("AC2 (gap-fan-in-spawn-stale-worktree-executor-missing-argv) — stale worktree 缺 --mechanical-fan-in argv 仍 spawn 成功（entry=kernel 安装位置，⛔ 改回 opts.worktree ⇒ unknown argument ⇒ parse-mechanical-fan-in red）", async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "stale-exec-"));
  t.after(() => rmSafe(base));
  const root = path.join(base, "root");
  const worktree = path.join(base, "wt");
  const pluginRoot = path.join(base, "plugin"); // kernel 安装位置（QUAY_PLUGIN_ROOT 缝）

  // kernel 安装位置的 worker-driver.ts = 当前版（有 --mechanical-fan-in argv）——最小自足 stub（无
  // import），命中 --mechanical-fan-in 即打一行 JSON result 退出。模拟「与 driver 同版」。
  fs.mkdirSync(path.join(pluginRoot, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, "scripts", "worker-driver.ts"), [
    "// current worker-driver.ts (kernel entry): has --mechanical-fan-in argv",
    "const argv = process.argv.slice(2);",
    'if (argv.includes("--mechanical-fan-in")) {',
    '  process.stdout.write(JSON.stringify({ outcome: "landed", step: null, reason: null, verdict: null }) + "\\n");',
    "  process.exit(0);",
    "}",
    'const flag = argv.find((x) => x.startsWith("--"));',
    'console.error("worker-driver: unknown argument: " + (flag ?? ""));',
    "process.exit(2);",
  ].join("\n"), "utf8");

  // worktree 的 worker-driver.ts = 陈旧版（无 --mechanical-fan-in argv，任何 --* 都 unknown argument）。
  // 模拟 stale worktree：落后 develop、缺新 argv。entry 现在锚在 kernel 安装位置（QUAY_PLUGIN_ROOT），
  // ⛔ 不读 worktree ⇒ stale stub 不被加载。
  fs.mkdirSync(path.join(worktree, "plugin", "scripts"), { recursive: true });
  fs.writeFileSync(path.join(worktree, "plugin", "scripts", "worker-driver.ts"), [
    "// STALE worker-driver.ts: no --mechanical-fan-in argv (any --* flag => unknown argument)",
    "const argv = process.argv.slice(2);",
    'const flag = argv.find((x) => x.startsWith("--"));',
    'console.error("worker-driver: unknown argument: " + (flag ?? ""));',
    "process.exit(2);",
  ].join("\n"), "utf8");

  const saved = process.env.QUAY_PLUGIN_ROOT;
  process.env.QUAY_PLUGIN_ROOT = pluginRoot;
  try {
    const r = await spawnMechanicalFanIn({ task: "gap-stale", worktree, root, runId: "r1" });
    assert.equal(r.outcome, "landed", "stale worktree must not break spawn — entry=kernel install location has --mechanical-fan-in (⛔ 改回 opts.worktree ⇒ unknown argument ⇒ parse-mechanical-fan-in red)");
    assert.equal(r.step, null, "no failure step when the kernel entry handles --mechanical-fan-in");
  } finally {
    if (saved === undefined) delete process.env.QUAY_PLUGIN_ROOT;
    else process.env.QUAY_PLUGIN_ROOT = saved;
  }
});

// gap-plugin-root-resolution-remaining-callsites-round2 AC2 负控制：第三方项目（quay-init 布下的面）
// 无 plugin/scripts/*.ts，只有 shipped dist/*.js。spawnMechanicalFanIn 的 worker-driver 自入口经
// kernelSiblingArgv 回退到 dist/worker-driver.js 且不带 --experimental-strip-types（stripTypes=false）。

test("AC2 (gap-plugin-root-resolution-remaining-callsites-round2) — worker-driver 自入口在无 plugin/ 的第三方项目解析到 shipped dist/worker-driver.js（stripTypes=false）", async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "stale-exec-dist-"));
  t.after(() => rmSafe(base));
  const root = path.join(base, "root");
  const worktree = path.join(base, "wt");
  const pluginRoot = path.join(base, "plugin");

  // kernel 安装位置的 bundled dist/worker-driver.js = 当前版（无 import 自足 stub，命中
  // --mechanical-fan-in 即打一行 JSON result 退出）。scripts/*.ts 不放 ⇒ resolveKernelSibling 回退 .js。
  const dist = path.join(pluginRoot, "scripts", "dist");
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, "worker-driver.js"), [
    "// bundled current worker-driver.js: has --mechanical-fan-in argv",
    "const argv = process.argv.slice(2);",
    'if (argv.includes("--mechanical-fan-in")) {',
    '  process.stdout.write(JSON.stringify({ outcome: "landed", step: null, reason: null, verdict: null }) + "\\n");',
    "  process.exit(0);",
    "}",
    "process.exit(2);",
  ].join("\n"), "utf8");

  const saved = process.env.QUAY_PLUGIN_ROOT;
  process.env.QUAY_PLUGIN_ROOT = pluginRoot;
  try {
    const r = await spawnMechanicalFanIn({ task: "gap-stale-dist", worktree, root, runId: "r1" });
    assert.equal(r.outcome, "landed", "worker-driver self-entry resolves to shipped dist/worker-driver.js (stripTypes=false, no --experimental-strip-types)");
    assert.equal(r.step, null, "no failure step when the dist entry handles --mechanical-fan-in");
  } finally {
    if (saved === undefined) delete process.env.QUAY_PLUGIN_ROOT;
    else process.env.QUAY_PLUGIN_ROOT = saved;
  }
});

// ── gap-fan-in-subprocess-hang-timeout-recovery ────────────────────────────────────────────────
// A+B 任务机械 fan-in 持 fan-in.lock 53min 挂死：mechSh 各步有超时、suite 有 silence
// watchdog，仍 53min 无恢复 ⇒ 超时/看门狗有盲区（孙进程持管道 ⇒ close 不触发；suite 未起等槽锁）。
// 修法三件套：AC1 每步 begin/end trace（挂起定位）、AC2 mechSh 进程组 kill + 显式 resolve（超时必达）、
// AC3 suite 看门狗显式 resolve 不依赖 close（等槽锁零输出也 kill）、AC4 挂起 ⇒ 锁必释放（finally）。


/** 建一个 hermetic git repo + task worktree（机械 fan-in 的输入，与 fan-in-driver-mechanical-
 *  orchestration.test.mjs 的 makeRepoWithWorktree 同形——develop 上 ready 任务、task/<id> 分支上
 *  doc-only 实现提交，使 merge/anti-drift/delta/typecheck/scoped/doc 直放行）。返回
 *  { base, repo, worktree, slotBase, capture }。 */

/** 一次机械 fan-in 的标准 opts（fake 命令缝，⛔ 不真跑 19+min 套件）。overrides 覆盖 suite/超时等。 */


test("AC1 (gap-fan-in-subprocess-hang-timeout-recovery) — appendFanInStepTrace 写 step-begin/step-end 到 .quay/fan-in-step-trace.jsonl（挂起 = begin 无 end）", (t) => {
  const root = makeRoot("trace-ac1");
  t.after(() => rmSafe(root));
  appendFanInStepTrace(root, "gap-t", "run-1", "merge-develop", "begin");
  appendFanInStepTrace(root, "gap-t", "run-1", "merge-develop", "end", { ok: true });
  appendFanInStepTrace(root, "gap-t", "run-1", "typecheck", "begin"); // 模拟挂起：无 end
  const lines = fs.readFileSync(path.join(root, ".quay", "fan-in-step-trace.jsonl"), "utf8")
    .trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(lines.length, 3, "begin+end+begin = 3 trace lines");
  assert.equal(lines[0].event, "step-begin");
  assert.equal(lines[0].step, "merge-develop");
  assert.equal(lines[1].event, "step-end");
  assert.equal(lines[1].step, "merge-develop");
  assert.equal(lines[1].ok, true);
  assert.equal(lines[2].step, "typecheck");
  // 挂起定位：typecheck 只有 begin 无 end（⛔ 不可把「无 end」读成「没跑过」，硬规则 3b 可区分）。
  assert.equal(lines.filter((l) => l.step === "typecheck" && l.event === "step-end").length, 0, "a hung step has begin without end");
  assert.ok(Number.isInteger(lines[0].epoch) && lines[0].epoch > 0, "epoch is a sortable second-resolution timestamp");
  assert.equal(lines[0].task, "gap-t");
  assert.equal(lines[0].runId, "run-1");
});


test("AC1 (gap-fan-in-subprocess-hang-timeout-recovery / gap-mech-fan-in-log-webui-visible-clickable) — runMechanicalFanIn 每步都有 begin/end（挂起定位）+ A1 过程日志 trace", () => {
  // gap-arch-worker-fan-in-extract-from-worker-driver：runMechanicalFanIn / step() 已迁 worker-fan-in.ts
  // ⇒ 本结构判据按【代码所在模块】读（判据强度不变，只是换了正本所在文件）。
  const src = fs.readFileSync(FAN_IN, "utf8");
  // mechSh 步经 step() 包层——包层内 appendFanInStepTrace begin/end（挂起 = begin 无 end）+ A1 一行。
  // ⛔ ff 不在其中：P2 (gap-execution-loop-productization-p2-p4) 把 ff 持锁段 TS 模块化（worker-driver
  // import packages/quay/src/fan-in/ff-merge.ts，⛔ 不再 shell-out 到 bash fan-in-ff-merge.sh）——ff 是
  // 直接函数调用非 mechSh 子进程，改走「自定义步 A1 trace」路径（下方第二循环）。
  for (const step of ["merge-develop", "anti-drift", "typecheck", "scoped-gate", "doc-check", "anti-drift-land", "ac-gate"]) {
    assert.ok(src.includes(`step("${step}"`), `step ${step} must go through the step() wrapper (begin/end + A1 trace)`);
  }
  // 自定义步（delta / flip-done / cleanup / ff）写 A1 过程日志 trace。
  for (const step of ["delta", "flip-done", "cleanup", "ff"]) {
    assert.ok(src.includes(`step: "${step}"`), `custom step ${step} must write an A1 trace`);
  }
  // suite 决策事件（ac-precheck / suite-start / suite-end / suite-skip）走 traceSuiteEvent 两路 trace
  // （per-run 过程日志 + 共享 fan-in-step-trace.jsonl——gap-fan-in-step-trace-suite-step-stopped-writing，
  // ⛔ 只写一路 ⇒ 共享读者永久看不到这批步骤）。
  for (const step of ["ac-precheck", "suite-start", "suite-end", "suite-skip"]) {
    assert.ok(src.includes(`traceSuiteEvent("${step}"`), `suite decision ${step} must write via traceSuiteEvent (both carriers)`);
  }
  // step() 包层内 begin/end 两路都写（挂起定位：begin 无 end 可区分）。
  assert.ok(src.includes('appendFanInStepTrace(root, task, runId, name, "begin")'), "step() emits a begin trace");
  assert.ok(src.includes('appendFanInStepTrace(root, task, runId, name, "end"'), "step() emits an end trace");
});
