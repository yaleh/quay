---
id: gap-productize-deep-semantic-dedup-scan-routine
title: 把深度语义重复扫描(08-25 多 agent 判重模式)产品化为周期 routine,而非常驻热路径闸
status: ready
labels:
  - gap
  - finding
parent: null
children: []
extra:
  schema: finding
---
**type:** finding

## Finding

`orchestration/manager-tick-log.md`(约 2026-08-25 09:4x–10:19Z 附近)记录了一次一次性人工触发的动作——用 archguard 拉出 `plugin/scripts`(2017 实体)+ `packages/quay/src`(367 实体)全量函数清单,派 7 个 subagent 并发核实 15 个疑似重复簇,确证 8 个以上真实重复(含 `findRepoRoot`/`findWorkspaceRoot` 逐字节重复的函数体、`write:state` 6 处实现分裂成原子/非原子两种)。这是 ADR-007 设想的 L_G(重复抽象)检测第一次真正跑通并抓到真缺陷的案例,但从未变成常设机制,完全依赖人偶然想起来。

**已存在但更浅的相邻机制(立案时核实,需知会执行者)**:`plugin/probes/architecture-analysis.md` 已是一个挂在 `plugin/scripts/routine-scheduler.ts`(`interval:1440m` 触发)上的周期 routine(`gap-probe-mechanism-dead-15-days-rewire-to-two-layer`,已 done),但它是**单一 fresh-context analyst 一次性通读**,用 archguard/git-lens 找环/上帝包/重复——**不是** 08-25 那种"先拉全量实体清单→分片派多个 subagent 各自核实→聚合裁决"的深度模式,后者才是真正抓到 8+ 重复的那次。此外,`routine-scheduler.ts` 当初接线的生产调用点是 `plugin/loop/fast-mode-loop-tick.md` / `orchestration/orchestrator-loop-tick.md`,而当前 CLAUDE.md(2026-09-04)记录 inner(fast-mode)已被 worker-driver 取代、outer 角色已退役并入 manager 直接 subagent 派发。**执行者落地前必须先核实 `routine-scheduler.ts`/`plugin/skills/routines/SKILL.md` 当前是否还有活的生产调用点**(搜 `manager-tick-core.md`/`worker-driver.ts` 里是否仍调用它),不能想当然认为旧接线今天还通;若已断线,本任务需要一并把触发路径接回当前活的 tick 机制。

**反例对照(不要重蹈覆辙)**:`tasks/gap-fan-in-remove-archguard-gate.md`(已 done)记录了同一个 archguard-structure 闸接进 fan-in 关键路径后,244 次运行里 `sccCount` 从未非零过一次、零指引价值、每次 27s,最终被移出关键路径——证明把 L_G 检测做成常驻热路径廉价布尔闸这条路已经走不通。深度语义判重的成本(拉全量实体 + 派多个 subagent)远高于单次布尔闸,更不能上热路径。

## Resolution（执行者实测，2026-09-13）

**接线核实（任务体要求的那一步，实测结论）**：`routine-scheduler.ts` 的活生产调用点**不是零**，但也不是任务体猜测的那两个 tick 文档。实测：`fast-mode-tick-core.md:34`(A14，**已退役的 inner 层**)是历史唯一调用点；`manager-tick-core.md`、`worker-driver.ts` **都不调用它**；真正的活调用点经 **Layer 1b `RoutineSpec`**——`quality-gate-driver.ts` 的常驻环（生产 run_id `qg-prod-*`，本机实测在跑）用 `driver-runtime.scheduleIsDue`（= `routine-scheduler.isDue`）判定 due。⇒ 断线属实，修法是把 probe 轨道接回**这个**活路径，而不是复活 inner/outer 的 tick 文档。

**实现**（`SPEC-capability-planes-and-mechanism-lifecycle-2026-09-05.md` §5.2「probe 轨道机械化」= 该 SPEC 落地顺序第 1 项）：

| 文件 | 角色 |
|---|---|
| `plugin/scripts/probe-routine.ts`（新） | 通用桥：`.quay/config.yml` `loop.routines:` 声明 → `RoutineSpec`；run() = readProbeSpec → fresh-context spawn → FILE-ONLY 守卫 → **结构化 finding 落 `.quay/routine-findings.jsonl`**。并补上 SPEC §5.2 缺的一件：**持久 last-run 窗口**（`runResidentQualityGateLoop` 的 lastRun 是进程内存态 ⇒ 每次 driver 重启都会重触发；深扫成本高，不能靠「重启就重跑」） |
| `plugin/scripts/probe-write-guard.ts`（新） | FILE-ONLY 守卫从 `meta-driver.ts` 提出（出现第二个消费者；留在 meta-driver 会形成 quality-gate-driver → probe-routine → meta-driver 的 import 环）。meta-driver 原地 re-export，实现仍只有一份 |
| `plugin/scripts/quality-gate-driver.ts` | 把声明式 probe 例程装进 Layer-1b 例程表（§5.1：⛔ 不为 probe 新造 driver kind）；配置读不出 / legacy 声明被跳过时**打到 stderr**（⛔ 不静默） |
| `plugin/probes/semantic-dedup-scan.md`（新） | 深度探针规格：① 全量实体清单 ② **分片派多个 fresh-context agent** 各自核实一批候选簇 ③ 结构化 finding（文件路径+函数名+理由），⛔ 不是布尔 |
| `.quay/config.yml`（gitignored，工作区本地） | 声明 `semantic-dedup-scan` = `trigger: interval:1440m` + `probe: semantic-dedup-scan`；写明四条 legacy `every(N)` 为何不由本轨道承接。⚠️ 该文件**不进 git**，且 `refresh-worktree-quay.sh` 会用主检出那份覆盖 worktree 那份 ⇒ 已同时写入主检出那份（生产 driver 读的是它） |
| `plugin/skills/routines/SKILL.md` | 开篇指明两层 driver 架构下的**机械通道**（本任务落的），本文件的手工通道保留给没有该 driver 的用法；两通道不得同时驱动同一 routine |

**第二轮补（2026-09-13 晚 —— 上一轮 fan-in 停在 scoped-gate 的唯一原因）**：`rhythm-consumer-check` 判据2 报 `probe-routine.ts: 按需 without a CONSUMER row — 「按需」=「无人」` 与 `probe-write-guard.ts:` 同款 ⇒ 两个新脚本的 catalog 声明只补了 5 张表，**漏了第六张 `CONSUMER`**（`QUESTION`/`CADENCE`/`INVALIDATION`/`LAST_REAFFIRMED`/`MATCHING` 都在，`--entry-surface` 也不报红，所以上一轮自己没发现）。**修法是声明真实按者，不是改 cadence 标签**——把它们标成「每轮」是把标签改得好看而不是把接线说清楚：`probe-routine.ts` 的按者是 `quality-gate-driver.ts` 的 Layer-1b 例程环（每趟 pass 用 `driver-runtime.scheduleIsDue` 对 `interval:<N>m` 判 due，due 才 spawn），`probe-write-guard.ts` 的按者是 `meta-driver.ts`（原地 re-export）与 `probe-routine.ts` 的 FILE-ONLY 守卫。改后判据2 = `97 judged, 0 violation(s)`，判据1/3 不变，整个 `rhythm-consumer-check: OK`（exit 0）。

## Acceptance Criteria

- [x] AC1: 新增或扩展一个 routine 条目(沿用/替换 `.quay/config.yml` `loop.routines:` 里已有的 `architecture-analysis`,或新增一个如 `semantic-dedup-scan`),触发方式用 `plugin/scripts/routine-scheduler.ts` 已有的 `interval:<N>m` 两层时间量机制(不是热路径闸)。命令验证:`node --experimental-strip-types plugin/scripts/routine-scheduler.ts --now <未来时刻的 epoch-ms> --last-run <空或陈旧 last-run.json>` 的输出里出现该 routine 名与 `probe <name>` 派发行。
      **证据（同一 config 的三态实测）**：新增 `semantic-dedup-scan`（`trigger: interval:1440m`）。把该 config 的 `loop.routines:` dump 成 JSON 后跑正本调度器：
      ```
      # ① 从未运行（空 last-run）⇒ DUE
      $ node --experimental-strip-types plugin/scripts/routine-scheduler.ts --now 1900000000000 \
          --last-run /tmp/ac1-lastrun.json --plugin-root <wt>/plugin /tmp/ac1-routines.json
      DUE: semantic-dedup-scan (interval:1440m) → probe semantic-dedup-scan          (exit 0)
      # ② 刚跑过（last-run == now）⇒ 窗口内不触发
      no routines due                                                                (exit 3)
      # ③ last-run 在 25h 前（> 1440m）⇒ 再次 DUE
      DUE: semantic-dedup-scan (interval:1440m) → probe semantic-dedup-scan          (exit 0)
      ```
      同一次 dump 也证明另四条 legacy `every(N)` 声明**永不 DUE**（两层模式无迭代计数）——这正是它们需要迁移的实测依据（本任务刻意不迁移，理由写在 config 注释里）。正本读者 `readLoopParams(主检出)` 读同一份 config 返回 `…, semantic-dedup-scan(interval:1440m)`（不是只有我这一条路径读得懂）。证据文件：`.quay/ac1-scheduler-evidence.txt`。

- [x] AC2: 该 routine 对应的 probe 文档(建议新建 `plugin/probes/semantic-dedup-scan.md`,或改写 `plugin/probes/architecture-analysis.md` 使其明确区分两种深度)明确要求:① 先用 archguard/等效静态提取拉出 `plugin/scripts/` 与 `packages/*/src` 的全量实体/函数清单;② 分片派发多个 subagent 各自核实一批疑似重复簇(而非单一 agent 通读全部);③ 产出**结构化 finding 列表**(每条含涉及的具体文件路径 + 函数名 + 判定理由),不是一个绿/红布尔值。
      **证据**：新建 `plugin/probes/semantic-dedup-scan.md`（frontmatter `instrument: archguard` / `fallback: git-lens` / `output_routing.duplication: milestone-candidate`），正文三节逐条对号：①「## ① Build the FULL inventory (exhaustive)」= 两个面（`plugin/scripts/` + `packages/*/src/`）全量 + archguard 主仪器 + 两个 git-lens 回退命令 + 要求报 `inventory` 规模；②「## ② Verify candidate clusters in SHARDS」= 一簇一批、每批一个 fresh-context subagent、≤6 簇/片、报 `shards`（subagent 不可用时可顺序核实但必须如实报 `shards: 1`）；③「## ③ Output: STRUCTURED findings — never a green/red boolean」= 一个 JSON 对象，每条 finding 必须带 `files` + `symbols` + `rationale`（**机器强制**：`probe-routine.ts:parseProbeFindings` 缺任一即计入 `malformed` 且不落载体）。另在 `plugin/probes/architecture-analysis.md` 顶部加 SHALLOW vs DEEP 指向块（本任务取「新建」分支，不重写旧探针）。
      **实测该探针真跑时确实按 ①②③ 走**：AC4 真跑记录 `inventory: {"plugin_scripts":1633,"package_src":276,"candidate_clusters":62,"files":353}`（= ① 全量）、`shards: 8`（= ② 分片）、53 条 finding 每条带 files+symbols+rationale（= ③）；子进程树含 archguard MCP（主仪器在场）。

- [x] AC3(负控制,呼应 `gap-fan-in-remove-archguard-gate` 的教训): 该 routine 不得挂进 fan-in/scoped-gate 等每任务必经的关键路径——验证:`grep -rn "semantic-dedup-scan\|SemanticDedupScan"` 在 `plugin/scripts/worker-driver.ts` 及 fan-in 编排相关文件里命中数必须为 0。
      **证据（逐文件计数，全部 0）**：`plugin/scripts/worker-driver.ts` 0 · `plugin/scripts/full-suite-runner.ts` 0 · `plugin/scripts/suite-driver.ts` 0 · `scripts/test.sh` 0 · `packages/quay/src/fan-in/ff-merge.ts` 0 · `grep -rn <pattern> packages/quay/src/fan-in/ scripts/` ⇒ 0。
      全仓 `semantic-dedup-scan` 的代码命中只有三类，**没有一类是接线**：`plugin/scripts/probe-routine.ts`（模块自身注释指向探针文件）；`plugin/scripts/capability-catalog.sh` 2 行 catalog 元数据（QUESTION 行的任务 id、INVALIDATION 行的探针文件名）；两个测试文件（`plugin/test/probe-routine.test.mjs`、`plugin/test/quality-gate-driver.test.mjs`）。承载它的 `quality-gate-driver.ts` 里**没有**这个名字（它按声明通用装配）⇒ 结构性证据：唯一消费者是例程型 driver 的例程表，该表与 fan-in/scoped-gate 无任何调用关系。（2026-09-13 第二轮更正：首轮此句写的是「唯一代码命中是 probe-routine.ts 加两个测试文件」，那时 catalog 的 2 行元数据确实还不存在；合并 develop 后重跑逐文件计数仍全 0。）证据文件：`.quay/ac3-negative-control.txt`。

- [x] AC4(生产载体读数): 该 routine 落地并接入一个当前确实存在生产调用点的触发路径(AC1 已核实/修复的那个)后,实际发生过至少一轮真实调度(非测试 fixture 注入),产出至少 1 条结构化 finding 记录在某可查载体(建议 `.quay/routine-findings.jsonl` 或等效追加文件),且该记录的时间戳/commit 晚于本任务实现落地的 commit——验证:比较载体记录与 `git log -1 --format=%H -- <实现文件>`。若把该 routine 的生产调用点摘掉后同一条 AC4 记录仍然存在(说明记录只是测试跑出来的,不是生产真跑的),本 AC 判假。
      **生产调用点**：`quality-gate-driver.ts` 的 Layer-1b 例程表（常驻例程型 driver，生产 run_id `qg-prod-*`，本机实测在主检出常驻运行）。入口/命令：`node --experimental-strip-types plugin/scripts/quality-gate-driver.ts --root <worktree> --once --run-id <id> --json`。
      **① 负控制（意外拿到的干净对照，先于正例发生）**：第一次 `--once` 运行（run_id `prod-semantic-dedup-20260913T175054Z`）时，worktree 的 `.quay/config.yml` 被 `refresh-worktree-quay.sh`（把主检出 `.quay/` 快照 `cp -p` 进 worktree 的既有机制）刷回旧版 ⇒ **声明缺席** ⇒ 该轮 facts 恰为内建四条、无 probe 例程、`.quay/routine-findings.jsonl` 根本不存在。⇒ **「摘掉生产调用点 ⇒ 记录不再产生」这一取假形态已实测**（本 AC 末句要求的那个对照）。
      **② 真调度（声明在场）**：run_id `prod-semantic-dedup-20260913T180336Z`（round ts `2026-09-13T18:10:51Z`）该轮 fact：
      `semantic-dedup-scan => verified | deep scan ran: 53 structured finding(s), 0 malformed, 8 shard(s), 54 record(s) appended to .quay/routine-findings.jsonl`
      fact value：`{"fired":true,"probe":"semantic-dedup-scan","role":"meta-driver","durationMs":412979,"exit":0,"runId":"semantic-dedup-scan-1789322638156","findings":53,"malformed":0,"shards":8,"inventory":{"plugin_scripts":1633,"package_src":276,"candidate_clusters":62,"files":353},"recordsAppended":54}`
      **真 LLM 探针证据**：该 spawn 的子进程树含 `archguard/mcp-launcher.mjs`（主仪器在场）与 meta-cc/quay/playwright/chrome-devtools MCP；探针墙钟 412979 ms；8 片 = 8 个 fresh-context 分片核实。
      **③ 载体记录**（`.quay/routine-findings.jsonl`，54 行 = 1 条 scan-round + 53 条 finding）：首行 ts `2026-09-13T18:03:58.156Z`；抓到的是与 08-25 人工那次同族的真重复，例如 `findreporoot-six-implementations`（`findRepoRoot`/`repoRoot`/`mainCheckoutRoot` 六处实现）、`statewriter-atomicity-leftover`、`getargvalue-38-copies`、`driver-resident-loop-scaffolding`、`cross-surface-task-parsing`、`assertsafeid-four-copies`。
      **④ 时间/commit 对照（本 AC 的判据本身）**：`git log -1 --format='%H %cI' -- plugin/scripts/probe-routine.ts` ⇒ `f86c6233b 2026-09-13T18:02:56Z`；载体记录 ts `2026-09-13T18:03:58.156Z` ⇒ **晚于实现落地 62 秒**；载体 commit `53cc833b5`（2026-09-13T18:21:36Z）亦晚于它（刻意分成两个 commit：同 commit 不算「晚于」）。
      **⑤ 不可被 fixture 单独满足**：`grep -rn "routine-findings" plugin/test/` ⇒ **0 命中**（测试只用常量 `ROUTINE_FINDINGS_REL`，且每条用例的 root 都是 mkdtemp 或显式 `--probe-state-dir`）；解析失败时载体**不写**（fail-closed，第一次运行即为此形态）⇒ 「读不懂」与「跑过了」在载体上不同形。

## Definition of Done

- 深度语义判重从"人偶然想起来的一次性动作"变成一个周期 routine,产出结构化 finding(不是布尔闸);
- AC1-4 全部勾选,AC4 的生产记录必须晚于实现落地且不可被 fixture 单独满足;
- 未挂进任何 fan-in/scoped-gate 关键路径(AC3 负控制通过);
- 涉及改动的测试套件连续 2 次绿。

## Touches

- plugin/probes/semantic-dedup-scan.md（新：深度探针规格）
- plugin/probes/architecture-analysis.md（SHALLOW vs DEEP 指向块）
- plugin/scripts/probe-routine.ts（新：通用 probe 例程桥 + 持久 last-run + 载体写端 + 解析）
- plugin/scripts/probe-write-guard.ts（新：FILE-ONLY 守卫，从 meta-driver 提出）
- plugin/scripts/meta-driver.ts（守卫改 re-export，实现搬到上面那份）
- plugin/scripts/quality-gate-driver.ts（例程表装配声明式 probe 例程 + 两个测试/运维缝）
- plugin/scripts/capability-catalog.sh（两个新脚本的 6 张表声明，**含 CONSUMER**——首轮只补了 5 张，漏 CONSUMER ⇒ `rhythm-consumer-check` 判据2 RED，即上一轮 fan-in scoped-gate exit 1 的唯一原因；本轮补上）
- plugin/skills/routines/SKILL.md（指明机械通道 vs 手工通道）
- plugin/test/probe-routine.test.mjs（新：11 例，含 no-drift 与四个负控制）
- plugin/test/quality-gate-driver.test.mjs（`--once` 用例改空工作区 root + mkdtemp 配对）
- .quay/config.yml（gitignored 工作区本地配置：声明 semantic-dedup-scan；主检出那份同步更新）
- .quay/routine-findings.jsonl（AC4 载体，追加式 JSONL；已提交）
- tasks/gap-productize-deep-semantic-dedup-scan-routine.md（本文件）
