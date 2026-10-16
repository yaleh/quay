---
id: gap-per-file-cpu-report-mem-key-collides-parent-and-isolated-child
title: per-file-cpu-report 的 .mem 只按文件路径作 key ⇒ 隔离子进程模式下父进程覆盖子进程读数：五个重型文件全被读成
  ~50 MB（低估约 35×）
status: done
labels:
  - gap
parent: null
children: []
extra: {}
---
## Proposal

`plugin/scripts/per-file-cpu-report.mjs` 的输出文件名只由**测试文件路径**决定、**不含 pid**：

- `:166` `const key = crypto.createHash("sha256").update(abs).digest("hex").slice(0, 16);`（`abs` = resolve 后的 `argv[1]`）
- `:168`/`:170` 写 `<cpuDir>/<key>.cpu` 与 `<cpuDir>/<key>.mem`
- `:71` 的注释把这个 key 写成 "MUST stay byte-identical" 的契约 —— 契约本身没错，但它**只标识文件、不标识进程**。

而 `node --test --test-isolation=process <file>` 会为测试文件起一个**隔离子进程**，且父进程的 `argv[1]` 与子进程**相同** ⇒ **同一个 key** ⇒ 两个进程写同一个 `<key>.mem`；父进程退出时用它自己的小读数覆盖掉子进程的真实峰值。

**实测（2026-10-16，一手读数，已记在 `tasks/gap-suite-heavy-files-and-phase-concurrency-under-16g-pressure-baseline-comparison.md` 的 Evidence 里）**：用生产 preload 直读时，五个重型文件**全都**读出几乎相同的 51224–52384 KB（≈50 MB）—— 那不是任何文件的峰值，是覆盖效应。改用**同一读数**、**按 pid 分文件**（`<key>.<pid>.mem`，取各 pid 的最大值）后，逐文件复现了该任务自己记录的 1.7–1.8 GB 量级。

⇒ 后果：**任何按文件读这份成本的消费者，在隔离子进程模式下读到的是父进程的读数**（"每个文件约 50 MB"）—— 一个系统性低估约 35× 的假读数；而 `mem_peak_kb=` 那条链（`measure-suite-reporter.mjs` / `full-suite-runner.ts` / `measure-trend-check.ts` / `pre-verified-round-record.ts`）正建立在它上面。

## Plan

1. **复现。** 按生产形状（同一 preload、`--test-isolation=process`、一个已知重型文件）跑一轮，粘贴 `<key>.mem` 读到的假读数（~50 MB 量级）与文件名；再用按 pid 分文件的变体粘贴真峰值，给出两者倍数差。
2. **修。** 让这一维**不可被父进程覆盖**：记为 `<key>.<pid>.mem` 而读者取各 pid 的最大值；或让父进程在检测到自己只是隔离父进程时不写这一维。⛔ 契约变更必须同步**所有**读者，不许只改写侧。
3. **判据。** 读侧不得因父进程的小读数而丢掉子进程的大读数（夹具：同一 key 下父写小值、子写大值 ⇒ 读侧必须得大值）。
4. ⛔ 不改 `mem_peak_kb=` 那条既有格式；⛔ 不放宽或删除任何既有判据来达成读数。

## Acceptance Criteria

- [x] AC1: 粘贴复现读数：同一重型文件，生产 preload 形状**直读**得到 ~50 MB 量级，而按 pid 分文件得到真实峰值；给出文件名、pid、两值倍数差。
- [x] AC2: 粘贴修复后的 A/B：修复后**直读即得真实峰值**（不再需要绕道），并写明契约怎么变的、哪些读者跟着改了。
- [x] AC3: 判据（落测试文件）：同一 key 下父进程写小值、隔离子进程写大值 ⇒ 读侧读到**大值**；负控 = 只写小值时读到小值（证明它不是恒取大）。
- [x] AC4: `scripts/test.sh --for-task <本任务>` 绿；anti-drift 报 OK（改动全在 Touches 内）。

## Definition of Done

- AC1–AC4 全部勾选并附实测读数。
- 既有判据（`plugin/test/measure-suite-reporter.test.mjs` 等）要么原样通过、要么在证据里说明哪个用例因契约变更**必须**改及为什么；⛔ 不得放宽或删除。
- 落地后 `mem_peak_kb=` 那条链在隔离子进程模式下给出的是**子进程的真实峰值**，而不是父进程的读数。

## Evidence

### AC1 —— 复现（一手读数，修复前；2026-10-16 本机）

触发面命令形状（生产 preload + 进程隔离）：

```
QUAY_PERFILE_CPU_DIR=<dir> NODE_OPTIONS=--require=<plugin/scripts/per-file-cpu-report.mjs> \
  node --test --test-isolation=process <file>
```

| 被测文件 | key | ① 直读 `<key>.mem`（生产 writer） | ② 同一读数、按 pid 分文件 | 倍数 |
|---|---|---|---|---|
| `plugin/test/ac341-post-merge-promotion-events-dialect.test.mjs`（真实重型文件） | `92b0d3b9557b9f8d` | **52,248 KB** | runner pid **2677287** = 52,248 KB；隔离子进程 pid **2677313** = **97,720 KB** | **1.9×** |
| 受控夹具 `balloon.test.mjs`（128 MiB 分配后释放） | `d20c029ddce7b12e` | **52,356 KB** | runner pid **2693160** = 52,252 KB；子进程 pid **2693173** = **1,624,188 KB** | **31.0×** |

- ① 的 52,248 / 52,356 KB 与立案时记的 51224–52384 KB 同一带（≈50 MB）——**那正是 runner 自己的 RSS**，②的第一列逐位吻合。
- **控制臂（证明 ~50 MB 不是「文件本来就小」而是覆盖）**：同一夹具改用 `--test-isolation=none`（无子进程，runner 就是文件自己的进程）⇒ `<key>.mem` = **1,625,132 KB**。同一仪器、同一读数，只在有无父子分裂时给出假值 / 真值。
- 进程身份（`--require` 探针，同一 node）：runner 的 `execArgv` = `['--test','--test-isolation=process']`、`argv[1]` 就是该文件、`NODE_TEST_CONTEXT` 未设；隔离子进程 `execArgv` = node 默认旗标表 + `--test-isolation=process`（**不含 `--test`**）、`argv[1]` 同一文件、`NODE_TEST_CONTEXT=child-v8` ⇒ **同一 key、同一文件名，先写子、后写父**。

### AC2 —— 修复后的 A/B（直读即真值，不再绕道）

修复后同一组形状直读 `<key>.<pid>.mem`：

| 臂 | 场景 | 修复后直读 | 修复前直读 | 倍数 |
|---|---|---|---|---|
| F1 | 夹具，`--test-isolation=process` | **1,624,156 KB** | 52,356 KB | **31.0×** |
| F2 | 真实重型文件 `ac341-…test.mjs` | **97,248 KB** | 52,248 KB | **1.9×** |
| F3 | 夹具，`--test-isolation=none`（覆盖不回退） | **1,626,172 KB** | 1,625,132 KB | 1.00× |
| F4 | 夹具，默认隔离（命令行不带隔离旗标） | **1,625,220 KB** | — | — |

F1/F2 每个 key 下**只剩一个**报告文件（子进程的），其 pid ≠ runner 的 pid（`spawnSync` 报告的 runner pid 未被写成任何报告）⇒ 直读即子进程真实峰值。

**契约怎么变（writer + reader 两半，两半都必要）**

1. 文件名：`<key>.cpu` / `<key>.mem` ⇒ **`<key>.<pid>.cpu` / `<key>.<pid>.mem`**（pid = 写者进程）。key 本身**逐字节未变**（仍是 `sha256(path.resolve(argv[1]))[:16]`，与读者同一契约）。
2. 武装条件（谁能写）：从「execArgv 出现 `--test-isolation`」改成**「本进程就是【跑这个文件】的那个进程」**——进程隔离运行的 `node --test` **CLI runner 不再武装**（它有 `--test`，且不是文件自己的进程）；`--test-isolation=none` 的 runner **仍然武装**（那里没有子进程，runner 就是文件自己的进程）；`node -e` 探针 / suite-fs-trace 子进程 / 其它非测试子进程**照旧不武装**（无隔离标记）。
3. 读侧：从「读单个 `<key>.<ext>`（后写者胜）」改成**枚举 `^<key>(\.\d+)?\.<ext>$` 取最大值**。pid 分量**可选** ⇒ 旧的 pid-less 方言仍可读（既有夹具 / 旧报告目录不失效）。

**哪些读者跟着改了**：`plugin/scripts/measure-suite-reporter.mjs` 的 `readPerFileMetric`（`readPerFileCpuMs` / `readPerFileMemPeakKb` 的唯一实现）。`__PERFILE__` 的两个发射点**都**经这两个函数取值（reporter 自己的路径 + `suite-scheduler.ts:376/378` 的 import），故没有第二个读点要同步。**`mem_peak_kb=` 行格式未动** ⇒ 行消费者（`full-suite-runner.ts` 的重型集、`measure-trend-check.ts`、`pre-verified-round-record.ts`）零改动。

**边界（如实报告，不夸大打击面）**：本缺陷需要 `--test-isolation` **在命令行上**（那才是把标记塞进 runner 的 execArgv 的动作）。`scripts/test.sh` 的 `node --test` 调用不带该旗标（`full-suite-runner.ts:3048` 的命令是 `bash scripts/test.sh`）⇒ **全量套件那条路只有隔离子进程被武装，读数本来是对的**；被咬的是**一次量一个文件**的形状 `node --test --test-isolation=process <file>`（即立案表所用的逐文件测量形状）。修复后两种形状都报文件自己的进程。

### AC3 —— 判据（落 `plugin/test/measure-suite-reporter.test.mjs`）

新增 `AC3 — the reader takes the MAX over a key's per-pid reports…`：

- 同一 key 下写 `<key>.<pidA>.mem` = 52356、`<key>.<pidB>.mem` = 1624188 ⇒ 读侧得 **1624188**；
- **负控（第一条断言就是它）**：只写小值 ⇒ 读到 **52356**（证明它不是恒取大 / 常量）；
- **顺序无关**：把小的那个**最后**重写一遍 ⇒ 仍读 1624188（「后写者胜」正是被修的缺陷）；
- **锚定**：`<key>extra.mem` / `<key>.1.mem.bak` / `prefix<key>.mem` 三个像似名**都不算**；
- **旧方言**：写一个 pid-less `<key>.mem` ⇒ 仍被接受、且仍输给大值；
- cpu 维走同一条规则（一个读者，两维不漂）。

**判据能取假（两条负控，逐条实测）**：

- 对 **develop 的旧 reader** 跑 AC3 ⇒ **红**：`AssertionError: only one (small) report ⇒ that value — the reader is not a constant`，`actual: undefined, expected: 52356`（旧 reader 只认 pid-less）。恢复修复后 ⇒ 绿。
- 对 **develop 的旧 writer** 跑 AC2 ⇒ **红**：`the writer must key reports by pid — a pid-less report means the two processes can still collide (present: cd2d083d86e5c5ce.cpu cd2d083d86e5c5ce.mem)`。恢复修复后 ⇒ 绿。

### AC4 —— scoped 门 + anti-drift

- 跑前已 `git merge --no-edit develop`（无冲突）。
- `bash scripts/test.sh --for-task gap-per-file-cpu-report-mem-key-collides-parent-and-isolated-child --allow-thin` ⇒ **exit 0**（reporter 文件 `tests 11 / pass 11 / fail 0`；日志 `/tmp/quay-memkey-repro/scoped-gate.log`）。
- `anti-drift-touches-check.ts --task … --worktree … --merge-target develop` ⇒ **exit 0**：`ANTI-DRIFT OK: 3 actual file(s), all within declared Touches (4 glob(s))`。
- scoped-gate cache 已写：`developSha e234d1865ac7a227c90e44d21171171560acdc6d`。

### 既有判据（DoD 第二句）

- `plugin/test/measure-suite-reporter.test.mjs` 原有 **9** 条用例**原样通过**（含 `readPerFileMemPeakKb — shared named export reading <key>.mem…`——它写的就是 pid-less 旧方言，正因读侧仍接受该方言而不必改）。契约变更后该文件 11/11 绿（9 旧 + 2 新）。
- **必须改的一处**：`runIsolatedFixtures` 这个 helper 原本**手搓** `<key>.mem` 路径读取；文件名契约变了，它若不改会静默读到 `undefined`。改法是**删掉那段手搓 key 派生与路径拼接、直接调用真读者 `readPerFileMemPeakKb`** ⇒ 不是放宽，而是**少一个会漂的读点**。
- `plugin/test/suite-scheduler.test.mjs`（**不在 Touches 内**，写 pid-less `<key>.cpu` 夹具）⇒ **14/14 原样通过**（旧方言仍被接受）。
- 无任何判据被放宽或删除。

### 硬规则 5b（同一原则的其它适用点）

在 `plugin/scripts/` 里 grep `createHash("sha256")` ⇒ **23** 命中（前 3：`build-evidence-manifest.ts:247/259/263`）。逐条看：只有一个形态是「把报告文件写进共享 per-run 目录、键只由文件路径派生」——`per-file-cpu-report.mjs` 自己。`suite-fs-trace.ts:71` 的 hash 是**内容**摘要，且每次追踪写进**自己的** tmp 文件（`path.join(tmp,"trace.json")`，单写者）⇒ 不属同类。其余为内容 / 缓存摘要，无第二个写者。

## Touches
- tasks/gap-per-file-cpu-report-mem-key-collides-parent-and-isolated-child.md
- plugin/scripts/per-file-cpu-report.mjs
- plugin/scripts/measure-suite-reporter.mjs
- plugin/test/measure-suite-reporter.test.mjs