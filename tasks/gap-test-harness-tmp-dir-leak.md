---
id: gap-test-harness-tmp-dir-leak
title: 测试 harness 泄漏临时目录：/tmp 积压 46,218 个 quay-*（15,278 个超 7 天）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

**实测（2026-11-06，同一台 128 vCPU / 246 GB 共享机）**：

```text
$ find /tmp -maxdepth 1 -name 'quay-*' | wc -l
46218
# 另有 /var/tmp 下 717 个
```

其中 **15,278 个超过 7 天**。抽样尺寸：200 个目录 = 24.8 MB，300 个最老的 = 3.6 MB ⇒ 全量**数 GB**。它们由套件/测试运行（`mkdtemp` / `/tmp/quay-*` 夹具）与被 kill 的套件留下；留存本身又制造 inode/元数据压力，并让 `/tmp` 扫描变慢。

2026-11-06 已做过一次**一次性**清理，删掉 15,364 个陈旧条目（清单留在 `~/tmp-quay-cleanup-20261106.list`）。⚠️ 一次性清理**不是修复**：产生源仍在，下一轮套件会重新积回来 —— 这正是本任务要修的那一半。

> 判读：这是「每次运行都泄漏一点点、且没人报告」的典型形态。它不会自己变红：没有读数会因为 `/tmp` 里有 46,218 个目录而失败，所以缺陷**与一切正常同形**（硬规则 3b）。修复的判据必须是一个**计数**（created / reaped / leaked），不是一个布尔。

### Proposed fix

给套件/测试 harness 一条**退出路径上的清理**（`trap` / `afterAll`）覆盖它自己创建的临时根；再加一个有界年龄的清扫器，且**永不删除活进程的 cwd**。把 created / reaped / leaked 三个计数报出来，而不是静默泄漏。

### Dedup / merge 决定

按机制去重：`/tmp/quay` / `mkdtemp` / `临时目录` / `leak` / `cleanup` / `残留` 在 todo/ready 池内命中均为 **0** ⇒ 无 open peer。merge-candidate：`scripts/test.sh` 与 `plugin/scripts/full-suite-runner.ts` 无其它 open 任务声明为 Touches ⇒ **独立立案**。

### 落地（机制要点，正本在代码里，此处只记「为什么是这个形状」）

1. **每个 run 一个 PRIVATE 临时根**：`plugin/scripts/suite-temp-root.sh`（`scripts/test.sh` 开局 source 一次）→ `mktemp -d <ambient>/quay-suite-<pid>-XXXXXX`（起步为空）→ `TMPDIR/TMP/TEMP` 指向它 ⇒ 该 run 创建的一切都是「这棵子树里的东西」，与并发 run（别的 worktree 的 scoped 门、别的项目）结构上互不重叠 —— 这是能安全删除的前提。
2. **trap 不够，还要 janitor**：`scripts/test.sh` 真正跑测试的那条路径结尾是 `exec node --test …`，**exec 会替换掉 shell**，EXIT trap 在那条路径上根本不会执行（实测：SIGTERM 后留下空根、无遥测行）。故另起一个 `setsid` 分离的 janitor 轮询 owner pid（exec 不改 pid），owner 死后 1s 内收尸 ⇒ 覆盖 exec / SIGKILL / 崩溃这一整类，正是当年只能靠一次性 `rm -rf` 的那类残留。
3. **清扫器永不删活进程的 cwd**：`plugin/scripts/temp-root-reaper.ts` 按 `/proc/<pid>/cwd` 判 IN-USE，落在某条目内（含子目录）即保留；`/proc` 读不到时**拒绝判定**（`evaluated=false` / exit 3 / 一个都不删），而不是把「我没法评估」印成「没有 owner」。
4. **跨 run 缓存留在根外**：`quay-real-install-build-cache`（自剪 48h）与 `quay-run-*` 命名空间族（owner-liveness 判据在 `run-namespace-sweep.mjs`）都不交给年龄清扫器 —— 前者删了要重编，后者删了会让仍在跑的 tmux server 失去 socket。
5. **runner 侧由 runner 拥有根**（`full-suite-runner.ts`）：它自己的 `quay-run-<id>` 命名空间与 server registry 都经 `os.tmpdir()` 解析，子进程另建一个根会让两边**静默分叉**；所以 full-suite 路径上 runner 建根 + 注入子进程 env + 收尾自己收，`scripts/test.sh` 见 `QUAY_SUITE_TMP_ROOT` 已存在则**采用**而不另建（孩子不删父的树）。pre-suite 的旧残留清扫在 TMPDIR 覆盖**之前**跑（否则它会去扫刚建的空根并报 0）。

## AC

- [x] 夹具套件跑完零新增：跑一条会创建 temp root 的 scoped 夹具套件，退出前后各取一次 `find /tmp -maxdepth 1 -name 'quay-*' | wc -l`，**两个数相同**（两个数都贴进任务体）。—— 见下 §AC1：`BEFORE=30972` / `AFTER=30972`，集合差为空；遥测 `created=0 reaped=0 leaked=0 evaluated=true`。
- [x] 信号路径同样清理：向同一夹具套件发 `SIGTERM` ⇒ 同样零新增（证明清理挂在 trap/退出路径上，而不是只在 happy path 的 `afterAll` 里）。—— 见下 §AC2：`BEFORE=30975` / `AFTER=30975`，且遥测 `created=28 reaped=28 leaked=0 evaluated=true`（遥测里 **28 条是真实被收尸的孤儿夹具**，不是空根）。
- [x] 清扫器双向控制：一个**被活进程持有为 cwd** 的 `/tmp/quay-*` 目录在清扫中**存活**；一个无人持有且超龄的被清掉。两个方向都断言（只测一个方向等于没测）。—— 见下 §AC3：同一个目录「被持有时 spared / 持有者死后被 reap」，同一次 pass 里无人持有的兄弟目录照常被清。
- [x] 遥测行报告三个计数（created / reaped / leaked），且**零泄漏时可与「没统计」区分**（硬规则 3b：`leaked=0` 与 `leaked=null`/字段缺席 不得同形）。—— 见下 §AC4：两种形态逐字对照 + 单测断言两者**不相等**。
- [x] 清扫器有干跑模式：输出将删除的条目清单而不直接删（贴一次干跑读数，含条目数与前 3 条路径）。—— 见下 §AC5。
- [x] `bash scripts/test.sh --for-task gap-test-harness-tmp-dir-leak --allow-thin` exit 0。—— 见下 §AC6（含 develop 最新提交的 merge 之后重跑；`--verify-run` 亦为 green/mustFix=[]）。
- [ ] 全量 `bash scripts/test.sh` 绿（由 driver 机械 fan-in 验证）（待外部）

## DoD

真实跑一轮全量套件后，`/tmp` 的 `quay-*` **净增量为 0**（或 ≤ 遥测行自己声明的 leaked 计数，且该数必须为 0 才算过），并贴出跑前/跑后两次 `find /tmp -maxdepth 1 -name 'quay-*' | wc -l` 的真实读数与遥测行原文。只证明「清理代码存在」或只跑单测不算（DIR-026 Reading A）；⛔ 用一次性 `rm -rf` 把计数清零不算修复 —— 判据是**下一轮跑完仍为零**。

> 本轮已给出**同一条判据在真实入口上的读数**（§AC1/§AC2：跑前/跑后 + 遥测行原文，且 AC2 那条是「被 SIGTERM 打断、28 条孤儿夹具全部收尸」而不是空根）。⛔ 尚未做的是**全量**那一轮 —— 按 worker 边界由 driver 机械 fan-in 跑，其遥测行会落在 suite log 的 `tmp-root-telemetry:` 上（同一行格式）；本 worker 不自行跑全量套件。

## Touches

- scripts/test.sh
- plugin/scripts/full-suite-runner.ts
- plugin/scripts/temp-root-reaper.ts (new)
- plugin/scripts/temp-root-reaper.sh (new)
- plugin/scripts/suite-temp-root.sh (new)
- plugin/test/temp-root-reaper.test.mjs (new)
- plugin/scripts/capability-catalog-declarations.json
- plugin/scripts/overhead-instrument.sh
- plugin/sh-census-baseline.json
- tasks/gap-test-harness-tmp-dir-leak.md

> Touches 里 `temp-root-reaper.ts` 是拟新增的载体；执行器若判定应复用/扩展现有的临时根 helper，按实情把真实路径登记进本节并留痕（⛔ 不要为了迁就本节另造一个文件）。
>
> **实际落地时的登记（留痕，2026-11-06）**：`temp-root-reaper.ts` 按原计划新增；但它不能由 `scripts/test.sh` 直接调用——`sh-census-check` 的 `embeddedInterpreterLines` 是【文件级】棘轮，`.sh` 里只要出现一个 `node` 就整文件计行，直接内联会是 +57。故拆成 `temp-root-reaper.sh`（2 行薄 wrapper，承担计数）+ `suite-temp-root.sh`（逻辑，无内嵌解释器 ⇒ 不计入）。`capability-catalog-declarations.json`（新脚本必须声明）、`overhead-instrument.sh`（它的 `trap … EXIT` 会覆盖早先装的 trap，必须链式而非替换）、`sh-census-baseline.json`（+3 的 committed re-anchor）随之进入 Touches。

## 证据（2026-11-06 本机实测，全部为真实运行读数）

**夹具套件** = `bash scripts/test.sh <scoped fixture>`（走真实入口：锁 → 资源闸 → build_dist → 静态检查 → `exec node --test`），AC1 用 `plugin/test/temp-root-reaper.test.mjs`，AC2 用 `packages/quay/test/mcp-server.test.mjs`（后者确认会创建 `quay-mcp-test-workspace-*` 一族，故 SIGTERM 时根里确有东西）。

### §AC1 跑完零新增

```text
BEFORE=30972
SUITE_EXIT=0
settled_after=1s
AFTER=30972
--- new entries (in AFTER, not BEFORE):
--- vanished entries:
tmp-root-telemetry: root=/tmp/quay-suite-2446686-3g3X8z created=0 reaped=0 leaked=0 evaluated=true
```

`settled_after=1s` = 等退出路径落地再读数（janitor 轮询 1s），⛔ 不是把读数提前到一个「还没收尸」的时刻——第一版 5s 轮询时就吃过这个亏：一次**正确**的清理被读成了残留目录（读数在测轮询空档，不是在测泄漏）。

### §AC2 SIGTERM 同样零新增（且真的收掉了东西）

```text
quiescent after ~120s (other suites: 1)
BEFORE=30975
suite pgid=162387
run root before TERM: /tmp/quay-suite-162387-pqCZ9k (32 entr(ies))
sent SIGTERM to process group 162387
suite gone after 2s
run root gone after 1s (janitor)
AFTER=30975
--- new entries:
--- MINE (quay-suite-*): 0
tmp-root-telemetry: root=/tmp/quay-suite-162387-pqCZ9k created=28 reaped=28 leaked=0 evaluated=true
```

- 对整个**进程组**发 SIGTERM（`setsid` 起的 suite），janitor 因为在自己的 session 里而不随组被杀 —— 这正是它能收尸的原因。
- `created=28 reaped=28`：被打断的测试不会再跑它们的 `after()`，那 28 个夹具就是「旧世界会留在 /tmp 的东西」（TERM 时刻 32 条，其中 4 条由垂死测试自己的钩子清掉）。这一条比「零增量」更强：它证明退出路径**确实删过东西**，不是一个恒为 0 的空转读数。
- 早先一次同型测量（`BEFORE=30972` / `AFTER=30973`）里唯一的增量是 `quay-run-mfigapan` —— 那是**并发套件**的 transient namespace（不在本轮 run root 下，数秒后自行消失，同一时刻 `find` 报 `quay-run-a6d8b271: No such file or directory`），不是本轮的残留；故本轮改在静默窗口重测，取上面这一组。

### §AC3 双向控制（活着不删 / 死了照删）

`node --test plugin/test/temp-root-reaper.test.mjs`：

```text
✔ liveness: a dir held as a live process cwd survives, and is reaped after that process exits
✔ age: an entry older than --max-age is reaped; a younger one is spared
✔ instrument guard: an unreadable proc root yields evaluated=false and removes nothing
✔ instrument: a MISSING root is also not-evaluated (not 'clean')
```

`liveness` 那条的断言：先 spawn 一个 cwd 停在该目录里的子进程 ⇒ 同一 pass 里 `sparedLiveCwd == [held]` 且 `reaped == [free]`（**同一次**清扫里另一个无人持有的目录被清掉 ⇒ 不是「全都保留」）；KILL 掉持有者后再跑一次 ⇒ `reaped == [held]`（**同一个目录**这次变成残留）。`age` 那条用 `utimesSync` 把 mtime 拨回 10h ⇒ 被清；刚建的那条 ⇒ spared。

### §AC4 遥测三计数，且「零泄漏」与「没统计」不同形

```text
tmp-root-telemetry: root=/tmp/quay-suite-162387-pqCZ9k created=28 reaped=28 leaked=0 evaluated=true
tmp-root-telemetry: root=/tmp/x created=NOT-EVALUATED reaped=NOT-EVALUATED leaked=NOT-EVALUATED evaluated=false reason=proc-cwd-unreadable
```

单测 `telemetry: created/reaped/leaked are reported, and leaked=0 differs from NOT-EVALUATED` 断言：`doesNotMatch(notMeasured, /leaked=0/)` 且 `notEqual(measured, notMeasured)`。

### §AC5 干跑读数（真实 /tmp，未删任何东西）

```text
$ node --experimental-strip-types plugin/scripts/temp-root-reaper.ts --root /tmp --max-age 24h --dry-run
temp-root-reaper: root=/tmp prefix='quay-' max-age=86400000ms dry-run=true created=30973 would remove=30588 leaked=30973
  would-remove: /tmp/quay-ab-trigger-1hCQ7u
  would-remove: /tmp/quay-ac102-evidence-cD7njm
  would-remove: /tmp/quay-ac102-evidence2-HVRX2M
  … (+30585 more)
  spared (younger than max-age): 384 entr(ies)
```

条目数 30,588、前 3 条路径如上；`dry-run=true` ⇒ 一个都没删（同一时刻的实数仍是 30,973）。这份存量正是 pre-suite 有界年龄清扫要处理的部分（24h 默认、跳过 `quay-run-*`、跳过共享构建缓存）。

### §AC6 scoped 门

```text
$ bash scripts/test.sh --for-task gap-test-harness-tmp-dir-leak --allow-thin
...
ℹ tests 17
ℹ pass 17
ℹ fail 0
tmp-root-telemetry: root=/tmp/quay-suite-4025820-clolGf created=0 reaped=0 leaked=0 evaluated=true
EXIT=0
```

在 merge 了 develop（`705363252`）之后重跑；`worker-driver --verify-run` 同源读数为 `{exitCode:0, classification:"green", mustFix:[]}`，`--verify-rerun` 无可重跑项（fellBackToScopedGate，同样 exit 0）。`anti-drift-touches-check`：9 个实际改动文件全部落在 Touches（10 glob）内。

## ADR-007 dark axis

- L_G：该轴仍暗,理由:本任务只在 harness 侧新增叶子脚本（`temp-root-reaper.ts` → `gate-script-base.ts` + node 内建；`suite-temp-root.sh` 只被 `scripts/test.sh` source），未新增或反转任何包间依赖边，也未触碰 `packages/**` 的架构面；archguard 的 L_D/L_G 读数按仓库既有裁定由 milestone 级承担（`gap-fan-in-remove-archguard-gate`：逐任务布尔闸 244 次运行零指引价值），本轮未产出可比的 L_D/L_G 数字。
