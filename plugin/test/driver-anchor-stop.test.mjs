// @test-group engine

// driver-anchor-stop.test.mjs — the STOPPING half of the driver-anchor contract, split out of

// driver-anchor.test.mjs by FUNCTIONAL BOUNDARY (gap-ac281-develop-ci-test-job-wallclock-under-30s).

//

// WHY SPLIT: `node --test` parallelises only ACROSS files — inside one file every test() is serial, so a

// file is the smallest schedulable unit and therefore the suite's floor. The parent file measured 22.3 s on

// the real CI run (35290919973 `__PERFILE__`), still above the ~20 s band the AC-281 target needs.

// Raising concurrency cannot help (LPT simulation: makespan == longest file at 64/128/256/512 alike).

//

// ⛔ SPLIT BY BOUNDARY, NOT BY HALVING A TEST: every test here is about what happens when an anchor is

// asked to STOP — `stop --kind X` must not disturb the other kinds or kill X's in-flight children; a loop

// that ignores the stop must not hang the anchor for ever; and a second dispatch must refuse to start a

// second anchor. The kept file holds the convergence / criterion / error-boundary half. The two share NO

// mutable state (each builds its own tmp fixture and its own anchor process), so parallel and serial runs

// give byte-identical verdicts.

//

// Run:

//   node --test plugin/test/driver-anchor-stop.test.mjs

// driver-anchor.test.mjs — GOAL-017/AC-255（SPEC-unified-quay-server §7 阶段 C + §6.1 + §6.9 + §6.10）。
//
// 本文件覆盖的是**生产默认路径**（单进程 anchor 承载六个 kind 的常驻循环）。
// ⚠️ 与之成对的是 plugin/test/driver-runtime.test.mjs —— 那个文件显式钉住 `QUAY_DRIVER_LEGACY_SUPERVISOR=1`
// 测**被保留为可回退形态**的多进程 supervisor 路径。⛔ 只看任一个都不是完整覆盖。
//
// 判据（逐条可取假）：
//   AC1  收敛直接量：承载 kind 循环的长驻进程数 = **1**（`ps` 直接量，⛔ 不是「pid 文件数」）；
//        六个 `.quay/<prefix>.pid` 都指向**同一个** pid ⇒ criterion 的去重计数 = 1。
//   AC2  AC-255 的 criterion 逐字 exit 0（两个条件同时成立）——判据从 goals/ 文件里**读出来跑**，
//        ⛔ 不在这里手抄一份（两份 = 漂移；判据的正本只有 goals/AC-255-*.md 一处）。
//   AC3  负控制两半各自取假：① 心跳停摆/推旧 ⇒ exit 1 且报出该 kind 名；② 多一个匹配 glob 的活 pid
//        ⇒ exit 1 且报出正确文件数。
//   AC4  六心跳在收敛后仍被写（产物读数，⛔ 不从「进程在」推导）。
//   AC6  `stop --kind X` **只停 X**：其余 kind 的 round 心跳不中断（§6.9 不变式 2），且 X 的在飞子进程
//        不被杀（§6.9 不变式 3）。
//   §6.10 anchor 崩溃 ⇒ 六个 kind 一起没；anchor 里**单个 kind 的循环抛错** ⇒ 不波及其余 kind
//        （事件循环层独立错误边界 + 重启计数，见 anchor 日志）。

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import yaml from "yaml";
import {
  DRIVER_KINDS,
  KNOWN_KINDS,
  preferredAnchorKernel,
  writeDesired,
} from "../scripts/driver-runtime.ts";
// ⚠️ 本文件**只剩** anchor 进程边界那半边（收敛 / 心跳判据 / stop --kind / 崩溃边界 / 双派发硬闸）。
//    「内核源树 + 陈旧 bundle 动作面」那 8 个 test() 已按功能边界拆到 `driver-anchor-bundle.test.mjs`
//    （gap-ac281-develop-ci-test-job-wallclock-under-30s：`node --test` 只在文件之间并行，单文件 43.1s
//    的地板抬并发无解，只能拆文件）。⛔ 两个文件合起来才是这块的完整覆盖，只看任一个都不是。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const KERNEL = path.join(REPO_ROOT, "plugin", "scripts", "driver-runtime.ts");
const ANCHOR_SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "driver-anchor.ts");

// ── 夹具的 fake driver 必须与 anchor **进程实际加载的那一份** kernel 同源 ──────────────────────────
//
// anchor 进程经 preferredAnchorKernel() 解析要跑的内核：**优先主检出**（AC-184/AC-255：常驻 anchor 的
// 生存期⛔ 不绑在短命 worktree 路径上 —— 见 driver-runtime.ts 的 preferredAnchorKernel 注释）。
// 而 `registerKindStop` / `requestKindStop` 的停机登记表是**模块级**的（driver-anchor.ts 头注释：
// 「在本进程里只有一个模块实例，登记表才与各 kind 看到的是同一张」）。
//
// ⇒ 从 worktree 里跑本文件时，anchor 跑主检出那份、夹具若 import worktree 那份 ⇒ **两张独立的登记表**
//   ⇒ `requestKindStop(kind)` 置的不是夹具那个 kind 读的那个标志 ⇒ `stop --kind X` 永远等不到该 kind
//   收尾，等满 60s 后 exit 1（与「该 kind 的循环真的挂了」**同形**，但真因是夹具自造的）。
//   实测对照（同一棵树，只改这一行 import）：import worktree 那份 ⇒ stop 60543ms / exit 1；
//   import 主检出那份 ⇒ stop 1099ms / exit 0。
//
// ⚠️ 已知边界（如实标注，⛔ 不伪装成全测）：本文件因此验的是**anchor 实际加载的那份**内核 ——
//   在 worktree 里就 = 主检出那份 ⇒ **worktree 中对 anchor 内核本身的改动不会被本文件验到**
//   （driver-runtime.ts 已明记该形态「结构上无法自测」）。这是形态的性质，⛔ 不是夹具能绕开的。
//   ✅ **一个例外，且只对下面 AC1/AC2 成立**：那两条**不经** `kernel()`/driver-runtime 解析，而是起一个
//   harness 直接 `import` 本文件的 `ANCHOR_SCRIPT`（= 本 worktree 那份）⇒ 它们验的**就是**本 worktree
//   的 driver-anchor.ts。`preferredAnchorKernel` 那条边界对它们不适用（代价：它们测的是一个**注入
//   invokeKind** 的 anchor，⛔ 不是一份真 driver；真 driver 的进程边界仍由上面那些 test 覆盖）。
const _anchorKernel = preferredAnchorKernel();
assert.ok(
  _anchorKernel,
  "preferredAnchorKernel() resolves — 取不到 ⇒ anchor 的 start/stop 语义无从测起（⛔ 不静默回退到一个自造的路径）",
);
const DRIVER_RUNTIME_ABS = path.join(
  path.dirname(_anchorKernel.path),
  _anchorKernel.stripTypes ? "driver-runtime.ts" : "driver-runtime.js",
);
assert.ok(
  fs.existsSync(DRIVER_RUNTIME_ABS),
  `夹具的 fake driver 必须 import anchor 自己那份 runtime（${DRIVER_RUNTIME_ABS}）—— 否则停机登记表分裂`,
);

// ── 夹具 ───────────────────────────────────────────────────────────────────────────────────────────
//
// 一个 fake driver：导出 `main(argv)`（⇒ anchor 经**既有入口**在进程内调用它，与真实 kind 同一条码路），
// 自写 `--pid-file`（pidSelf 语义：写者是驱动自己），并按 interval 追写 round 心跳载体，直到 anchor
// 经 `requestKindStop` 请求它停机。⛔ 它刻意**不**实现任何派发逻辑——本文件测的是进程边界，不是判定。
function fakeDriverSource(kind) {
  const spec = DRIVER_KINDS[kind];
  const carrier = spec.carriers.find((c) => c.endsWith("-round.jsonl")) ?? spec.carriers[0];
  return `import fs from "node:fs";
import path from "node:path";
import { registerKindStop } from ${JSON.stringify(DRIVER_RUNTIME_ABS)};

export async function main(argv) {
  const args = argv.slice(2);
  const get = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const root = get("--root");
  const pidFile = get("--pid-file");
  const interval = Number(get("--interval") ?? 150);
  if (pidFile) fs.writeFileSync(pidFile, String(process.pid) + "\\n", "utf8");
  // §6.9 不变式 3 的观测点：本 kind 若有"在飞子进程"，它必须活过 stop。夹具里由 env 传一个命令。
  if (process.env.FAKE_CHILD_CMD) {
    const { spawn } = await import("node:child_process");
    const child = spawn(process.env.FAKE_CHILD_CMD, { shell: true, stdio: "ignore", detached: false });
    fs.writeFileSync(path.join(root, ".quay", ${JSON.stringify(kind)} + "-child.pid"), String(child.pid), "utf8");
  }
  const ctl = registerKindStop(${JSON.stringify(kind)});
  const file = path.join(root, ".quay", ${JSON.stringify(carrier)});
  // FAKE_IGNORE_STOP=1 ⇒ 循环**不响应**停机（模拟「在飞 worker 无超时」那种无界收尾），用来把
  // anchor 的有界停机宽限做成确定性的。
  const ignoreStop = process.env.FAKE_IGNORE_STOP === "1";
  let round = 0;
  while (ignoreStop || !ctl.requested()) {
    round += 1;
    try { fs.appendFileSync(file, JSON.stringify({ round, ts: new Date().toISOString().slice(0, 19) + "Z", pid: process.pid }) + "\\n"); } catch {}
    await new Promise((r) => setTimeout(r, interval));
  }
  return 0;
}
`;
}

function makeFixture(tag, kinds = KNOWN_KINDS) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `anchor-${tag}-`));
  const scripts = path.join(root, "plugin", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  for (const kind of kinds) fs.writeFileSync(path.join(scripts, DRIVER_KINDS[kind].driver), fakeDriverSource(kind), "utf8");
  return root;
}

/** 跑 `quay driver <verb>` —— 直接跑内核（内核就是 CLI 的真正实现入口，`cli/driver.ts` 是薄壳）。 */
function kernel(args, root, extraEnv = {}) {
  return spawnSync(process.execPath, ["--no-warnings", "--experimental-strip-types", KERNEL, ...args], {
    encoding: "utf8",
    // QUAY_ANCHOR_SHUTDOWN_GRACE_MS 缺省 120s（生产值）——测试缝调小，使有界停机在测试里是确定性的。
    env: { ...process.env, QUAY_PLUGIN_ROOT: path.join(root, "plugin"), QUAY_ANCHOR_SHUTDOWN_GRACE_MS: "3000", ...extraEnv },
    timeout: 60_000,
  });
}

function anchorPidOf(root) {
  const p = path.join(root, ".quay", "anchor.pid");
  return fs.existsSync(p) ? Number(fs.readFileSync(p, "utf8").trim()) : null;
}

function killAnchor(root) {
  const pid = anchorPidOf(root);
  if (pid) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
}

/** 六个 kind 的存活进程数（**直接量**：读每个 `.quay/<prefix>.pid` 的内容再 `kill -0`，按 pid 去重）。
 *  这正是 AC-255 的 criterion 数的那一个量，⛔ 不是「有几个 pid 文件」。 */
function distinctLiveDriverPids(root) {
  const seen = new Set();
  for (const kind of KNOWN_KINDS) {
    const p = path.join(root, ".quay", `${DRIVER_KINDS[kind].prefix}.pid`);
    if (!fs.existsSync(p)) continue;
    const pid = Number(fs.readFileSync(p, "utf8").trim());
    if (!Number.isInteger(pid)) continue;
    try { process.kill(pid, 0); seen.add(pid); } catch { /* dead */ }
  }
  return seen;
}

// ── AC-255 的 criterion：从 goals/ 文件里读出来跑（⛔ 不手抄一份） ────────────────────────────────────
function loadCriterion() {
  const dir = path.join(REPO_ROOT, "goals");
  const file = fs.readdirSync(dir).find((f) => f.startsWith("AC-255-"));
  assert.ok(file, "goals/AC-255-*.md exists (the criterion's single source of truth)");
  // 目标文件是 frontmatter 文档（`---` 包裹）——取**第一份**文档，⛔ 不让结尾的 `---` 把 parse 变成多文档。
  const raw = fs.readFileSync(path.join(dir, file), "utf8");
  const lines = raw.split("\n");
  assert.equal(lines[0].trim(), "---", "the goal file opens with a frontmatter fence");
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
  assert.ok(end > 0, "the goal file closes the frontmatter fence");
  const doc = yaml.parse(lines.slice(1, end).join("\n"));
  assert.equal(doc.id, "AC-255");
  assert.equal(typeof doc.criterion, "string");
  return doc.criterion;
}

/** 逐字跑 criterion：**整段 shell 片段原样交给 bash**（criterion 正文本来就是 `python3 - <<'P' … P`
 *  的 shell 片段），cwd = 被测工作区（criterion 用相对 `.quay/` 路径，与生产一致）。⛔ 不剥壳、不重写。 */
function runCriterion(root) {
  const r = spawnSync("bash", ["-c", loadCriterion()], { encoding: "utf8", cwd: root, timeout: 60_000 });
  return { code: r.status, stderr: r.stderr ?? "", stdout: r.stdout ?? "" };
}

/** 把某 kind 的心跳载体推旧到指定分钟前（负控制用；改写最后一条记录的 ts，⛔ 不是 touch mtime
 *  ——criterion 读的是**最后一条记录的 ts**，mtime 推旧对它无效，那正是它的设计）。 */
function ageCarrier(root, kind, minutes) {
  const carrier = DRIVER_KINDS[kind].carriers.find((c) => c.endsWith("-round.jsonl")) ?? DRIVER_KINDS[kind].carriers[0];
  const file = path.join(root, ".quay", carrier);
  const lines = fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "");
  const last = JSON.parse(lines[lines.length - 1]);
  last.ts = new Date(Date.now() - minutes * 60_000).toISOString().slice(0, 19) + "Z";
  lines[lines.length - 1] = JSON.stringify(last);
  fs.writeFileSync(file, lines.join("\n") + "\n", "utf8");
}

async function waitFor(fn, ms, what) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${what}`);
}

function cleanup(root) {
  killAnchor(root);
  // 夹具的 fake 子进程（FAKE_CHILD_CMD）也一并收掉，⛔ 不留孤儿。
  const childPidFile = path.join(root, ".quay", "worker-child.pid");
  if (fs.existsSync(childPidFile)) {
    const pid = Number(fs.readFileSync(childPidFile, "utf8").trim());
    if (Number.isInteger(pid)) { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } }
  }
  fs.rmSync(root, { recursive: true, force: true });
}

// ── AC1/AC2：停机后⛔ 不得再把 kind 拉起来（D1，gap-driver-anchor-self-refresh-leaves-no-anchor-alive）──
//
// ⚠️ 这两条⛔ **不能**走本文件上面的 `makeFixture` + `kernel()`：那一路经 driver-runtime 的
//    `preferredAnchorKernel()` 解析要跑的 anchor 内核，而它**优先主检出**（见文件头 :92-94 的已知边界）
//    ⇒ **worktree 里对 `driver-anchor.ts` 的改动结构上验不到**，而 D1 的闸就写在 `driver-anchor.ts` 里。
//    ⇒ 必须让 anchor 真的加载**本 worktree 那一份**：直接起 `ANCHOR_SCRIPT`。
//    而 `invokeKind` 是 `runAnchor()` 的**进程内**缝（AnchorOptions）⇒ 由一个一次性的 harness 注入：
//    harness import 本 worktree 的 driver-anchor.ts 并调 runAnchor({invokeKind})；测试把 SIGTERM 发给
//    harness —— **真进程上的真停机信号**，与生产同一条码路（⛔ 不是给测试加的停机缝）。
//    注入的循环**立刻返回** ⇒ 「事件循环层 respawn」与「reconcile 起分支」两条重启路径都可被逐条数出。

/** 写一个注入 `invokeKind` 的 harness（见上）。每次调用追写 `.quay/invoke.jsonl`（**直接量**：
 *  「循环还在被调用吗」不靠日志解析）。 */
function writeAnchorHarness(root, kinds) {
  const file = path.join(root, "anchor-harness.mjs");
  fs.writeFileSync(
    file,
    `import fs from "node:fs";
import path from "node:path";
import { runAnchor } from ${JSON.stringify(ANCHOR_SCRIPT)};

const root = process.argv[2];
const invokes = path.join(root, ".quay", "invoke.jsonl");
await runAnchor({
  root,
  kinds: ${JSON.stringify(kinds)},
  reconcileMs: 30,
  restartDelaySecs: 1, // 事件循环层 respawn 的退避基准（代码里下限就是 1s）
  logFile: path.join(root, ".quay", "anchor.log"),
  invokeKind: async (kind) => {
    fs.appendFileSync(invokes, JSON.stringify({ kind, pid: process.pid, at: Date.now() }) + "\\n");
    return 0; // ⛔ 立刻返回：循环体结束 ⇒ 走 respawn 分支（这正是要观测的两条重启路径之一）
  },
});
`,
    "utf8",
  );
  return { file, invokes: path.join(root, ".quay", "invoke.jsonl") };
}

/** harness 的夹具根：只有 `.quay/`（anchor 自己会建）+ 一个**空的** plugin/scripts。
 *  ⚠️ QUAY_PLUGIN_ROOT 指到那个空目录 ⇒ `sourceWatch().state === "unwatched"` ⇒ 自刷新的两条支路
 *  （stale / bundleStale）都不成立 —— 本组测停机，⛔ 不让它顺带重启自己。 */
function makeHarnessRoot(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `anchor-${tag}-`));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.mkdirSync(path.join(root, "plugin", "scripts"), { recursive: true });
  return root;
}

function startHarness(root, harnessFile) {
  return spawn(process.execPath, ["--no-warnings", "--experimental-strip-types", harnessFile, root], {
    stdio: ["ignore", "ignore", "pipe"],
    env: {
      ...process.env,
      QUAY_PLUGIN_ROOT: path.join(root, "plugin"),
      // 有界停机宽限调小（测试缝）：RED 形态下 anchor 的唯一出口是它，60000ms 会让本测慢到没法跑。
      QUAY_ANCHOR_SHUTDOWN_GRACE_MS: "2000",
    },
  });
}

const anchorLogOf = (root) => {
  const p = path.join(root, ".quay", "anchor.log");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
};

/** 日志里**最后一次** `stop requested` 之后的全部内容（未出现 ⇒ null）。 */
function afterStopRequested(log) {
  const i = log.lastIndexOf("stop requested");
  return i < 0 ? null : log.slice(i);
}

const countIn = (s, re) => (s.match(re) ?? []).length;
const invokeCount = (file) => (fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter((l) => l.trim() !== "").length : 0);

test("AC1 (D1) — stop 请求之后 reconcile ⛔ 不再拉起任何 kind（修复前：起分支无 `!stopping` 闸 ⇒ 停完下一趟就重起，宽限成了唯一出口）", async (t) => {
  const root = makeHarnessRoot("d1-stop");
  const { file, invokes } = writeAnchorHarness(root, ["outer", "goal"]);
  const child = startHarness(root, file);
  t.after(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } fs.rmSync(root, { recursive: true, force: true }); });

  // 正控制①：停机之前两个 kind 都真的起过、且**只起一次**（幂等；⛔ 否则下面的负断言可能因为「压根没跑到」而空过）。
  await waitFor(() => countIn(anchorLogOf(root), /loop started/g) >= 2, 20_000, "both kinds to start");
  assert.equal(countIn(anchorLogOf(root), /loop started/g), 2, "两个 kind 各起一次（幂等：已在 active 的不重起）");
  // 等到事件循环层 respawn 至少发生过一次 ⇒ 此刻 SIGTERM 处理器**一定**已注册、anchor 已完全进入常驻循环
  // （处理器在初始 startKindTask 之后注册，只等 "loop started" 会撞上一个极窄的窗口）。
  await waitFor(() => /event-loop respawn #1/.test(anchorLogOf(root)), 20_000, "the anchor to be fully inside its resident loop");

  child.kill("SIGTERM");
  await waitFor(() => afterStopRequested(anchorLogOf(root)) !== null, 20_000, "the stop request to be logged");
  // 正控制②：循环**确实收尾过**——否则「停后没有 loop started」是一句空话（什么都没停，就没得重起）。
  await waitFor(() => afterStopRequested(anchorLogOf(root)).includes("loop stopped"), 20_000, "the loops to actually drain after the stop");
  const drainedInvokes = invokeCount(invokes);
  // 给足时间：≥60 趟 reconcile（30ms/趟）+ 一次 respawn 退避（1s）。修复前，收尾后的**下一趟**就会重起
  // （`wanted` 仍是盘上期望态，它不看 `stopping`）。
  await new Promise((r) => setTimeout(r, 2500));

  const after = afterStopRequested(anchorLogOf(root));
  assert.ok(after !== null, "stop-requested 标记在场");
  assert.ok(after.includes("loop stopped"), "收尾本身发生了（⛔ 负断言不是空过）");
  const restarted = after.split("\n").filter((l) => l.includes("loop started"));
  assert.equal(
    restarted.length,
    0,
    `stop 请求之后⛔ 不得再出现 loop started（实得 ${restarted.length} 条）:\n${restarted.join("\n")}`,
  );
  assert.equal(countIn(after, /restarting in \d+ms/g), 0, "停机后连事件循环层 respawn 也不该有");
  // 直接量：注入的循环**没有再被调用**（⛔ 不靠日志解析——那是代理量）。
  assert.equal(invokeCount(invokes), drainedInvokes, `停机后循环⛔ 不得再被调用（invoke.jsonl ${drainedInvokes} → ${invokeCount(invokes)}）`);
});

test("AC2 (D1 负控制) — ⛔ 没有 stop 时两条重启路径都仍在：循环返回 ⇒ respawn；期望态后加的 kind ⇒ reconcile 起它", async (t) => {
  const root = makeHarnessRoot("d1-nostop");
  const { file, invokes } = writeAnchorHarness(root, ["outer"]);
  const child = startHarness(root, file);
  t.after(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } fs.rmSync(root, { recursive: true, force: true }); });

  // (a) 事件循环层 respawn：循环体立刻返回，同一 kind 被**再次**调用。这条路径⛔ 不受 D1 影响
  //     （D1 只挡 `stopping` 之后的**起**），修闸时⛔ 不得把它一起关掉。
  await waitFor(
    () => fs.existsSync(invokes) && fs.readFileSync(invokes, "utf8").split("\n").filter((l) => l.includes('"outer"')).length >= 2,
    20_000,
    "the outer loop to be respawned at the event-loop level",
  );
  assert.match(anchorLogOf(root), /event-loop respawn #\d+/, "respawn 计数落在日志里（⛔ 不静默）");

  // (b) reconcile 的**起分支**：把一个 kind 后加进期望态（**全程没有 stop 请求**）⇒ 它必须被拉起。
  //     这正是那道 `!stopping` 闸的负控制：闸只能挡停机后的起，⛔ 不能挡正常态下的起。
  writeDesired(root, ["outer", "goal"], "test:d1-negative-control");
  await waitFor(() => /kind=goal loop started/.test(anchorLogOf(root)), 20_000, "reconcile to start the newly-desired kind");
  assert.ok(!anchorLogOf(root).includes("stop requested"), "全程没有停机请求（否则这条负控制测的就不是正常态）");
});

// ── AC1 / AC2 / AC4：收敛 + criterion 逐字 exit 0 + 六心跳仍被写 ──────────────────────────────────


test("AC6 — `stop --kind X` 只停 X：其余 kind 的心跳不中断（§6.9 不变式 2），且 X 的在飞子进程不被杀（不变式 3）", async (t) => {
  const root = makeFixture("partial");
  t.after(() => cleanup(root));
  // ⚠️ worker **先**起：anchor 进程的 env 在它被 spawn 的那一刻固定，之后再 start 别的 kind 不会重新读
  // env ⇒ 夹具的在飞子进程钩子（FAKE_CHILD_CMD）必须挂在**拉起 anchor 的那一次** start 上。
  assert.equal(
    kernel(["start", "--kind", "worker", "--root", root, "--confirm-timeout", "20"], root, { FAKE_CHILD_CMD: "sleep 120" }).status,
    0,
    "start worker (spawns the anchor, carrying the in-flight-child hook)",
  );
  for (const kind of KNOWN_KINDS) {
    if (kind === "worker") continue;
    assert.equal(kernel(["start", "--kind", kind, "--root", root, "--confirm-timeout", "20"], root).status, 0, `start ${kind}`);
  }
  const carrierOf = (k) => {
    const c = DRIVER_KINDS[k].carriers.find((x) => x.endsWith("-round.jsonl")) ?? DRIVER_KINDS[k].carriers[0];
    return path.join(root, ".quay", c);
  };
  const mtimeOf = (k) => fs.statSync(carrierOf(k)).mtimeMs;
  const childPidFile = path.join(root, ".quay", "worker-child.pid");
  await waitFor(() => fs.existsSync(childPidFile), 20_000, "the worker's in-flight child pid file");
  const childPid = Number(fs.readFileSync(childPidFile, "utf8").trim());
  assert.ok(Number.isInteger(childPid) && childPid > 0, "in-flight child pid recorded");
  const others = ["outer", "goal", "quality", "meta", "promotion"];
  const before = Object.fromEntries(others.map((k) => [k, mtimeOf(k)]));

  assert.equal(kernel(["stop", "--kind", "worker", "--root", root], root).status, 0, "stop --kind worker");

  // 不变式 3：杀的是调度者，⛔ 不是它在跑的工作。
  assert.doesNotThrow(() => process.kill(childPid, 0), "the in-flight worker child SURVIVES `stop --kind worker`");
  // 不变式 2：其余五个 kind 的循环没有被打断（它们的载体继续被写）。
  await waitFor(() => others.every((k) => mtimeOf(k) > before[k]), 20_000, "the other five kinds' heartbeats to keep advancing");
  // 而且它们仍由**同一个** anchor 承载（⛔ 不是「anchor 被杀了、别的 kind 也一起没了」）。
  assert.equal(distinctLiveDriverPids(root).size, 1, "still exactly one carrying process after the partial stop");
});

test("§6.9 inv.3（有界半边）— 循环不响应停机 ⇒ anchor 在停机宽限后如实记一条并退出（⛔ 不无界挂死）", async (t) => {
  const root = makeFixture("bounded-stop", ["outer"]);
  t.after(() => cleanup(root));
  assert.equal(
    kernel(["start", "--kind", "outer", "--root", root, "--confirm-timeout", "20"], root, { FAKE_IGNORE_STOP: "1" }).status,
    0,
    "start outer (its loop will ignore the stop signal)",
  );
  const anchorPid = anchorPidOf(root);
  assert.ok(anchorPid, "anchor pid recorded");
  // 让 anchored 的循环永不返回（模拟「在飞 worker 无超时」）：直接 SIGTERM 给 anchor 的**停机宽限**路径。
  process.kill(anchorPid, "SIGTERM");
  const logFile = path.join(root, ".quay", "anchor.log");
  // 宽限 3s（测试缝），断言：宽限之内 anchor 仍在；超宽限后它退出且日志里那句话在场。
  const ok = await (async () => {
    const deadline = Date.now() + 40_000;
    while (Date.now() < deadline) {
      const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
      if (/shutdown grace .* exceeded with loop\(s\) still draining/.test(log)) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  })();
  assert.ok(ok, "the anchor LOGS a bounded-shutdown line when a loop outlives the grace window");
  const log = fs.readFileSync(logFile, "utf8");
  assert.match(log, /independent OS processes and are NOT killed/, "the log states the in-flight children are not killed");
  await waitFor(() => { try { process.kill(anchorPid, 0); return false; } catch { return true; } }, 30_000, "the anchor to exit");
});

test("双派发硬闸 — 盘上已有活 anchor（不是我）⇒ 第二个 anchor 拒绝起循环并留痕", async (t) => {
  const root = makeFixture("dup-guard", ["outer"]);
  t.after(() => cleanup(root));
  assert.equal(kernel(["start", "--kind", "outer", "--root", root, "--confirm-timeout", "20"], root).status, 0, "first anchor starts");
  const first = anchorPidOf(root);
  const carrier = path.join(root, ".quay", "outer-round.jsonl");
  const before = fs.statSync(carrier).mtimeMs;

  // 直接起第二个 anchor（同 root，⛔ 不带 --takeover —— 模拟「两条起法撞在一起」）。
  const second = spawnSync(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", ANCHOR_SCRIPT, "__anchor", "--root", root, "--kinds", "outer"],
    {
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, QUAY_PLUGIN_ROOT: path.join(root, "plugin"), QUAY_ANCHOR_SHUTDOWN_GRACE_MS: "3000" },
    },
  );
  assert.equal(second.status, 1, `the second anchor refuses (got status ${second.status}, stderr ${second.stderr})`);
  const log = fs.readFileSync(path.join(root, ".quay", "anchor.log"), "utf8");
  assert.match(log, /another anchor is live \(pid=\d+/, "the refusal is logged with the incumbent pid (⛔ not silent)");
  // 原 anchor 的循环不受影响（⛔ 第二个进程没有抢走它）。
  assert.equal(anchorPidOf(root), first, "the incumbent still owns anchor.pid");
  await waitFor(() => fs.statSync(carrier).mtimeMs > before, 20_000, "the incumbent's loop to keep beating");
});
