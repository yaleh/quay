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
import { DRIVER_KINDS, KNOWN_KINDS } from "../scripts/driver-runtime.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const KERNEL = path.join(REPO_ROOT, "plugin", "scripts", "driver-runtime.ts");
const DRIVER_RUNTIME_ABS = path.join(REPO_ROOT, "plugin", "scripts", "driver-runtime.ts");

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
