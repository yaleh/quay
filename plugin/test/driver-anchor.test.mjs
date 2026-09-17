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
  kernelSourceScriptsDir,
  preferredAnchorKernel,
  preferredAnchorKernelIn,
  readAnchorBundleReading,
  rebuildKernelBundle,
  resolveQuayKernelBuildScript,
  sourceFilesMaxMtimeMs,
  sourceWatch,
  supervisorStaleness,
  watchedSourceFiles,
} from "../scripts/driver-runtime.ts";

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

// ── AC1 / AC2 / AC4：收敛 + criterion 逐字 exit 0 + 六心跳仍被写 ──────────────────────────────────

test("AC1/AC2/AC4 — 六个 kind 收进**一个** anchor：去重存活 pid = 1，且 AC-255 的 criterion 逐字 exit 0", async (t) => {
  const root = makeFixture("conv");
  t.after(() => cleanup(root));
  for (const kind of KNOWN_KINDS) {
    const r = kernel(["start", "--kind", kind, "--root", root, "--confirm-timeout", "20"], root);
    assert.equal(r.status, 0, `start --kind ${kind} exits 0 (stderr: ${r.stderr})`);
  }
  // AC1 直接量：**一个**承载进程（anchor），六个 pid 文件全指向它。
  const pids = distinctLiveDriverPids(root);
  assert.equal(pids.size, 1, `exactly ONE live process carries all six loops (got ${[...pids].join(",")})`);
  const anchorPid = anchorPidOf(root);
  assert.equal([...pids][0], anchorPid, "the carrying pid is the anchor's own pid");
  for (const kind of KNOWN_KINDS) {
    const pf = path.join(root, ".quay", `${DRIVER_KINDS[kind].prefix}.pid`);
    assert.ok(fs.existsSync(pf), `${kind}: per-kind pid carrier exists`);
    assert.equal(Number(fs.readFileSync(pf, "utf8").trim()), anchorPid, `${kind}: pid carrier names the anchor`);
  }
  // ⛔ 阶段 C 退役了 supervisor：⛔ 不得残留 supervisor pid 文件（残留会让 aliveness 报 stale_supervisor_pidfile）。
  for (const kind of KNOWN_KINDS) {
    assert.ok(!fs.existsSync(path.join(root, ".quay", `${DRIVER_KINDS[kind].prefix}-supervisor.pid`)), `${kind}: no supervisor pid file`);
  }
  // 一个 OS 进程（直接量）：`ps` 只有 anchor 一行带 driver-anchor。
  // ⛔ 按**本工作区**过滤（`--root <root>`）：宿主上可能还有别的工作区的 anchor（测试并行时尤其），
  // 数它们会把「本工作区收敛成几个进程」这个量污染成机器全局量（硬规则 4b）。
  const ps = spawnSync("bash", ["-c", `ps -eo args | grep -c "[d]river-anchor.ts __anchor --root ${root}"`], { encoding: "utf8" });
  assert.equal(Number(ps.stdout.trim()), 1, `exactly one anchor process carries THIS workspace (ps said ${ps.stdout.trim()})`);

  // AC4：六个 kind 的心跳**都被写过**（产物读数，⛔ 不从「进程在」推导）。
  await waitFor(
    () => KNOWN_KINDS.every((k) => {
      const carrier = DRIVER_KINDS[k].carriers.find((c) => c.endsWith("-round.jsonl")) ?? DRIVER_KINDS[k].carriers[0];
      return fs.existsSync(path.join(root, ".quay", carrier));
    }),
    20_000,
    "all six round heartbeat carriers to exist",
  );

  // AC2：criterion 逐字跑 ⇒ exit 0（两个条件同时成立）。
  const r = runCriterion(root);
  assert.equal(r.code, 0, `AC-255 criterion exits 0 on the converged form (stderr: ${r.stderr})`);
});

// ── AC3：criterion 的两半各自能取假（四个读数） ────────────────────────────────────────────────────

test("AC3① — 心跳半边可取假：停掉一个 kind 的循环并把它的载体推旧到 >60min ⇒ exit 1 且 stderr 报出该 kind；恢复 ⇒ exit 0", async (t) => {
  const root = makeFixture("neg-hb", ["outer", "goal"]);
  t.after(() => cleanup(root));
  assert.equal(kernel(["start", "--kind", "outer", "--root", root, "--confirm-timeout", "20"], root).status, 0, "start outer");
  assert.equal(kernel(["start", "--kind", "goal", "--root", root, "--confirm-timeout", "20"], root).status, 0, "start goal");
  // criterion 要求**六个**载体都在（缺一个 = exit 3 仪器问题）⇒ 补齐另外四个（内容任意，只需有 ts）。
  for (const kind of KNOWN_KINDS) {
    if (kind === "outer" || kind === "goal") continue;
    const carrier = DRIVER_KINDS[kind].carriers.find((c) => c.endsWith("-round.jsonl")) ?? DRIVER_KINDS[kind].carriers[0];
    fs.writeFileSync(path.join(root, ".quay", carrier), JSON.stringify({ ts: new Date().toISOString().slice(0, 19) + "Z" }) + "\n", "utf8");
  }
  await waitFor(() => fs.existsSync(path.join(root, ".quay", "goal-round.jsonl")), 20_000, "goal heartbeat");
  assert.equal(runCriterion(root).code, 0, "baseline: converged + all six fresh ⇒ exit 0");

  // ① 真停掉 goal 的循环（⇒ 它的心跳停写）② 把最后一条 ts 推旧到 61min。
  assert.equal(kernel(["stop", "--kind", "goal", "--root", root], root).status, 0, "stop --kind goal");
  ageCarrier(root, "goal", 61);
  const bad = runCriterion(root);
  assert.equal(bad.code, 1, `stale heartbeat for one kind ⇒ exit 1 (stderr: ${bad.stderr})`);
  assert.match(bad.stderr, /goal/, `stderr names the stalled kind (got: ${bad.stderr})`);
  // ⛔ 命名的是 goal，而 outer 仍新鲜 ⇒ 该读数**区分得出来**（不是一个笼统的「有不新鲜的」）。
  assert.doesNotMatch(bad.stderr, /outer/, `outer is still fresh and must NOT be named (got: ${bad.stderr})`);

  ageCarrier(root, "goal", 0);
  assert.equal(runCriterion(root).code, 0, "restored ⇒ exit 0");
});

test("AC3② — pid 半边可取假：多两个匹配 glob 的**活** pid ⇒ exit 1 且报出正确数；删除 ⇒ exit 0", async (t) => {
  const root = makeFixture("neg-pid", ["outer"]);
  t.after(() => cleanup(root));
  assert.equal(kernel(["start", "--kind", "outer", "--root", root, "--confirm-timeout", "20"], root).status, 0, "start outer");
  for (const kind of KNOWN_KINDS) {
    const carrier = DRIVER_KINDS[kind].carriers.find((c) => c.endsWith("-round.jsonl")) ?? DRIVER_KINDS[kind].carriers[0];
    const p2 = path.join(root, ".quay", carrier);
    if (!fs.existsSync(p2)) fs.writeFileSync(p2, JSON.stringify({ ts: new Date().toISOString().slice(0, 19) + "Z" }) + "\n", "utf8");
  }
  assert.equal(runCriterion(root).code, 0, "baseline: ONE carrying process ⇒ exit 0");

  // 两个**活着的**多余进程，其 pid 记进匹配 `*-driver.pid` 的文件（⛔ 不是「改个文件名」——本控制注入的
  // 是真进程，正是 criterion 该挡的形态）。1 (anchor) + 2 = 3 > 2 ⇒ 必须红。
  const extra = [];
  t.after(() => { for (const c of extra) { try { c.kill("SIGKILL"); } catch { /* gone */ } } });
  for (const n of ["a", "b"]) {
    const child = spawn("sleep", ["60"], { stdio: "ignore" });
    extra.push(child);
    fs.writeFileSync(path.join(root, ".quay", `bogus-${n}-driver.pid`), String(child.pid), "utf8");
  }
  const bad = runCriterion(root);
  assert.equal(bad.code, 1, `a second/third live driver process ⇒ exit 1 (stderr: ${bad.stderr})`);
  assert.match(bad.stderr, /3 LIVE driver process/, `stderr reports the correct count (got: ${bad.stderr})`);

  for (const n of ["a", "b"]) fs.rmSync(path.join(root, ".quay", `bogus-${n}-driver.pid`), { force: true });
  assert.equal(runCriterion(root).code, 0, "removed ⇒ exit 0");
});

// ── AC6：零能力回退 —— 部分停机不波及其余 + 在飞子进程不被杀 ──────────────────────────────────────

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

// ── §6.1：事件循环层的独立错误边界（一个 kind 抛错不带倒其余 kind） ────────────────────────────────

test("§6.1 — 一个 kind 的循环抛错不波及其余 kind（独立错误边界），且重启计数落在 anchor 日志里（⛔ 不静默）", async (t) => {
  const root = makeFixture("boundary", ["outer", "goal"]);
  t.after(() => cleanup(root));
  // goal 的 fake 改成「第一轮就抛」——它的进程内循环必须被 catch 住并重启，而 outer 照常转。
  const goalFile = path.join(root, "plugin", "scripts", DRIVER_KINDS.goal.driver);
  fs.writeFileSync(
    goalFile,
    `export async function main() { throw new Error("boom from the goal loop"); }\n`,
    "utf8",
  );
  assert.equal(kernel(["start", "--kind", "outer", "--root", root, "--confirm-timeout", "20"], root).status, 0, "start outer");
  assert.equal(kernel(["start", "--kind", "goal", "--root", root, "--confirm-timeout", "5"], root).status !== 0, true, "goal never becomes ready");

  const logFile = path.join(root, ".quay", "anchor.log");
  await waitFor(() => fs.existsSync(logFile) && /goal loop THREW/.test(fs.readFileSync(logFile, "utf8")), 20_000, "the goal loop's throw to be logged");
  const log = fs.readFileSync(logFile, "utf8");
  assert.match(log, /goal loop THREW after \d+ms: boom from the goal loop/, "the throw is logged with its message");
  assert.match(log, /event-loop respawn #1/, "a restart COUNT is recorded (⛔ not a silent restart)");
  // outer 的心跳仍在推进 ⇒ 一个 kind 的崩溃没有冻结其余 kind（这就是事件循环层边界买到的那部分隔离）。
  const outerCarrier = path.join(root, ".quay", "outer-round.jsonl");
  const m1 = fs.statSync(outerCarrier).mtimeMs;
  await waitFor(() => fs.statSync(outerCarrier).mtimeMs > m1, 20_000, "outer to keep beating while goal crash-loops");
});

// ── §6.9 不变式 3 的**有界**半边：停机不能无界等待 ──────────────────────────────────────────────
//
// 实测缺陷（2026-09-13，生产 cutover 现场）：worker 的常驻循环要到「在飞全部跑完」才 break，
// 而在飞 worker 的 --timeout 缺省是 0 = **无超时** ⇒「等全部循环收尾」结构上可以无界。一次真实
// SIGTERM 之后 anchor 卡在 stopping 态 10 分钟以上不退出（最后只能 SIGKILL）。本测用「永不返回的
// 循环」把这一态做成确定性的，并断言：超出宽限 ⇒ anchor 如实记一条**并退出**（⛔ 不是静默挂死），
// 且日志说明在飞子进程是独立进程、没有被杀。

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

// ── 双派发硬闸（实测缺陷回归，2026-09-13 生产现场） ─────────────────────────────────────────────
//
// 现场读数：源码自刷新的替换 anchor 等旧 anchor 60s 而旧的**有界停机宽限是 120s** ⇒ 它打印
// 「STILL ALIVE after 60s (starting anyway)」然后**照样起循环** ⇒ 两个 anchor 并发跑同一组六个
// kind 约 3 分钟（双派发）。修法两条：① 等待上限 > 停机宽限；② 到点仍活着 ⇒ 放弃接管。
// 本测钉住的是那条**与等待互补的硬闸**：盘上 anchor.pid 指向一个活着的、不是我自己的进程 ⇒
// 新的 anchor 必须**拒绝起循环**（宁可不起，⛔ 不可两个 anchor 同时派发）。

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

// ── 内核源树 / 陈旧构建产物（gap-ac259-frozen-reading-stale-staging-kernel）──────────────────────────
//
// 缺陷形态（2026-09-15 实测，读生产实时状态）：本仓库自宿主 anchor 的 cmdline 是
//   <repo>/packages/quay/plugin/scripts/dist/driver-anchor.js __anchor --root <repo>
// 而 `packages/quay/plugin/` 是 `package.sh` 的 **pack-time 暂存快照**（gitignored、0 tracked），
// 它的 `.ts` 源在 `<repo>/plugin/scripts/`。旧读法 `sourceFilesMaxMtimeMs` 只 stat **本内核目录**，
// 那里一个 `.ts` 都没有 ⇒ max 恒 0 ⇒「源码从未推进」与「盘上根本没有源」同形（硬规则 3b）⇒
// 07:35 构建的 bundle 上跑着的内核永远不知道自己陈旧（10:17 落地的修复静默不生效），⛔ 且重启也
// 不换版本（重启后 resolveKernelScriptsDir() 还是那个目录）。
//
// 判据（AC3 两臂 + AC4 取假）：`sourceWatch` 三态把该形态报成 **mirror** 并把 mtime/dir 指向**源树**；
// 于是「源树未推进 ⇒ fresh」与「源树已推进 ⇒ stale」给出**相反**的预测，两臂都钉在这里。
// ⛔ 这些是**纯函数/直接 import** 的判据（不经 anchor 子进程）—— 本文件头上的那条已知边界
// （worktree 里 anchor 子进程跑的是主检出那份 kernel）因此**不适用**于本组测试。

/** 造一个「本内核跑在 gitignored 暂存树里」的夹具：
 *    <root>/package.json + scripts/test.sh          ← 夹具是个 git 仓库（mainCheckoutRoot 的前提）
 *    <root>/plugin/scripts/*.ts                     ← **源树**（被监视集齐全）
 *    <root>/plugin/scripts/dist/driver-anchor.js    ← 源树的构建产物（可造得比暂存树新/旧）
 *    <root>/packages/quay/plugin/scripts/…          ← 本内核（暂存树；⛔ 无 .ts）
 *  `QUAY_PLUGIN_ROOT=<root>/packages/quay/plugin` ⇒ `resolveKernelScriptsDir()` 指向暂存树的 scripts。 */
function makeStagingFixture(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `kernelsrc-${tag}-`));
  fs.writeFileSync(path.join(root, "package.json"), "{}\n", "utf8");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "test.sh"), "#!/usr/bin/env bash\n", "utf8");
  const srcScripts = path.join(root, "plugin", "scripts");
  fs.mkdirSync(path.join(srcScripts, "dist"), { recursive: true });
  for (const rel of watchedSourceFiles("promotion")) fs.writeFileSync(path.join(srcScripts, rel), "// src\n", "utf8");
  fs.writeFileSync(path.join(srcScripts, "dist", "driver-anchor.js"), "// built\n", "utf8");
  // 源树 mtime 显式落**过去**（臂 (a) 的基线）：否则刚创建的夹具文件的 mtime 本就晚于本测试进程的
  // 启动时刻 ⇒ 臂 (a) 会（正确地）报 stale，把「源树未推进」那一臂变成空转。
  const past = new Date(Date.now() - 600_000);
  for (const rel of watchedSourceFiles("promotion")) fs.utimesSync(path.join(srcScripts, rel), past, past);
  const stagingScripts = path.join(root, "packages", "quay", "plugin", "scripts");
  fs.mkdirSync(path.join(stagingScripts, "dist"), { recursive: true });
  fs.writeFileSync(path.join(stagingScripts, "dist", "driver-anchor.js"), "// staging\n", "utf8");
  const init = spawnSync("git", ["init", "-q", root], { encoding: "utf8", timeout: 20_000 });
  assert.equal(init.status, 0, `fixture is a git repo (mainCheckoutRoot needs it): ${init.stderr}`);
  return root;
}

/** 在一个临时 QUAY_PLUGIN_ROOT 下跑 fn（`resolveKernelScriptsDir()` 由它决定）。 */
function withPluginRoot(pluginRoot, fn) {
  const saved = process.env.QUAY_PLUGIN_ROOT;
  process.env.QUAY_PLUGIN_ROOT = pluginRoot;
  try { return fn(); } finally {
    if (saved === undefined) delete process.env.QUAY_PLUGIN_ROOT; else process.env.QUAY_PLUGIN_ROOT = saved;
  }
}

test("内核源树两臂对照 — mirror 态比的是【源树】：未推进 ⇒ fresh / 已推进 ⇒ stale（⛔ 只给一臂不算过）", (t) => {
  const root = makeStagingFixture("arms");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const kernelDir = path.join(root, "packages", "quay", "plugin", "scripts");
  const srcScripts = path.join(root, "plugin", "scripts");

  withPluginRoot(path.dirname(kernelDir), () => {
    // ⛔ 取假的正控制：旧读法（只看本内核目录）在这个输入上**恒 0** —— 这正是「未变更」与「无源码」
    // 同形的输入（硬规则 3b）。若有人把 sourceFilesMaxMtimeMs 回退成只看本内核目录，下面的臂 (a)
    // 会变成 0、臂 (b) 会变成 fresh ⇒ 本测红。
    let kernelDirOnlyMax = 0;
    for (const rel of watchedSourceFiles("promotion")) {
      try { kernelDirOnlyMax = Math.max(kernelDirOnlyMax, fs.statSync(path.join(kernelDir, rel)).mtimeMs); } catch { /* absent */ }
    }
    assert.equal(kernelDirOnlyMax, 0, "本内核目录里没有被监视 .ts（构建产物形态）—— 旧读法在这个输入上恒 0");

    assert.equal(kernelSourceScriptsDir(), srcScripts, "源树解析到 <repo>/plugin/scripts（本内核 plugin 树的同名树）");

    // ── 臂 (a)：源树 mtime 早于本进程启动 ⇒ mirror + 真读数 + fresh（⛔ 不报陈旧、不自刷新）──
    const a = sourceWatch(root, "promotion");
    assert.equal(a.state, "mirror", "内核是构建产物而源树在 ⇒ mirror（⛔ 不是 unwatched：那会与「无源可推进」同形）");
    assert.equal(a.dir, srcScripts, "mirror 态把 dir 指向**源树**，⛔ 不是本内核目录");
    assert.ok(a.mtimeMs > 0, "mirror 态给的是真读数（⛔ 不是那个恒 0）");
    assert.equal(sourceFilesMaxMtimeMs(root, "promotion"), a.mtimeMs, "sourceFilesMaxMtimeMs 走同一解析");
    const before = supervisorStaleness(root, "promotion", process.pid);
    assert.equal(before.state, "fresh", `臂 (a) 源树未推进到启动时刻之后 ⇒ fresh: ${JSON.stringify(before)}`);
    assert.equal(before.sourceWatch, "mirror", "陈旧判定同时报出它的输入从哪来（可核，⛔ 不是只给一个布尔）");

    // ── 臂 (b)：只改一处 —— 把源树推到本进程启动时刻之后 ⇒ 预测相反：stale ────────────────────
    const future = new Date(Date.now() + 120_000);
    for (const rel of watchedSourceFiles("promotion")) fs.utimesSync(path.join(srcScripts, rel), future, future);
    const after = supervisorStaleness(root, "promotion", process.pid);
    assert.equal(after.state, "stale", `臂 (b) 源树已推进 ⇒ stale（两臂预测相反 ⇒ 判据能取假）: ${JSON.stringify(after)}`);
    assert.ok(after.sourceMtimeMs > before.sourceMtimeMs, "读数确实变了（⛔ 不是同一个常量被读两次）");
    assert.equal(sourceWatch(root, "promotion").state, "mirror", "态没变，变的是它指向的目录的 mtime");
  });
});

test("内核源树 fail-closed — 盘上没有源树（装好的产物）⇒ unwatched（独立取值，⛔ 与「未变更」同形）", (t) => {
  // 一个**没有**同名 plugin 树的 git 仓库：装好的产物（npm 包 / marketplace cache / 第三方 vendored）
  // 就是这一形。⛔ 不能把「没有源树」读成「源码没推进」—— 两者必须有独立取值（硬规则 3b）。
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kernelsrc-none-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scripts = path.join(root, "packages", "quay", "plugin", "scripts");
  fs.mkdirSync(path.join(scripts, "dist"), { recursive: true });
  fs.writeFileSync(path.join(scripts, "dist", "driver-anchor.js"), "// installed\n", "utf8");
  const init = spawnSync("git", ["init", "-q", root], { encoding: "utf8", timeout: 20_000 });
  assert.equal(init.status, 0, init.stderr);

  withPluginRoot(path.dirname(scripts), () => {
    assert.equal(kernelSourceScriptsDir(), null, "没有同名源树 ⇒ null（fail-closed，⛔ 不把 cwd 当仓库根）");
    const w = sourceWatch(root, "promotion");
    assert.equal(w.state, "unwatched", "无可监视源码是**独立取值**，⛔ 不是 0 冒充的「未变更」");
    assert.equal(w.mtimeMs, 0, "unwatched 的 mtime 是 0，但取值含义由 state 区分");
    const s = supervisorStaleness(root, "promotion", process.pid);
    assert.equal(s.sourceWatch, "unwatched", "陈旧读数把「无源可推进」与「源码未推进」分开报出（硬规则 3b）");
  });
});

test("preferredAnchorKernelIn — 构建产物内核只换到**更新的**源树 bundle（⛔ 不换 raw、⛔ 不换更旧的）", (t) => {
  const root = makeStagingFixture("pref");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stagingScripts = path.join(root, "packages", "quay", "plugin", "scripts");
  const srcScripts = path.join(root, "plugin", "scripts");
  const selfJs = path.join(stagingScripts, "dist", "driver-anchor.js");
  const srcJs = path.join(srcScripts, "dist", "driver-anchor.js");
  // 「本内核目录」= `path.dirname(kernelSelfPath())` = 那份 driver-anchor.js 所在目录（生产形态里是
  // `.../scripts/dist` —— 这正是 preferredAnchorKernel 包装传给判定半边的那个值）。
  const me = path.join(stagingScripts, "dist");
  const old = new Date(Date.now() - 600_000);
  const now = new Date(Date.now() - 1_000);

  // (i) 源树 bundle **更新** ⇒ 换过去（同形态：bundle → bundle，⛔ 不换成 raw driver-anchor.ts）。
  fs.utimesSync(selfJs, old, old);
  fs.utimesSync(srcJs, now, now);
  const toNewer = preferredAnchorKernelIn(me, me, srcScripts);
  assert.equal(toNewer?.path, srcJs, `换到源树那份更新的 bundle: ${JSON.stringify(toNewer)}`);
  assert.equal(toNewer?.stripTypes, false, "同形态（bundle → bundle）：⛔ 不把 bundle 内核悄悄降成 raw");

  // (ii) 源树 bundle **更旧** ⇒ 不换（否则每次 reconcile 都换到同一版 = 重启风暴）。
  fs.utimesSync(selfJs, now, now);
  fs.utimesSync(srcJs, old, old);
  const toOlder = preferredAnchorKernelIn(me, me, srcScripts);
  assert.equal(toOlder?.path, selfJs, `更旧的源树 bundle 不被选（⛔ 防重启风暴）: ${JSON.stringify(toOlder)}`);

  // (iii) 没有源树（装好的产物）⇒ 本内核自己（行为与今天逐字相同）。
  const bare = preferredAnchorKernelIn(me, me, null);
  assert.equal(bare?.path, selfJs, "无源树 ⇒ 仍是本内核自己");
});

// ── 陈旧 bundle 的**动作面**（gap-ac214-sixth-crossing-stale-bundle-detected-but-no-remediation）────────
//
// 缺陷形态（2026-09-17 实测，AC-214 第六次转红的成因）：`bundleStale` 支会**检测**「本内核 bundle 比
// 它的源树旧」并把 `rebuild the bundle to clear this` 写进 anchor 日志（生产 `.quay/anchor.log` 有 ≥3 条
// 带时刻的行），而**全仓没有任何机件执行那个动词** ⇒ 该条件静默 2 天：第五次转红落地的立案步
// （`fileRoutineTask`）在**源**里、不在**跑的那个产物**里 ⇒ 生产载体
// `.quay/routine-findings.jsonl` 的 `kind:"filing-round"` 记录数 = 0。
//
// 判据（双向 + 独立取值，⛔ 只给一臂不算过）：
//   ① 陈旧 ⇒ **机械重建被调用**（不是只打一行日志），且结果落成 `.quay/anchor.json` 的 `bundle.state`
//      独立取值 `stale-rebuilt` / `stale-rebuild-failed`；
//   ② 补救 seam 关掉（kill switch）⇒ 陈旧**仍被报出**（STALE BUNDLE 行在场、取值 `stale-no-action`），
//      ⛔ 不静默降级成 `fresh`；
//   ③ **不陈旧**（bundle 不早于源树）⇒ **不**触发补救（无 marker、state = `fresh`）—— 用于区分
//      「补救在工作」与「恒有输出」；
//   ④ 没有源树（装好的产物）⇒ `resolveQuayKernelBuildScript()` = null + `attempted=false`
//      （fail-closed，⛔ 不把静态产物写成半成品）。

/** 造一个「本内核是**构建产物**、而它的源树在盘上且更旧/更新」的夹具：
 *    <root>/plugin/scripts/*.ts                     ← **源树**（被监视集齐全；镜像态比较的对象）
 *    <root>/staging/plugin/scripts/                 ← 本内核（QUAY_PLUGIN_ROOT；⛔ 目录里一个 .ts 都没有）
 *    <root>/staging/packages/quay/src/              ← resolveQuayCodeRoot 的判据（本内核的代码根）
 *    <root>/staging/packages/quay/scripts/build-plugin-dist.mjs  ← 假构建脚本（写 marker / 可失败）
 *  这是生产形态的逐字镜像：本内核跑 `<repo>/plugin/scripts/dist/*.js`，源树在 `<repo>/plugin/scripts/`。 */
function makeBundleStaleFixture(tag, { sourceNewerThanKernel = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `bundlestale-${tag}-`));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), "{}\n", "utf8");
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "test.sh"), "#!/usr/bin/env bash\n", "utf8");

  // 源树（镜像态比较的对象）：被监视集齐全。
  const srcScripts = path.join(root, "plugin", "scripts");
  fs.mkdirSync(path.join(srcScripts, "dist"), { recursive: true });
  for (const rel of watchedSourceFiles("outer")) fs.writeFileSync(path.join(srcScripts, rel), "// src\n", "utf8");
  // ⚠️ 两臂都必须相对**本内核文件自己的 mtime**（= `kernelBuiltAt` 的直接量，`driver-anchor.ts` 的
  //    `fs.statSync(fileURLToPath(import.meta.url))`）来定，⛔ **不能**相对 `Date.now()`：本夹具的
  //    「本内核」就是 worktree 里那份 `driver-anchor.ts`，它的 mtime 是**检出/最后一次编辑时刻**，
  //    而在套件并行负载下 `Date.now()` 早已推进很多 ⇒ 用「now − 10min」当「更旧」会算出**比内核还新**
  //    的 mtime ⇒ 臂 (b) 静默变成 stale、反例对照空转（实测：单跑绿、scoped 门里 30s 超时）。
  const kernelMtimeMs = fs.statSync(ANCHOR_SCRIPT).mtimeMs;
  const when = new Date(sourceNewerThanKernel ? kernelMtimeMs + 120_000 : kernelMtimeMs - 600_000);
  for (const rel of watchedSourceFiles("outer")) fs.utimesSync(path.join(srcScripts, rel), when, when);

  // 本内核：plugin root 的 basename 与源树同名（`plugin`），才让 kernelSourceScriptsDir 找到源树。
  const kernelScripts = path.join(root, "staging", "plugin", "scripts");
  fs.mkdirSync(path.join(kernelScripts, "dist"), { recursive: true });
  fs.writeFileSync(path.join(kernelScripts, "dist", "driver-anchor.js"), "// built\n", "utf8");

  // 本内核的代码根（resolveQuayCodeRoot 的判据）+ 假构建脚本（**真实路径**，⛔ 不注入测试缝路径）。
  const codeRoot = path.join(root, "staging");
  fs.mkdirSync(path.join(codeRoot, "packages", "quay", "src"), { recursive: true });
  const buildScript = path.join(codeRoot, "packages", "quay", "scripts", "build-plugin-dist.mjs");
  fs.mkdirSync(path.dirname(buildScript), { recursive: true });
  fs.writeFileSync(
    buildScript,
    `import fs from "node:fs";\n` +
    `const marker = process.env.QUAY_FAKE_BUILD_MARKER;\n` +
    `if (marker) fs.appendFileSync(marker, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + "\\n", "utf8");\n` +
    `process.exit(Number(process.env.QUAY_FAKE_BUILD_EXIT ?? "0"));\n`,
    "utf8",
  );
  const init = spawnSync("git", ["init", "-q", root], { encoding: "utf8", timeout: 20_000 });
  assert.equal(init.status, 0, `fixture is a git repo (mainCheckoutRoot needs it): ${init.stderr}`);
  return { root, pluginRoot: path.join(root, "staging", "plugin"), marker: path.join(root, ".quay", "rebuild-marker.txt"), buildScript };
}

/** 直接起一个常驻 anchor（⛔ 不经 `start` CLI 的就绪闸——本组测的是 reconcile 里的判定与动作），
 *  轮询到 `predicate` 成立后停机。
 *
 *  ⚠️ 必须**在它活着的时候**读 `.quay/anchor.json`：正常退出时 anchor 会主动删掉 pid / state 载体
 *  （「已经在跑」与「已经停了」不得同形，硬规则 3b）—— 所以本夹具不能等它退出再读。 */
async function runAnchorUntil(root, pluginRoot, predicate, extraEnv = {}) {
  const child = spawn(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", ANCHOR_SCRIPT, "__anchor", "--root", root,
      "--kinds", "outer", "--reconcile-ms", "150"],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        QUAY_PLUGIN_ROOT: pluginRoot,
        QUAY_ANCHOR_SHUTDOWN_GRACE_MS: "3000",
        // 测试缝：只验「重建发生了」，⛔ 不让它 spawn 一个替换 anchor（那会把夹具的假 driver 当真拉起）。
        QUAY_ANCHOR_BUNDLE_REBUILD_NO_RESTART: "1",
        ...extraEnv,
      },
    },
  );
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += String(d); });
  // ⚠️ 读数必须在**它活着的时候**抓下来：正常退出会删掉 `.quay/anchor.json`（见上）。
  let captured = null;
  try {
    await waitFor(() => { const v = predicate(); if (v) { captured = v; return true; } return false; }, 30_000, "the anchor to publish the expected bundle reading");
  } finally {
    child.kill("SIGTERM");
    await new Promise((r) => {
      const t = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* gone */ } r(); }, 20_000);
      child.on("exit", () => { clearTimeout(t); r(); });
    });
  }
  return { stderr, reading: captured };
}

/** 轮询谓词：`bundle.state` 等于期望值时把**那一份读数**交出来（⛔ 不是事后重读一个已被删的文件）。 */
function bundleStateIs(root, state) {
  return () => {
    const r = readAnchorBundleReading(root);
    return r?.state === state ? r : null;
  };
}

const anchorLogOf = (root) => {
  const p = path.join(root, ".quay", "anchor.log");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
};

test("陈旧 bundle ① — 陈旧且换不动 ⇒ **机械重建被调用**，结果落成 bundle.state 的独立取值", async (t) => {
  const f = makeBundleStaleFixture("stale-rebuilt");
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  // 正控制：这个夹具确实处在「本内核是产物 + 源树更新」的输入上（否则本测会空转）。
  withPluginRoot(f.pluginRoot, () => {
    assert.equal(sourceWatch(f.root, "outer").state, "mirror", "夹具处在 mirror 态（旧读法在这里恒 0）");
    assert.equal(resolveQuayKernelBuildScript(), f.buildScript, "构建脚本解析到**真实推导出的**那个路径（⛔ 不是测试注入的路径）");
  });

  const r = await runAnchorUntil(f.root, f.pluginRoot, bundleStateIs(f.root, "stale-rebuilt"),
    { QUAY_FAKE_BUILD_MARKER: f.marker });
  assert.ok(fs.existsSync(f.marker), `the mechanical rebuild WAS invoked (stderr: ${r.stderr}, log: ${anchorLogOf(f.root)})`);
  const calls = fs.readFileSync(f.marker, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(calls.length, 1, `rebuilt exactly ONCE (冷却生效，⛔ 不是每趟 reconcile 一次): ${JSON.stringify(calls)}`);
  assert.match(calls[0].cwd, /bundlestale-stale-rebuilt-/, "cwd = 源树的仓库根（⛔ 不是 --root 工作区）");

  const log = anchorLogOf(f.root);
  assert.match(log, /bundle rebuild OK in \d+ms/, "重建结果如实落进 anchor 日志");
  assert.match(log, /STALE BUNDLE — source tree is newer than this kernel's build/, "陈旧**仍被报出**（⛔ 检测没有因为有了动作面而消失）");

  const reading = r.reading;
  assert.ok(reading, ".quay/anchor.json 里有结构化的 bundle 读数（⛔ 不再只有一行日志）");
  assert.equal(reading.state, "stale-rebuilt", `陈旧 + 重建成功 = 独立取值 stale-rebuilt: ${JSON.stringify(reading)}`);
  assert.equal(reading.rebuild?.attempted, true, "读数里带着「动作被调用过」");
  assert.equal(reading.rebuild?.ok, true, "读数里带着动作的结果");
  assert.ok(reading.kinds.includes("outer"), "读数点名了参与判定的 kind（⛔ 不是一个笼统的「有陈旧」）");
});

test("陈旧 bundle ② — 补救 seam 关掉 ⇒ 陈旧**仍被报出**（⛔ 不静默降级成 fresh）", async (t) => {
  const f = makeBundleStaleFixture("no-action");
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const r = await runAnchorUntil(f.root, f.pluginRoot, bundleStateIs(f.root, "stale-no-action"),
    { QUAY_ANCHOR_NO_BUNDLE_REBUILD: "1", QUAY_FAKE_BUILD_MARKER: f.marker });
  assert.ok(!fs.existsSync(f.marker), `kill switch ⇒ 构建脚本没有被调用 (stderr: ${r.stderr})`);

  const log = anchorLogOf(f.root);
  assert.match(log, /STALE BUNDLE — source tree is newer than this kernel's build/, "陈旧条件**仍被报出**");
  assert.match(log, /bundle rebuild SKIPPED \(disabled by QUAY_ANCHOR_NO_BUNDLE_REBUILD=1\)/, "跳过原因如实留痕（⛔ 不静默）");

  const reading = r.reading;
  assert.equal(reading?.state, "stale-no-action", `无动作可用是**独立取值**，⛔ 不与 fresh 同形: ${JSON.stringify(reading)}`);
  assert.notEqual(reading?.state, "fresh", "⛔ 补救被关掉**不**等于「不陈旧」");
});

test("陈旧 bundle ③ — 构建失败 ⇒ 独立取值 stale-rebuild-failed（⛔ 不与「无动作」/「新鲜」同形）", async (t) => {
  const f = makeBundleStaleFixture("rebuild-failed");
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const r = await runAnchorUntil(f.root, f.pluginRoot, bundleStateIs(f.root, "stale-rebuild-failed"),
    { QUAY_FAKE_BUILD_MARKER: f.marker, QUAY_FAKE_BUILD_EXIT: "7" });
  assert.ok(fs.existsSync(f.marker), `the rebuild WAS attempted (stderr: ${r.stderr})`);
  const log = anchorLogOf(f.root);
  assert.match(log, /bundle rebuild FAILED in \d+ms .*reason=build script exited 7/, "失败原因（退出码）如实落进日志");
  assert.match(log, /STALE BUNDLE — source tree is newer than this kernel's build/, "失败时陈旧仍被报出");
  const reading = r.reading;
  assert.equal(reading?.state, "stale-rebuild-failed", `试过但失败是**独立取值**: ${JSON.stringify(reading)}`);
});

test("陈旧 bundle ④ — 反例对照：**不陈旧**（源树早于本内核）⇒ 不触发补救，state = fresh", async (t) => {
  const f = makeBundleStaleFixture("fresh", { sourceNewerThanKernel: false });
  t.after(() => fs.rmSync(f.root, { recursive: true, force: true }));
  const r = await runAnchorUntil(f.root, f.pluginRoot, bundleStateIs(f.root, "fresh"),
    { QUAY_FAKE_BUILD_MARKER: f.marker });
  assert.ok(!fs.existsSync(f.marker), `源树更旧 ⇒ 构建脚本**没有**被调用 (stderr: ${r.stderr})`);
  const log = anchorLogOf(f.root);
  assert.doesNotMatch(log, /bundle rebuild/, "⛔ 没有任何重建行（用于区分「补救在工作」与「恒有输出」）");
  assert.doesNotMatch(log, /STALE BUNDLE/, "⛔ 不陈旧就不该报陈旧");
  const reading = r.reading;
  assert.equal(reading?.state, "fresh", `不陈旧 ⇒ fresh: ${JSON.stringify(reading)}`);
});

test("陈旧 bundle ⑤ — 没有源树（装好的产物）⇒ fail-closed：解析不到构建脚本且不冒认「可重建」", (t) => {
  // 装好的产物形态（npm-pack / marketplace cache / 第三方 vendored）：盘上**没有**同名源树。
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bundlestale-nosrc-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scripts = path.join(root, "pkg", "plugin", "scripts");
  fs.mkdirSync(path.join(scripts, "dist"), { recursive: true });
  fs.writeFileSync(path.join(scripts, "dist", "driver-anchor.js"), "// installed\n", "utf8");
  fs.mkdirSync(path.join(root, "pkg", "packages", "quay", "src"), { recursive: true });
  const init = spawnSync("git", ["init", "-q", root], { encoding: "utf8", timeout: 20_000 });
  assert.equal(init.status, 0, init.stderr);

  withPluginRoot(path.join(root, "pkg", "plugin"), () => {
    assert.equal(kernelSourceScriptsDir(), null, "没有源树 ⇒ null（fail-closed）");
    assert.equal(resolveQuayKernelBuildScript(), null, "没有源树 ⇒ 不给构建脚本（⛔ 不把静态产物当真源树重建）");
    const r = rebuildKernelBundle();
    assert.equal(r.attempted, false, `attempted=false（⛔ 不是 attempted-but-failed）: ${JSON.stringify(r)}`);
    assert.match(r.reason ?? "", /no plugin-dist build script|no source tree/, "失败原因可诊断");
  });
});
