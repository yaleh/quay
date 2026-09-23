// @test-group engine

// anchor-state-atomicity.test.mjs — gap-anchor-state-nonatomic-and-declaration-outruns-log：
// `driver-anchor` 的**同趟一致性**（M1）与 `writeState()` 的**原子性**（M2）两个机制，各自能取假。
//
// ── M1（同趟一致性）：一趟 reconcile 里期望态被读了**三次**，三次之间可以变 ──────────────────────
//
// 修前 `driver-anchor.ts` 的一趟 reconcile 里：
//   ① `const wanted = readDesired(root)?.kinds ?? []`            （趟首快照）
//   ② `undeclaredKinds(root)`  → 内部**重新读盘**，再用**陈旧的 `wanted`** 过滤
//   ③ `writeState()` → `kindDeclarationMap(root)` → **第三次**读盘
// 期望态恰好落在 ① 与 ② 之间（`writeDesired` 是 tmp+rename 原子写 ⇒ 只会读到完整的新集合）时，
// 这一趟就**发布 `not-declared` 而 `silent` 为空 ⇒ 不打那行日志**，那行落到**下一趟**
// （≤1 个 reconcile 周期）。⇒ 「同一趟发布的 declaration」与「同一趟的那行日志」不同现。
//
// 为什么只在全量 suite 下红：窗口 = ① 与 ② 之间那段**同步体**（正常只有 µs），要靠宿主负载
// （96 路 CPU burner ⇒ 本进程被抢占）把它放大到 ms 级才够撞上。单跑该文件 12/12 绿。
// 本文件的 M1b **不靠负载**：它把期望态翻转**嵌进 anchor 正在 start 一批 kind 的那一趟**——
// 那一趟的同步体天然长（每 start 一个 kind 都要落一个 pid 文件 + 追加一行日志 + 解析 sibling），
// 于是窗口从 µs 变成 ~10²µs，翻转子进程的 rename 有足够概率落进去（见 M1b 里 ①②③ 的注释）。
//
// ── M2（原子性）：`writeState()` 是 O_TRUNC 后写，并发读者可见半写文件 ───────────────────────────
//
// 修前 `driver-anchor.ts` 用裸 `fs.writeFileSync(paths.stateFile, …)`，而**同一文件族**的
// `writeDesired()`（`driver-runtime.ts`）是 tmp+rename。⇒ 并发读者可观测到**零长度/半写**的
// `.quay/anchor.json`，而读者把解析失败映射成 `null`（⛔ 与「文件不存在」同形，硬规则 3b）——
// 那正是 `.quay/fan-in-suite-*.log` 里 `TypeError: Cannot read properties of null (reading 'kinds')`
// 的来源。torn 率随宿主负载上升（立案轮实测 0/32/96 三档 = 9.4e-5 / 1.85e-3 / 1.0e-2）。
//
// ── 三个测试各自回答什么，以及它们的**正控制**（硬规则 2 的配套半边）─────────────────────────────
//
//   M1a  一趟判定只读**一次**期望态：快照拿到后盘上再变，同一快照的两处读数不跟着变、且两处一致。
//        确定性，与调度相位无关。正控制 = 新快照**确实**翻到 `not-declared`（谓词对真样本命中）。
//   M1b  端到端：anchor **发布**的每一个非空 `not-declared` 集合，日志里必须有**同名的那一行**。
//        正控制 = **每个** drop 集合的那一行最终都出现（⛔ 否则 violations===0 只是谓词恒假的回声）。
//   M2   `.quay/anchor.json` 的并发读 0 例 torn/missing。正控制 = **同一个读者谓词**对着一个
//        故意非原子的写者（O_TRUNC + 分片写）必须报 torn>0 ⇒ 证明谓词不是恒假。
//
// ── 与 `driver-anchor-declaration.test.mjs` 的关系 ──────────────────────────────────────────────
//
// 那份验的是**读数语义**（四态各自独立、两个回读面都报得出）；本文件验的是**载体的写侧与读侧的
// 一致性/原子性**。两者的 anchor 都**不经** `preferredAnchorKernel()`（那是主检出那一份 ⇒ worktree
// 里对内核本身的改动物理上跑不到），而是直接 spawn `REPO_ROOT/plugin/scripts/driver-anchor.ts`
// + `QUAY_PLUGIN_ROOT=<fixture>/plugin` ⇒ 跑的就是**本 worktree 这一份**内核。
//
// Run:
//   node --test plugin/test/anchor-state-atomicity.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DRIVER_KINDS,
  KNOWN_KINDS,
  readAnchorStateDetailed,
  kindDeclarationMap,
  readDeclarationSnapshot,
  undeclaredKinds,
  writeDesired,
} from "../scripts/driver-runtime.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
// ⛔ 直指本 worktree 那一份（`preferredAnchorKernel()` 会换到主检出，本文件刻意绕开它）。
const ANCHOR_SCRIPT = path.join(REPO_ROOT, "plugin", "scripts", "driver-anchor.ts");
const WORKTREE_RUNTIME = path.join(REPO_ROOT, "plugin", "scripts", "driver-runtime.ts");

const SIX = [...KNOWN_KINDS];
/** 只托管一个 kind。⛔ 这不是仪式：M1b 每一步都先收回成 ONE，是为了让**下一步回到 SIX 时
 *  anchor 要 start 五个 kind**——那一趟的同步体就是 M1b 要嵌进去的窗口（见头注释 M1）。 */
const ONE = ["promotion"];

// ── 夹具（与 `driver-anchor-declaration.test.mjs` 同形；见那份头注释的「同源」纪律）───────────────

/** 一个 fake driver：导出 `main(argv)`（anchor 经**既有入口**在进程内调用它，与真实 kind 同一条码路），
 *  自写 `--pid-file`，并按 interval 追写 round 心跳，直到 anchor 经 `requestKindStop` 请求它停机。
 *  ⛔ 它 import 的是**本 worktree**那份 runtime —— 与下面起的那份 anchor 同源（否则停机登记表分裂）。 */
function fakeDriverSource(kind) {
  const spec = DRIVER_KINDS[kind];
  const carrier = spec.carriers.find((c) => c.endsWith("-round.jsonl")) ?? spec.carriers[0];
  return `import fs from "node:fs";
import path from "node:path";
import { registerKindStop } from ${JSON.stringify(WORKTREE_RUNTIME)};

export async function main(argv) {
  const args = argv.slice(2);
  const get = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const root = get("--root");
  const pidFile = get("--pid-file");
  const interval = Number(get("--interval") ?? 120);
  if (pidFile) fs.writeFileSync(pidFile, String(process.pid) + "\\n", "utf8");
  const ctl = registerKindStop(${JSON.stringify(kind)});
  const file = path.join(root, ".quay", ${JSON.stringify(carrier)});
  let round = 0;
  while (!ctl.requested()) {
    round += 1;
    try { fs.appendFileSync(file, JSON.stringify({ round, ts: new Date().toISOString().slice(0, 19) + "Z", pid: process.pid }) + "\\n"); } catch {}
    await new Promise((r) => setTimeout(r, interval));
  }
  return 0;
}
`;
}

/** 一个合法 workspace（`anchorPaths()` 只要求 `<root>/.quay`；config.yml 让它同时是合法 quay workspace）。 */
function makeWorkspace(tag) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `atomic-${tag}-`));
  fs.mkdirSync(path.join(root, ".quay"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".quay", "config.yml"),
    [
      "providers:",
      "  native:",
      "    enabled: true",
      '    path: "./packages/quay-native"',
      '    tasks_dir: "./tasks"',
      '    mcp_entry: ["node", "./bin/quay-native.ts", "mcp"]',
      "",
    ].join("\n"),
    "utf8",
  );
  return root;
}

function makeFixture(tag) {
  const root = makeWorkspace(tag);
  const scripts = path.join(root, "plugin", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  for (const kind of KNOWN_KINDS) fs.writeFileSync(path.join(scripts, DRIVER_KINDS[kind].driver), fakeDriverSource(kind), "utf8");
  return root;
}

/** 直接起**本 worktree 那一份** anchor（⛔ 不经 `preferredAnchorKernel()`，见头注释）。 */
function startAnchor(root, reconcileMs) {
  const logFd = fs.openSync(path.join(root, ".quay", "anchor.log"), "a");
  const child = spawn(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", ANCHOR_SCRIPT, "__anchor", "--root", root, "--reconcile-ms", String(reconcileMs)],
    {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, QUAY_PLUGIN_ROOT: path.join(root, "plugin") },
    },
  );
  child.unref();
  return child;
}

const anchorStateFile = (root) => path.join(root, ".quay", "anchor.json");
const anchorPidFile = (root) => path.join(root, ".quay", "anchor.pid");
const anchorLogFile = (root) => path.join(root, ".quay", "anchor.log");

/** 读 `.quay/anchor.json` 的**原始**回读面。⛔ 三态各自独立（硬规则 3b）：`missing`（还没有这个文件）
 *  与 `torn`（文件在但读不懂 —— 半写/0 字节/人为损坏）**不得同形**：后者正是 M2 的缺陷形态，把它
 *  冒充成「还没有回读面」会让一次**正在发生的**损坏读成「一切正常，只是还早」。 */
function readState(root) {
  let raw;
  try {
    raw = fs.readFileSync(anchorStateFile(root), "utf8");
  } catch (e) {
    return { ok: false, reason: e?.code === "ENOENT" ? "missing" : "torn" };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, reason: "torn" };
  }
}

/** 一份 `anchor.json` 里被报成 `not-declared` 的 kind（KNOWN_KINDS 序 —— 与日志行 `[a,b]` 同序）。 */
function notDeclaredOf(v) {
  const decl = v?.declaration ?? {};
  return KNOWN_KINDS.filter((k) => decl[k] === "not-declared");
}

const logText = (root) => {
  try { return fs.readFileSync(anchorLogFile(root), "utf8"); } catch { return ""; }
};
/** anchor 的「静默脱离期望态」那一行里点名了**哪个集合**（`[a,b]`），⛔ 不是「有过任何一行」。 */
const hasLineFor = (root, kinds) => logText(root).includes(`absent from the desired set with NO explicit stop record: [${kinds.join(",")}]`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForState(root, pred, ms, what) {
  const deadline = Date.now() + ms;
  for (;;) {
    const r = readState(root);
    if (r.ok && pred(r.value)) return r.value;
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${what} (last: ${r.ok ? JSON.stringify(notDeclaredOf(r.value)) : r.reason})`);
    }
    await sleep(5);
  }
}

async function waitForLine(root, kinds, ms, what) {
  const deadline = Date.now() + ms;
  while (!hasLineFor(root, kinds)) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
    await sleep(5);
  }
}

function cleanup(root) {
  try {
    const pid = Number(fs.readFileSync(anchorPidFile(root), "utf8").trim());
    if (Number.isInteger(pid)) process.kill(pid, "SIGKILL");
  } catch { /* gone */ }
  fs.rmSync(root, { recursive: true, force: true });
}

/** 紧循环盯住 anchor 日志的**新增字节**（⛔ 不起定时器：这条要的是 µs 级反应，`setTimeout` 粒度不够）。
 *  返回「新增字节里第一次出现 `needle`」那一刻的读数；超时 ⇒ null（⛔ 不假装匹配到了）。 */
function spinForAppend(fd, offset0, needle, deadlineMs) {
  let offset = offset0;
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    const size = fs.fstatSync(fd).size;
    if (size > offset) {
      const buf = Buffer.alloc(size - offset);
      const n = fs.readSync(fd, buf, 0, buf.length, offset);
      const chunk = buf.subarray(0, n).toString("utf8");
      offset += n;
      if (chunk.includes(needle)) return { offset, at: Date.now() };
    }
    if (Date.now() >= deadline) return null;
  }
}

// ── M1a：一趟判定只读一次期望态（确定性；快照拿到后盘上再变，同一快照的两处读数不跟着变）────────

test("M1a — 一趟判定只读**一次**期望态：同一快照的 `undeclaredKinds` 与 `kindDeclarationMap` 不跟着盘变、且两处一致", () => {
  const root = makeWorkspace("m1a");
  try {
    // 基线：六个 kind 全在期望态 ⇒ 两处读数都说「没有静默脱离」。
    writeDesired(root, SIX, "test:m1a-baseline");
    const snapAll = readDeclarationSnapshot(root);
    assert.deepEqual(undeclaredKinds(root, snapAll), [], "六个都在期望态 ⇒ 没有静默脱离");
    for (const kind of KNOWN_KINDS) assert.equal(kindDeclarationMap(root, snapAll)[kind], "declared", `${kind}: declared`);

    // 盘上把 quality+meta **静默**移出（直接改期望态，⛔ 不留停机记录 —— 生产上发生的就是这件事）。
    const DROPPED = ["quality", "meta"];
    const declared = SIX.filter((k) => !DROPPED.includes(k));
    writeDesired(root, declared, "test:m1a-silent-drop");

    // ⛔ 旧快照的两处读数必须**都不变** —— 它们派生自同一份期望态，不得一个读旧、一个读新。
    assert.deepEqual(undeclaredKinds(root, snapAll), [], "旧快照 ⇒ 仍无静默脱离（⛔ 不得现算盘上那一份）");
    for (const kind of KNOWN_KINDS) {
      assert.equal(kindDeclarationMap(root, snapAll)[kind], "declared", `${kind}: 旧快照的**发布面**不得跟着盘变`);
    }

    // 正控制（硬规则 2 的配套半边）：**新**快照确实翻到 `not-declared` ⇒ 上面的零计数不是谓词恒假。
    const snapDropped = readDeclarationSnapshot(root);
    const decl = kindDeclarationMap(root, snapDropped);
    assert.deepEqual(undeclaredKinds(root, snapDropped), DROPPED, "新快照 ⇒ 两个 kind 静默脱离（谓词对真样本命中）");
    assert.equal(decl.quality, "not-declared");
    assert.equal(decl.meta, "not-declared");
    for (const kind of SIX.filter((k) => !DROPPED.includes(k))) assert.equal(decl[kind], "declared", `${kind} 仍 declared（读数定位得准）`);

    // **M1 的核心不变式**：对**任意**快照，「发布面里的 not-declared 集合」与「会打日志的那个集合」
    // 必须是同一个集合 —— 修前它们是两次独立读盘，故可以不一致。
    for (const [name, snap] of [["all", snapAll], ["dropped", snapDropped]]) {
      const published = KNOWN_KINDS.filter((k) => kindDeclarationMap(root, snap)[k] === "not-declared");
      assert.deepEqual(published, undeclaredKinds(root, snap), `snapshot=${name}: 发布面 === 日志谓词集合`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ── M1b：端到端 —— anchor **发布**的 not-declared 集合必须在日志里有同名的那一行 ─────────────────

/** 会依次用到的 **drop 集合**（6 个单元素 + 15 个二元组，全在 KNOWN_KINDS 序）。
 *  ⛔ 每一个都必须是**崭新的**：谓词是「日志里有**点名这个集合**的那一行」，重用一个已经打过日志的
 *  集合会让修前的分叉读起来像「有那一行」⇒ 检测机会凭空消失。 */
const FRESH_DROPS = (() => {
  const out = [];
  for (const a of KNOWN_KINDS) out.push([a]);
  for (let i = 0; i < KNOWN_KINDS.length; i += 1) {
    for (let j = i + 1; j < KNOWN_KINDS.length; j += 1) out.push([KNOWN_KINDS[i], KNOWN_KINDS[j]]);
  }
  return out;
})();
const ONE_SET = SIX.filter((k) => !ONE.includes(k));

test("M1b — anchor 发布的**每一个**非空 `not-declared` 集合，日志里都得有同名的那一行（同趟两个读数同现）", async (t) => {
  const root = makeFixture("m1b");
  t.after(() => cleanup(root));
  writeDesired(root, ONE, "test:m1b:baseline");
  // reconcile 10ms：一趟 ≈ 10ms ⇒ 分叉状态只存活一趟也足够被 1ms 采样逮到。
  startAnchor(root, 10);

  const logFd = fs.openSync(anchorLogFile(root), "r");
  t.after(() => { try { fs.closeSync(logFd); } catch { /* ignore */ } });

  await waitForState(root, (v) => v.kinds?.length === 1, 20_000, "the anchor to carry the single declared kind");
  await waitForLine(root, ONE_SET, 10_000, "the baseline `not-declared` line for the five un-hosted kinds");

  let sampled = 0;
  let violations = 0;
  let tornReads = 0;
  let missingLine = 0;
  const lags = [];

  for (const drop of FRESH_DROPS) {
    const declared = SIX.filter((k) => !drop.includes(k));

    // ① 收回成 ONE。这一步不是仪式：**下一步回到 SIX 时 anchor 要 start 五个 kind**，那一趟的同步体
    //    就是窗口（每 start 一个 kind：落 pid 文件 + 解析 sibling + 追加一行日志）。⛔ 直接在 4/5 个
    //    kind 的基底上回 SIX 只 start 一两个 ⇒ 窗口小一个数量级，撞不上。
    writeDesired(root, ONE, "test:m1b:settle-one");
    await waitForState(root, (v) => notDeclaredOf(v).join(",") === ONE_SET.join(","), 10_000, `the anchor to settle on [${ONE.join(",")}]`);
    // ⛔ 也要等**它那一行**：否则下面采样若读到这一趟的状态，会把「本趟的行还没打」误记成分叉。
    await waitForLine(root, ONE_SET, 10_000, "the `not-declared` line for the settle-one state");

    // ② 期望态 → 六个：anchor 的**下一趟**会 start 五个 kind。
    const off0 = fs.fstatSync(logFd).size;
    writeDesired(root, SIX, "test:m1b:restore-six");
    // ③ 就在那一趟**中途**把期望态翻到 declared（丢掉 drop）—— 立案轮实测的 M1 形态。
    //    ⛔ `trig` 为 null（那一批 start 没等到）时也照翻：那只是这一趟错过窗口，不是夹具失灵
    //    （错过 ⇒ 两个读数本来就一致 ⇒ 不产生分叉，也不会造成假红）。
    spinForAppend(logFd, off0, "loop started", 2_000);
    const flippedAt = Date.now();
    writeDesired(root, declared, "test:m1b:silent-drop");

    // ④ 采样：**任何**非空的 `not-declared` 集合都必须在日志里有点名它的那一行。
    const deadline = Date.now() + 3_000;
    for (;;) {
      const r = readState(root);
      sampled += 1;
      if (!r.ok) {
        if (r.reason !== "missing") tornReads += 1;
      } else {
        const nd = notDeclaredOf(r.value);
        if (nd.length > 0 && !hasLineFor(root, nd)) violations += 1;
      }
      if (hasLineFor(root, drop)) break;
      if (Date.now() >= deadline) break;
      await sleep(1);
    }
    if (hasLineFor(root, drop)) lags.push(Date.now() - flippedAt);
    else missingLine += 1;
  }

  // ⛔ 零计数的配套半边（硬规则 2）：**每一个** drop 集合的日志行最终都出现 ⇒ 下面的零计数不是谓词恒假。
  assert.equal(missingLine, 0, `${FRESH_DROPS.length - missingLine}/${FRESH_DROPS.length} drop sets got their own log line（⛔ 缺的那些就是「谓词没法命中」的信号）`);
  assert.equal(violations, 0, `发布的 not-declared 集合必须**同趟**有那一行（采样 ${sampled} 次，${lags.length} 个 drop 集合被见证）`);
  assert.equal(tornReads, 0, `采样期间不该读到 torn/unreadable 的 \`.quay/anchor.json\`（读到 ${tornReads} 次）`);
  assert.ok(lags.length === FRESH_DROPS.length, "每个 drop 集合都取到了一次 lag 读数");
});

// ── M2：`.quay/anchor.json` 的写是原子替换（并发读者 0 例 torn）+ 正控制 ──────────────────────────

test("M2 — 并发读 `.quay/anchor.json` 0 例 torn/missing；正控制：同一谓词对着故意非原子的写者必须报 torn>0", async (t) => {
  const root = makeFixture("m2");
  t.after(() => cleanup(root));
  writeDesired(root, SIX, "test:m2:baseline");
  // reconcile 5ms ⇒ 回读面被重写 ~200 次/秒：**用写侧频率放大窗口**，⛔ 不是等运气。
  startAnchor(root, 5);

  await waitForState(root, (v) => Array.isArray(v.kinds), 20_000, "`.quay/anchor.json` to be written by the anchor");

  /** 一次读：能解析 ⇒ ok；文件不存在 ⇒ missing；文件在但读不懂 ⇒ torn（⛔ 后两者不同形，硬规则 3b）。 */
  const readOnce = async (file) => {
    try {
      JSON.parse(await fs.promises.readFile(file, "utf8"));
      return "ok";
    } catch (e) {
      return e?.code === "ENOENT" ? "missing" : "torn";
    }
  };

  const burst = async (file, readers, perReader) => {
    const tally = { ok: 0, torn: 0, missing: 0 };
    await Promise.all(
      Array.from({ length: readers }, async () => {
        for (let i = 0; i < perReader; i += 1) tally[await readOnce(file)] += 1;
      }),
    );
    return tally;
  };

  const reads = Number(process.env.QUAY_ANCHOR_M2_READS ?? 9_000);
  const state = await burst(anchorStateFile(root), 6, reads);
  assert.equal(state.missing, 0, "`.quay/anchor.json` 在 anchor 活着期间不得整份消失（原子替换 ⛔ 不经过「不存在」）");
  assert.equal(state.torn, 0, `并发读不得看到零长度/半写的 \`.quay/anchor.json\`（torn=${state.torn}，ok=${state.ok}）`);
  // ⛔ 零计数必须对着一个**已知为真**的样本干跑（硬规则 2）：读者确实读到了这个文件。
  assert.ok(state.ok > 1000, `读者确实在读这个文件（ok=${state.ok}）—— 否则上面的 torn=0 只是「没读成」的回声`);

  // ── 正控制：**同一个读者谓词** + 一个故意非原子的写者（O_TRUNC + 分片写）⇒ 必须报 torn>0。──────
  //    没有这一半，上面的 `torn===0` 与「谓词恒假」同形（硬规则 2 / 3b）。
  const ctlFile = path.join(root, ".quay", "control-torn.json");
  const ctlWriter = spawn(
    process.execPath,
    [
      "-e",
      [
        'const fs = require("node:fs");',
        "const file = process.argv[1];",
        'const chunk = "x".repeat(4096);',
        "for (;;) {",
        '  const fd = fs.openSync(file, "w");',            // O_TRUNC —— 与裸 writeFileSync 同形
        "  for (let i = 0; i < 40; i += 1) fs.writeSync(fd, chunk);", // 40 次分片写 ⇒ 半写窗口被放大
        "  fs.closeSync(fd);",
        "}",
      ].join("\n"),
      ctlFile,
    ],
    { stdio: "ignore" },
  );
  try {
    // ⚠️ 先等它把文件建出来，否则读者的第一次 ENOENT 会被算成 missing（那是夹具的相位，不是被测量）。
    const ctlDeadline = Date.now() + 10_000;
    while (!fs.existsSync(ctlFile)) {
      assert.ok(Date.now() < ctlDeadline, "the control writer should have created its file");
      await sleep(5);
    }
    const ctl = await burst(ctlFile, 3, Math.max(1_000, Math.floor(reads / 3)));
    assert.ok(ctl.torn > 0, `正控制：非原子写者必须让同一谓词报出 torn>0（torn=${ctl.torn}, ok=${ctl.ok}, missing=${ctl.missing}）`);
  } finally {
    ctlWriter.kill("SIGKILL");
  }

  // ── 生产消费者侧的「读不懂 vs 不存在」也分得开（Plan 第 4 步）：`.quay/anchor.json` 被写坏时，
  //    `readAnchorStateDetailed` 报的是具名原因，⛔ 不是与「文件还没写」共用一个 null。──────────────
  //    ⚠️ 这一步必须在一个**没有 anchor 在写**的 workspace 上做：live fixture 的 `.quay/anchor.json`
  //    每 5ms 被重写一次，「写坏再读」那一小段会被直接抹掉（实测：96 路负载下 6 次里红 2 次，红的是
  //    本夹具自己的相位，⛔ 不是机制）。判据是**读者**的区分能力 ⇒ 它不需要一个活的写者。
  assert.equal(readAnchorStateDetailed(root).ok, true, "正式运行中的 `.quay/anchor.json` 可读");
  const probeRoot = makeWorkspace("m2-read");
  try {
    const probeFile = anchorStateFile(probeRoot);
    assert.deepEqual(readAnchorStateDetailed(probeRoot), { ok: false, reason: "missing" }, "文件不存在 ⇒ `missing`");
    fs.writeFileSync(probeFile, '{"pid":1,"kinds":["pro', "utf8");
    assert.deepEqual(readAnchorStateDetailed(probeRoot), { ok: false, reason: "malformed" }, "半写（torn）⇒ `malformed`（⛔ 不是 `missing`：文件在，只是读不懂）");
    fs.writeFileSync(probeFile, '{"pid":1}\n', "utf8");
    assert.deepEqual(readAnchorStateDetailed(probeRoot), { ok: false, reason: "malformed" }, "可解析但没有 `kinds` ⇒ 同样是 `malformed`");
    fs.writeFileSync(probeFile, '{"pid":1,"kinds":["promotion"]}\n', "utf8");
    assert.deepEqual(readAnchorStateDetailed(probeRoot), { ok: true, pid: 1, kinds: ["promotion"] }, "合格回读面 ⇒ ok（⛔ 上面三条零计数不是「谓词恒假」）");
  } finally {
    fs.rmSync(probeRoot, { recursive: true, force: true });
  }
});
