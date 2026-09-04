---
id: gap-tests-never-clean-up-their-tmpdirs
title: "158,757 test fixture dirs accumulated in tmpfs over 9 days and filled 6.3GB
  of RAM until the inner hit quota errors"
status: done
labels:
  - gap
  - defect
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

2026-08-03 06:0xZ 内层派了三个 subagent 排查「磁盘配额错误」。外层实测根因：

**`/tmp` 是 tmpfs（内存盘，7.9 GB），里面有 166,923 个顶层条目、占 6.3 GB——占的是内存。**

前缀分布（清理前）：

| 前缀 | 个数 |
|---|---|
| `prepare-admission-` | **14,220** |
| `prep-check-` | 9,128 |
| `quay-loop-params-trig-fuzz-` | 4,337 |
| `adr-store-` | 3,590 |
| `document-store-` | 2,868 |
| `quay-qeng2-*` / `quay-doc-cli-*` | 各数百 × 十余种 |

最早的时间戳是 **2026-07-25 18:34**——**积了 9 天**，且仍在产生（清理时最新一条是当分钟的）。

### 契约满足了一半

[[gap-test-isolation-contract-is-unwritten]] 刚立的四条契约里，第一条是
「测试写入的路径必须是**每运行唯一**的（`mkdtemp`），不得是固定路径」。

**这一条是满足的**——正是因为满足，名字才带随机后缀，才会每次新建一个。
**缺的是第二半：建了之后必须删。**

**⇒ 这不是契约被违反，是契约不完整。** 补进那份契约，比新建一套机制便宜。

### 后果不是「磁盘满」而是「内存被吃掉」

tmpfs 占的是 RAM。清理前后的实测：

| | 清理前 | 清理后 |
|---|---|---|
| `/tmp` 已用 | 6,380 MB（80%） | **3,936 MB（50%）** |
| 顶层条目 | 166,923 | **8,665** |
| `free -m` 的 `shared`（tmpfs） | 4,623 MB | **2,823 MB** |
| `MemAvailable` | 5,291 MB | **7,370 MB** |
| swap 已用 | 1,779 MB | **1,142 MB** |

**今晚 swap 从 0 涨到 1.78 GB，主因就是这个**——不是负载，是泄漏。

### 速率与重现时间（外层 2026-08-03 06:43Z 实测活跃期速率，比首测高 4 倍）

**两个口径，差 4 倍，用高的那个**：

| 口径 | 速率 | 填回 166k 需要 |
|---|---|---|
| 9 天均值（158,757 / 9） | 17,600 个/天 | ~9 天 |
| **开发活跃期实测**（清理后 30 分钟新增 1,606 个） | **约 3,200 个/小时 ≈ 77,000/天** | **约 2 天** |

**首测那个 17,600/天是含空闲期的均值，会低估四倍。**
清理后 20 分钟内 `/tmp` 条目从 8,866 涨回 **10,118**——**回填是可观测的，不是推测**。

**⇒ 紧急度比任务体初稿写的高：活跃开发下约 2 天重现，不是 9 天。**

前 5 名前缀与首测一致（`prepare-admission-` 164、`prep-check-` 69、`adr-store-` 36、
`quay-loop-params-trig-fuzz-` 32、`document-store-` 20 / 30 分钟），说明**漏点稳定**，
AC1 的归因表会很快收敛。

## 派发时序与实测（2026-08-03，实际执行）

**AC1 归因搭的车**：初稿的时序约定是「搭 sigma 两次受控 back-to-back 运行」——那两次**已完成，
sigma 已合并**。实际执行搭的是**协调方的 fan-in 全量套件**（跑在主工作树，pid 752812，日志
`/tmp/sigma-fanin-fullsuite.log`）。AC3 的修复前/后对照 = 本次样本 #1（修复前）+ 关闭 sigma 时
协调方跑的套件（修复后）。

| 时点 | `/tmp` 顶层条目 | 说明 |
|---|---|---|
| 派发基线（套件运行中） | 15,297 | 套件已开跑几分钟，基线含在飞条目 |
| 套件 #1 完成（后计数） | 15,649 | 净 **+352**（部分窗口——基线在套件中途采，非全量窗口） |
| M136 重跑前快照 | 15,673 | `/tmp/snapshot-pre-rerun.txt`（全量列表，供前缀级归因） |
| M136 重跑后计数 | 16,244 | 净 +571（快照采在重跑中途，尾部含协调方/外层活动；新增前缀多为 `quay-dir`/`quay-gap`/`rui-*`/`quay-qeng4-*`，非泄漏测试前缀） |
| 修复后套件（AC3 后计数） | （待协调方通知） | 与样本 #1 构成修复前/后对照 |

## AC7 记录：外层 2026-08-03 一次性清理

**命令**（外层 `unblock` tick 执行，>2h）：按 fixture 前缀匹配 `/tmp` 顶层目录并删除，
**显式排除 `quay-wt-*`（在用 worktree）与 `claude-*`（会话数据）**：
```bash
# 代表性形态（外层实际执行）
find /tmp -maxdepth 1 -type d \( -name 'prepare-admission-*' -o -name 'prep-check-*' \
  -o -name 'quay-loop-params-*' -o -name 'adr-store-*' -o -name 'document-store-*' \
  -o -name 'quay-qeng2-*' -o -name 'quay-doc-cli-*' \) ! -name 'quay-wt-*' \
  ! -name 'claude-*' -exec rm -rf {} +
```
**结果**：**删 158,757 条目、释放 2,454 MB**。`/tmp` 80%→50%、tmpfs 占内存 4,623→2,823 MB、
MemAvailable 5,291→7,370 MB、swap 1,779→1,142 MB。

**⚠ 清理脚本不是修复（AC7）**：判据是 **`leaked_after_suite = 0`**，不是 `/tmp` 当下有多空。
外层清理只清存量；只要测试还在 `mkdtemp` 而从不删，回填速率（活跃期约 3,200/小时）会重新填满。
修复 = AC2（给泄漏测试加 `try/finally` / `t.after()` 删除）+ 本任务 R6 契约规则。

## 交叉标注（2026-08-05，AC5 of gap-tests-leak-tmux-servers-main-resource-pressure-and-crash-cause）

同族任务：测试起外部进程/服务器却不在 teardown 回收。本任务管「mkdtemp 建了目录不删」（tmpfs 内存泄漏），
姊妹任务管「测试起了 tmux server 不 kill」（进程泄漏，217 个 tmux server / PSI cpu 94→31）。两条同根：
**测试必须回收它自己创建的外部资源**。姊妹任务的套件尾部断言（`plugin/scripts/tmux-leak-scan.sh`，
`skv-`/`session-liveness-`/`ol-tok-`/`enter-repro-` 前缀）与 teardown 修复（`tmux kill-session -t <名>`，
绝不用 `kill-server`）交叉覆盖，互不替代。

## Contract

```
measure  tmp_entries = `ls -1 /tmp | wc -l` 输出的行数字段
measure  tmp_used_mb = `df -m /tmp` 第二行的 Used 字段（MB）
measure  leaked_after_suite = 跑一次全量套件前后 `ls -1 /tmp | wc -l` 的差值字段
band     leaked_after_suite = 0                                   # 一次套件跑完不应净增任何条目
invariant 清理规则永不匹配 `/tmp/claude-*` 与 `/tmp/quay-wt-*`      # 前者是会话数据，后者是在用 worktree
invoke   `bash scripts/test.sh` 前后各跑一次 `ls -1 /tmp | wc -l`
control  故意留一个不清理的 mkdtemp fixture ⇒ leaked_after_suite 必须 > 0
resume   n/a: 单次测量，无中途产物
```

## Chosen mechanism

**先量出是谁在漏，再修那几个；不要全局加清理钩子。**

1. **归因**：跑一次全量套件，记录前后 `/tmp` 新增条目及其前缀。
   **前缀直接指向创建它的测试**（`prepare-admission-` → `prepare-admission-check` 的测试，
   `quay-doc-cli-*` → 文档 CLI 的测试）。输出一张「前缀 → 测试文件 → 每次跑泄漏数」的表。
2. **修漏得最多的那几个**：按上表的头部处理，用 `try/finally` 或 `t.after()` 删除。
   **不追求一次修完全部**——头部几个就覆盖大半（`prepare-admission-` 一个就占 14,220 / 158,757 ≈ 9%）。
3. **补契约**：在 [[gap-test-isolation-contract-is-unwritten]] 的四条后加第五条——
   **「`mkdtemp` 建的目录必须在同一测试内删除」**，并接进它已有的扫描器
   （静态可判：有 `mkdtemp` 而无对应的 `rm`/`rmSync`/`after` 即报出）。
4. **一次性清理留给运维，不进代码**：外层 2026-08-03 已清一次的命令记进任务体作为参考，
   但**清理脚本不是修复**——`leaked_after_suite = 0` 才是。

**不做**：不加全局 `process.on('exit')` 清理钩子（它在 `process.exit()` 下不执行，
而本仓库已知有 8 个手写 harness 用 `process.exit(1)`——那正是它会漏掉的路径）；
不改 tmpfs 大小；不把 `/tmp` 换成磁盘路径（那只是把内存问题换成 I/O 问题）。

### 派发时的时序约定（外层 2026-08-03T08:07:33Z）

**AC1 的归因不需要自己跑一次全量套件——搭车即可。**

它需要的只是在**任何一次**全量套件运行的前后各数一次 `ls -1 /tmp | wc -l`，
并记下新增条目的前缀分布。派发时 `gap-suite-sigma-distribution-stale-after-retirement`
正在做受控 back-to-back 重测，**直接搭那两次运行的车**。

**理由**：两者文件正交（`checkTouchesPair` 已复核 DISJOINT），但**资源上互斥**——
都要求干净的低负载窗口。搭车既拿到归因数据，又不打扰 sigma 的窗口。
这是 [[gap-dispatch-eligibility-blind-to-files-that-do-not-exist-yet]] 记的那类冲突的一个**廉价规避**，
不是它的修复。

**派发时的实测规模**：`/tmp` 15,052 条目（外层清理后 8,866）、近 30 分钟新增 1,836 个、
占用 3899/7994 MB。

## 执行记录（2026-08-03，worktree agent-ae4194bd3188feacd）

- **AC2（修前 4）**：给泄漏量前 5 里的 4 个可归因测试加删除——`packages/quay/test/adr-store.test.mjs`
  （`adr-store-` 3,590）、`packages/quay/test/document-store.test.mjs`（`document-store-` 2,868）、
  `packages/quay/test/loop-params.test.mjs`（`quay-loop-params-*` 4,337，含 `trig-fuzz` leg）、
  `plugin/test/prepare-admission-check.test.mjs`（`prepare-admission-` 14,220 ≈9%）。
  **每个用 node:test 文件级 `after()` 钩子**（等效 `t.after()` 于文件作用域；失败路径也执行，与
  `process.on('exit')` 不同——后者在 `process.exit(1)` 下不跑）。单文件实测泄漏为 0
  （`before==after`，前缀计数不变）。**`prep-check-`（9,128）在现行源码里找不到创建者**
  ——该前缀目录含 `charter.md/plan.md/r.json/task.md`，像是外层/退役 prepare 流程的 preflight 工作区，
  非当前测试文件产物；留作未归因。
- **AC5（R6）**：`docs/analysis/test-isolation-contract.md` 加 **R6**（R1–R5 已存在，R5 为 2026-08-03
  浅克隆规则）；`plugin/scripts/test-isolation-check.ts` 加 `mkdtemp-no-cleanup` 判定并接进 `detectAll`；
  违规名单（shrink-only 棘轮）从 23 → **51** 条（28 条为 R6 现行违规，一次性 re-baseline）。
- **AC6**：R6 判定**永不匹配** `/tmp/claude-*` 与 `/tmp/quay-wt-*` 前缀（fixture 断言两个方向）。
- **AC4（负控制，fixture 级）**：`plugin/test/test-isolation-check.test.mjs` 里「去掉清理 ⇒ 报出
  >0；恢复 `t.after` ⇒ 回到 0」双向断言通过。**套件级**负控制（`leaked_after_suite > 0`）待 AC3
  的修复后全量套件运行时一并验证。
- **未做（留待关闭时）**：AC3 修复前/后对照（样本 #1 + 关闭 sigma 时的修复后套件）——需全量套件
  实测；本次套件窗口互相重叠（派发基线在套件中途采、重跑快照也在中途采），没有干净的修复前全量窗口，
  故归因表用**静态调用计数**（确定性的每次泄漏数）+ 外层实测速率交叉验证。

## AC1 归因表（前缀 → 创建它的测试文件 → 每次全量套件泄漏几个）

**每次全量套件泄漏数** = 创建文件里 `mkdtemp` 助手的**调用次数**（每个调用一次运行建一个目录、从不删；
`function` 定义本身不算，故为实测调用数）。**修复前**。修复后（AC2 已加 `after()` 钩子）这些变为 0。

| 前缀 | 创建它的测试文件 | mkdtemp 助手调用/套件 | 外层 30 分钟实测速率（2026-08-03 06:43Z） |
|---|---|---|---|
| `prepare-admission-` | `plugin/test/prepare-admission-check.test.mjs`（`makeWorkspace()`） | **42** | 164 |
| `quay-loop-params-*`（含 `trig-fuzz`） | `packages/quay/test/loop-params.test.mjs`（`tmpWs(tag)`） | **46** | 32（`trig-fuzz` leg） |
| `adr-store-` | `packages/quay/test/adr-store.test.mjs`（`tmpDir()`） | **13** | 36 |
| `document-store-` | `packages/quay/test/document-store.test.mjs`（`tmpDir()`） | **11** | 20 |
| `prep-check-` | **现行源码里找不到创建者**（目录含 `charter.md/plan.md/r.json/task.md`，像是外层/退役 prepare 流程的 preflight 工作区） | ？ | 69 |

实测差值（样本）：套件 #1 净 +352（部分窗口）、M136 重跑净 +571（部分窗口，新增多为协调方/外层
`quay-dir`/`quay-gap`/`rui-*`/`quay-qeng4-*` 活动）。两个窗口都因基线中途采样而不干净；干净的修复前
全量窗口缺失，故以静态调用计数为准。`prep-check-` 的创建者不在套件内，**本任务无法修复**（留待外层确认
来源）。

## Acceptance Criteria

- [x] AC1: 归因表完成——「前缀 → 创建它的测试文件 → 每次全量套件泄漏几个」，
      **依据是套件前后的实测差值，不是猜测**（agent 用确定性静态调用计数 + 外层实测速率交叉验证，
      因两个套件窗口都重叠、无干净修复前全量窗口；见下方 AC1 归因表）
- [x] AC2: 修复泄漏量前 5 里的 4 个可归因测试（`prep-check-` 无源不可修）；每个用
      `try/finally` 或 `t.after()`，**不用全局钩子**
- [x] AC3: **主判据**——修复后全量套件（2026-08-03 08:33–08:40，fan-in suite，2054 tests 绿）：
      4 个修复前缀（`prepare-admission-`/`quay-loop-params-`/`adr-store-`/`document-store-`）
      **最近 10 分钟 0 个新目录**（最新 mtime 停在修复合并前的 08:24），即修复后每次套件泄漏 **0**，
      对比修复前静态 ~112/套件（42+46+13+11）→ **100% 下降（≥80% 达标）**。
      ⚠ 原始 /tmp 净增 +470（16,243→16,713）含范围外的 `quay-qeng` 泄漏 + token agent 并发 scoped
      测试，**不是**本任务修复的信号（外层方法提醒：不能拿墙钟速率/原始计数做分母）
- [x] AC4: **负控制双向**——`plugin/test/test-isolation-check.test.mjs` fixture 级：去掉清理 ⇒
      检测器报出（泄漏>0）；恢复 `t.after` ⇒ 回到 0。套件级「恢复方向」由本次 post-fix 套件实证
      （4 前缀 0 新目录）
- [x] AC5: 契约补第六条 R6「`mkdtemp` 建的必须删」（契约已含 R1–R5，R5 为 2026-08-03 浅克隆规则），
      并接进 `test-isolation-check.ts` 的静态扫描；违规名单是 shrink-only 棘轮（23 → 51，一次性 re-baseline）
- [x] AC6: 扫描器**永不匹配** `/tmp/claude-*` 与 `/tmp/quay-wt-*`——用 fixture 断言这两个前缀被排除
- [x] AC7: 任务体记录外层 2026-08-03 那次一次性清理的命令与结果（158,757 条目 / 2,454 MB），
      **并注明清理脚本不是修复**（见 AC7 记录节）
- [x] AC8: 未新增测试文件（只改现有）；改动文件均带 `// @test-group`

## Definition of Done

- [x] AC1 的归因表与 AC3 的修复前后对照贴进任务体（见上方 AC1 归因表 + 执行记录 + AC3 判定）
- [x] AC4 的双向负控制输出贴进任务体（fixture 级双向断言 + 套件级恢复方向实证）
- [x] `scripts/test.sh` 全绿：fan-in 套件 **2054 tests / 2035 pass / 0 fail / 0 cancelled / 19 skipped**
      （exit 0，`/tmp/tmpdirs-fanin-fullsuite.log`）；前一 sigma 重跑亦绿（2052）。2x-绿以
      「合并后 fan-in 套件绿 + scoped 149/149 + 检测器 selftest 36/36」为证
- [x] 明确记录：**隔离契约的第一条被满足，才使这个泄漏成为可能**——
      `mkdtemp` 保证了每次新建一个唯一目录，而没有任何一条规则要求删掉它。
      **一条只写了一半的契约，比没有契约更容易让人以为问题已经解决**

## Touches

- plugin/scripts/test-isolation-check.ts
- plugin/test/test-isolation-check.test.mjs
- docs/analysis/test-isolation-contract.md

## Dispatch review

reviewer: outer
at: 2026-08-03T06:15:00Z
changed: 初稿想加一个全局退出钩子；改为「先归因再修头部几个」——理由是本仓库已知有 8 个手写 harness 在失败路径用 `process.exit(1)`，而 `process.on('exit')` 在那条路径下不执行，全局钩子恰好会漏掉最需要它的地方。并把「清理脚本不是修复」写进 AC7，因为外层已经清过一次，容易让人误以为问题已解决——判据是 `leaked_after_suite = 0`，不是 `/tmp` 当下有多空
