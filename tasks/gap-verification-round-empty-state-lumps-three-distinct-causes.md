---
id: gap-verification-round-empty-state-lumps-three-distinct-causes
title: /tests 空状态把三个不同成因合并成一句「尚未跑过验证轮」—— 结构性问题被说成时序问题
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（2026-09-13 实测，真实第三方项目 `/home/yale/work/quay-fleet`）**：`/tests` 页面显示

```
Tests — 验证轮记录
数据源：.quay/verification-round.jsonl（每轮 suite 完成时追加，红绿皆入账）
未接入/无数据 — .quay/verification-round.jsonl 不存在（尚未跑过验证轮 → 未接入）
```

**该措辞把三个不同成因合并成一句话**，而其中只有一个成因与「再跑一轮」有关 ⇒ 读者被导向一条对另外两个成因**并不存在**的解决路径。

**⛔ 立案时被证伪的一个前提（保留此段，以免再犯同形错误）**：本条初稿曾依据 `plugin/scripts/full-suite-runner.ts` 与 `plugin/scripts/pre-verified-round-record.ts` 的**头注释**（"the only other verification-round writer" / "the SHARED verification-round writer"）断言「该载体只有两个写者、都只在 quay 自己的路径上 ⇒ 第三方结构上永远无数据」。**那是旧注释，不是当前的执行路径** —— 当前路径是 `plugin/scripts/worker-driver.ts:1225 readLoopTestOutput`（其头注释自带 `gap-verification-round-bound-to-quay-shaped-suite-entry AC5` 标记）与同文件的 `appendDelegatedSuiteRound`：第三方项目经机械 fan-in **能**落账，已在真实第三方项目 archguard 上真跑验证过。⇒ **本任务不碰写者接入，只修「措辞 + 取值枚举」这一半。**

**对照读数（决定性，2026-09-13 实测）**：

```
quay-fleet  .quay/fan-in-step-trace.jsonl      不存在                     ⇒ fan-in 从未在此跑过
quay-fleet  .quay/config.yml loop.test_output  已声明（node --test 形状）  ⇒ 写者能力已具备
            readLoopTestOutput('/home/yale/work/quay-fleet') → {pass,fail,cancelled,tests}
            负控制 readLoopTestOutput('/tmp')                 → null
quay 自己   .quay/fan-in-step-trace.jsonl      11305 行，verification-round-record 步 13 次
```

⇒ quay-fleet 的页面报的其实是**使用状态**（有写者能力、尚未产出记录），却被渲染成与「本项目根本无写者接入」**逐字相同**的一句话。

**现状契约（不得回归）**：`packages/quay/src/observation.ts:10-16` 的 DEGRADATION CONTRACT 已经把 `status:"empty"`（无数据）与 `status:"error"`（读失败）做成**可区分**的两态，并写明「『无数据』 and 『读失败』 are ALWAYS distinguishable」。**缺陷不在这一层** —— 而在于 **`empty` 这一个取值内部还压着两个成因**，且它的 `reason` 串把其中一个成因说成了时序问题（「尚未跑过验证轮」）。这正是硬规则 3 的反面：布尔化的取值把两个需要不同处置的状态合并了。

**⛔ 仅追溯，不构成依赖声明**：quay-fleet 的 fan-in 至今一轮未跑，级联自 `gap-drivers-resolve-quay-scripts-under-project-root-not-plugin-root`（driver 的实质判据在该项目上全部取不到值）。**本任务不依赖它修复** —— 措辞与取值枚举在渲染侧即可取真实读数验证。

<!-- dedup-ref -->
## 与既有任务的关系（仅追溯，⛔ 不构成依赖声明）

- **`gap-verification-round-bound-to-quay-shaped-suite-entry`（done，2026-09-12）** —— **同一页面、不同半边，⛔ 不要重做它**：它覆盖的是**写者接入**（第三方用自己的 suite 入口时台账结构性缺失），AC1–AC5 已在真实第三方项目 archguard 上跨机验证并 done。它的 AC3 证据里那句 `未接入/无数据 — .quay/verification-round.jsonl 不存在（尚未跑过验证轮 → 未接入）` **正是本任务要改的那句**，但它只要求「该串不再出现（因为终于有记录了）」，**从未要求区分『没有记录』的不同成因**。⇒ 本任务只取它未覆盖的**措辞 / 取值枚举**那一半。
- **`gap-ac95-webui-15-views`（done）** —— 其 AC3 只要求「空态诚实：数据源空/不可用渲染『未接入/无数据』，不得留白/显示 0」，即**把空态当成一个取值**；本任务要求的正是把那一个取值再拆开，⛔ 不与它冲突，是它的细化。

## Plan

1. **先取直接量，再动代码**：打印 `readTests()` 当前实际产出的 `(status, reason)` 全部取值（⛔ 不要只报结论；引用计数前先打印匹配到的实际内容，硬规则 2）。
2. **把 `empty` 拆成两个取值**：`no-writer`（本项目无任何写者接入路径）与 `writer-but-zero-records`（有写者能力、尚未产出记录）。判定量由实现者定，但**必须是渲染时读得到的直接量**（如工作区 `.quay/config.yml` 的 `loop.test_command` / `loop.test_output` 声明、fan-in 痕迹载体是否存在），且**必须能取假** —— ⚠️ 硬规则 4c：该量要穿过 `observation.ts` 这一层仍取得到，⛔ 不要挑一个只有 driver 侧才有的量。
3. **渲染三态**：`serve-render.ts` 的 `obsNote` 按取值给出不同文案；`no-writer` 给**接入指引**，`writer-but-zero-records` 才允许出现「等一轮」语义，`unreadable` 保持既有「读失败」形态。
4. **把 (b) 半边的契约说清楚**：或提供并文档化一个公开的 append 入口，或明确裁定「第三方只能经机械 fan-in 落账」并把这一事实写进指引 —— 两者都算把契约说清楚，⛔ 但不得两者都不做而只改措辞。
5. **负控制（不得回归）**：quay 自己（已有 1500+ 条记录）的 `/tests` 页面文案**不得变化**；打印改前/改后两向 diff。

## Plan 落实（实现者记录）

- **取值枚举（`packages/quay/src/observation.ts`）**：新增 `TestsStatus = "ok" | "empty-no-writer" | "empty-writer-zero-records" | "error"`，`TestsResult.status` 从 `ObservationStatus` 换成它。**判据落在 `status` 上而不是只在散文里**（DoD 明令：⛔ 不得三个成因仍共用同一个 status 取值）——`reason` 只承载**证据**（探到了哪些声明）。
- **判定量 = `detectRoundWriterPath(root)`**：由 `<root>` 单独可读（穿过 `observation.ts` 这一层仍取得到 —— 硬规则 4c；⛔ 没有挑 driver 侧才有的量），且**能取假**（见 AC2/AC3 读数）。
  - `wired = 存在 <root>/scripts/test.sh  ∨  loop.test_command 为非空字符串`
    —— 这**正是机械 fan-in 自己解析 suite 入口的两个信号**（`worker-driver.ts` 的 `resolveScopedGateCommand` / `suiteRunsOutsideRunner`），所以**页面与 fan-in 对「这里能不能落账」的判断同源**，不会各说各话。
  - `loop.test_output` **只作为证据上报，本身不把写者判为已接入**：解析约定 ≠ 可跑的入口；把只有解析声明的项目报成「已接入」是伪造能力（硬规则 3b）。单测 `detectRoundWriterPath: loop.test_output is reported as EVIDENCE but does not by itself wire a writer` 钉死这一点。
  - 读法是**直读 `<root>/.quay/config.yml`，不做向上搜索** —— 一个工作区由**它自己**的声明判定，不继承父目录（单测：`reads <root> DIRECTLY — a parent workspace's loop config does not leak in`）。
- **三态渲染（`packages/quay/src/serve-render.ts` 的 `obsNote`）**：`empty-no-writer` → 「未接入/无数据」；`empty-writer-zero-records` → 「已接入/暂无记录」；`error` → 既有「读失败」。**「等一轮」语义只出现在 `empty-writer-zero-records`**；`empty-no-writer` 给的是接入指引。既有的通用 `empty` 取值保留给其它观测源（它们的缺失只有一个成因），文案不变 ⇒ 别的页面零位移。
- **DEGRADATION CONTRACT 不回归**：`observation.ts` 头注释补 REFINEMENT 段，写明这次是**加宽取值集合**、不是放松「无数据 ≠ 读失败」；`error` 仍表示「存在但读不了」。
- **AC4 所选 = ②**（见下）。

## Acceptance Criteria

- [x] AC1（负控制，改前必须红）：在 **quay-fleet**（已声明 `loop.test_output`、`.quay/verification-round.jsonl` 不存在）渲染 `/tests` —— 改前页面含「尚未跑过验证轮」；改后该串**不再出现**，代之以「有写者接入、尚未产出记录」语义的文案。贴出改前/改后两段**实际 HTML 文本**（⛔ 不以 HTTP 200 为证据，硬规则 4）。**〔证人换人，见「验证证据」§0：quay-fleet 在本轮取证前已离开该态，改用同样真实且正在该态的 `quay-init --loop` 工作区〕**
- [x] AC2（枚举而非布尔，硬规则 3）：三个取值 `no-writer` / `writer-but-zero-records` / `unreadable` 的实际渲染文案**两两不同形** —— 逐条打印三条文案原文；任意两条相同即判红。其中 `unreadable` 仍与另两者可区分（⛔ `observation.ts:10-16` 的既有 DEGRADATION CONTRACT 不得回归）。
- [x] AC3（`no-writer` 给的是接入指引而不是等待暗示）：在一个**无写者接入路径**的工作区（无 `loop.test_output` 声明、无 fan-in 可达性）渲染 `/tests`，文案明确指出「本项目无写者接入该载体」并给出接入方式；**该指引点名的入口必须实际存在**（文件路径可读 / 子命令可解析到）—— ⛔ 不得写一个不存在的命令名，否则只是把一句误导换成另一句。
- [x] AC4（契约落地，二选一并在任务体写明所选）：① 提供并文档化公开 append 入口 ⇒ 在 quay-fleet 上真跑一次，页面**离开** `writer-but-zero-records` 态并显示该轮的 `state` 与 `tests` 计数；或 ② 裁定「第三方只能经机械 fan-in 落账」⇒ 把该事实写进 AC3 的指引与文档，并在一个 fan-in **可跑**的工作区（quay 自己或 archguard 形态）真跑一轮，证明该契约陈述为真。⛔ 不得两条都不做。**〔本任务选 ②，并把 ① 的边界一并写清 —— 见下〕**
- [x] AC5（不回归）：quay 自己（已产出记录态）的 `/tests` 页面文案与改前**逐字一致** —— 打印两向 diff，差集为空。
- [ ] AC6：全量 `bash scripts/test.sh` 绿 —— 由 fan-in 机械跑全量（**本 worker 按派发契约不跑全量套件、不调 fan-in workflow**，故此项只能由外层验证，⛔ 不在此虚勾）—— 外层 verification-round 验证

## Definition of Done

- 六条 AC 全部满足。
- **AC1 的证据取自真实第三方项目 quay-fleet（非 fixture）**，AC5 的证据取自 quay 自己的生产载体 `.quay/verification-round.jsonl`；**fixture 满足不算数**（硬规则 4 推论三：一个只能被 fixture/注入数据满足的判据不是测量）。若某一态（如 `unreadable`）确实无法取到真实实例，须在任务体写明**为什么**，⛔ 不得默默用 fixture 顶替而不标注。**〔执行结果：AC5 逐字满足；AC1 的原证人 quay-fleet 在取证前已离开该态，改用另一个真实第三方工作区，理由与读数见「验证证据」§0 与 §1；`unreadable` 取不到真实实例的理由见 §2〕**
- 两个真实项目恰好覆盖两个需要区分的取值：**quay-fleet = 有写者能力、零记录**；**quay 自己 = 有写者且已产出**。⇒ ⛔ 不必为这两态另造 fixture。**〔执行结果：quay-fleet 不再处于「零记录」态（已 1043 行），该态由 `/home/yale/.quay-verify-dryrun/proj` 覆盖 —— 同样是真实第三方工作区、由产品自己的 `quay-init --loop` 铺出〕**
- ⛔ **不得改动 `plugin/scripts/pre-verified-round-record.ts`** —— 其头注释第 6-12 行的裁定「⛔ RETIRED FROM THE FAN-IN PATH … do NOT re-wire it into the fan-in path — route through the runner instead」经复核成立。**〔未改动，`git diff` 可核〕**
- ⛔ **不得只在页面上多加一句话而让三个成因仍共用同一个 `status` 取值** —— 取值本身必须可枚举（硬规则 3），否则下一个读者仍然无法从数据上区分它们。**〔已满足：`TestsStatus` 四个取值，成因在 `status` 上，不在散文里〕**

## 验证证据（2026-09-13 实测）

渲染一律取自**真实进程产出的 HTML**（起真 `quay serve`，`GET /tests`，取页面正文；访问日志指向 `/tmp`），
⛔ 不以 HTTP 200 为证据（硬规则 4）。改前/改后由**换源码跑两遍**取得（`git checkout HEAD~1 -- <两个源文件>` →
渲染 → `git checkout HEAD -- <同两个文件>` → 核对还原，见 §5 的还原核验）。

### §0 ⚠️ 取证现场的漂移（先记，因为它改变了 AC1 的证人）

立案（`09:09:57Z`）时 quay-fleet 的 `.quay/verification-round.jsonl` **不存在**。本轮取证（`10:2xZ`）时它已有
**1043 行**，首行时间戳 `2026-09-13T08:49:16Z` —— 即**该项目的 loop 在立案前 20 分钟就已开始落账**，任务体里
「不存在」的对照读数取自更早的一次测量。⇒ **AC1 的证人换成另一个真实、且此刻正处在目标态**的第三方工作区：

```
/home/yale/.quay-verify-dryrun/proj
  头注释自述      : "Generated by quay-init --loop (gap-cold-start-...-eight-steps AC7b)"
  loop.test_command: node --test          ← 写者入口已声明
  scripts/test.sh  : 不存在
  .quay/verification-round.jsonl : 不存在 ← 零记录
  .quay/runtime/bin/quay-native.js: 1134806 B（安装机制铺出的真实产物）
```

它**不是 fixture**：由产品自己的 `quay-init --loop` 铺出、从未被本任务改过一个字节。
**quay-fleet 的证据没有丢** —— 它反而变成了更强的 AC4 证人（见 §4）。

### §1 AC1（负控制：改前必须红）

同一工作区、同一 URL、同一进程形状，只换源码：

**改前**（`HEAD~1` 的 `observation.ts` + `serve-render.ts`）：

```html
<p class="meta"><strong>未接入/无数据</strong> — .quay/verification-round.jsonl 不存在（尚未跑过验证轮 → 未接入）</p>
```

**改后**：

```html
<p class="meta"><strong>已接入/暂无记录</strong> — .quay/verification-round.jsonl 不存在，但本项目已接入写者（loop.test_command）—— 机械 fan-in 在下一轮 suite 完成后即写入该载体（尚未产出记录，不是未接入）</p>
```

⇒ 「尚未跑过验证轮」**不再出现**；文案改成「有写者接入、尚未产出记录」，并且**括注写明了出处**
（`loop.test_command`）—— 读者能看见「已接入」这个判断是从哪个声明得出来的，而不是一个无法证伪的断言。

**同一组对照还暴露了本任务真正要修的东西**（这也是「改前必须红」的最强形态）：改前，
`/home/yale/.quay-verify-dryrun/proj`（**有写者、零记录**）与 `/tmp/tse-nowriter-ws`（**产品自己的
`quay init` 铺出、无写者接入路径**）两个**结构上完全不同**的工作区，渲染出**逐字相同**的一行
（两段 HTML 除页面外壳外完全一致）。改后两者分别渲染 §1 与 §3 的两行。

### §2 AC2（三态文案两两不同形）

```
no-writer           : <p class="meta"><strong>未接入/无数据</strong> — &lt;REASON-A&gt;</p>
writer-zero-records : <p class="meta"><strong>已接入/暂无记录</strong> — &lt;REASON-B&gt;</p>
unreadable          : <p class="meta"><strong>读失败</strong> — &lt;REASON-C&gt;</p>
ok（无记录时）       : ""            ← 空串，页面不留任何 obsNote
PAIRWISE DISTINCT   : true
```

`unreadable`（= 既有 `error`）仍与另两者可区分：**改后**用 `/tmp` 之外的一个真实文件系统条件取到它 ——
在 `.quay/verification-round.jsonl` 放一个**目录**（`existsSync` 为真、`readFileSync` 抛 EISDIR），
真实命中「存在但读不了」分支，`status="error"`、文案「读失败」。
⛔ **为什么 `unreadable` 取不到「真实生产实例」**（DoD 要求写明理由）：该态要求生产上真有一份
**存在却读不动**的台账（权限/IO/类型错误）。本环境三台工作区（quay / quay-fleet / 两个 cold-start 遗留）
的台账都正常可读，没有这样的实例；**这一态的行为未经改动**（改前改后同一分支、同一文案），
本任务的改动只是不让它和另外两态混同，故用真实 fs 条件（目录）覆盖，⚠️ 并在此**显式标注**而非默默顶替。
测试文件里三态各自的断言见 `packages/quay/test/serve-tests-empty-state.test.mjs`。

### §3 AC3（无写者 ⇒ 接入指引，且点名的入口真实存在）

工作区 `/tmp/tse-nowriter-ws`：由**产品自己的**`node packages/quay/bin/quay.js init --root …` 铺出 ⇒
`.quay/config.yml` 的 `loop:` 段里**没有** `test_command` / `test_output`，也没有 `scripts/test.sh`。
改后该工作区的 `/tests` 实际 HTML（节选状态行）：

```html
<p class="meta"><strong>未接入/无数据</strong> — 未接入：.quay/verification-round.jsonl 不存在，且本项目无写者接入该载体（未发现 scripts/test.sh；.quay/config.yml 的 loop 段也未声明 test_command / test_output）—— 再跑多少轮也不会有记录。接入方式：在本项目 .quay/config.yml 的 loop 段声明 test_command（plugin/scripts/quay-init.sh 写入；等价入口 /quay:init --all --loop），机械 fan-in 即会落账</p>
```

明文写出「**再跑多少轮也不会有记录**」（堵掉等待暗示）+「接入方式」。指引点名的入口**逐个核过存在**：

| 点名 | 存在性核验 |
|---|---|
| `.quay/config.yml` 的 `loop.test_command` | 写者侧真读它：`plugin/scripts/worker-driver.ts` 的 `readLoopTestCommand`；渲染侧 `detectRoundWriterPath` 同源 |
| `plugin/scripts/quay-init.sh` | 文件存在（153659 B）且真写 `test_command`（`grep -c test_command` > 0） |
| `/quay:init --all --loop` | `plugin/skills/init/SKILL.md` 存在，且 CLI 侧 `quay init --loop` 会**明确报错**指向它（`packages/quay/src/cli/init.ts:81-90`） |

这三条由单测 `AC3: every entry the no-writer guidance names actually exists` 钉死（读真实文件，不查字面量）。

### §4 AC4（**所选：②**）——契约陈述 + 真跑一轮的证据

**所选 ②，并把 ① 的边界同时写清**（因为只写「只能」会是一句**假**陈述，这正是本任务要消灭的形态）：

1. **quay 不为第三方提供独立的「追加一轮」入口** —— 已核：`quay --help` 的全部子命令
   （task/adr/goal/meta/action/gate/gate-log/complete/adjudicate/promote/retreat/run/migrate/config/serve/mcp/manager/driver）
   中**没有**任何 append 台账的动词。唯一那个通用写者 `plugin/scripts/pre-verified-round-record.ts`
   按自己的头注释裁定**已退出 fan-in 路径**，本任务**未改动它**（DoD 明令）。
2. ⇒ **第三方落账的正路 = 机械 fan-in**：项目声明 `loop.test_command`（即 `detectRoundWriterPath` 的
   `wired`）后，fan-in 跑完 suite 就调 `appendDelegatedSuiteRound` 写行。**这句话已写进 AC3 的指引**
   （「机械 fan-in 即会落账」）与 `observation.ts` 里该分支上方的 AC4 注释块。
3. **项目也可以自己写**（quay-fleet 的 `scripts/test.sh` 就自己追加）—— 这不与上一条冲突：声明入口是
   **充分**条件，不是唯一条件。⛔ 把契约写成「只能经 fan-in」会是假陈述，故按实际写清。

**契约陈述为真的证据（真实第三方项目、真实 fan-in 轮次，非 fixture、非本任务触发）**：

```
/home/yale/work/quay-fleet/.quay/verification-round.jsonl   共 1043 行
  runner=="inner"（机械 fan-in 写入）的行 = 3：
    round=341  runId=mfi-fleet-agent-sessions-transcript-endpoint-…  taskId=fleet-agent-sessions-transcript-endpoint  state=red    tests=0  scope=worktree
    round=469  runId=mfi-fleet-agent-sessions-transcript-endpoint-…  taskId=fleet-agent-sessions-transcript-endpoint  state=red    tests=0  scope=worktree
    round=924  runId=mfi-test-sh-emit-perfile-markers-…              taskId=test-sh-emit-perfile-markers              state=green  tests=55 scope=worktree

/home/yale/work/quay/.quay/verification-round.jsonl         共 1632 行，by runner = {inner: 1279, outer: 350, None: 3}
```

⇒ 第三方项目**确实**能经机械 fan-in 落账，且落的是**带 `state` 与 `tests` 计数**的完整行。
⚠️ **取证边界（不粉饰）**：这几轮由**正在运行的 loop 自己**跑出（本 worker 按派发契约**不跑 suite、
不调 fan-in workflow**，见 AC6 注），⛔ 不是我为这条 AC 现造的一轮；时间戳 `09:59/10:05/10:11Z`
均早于本轮实现（`10:2xZ`），故它们是**先于**本任务存在的事实证据，不是被本任务制造出来的。
另外 quay-fleet 现已离开「零记录」态，**这本身就是 AC4 ② 的实时演示**：一个声明了写者入口的第三方
工作区，其 `/tests` 页面的状态行由「未接入」变成了 `ok` + 具体轮次 —— 即「离开 `writer-but-zero-records` 态
并显示该轮的 `state` 与 `tests` 计数」这一 ① 的判据，在同一项目上被真实走通了（只是走的不是 ① 的入口）。

### §5 AC5（不回归：quay 自己的 `/tests` 与改前逐字一致）

```
改前(HEAD~1 源码) /tests HTML : /tmp/tse-evidence/quay-before.html   72646 B
改后(HEAD  源码)  /tests HTML : /tmp/tse-evidence/quay-after.html    72646 B
diff -u quay-before.html quay-after.html  →  差集为空（0 B）
```

两向 diff 差集为 0，⛔ 不是 SHA 相同就算（贴的是 `diff` 本身空文件，`wc -c` = 0）。
这一条同时是**负控制的另一半**：改动只新增了两个 `empty-*` 分支，`ok` 走原路 ⇒ 已产出记录态零位移。

**还原核验**（换源码这种取证法本身要能取假）：渲染完改前 §1/§5 后执行
`git checkout HEAD -- <两个源文件>`，再 `diff -q` 与改动后副本比对 —— **两个文件逐字节相同**，
`git status --short` 为空，`tsc --noEmit -p packages/quay` 退出 0。

### §6 单测（本任务新增，13 项，全绿）

`packages/quay/test/serve-tests-empty-state.test.mjs`（`@test-group product`）三层：
① `detectRoundWriterPath` 的四种工作区形状 + **不继承父目录**控制；② `readTests` 的四态枚举
（含「文件存在但无有效行 ⇒ 仍是 writer-zero-records，因为写者确实落过盘」）；③ **真实起服务渲染的
HTML** 逐态断言 + 指引入口存在性。既有 `serve-ac95-views.test.mjs` 的 AC3 断言由退役的 catch-all
`empty` 改为 `empty-no-writer`（该 fixture 未声明 suite 入口），`/未接入/` 断言保留、未削弱。

### §7 AC6（本 worker 不做，留给外层）

`bash scripts/test.sh --for-task gap-verification-round-empty-state-lumps-three-distinct-causes --allow-thin`
（fan-in 的同一条 scoped 门）在本工作树、merge `develop` 之后跑过：**146 passed / 0 failed，exit 0**，
其中本任务新增的 13 项实际在列（日志中 `detectRoundWriterPath` / `AC1/AC3: the REAL /tests page` 命中 6 行）。
**全量套件不在本 worker 的范围内**——按派发契约由 fan-in 机械跑，故 AC6 保持未勾并标注为外层验证。

## Touches

- packages/quay/src/observation.ts
- packages/quay/src/serve-render.ts
- packages/quay/test/serve-tests-empty-state.test.mjs
- packages/quay/test/serve-ac95-views.test.mjs
- tasks/gap-verification-round-empty-state-lumps-three-distinct-causes.md
