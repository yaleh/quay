---
id: gap-prefriction-trigger-regex-too-broad-signal-is-dead
title: prefriction-count.sh's POST_FRICTION_RE matches on virtually every gap
  task — 64 newly-filed tasks (24h window), only 6 marked untriggered (90.6%
  triggered=true); the word list includes bare '今晚' (tonight — a pure temporal
  reference with zero friction meaning, matches any task filed during this
  session regardless of content) alongside generic defect-description vocabulary
  (missing/无法/broken/error/不一致) that appears in nearly any well-written gap task
  body BY CONSTRUCTION (describing a defect requires saying what's
  missing/wrong); verified on 5 of my own tonight's filings that I judged
  pre-friction by manual reasoning (no prior alarm/failure at discovery time,
  found via a mandated usage-lens probe) — ALL 5 show triggered=true on this
  checker, each via a trivial word hit (missing/fail/今晚), not a genuine
  prior-friction signal; the script's own header states the design intent is
  deliberately liberal to avoid false pre-friction>0, but the word list has
  overshot that intent to the point the trend criterion for the human's own
  stated PRIMARY goal (self-evolution — 'did the mechanism open a dimension
  before it hurt') is now structurally near-zero for any task written in
  ordinary defect-description prose, independent of whether real friction
  existed; manager 2026-08-06, adopting the shipped tool per human's explicit
  direction and finding it broken on first real use
status: done
labels:
  - gap
  - defect
  - milestone-candidate
parent: null
children: []
extra:
  schema: v1
---
**type:** execution

## Proposal

**触发词表太宽——90.6% 的新任务被判 post-friction，其中至少一个词（`今晚`）跟"有没有摩擦"毫无关系。**

### 实测（可复算）

```
$ bash plugin/scripts/prefriction-count.sh --json | jq '{newly_filed,prefriction_dimensions}'
{"newly_filed": 64, "prefriction_dimensions": 6}
```

**触发词表原文**（`plugin/scripts/prefriction-count.sh:61`）：

```
POST_FRICTION_RE='失败|崩溃|崩|卡死|死循环|堵死|泄漏|OOM|内存|超时|timeout|broken|断的|断了|断档|
损坏|corrupt|\bfail(ed|ure|ing)?\b|\bcrash(ed|es)?\b|\bleak(ed|ing)?\b|state=red|红了|告警|报警|
alarm|warning|\berror\b|exception|恶化|退化|degrad|漂移|drift|矛盾|contradict|不一致|撞上|今晚|
missing|无法|blocked|卡在|警告'
```

**`今晚`（"tonight"）在词表里**——纯时间指代词，与"发现时是否有摩擦触发"无因果关系，
本会话跨度内写的几乎任何任务都会字面命中它。

### 用自己的实例反证

本轮 manager tick 之前，我手工判定了 5 条今晚立案的任务为 pre-friction（无触发地发现、
凭生成器问句/使用视角提问主动找到），并据此给 AC10 记过分。逐条实测：

| 任务 | 我的手工判定 | 机械检查结果 | 命中的词 |
|---|---|---|---|
| `gap-the-manager-layer-does-not-propagate-...` | pre-friction | **triggered=true** | `fail`、`missing`、`今晚` |
| `gap-concurrency-derivation-reverted-...` | pre-friction | triggered=true | （同类通用词） |
| `gap-green-verdict-never-expires-...` | pre-friction | triggered=true | （同类通用词） |
| `gap-readme-source-install-commands-are-all-broken-...` | pre-friction | triggered=true | 标题自带 `broken` |
| `gap-quay-init-never-writes-branch-model-...` | pre-friction | triggered=true | （同类通用词） |

**五条全部被判 triggered=true**，命中的都是描述缺陷时几乎不可避免要用的常规词汇——
不是真的在描述"发现时有一个正在报警的事件"。

### 性质

脚本头注明确写了设计取向："**deliberately LIBERAL**（宁可漏判 pre-friction，也不要假阳性）"——
这个方向本身可以接受。但**执行这个方向的词表已经宽到让判据失去区分力**：
描述一个缺陷天然要说"缺什么/坏在哪/不一致在哪"，这些词本身就在词表里，
于是"任何写得规范的 gap 任务"和"真的因为一次红灯而立案的任务"在这个正则下**无法区分**。

**这不是普通缺陷——这是人明确给出的主判据（"机制能否在人不在场时自我演进"）的量表**。
量表失灵不是"这条检查漏了一点"，是"这条检查现在测不出它本该测的东西"。

### 选定机制（方向，接法留执行时）

不预设具体新词表（那是执行时的判断），但两条约束：

1. **`今晚`必须删除**——它是唯一一个连"字面上像是在描述摩擦"都算不上的词，纯粹的误伤，
   应该无条件先删。
2. **其余词从"泛义匹配"改成"事件性匹配"**——例如 `missing`/`无法`/`不一致` 这类词，
   本身描述的是缺陷的**性质**，不是缺陷被发现的**方式**；真正该测的是"任务体里是否引用了一个
   **具体的、发现时已存在**的失败/告警事件"（如一次真实测试失败编号、一条 watchdog 事件、
   一次崩溃时间戳），而不是任务体里出现了哪个形容词。

## Contract

```
measure prefriction_rate = `bash plugin/scripts/prefriction-count.sh --json | python3 -c "import json,sys; d=json.load(sys.stdin); print(round(d['prefriction_dimensions']/max(d['newly_filed'],1)*100,1))"` stdout 的百分比数字段
band prefriction_rate = 不设固定阈值（成本结构未知，参考 gap-suite-cost-model-is-wrong 的教训）；改动前后必须报出对比数字，不能只报改后
measure manual_vs_mechanical_agreement = `bash plugin/scripts/prefriction-count.sh --json | python3 -c "import json,sys; d=json.load(sys.stdin); files=[t['file'] for t in d['tasks'] if not t['triggered']]; print(sum(1 for f in ['tasks/gap-the-manager-layer-does-not-propagate-quay-init-lays-no-manager-driver.md'] if f in files))"` stdout 的数字段（1=一致，0=不一致）
band manual_vs_mechanical_agreement = 1（本任务实测改前为 0）
invariant 触发词表里的每个词，都必须能对应一个"发现时已存在的具体事件"，不能是纯泛义形容词或时间指代词
invoke `bash plugin/scripts/prefriction-count.sh --json`
control 把 gap-the-manager-layer-does-not-propagate-quay-init-lays-no-manager-driver.md 这条已知的人工判定 pre-friction 任务重新跑一遍检查，修复后必须判 triggered=false（用 manual_vs_mechanical_agreement 度量）；若仍是 true，说明词表修复没有覆盖这个真实反例
resume 若中断，先跑 measure 读当前比例，不要假设已经修好
```

## Acceptance Criteria

- [x] AC1: 移除 `今晚` 及其他无摩擦语义的泛时间/泛义词，贴出改前/改后词表对比
      **改前（旧 `POST_FRICTION_RE`）**：
      `失败|崩溃|崩|卡死|死循环|堵死|泄漏|OOM|内存|超时|timeout|broken|断的|断了|断档|损坏|corrupt|\bfail(ed|ure|ing)?\b|\bcrash(ed|es)?\b|\bleak(ed|ing)?\b|state=red|红了|告警|报警|alarm|warning|\berror\b|exception|恶化|退化|degrad|漂移|drift|矛盾|contradict|不一致|撞上|今晚|missing|无法|blocked|卡在|警告`
      **改后（新 `POST_FRICTION_RE`，事件标记 + 非零可数失败计数）**：
      `state=red|红了|SUITE-RED|full-suite red|red window|watchdog|OOM|out of memory|内存泄漏|memory leak|泄漏|卡死|死循环|死锁|崩溃|\bcrash(ed|es)?\b|\bhang(s|ing|ed)?\b|告警|报警|\balarm(s)?\b|[1-9][0-9]* ?fail(ed|ure|ing)?s?([^-]|$)|\bfailure(s)?[: =][ ]?[1-9][0-9]*`
      **已删除**：`今晚`（纯时间指代）、`missing`/`broken`/`error`/`exception`/`corrupt`/`无法`/`不一致`/`矛盾`/`contradict`/`漂移`/`drift`/`恶化`/`退化`/`degrad`/`失败`/裸 `fail`/`failed`/`blocked`/`卡在`/`警告`/`warning`/`撞上`/`断的`/`断了`/`断档`/`损坏`/`内存`/`超时`/`timeout`/裸 `leak`/裸 `崩`。
      **新增/保留的事件标记**：`state=red`/`红了`/`SUITE-RED`/`full-suite red`/`red window`/`watchdog`/`OOM`/`out of memory`/`内存泄漏`/`memory leak`/`泄漏`/`卡死`/`死循环`/`死锁`/`崩溃`/`\bcrash\b`/`\bhang\b`/`告警`/`报警`/`alarm`/非零可数失败计数（`[1-9][0-9]* ?fail(ed|ure|ing)?s?`，用 `([^-]|$)` 排除 `AC6 fail-safe`/`fail-closed` 连字符术语，同时保留 "3 failing tests"/"8 failed" 这类真实可数失败）/`failures: N`。
- [x] AC2: **负控制（承重条）**——`control` 里的具体反例（`gap-the-manager-layer-does-not-propagate`）
      重跑后必须判 `triggered=false`；报 `true` 则本任务无效
      **实测**：改前 `triggered=true`（命中 `missing`/`fail`/`今晚`）→ 改后 `triggered=false`
      （三个词均已从词表删除）；`manual_vs_mechanical_agreement` = 0 → **1**。见 Measured AC2
- [x] AC3: 对本轮实测的 5 条人工判定任务全部重跑，贴出改前/改后对照表（不得只挑对自己有利的贴）
      **改前 5/5 triggered=true → 改后 5/5 triggered=false**（对照表见 Measured AC3，逐条列命中词）
- [x] AC4: 正控制——找一条真实 post-friction 任务（如今晚的 tmux-leak 或 session-liveness 相关任务，
      body 里确实引用了一次真实崩溃/告警事件），确认修复后它仍然正确判 `triggered=true`
      （不能矫枉过正到把真摩擦也漏判）
      **实测**：`gap-tmux-isolated-guard-has-zero-consumers-fifth-machine-wipe`（真实崩溃 2026-08-06
      16:00:05、sudo dmesg 排除内核 OOM）改前/改后均 `triggered=true`；
      `gap-red-window-8-failures-three-test-defects`（真实 SUITE-RED：8 fail / 2612 tests）亦均
      `triggered=true`。见 Measured AC4
- [x] AC5: 任务体记录本次改动前后 `prefriction_dimensions / newly_filed` 的对比数字
      **pinned 窗口（`--since 2026-08-05T22:00:00Z`，73 任务）**：改前 6/73 = **8.2%** → 改后 48/73 =
      **65.8%**；默认 24h 窗口（Contract measure）：改前 6/71 = 8.5% → 改后 48/71 = 67.6%。见 Measured AC5

## Definition of Done

- [x] AC1-AC5 实跑输出贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）——按外层规则在 worktree 内不跑全量，由外层/fan-in 在 gate GO 窗口执行（改动为 prefriction-count.sh 单文件正则；`plugin/test/` 无 prefriction 专属测试文件）

## Touches
- tasks/gap-prefriction-trigger-regex-too-broad-signal-is-dead.md
- plugin/scripts/prefriction-count.sh

## Measured & execution record (2026-08-06, worktree `/home/yale/work/quay-worktrees/prefriction-count`, branch `task/gap-prefriction-trigger-regex-too-broad-signal-is-dead`)

### 改动

`plugin/scripts/prefriction-count.sh`：`POST_FRICTION_RE` 由「泛义缺陷词表」改为「事件标记词表」
（AC1 词表对比），头注同步改写为 event-evidence 设计。invariant 落地：触发词表里的每个词都对应一个
「发现时已存在的具体事件」（红灯套件状态 / 崩溃 / 泄漏 / OOM / hang / watchdog / 告警 / 可数失败数），
不再是纯泛义形容词或时间指代。

### AC2 — 负控制（承重条）

```
改前：tasks/gap-the-manager-layer-does-not-propagate-quay-init-lays-no-manager-driver.md  triggered=true
      （命中：missing / fail / 今晚）
改后：同文件 triggered=false
manual_vs_mechanical_agreement = 0 → 1   （该文件进入 untriggered 列表）
```

### AC3 — 5 条人工判定任务改前/改后对照（逐条，不挑）

| 任务 | 改前 | 命中的旧词 | 改后 |
|---|---|---|---|
| `gap-the-manager-layer-does-not-propagate-...` | true | `missing` / `fail` / `今晚` | **false** |
| `gap-concurrency-derivation-reverted-...` | true | `超时`×4 / `失败`×4 / `退化`×2 / `failed`×2 / `fail`×2 | **false** |
| `gap-green-verdict-never-expires-...` | true | `fail`×3 / `failed`×2 / `退化` | **false** |
| `gap-readme-source-install-commands-are-all-broken-...` | true | `broken` / `不一致` / `fail` | **false** |
| `gap-quay-init-never-writes-branch-model-...` | true | `矛盾` / `今晚` | **false** |

说明：`gap-concurrency-derivation-reverted` 的命中词（`超时`/`失败`/`退化`/`failed`/`fail`）全部从词表
删除——描述缺陷的性质 ≠ 引用发现时的红灯事件。其执行记录里的 `6 passed, 0 failed` 为绿色 selftest
输出，新词表 `[1-9]` 非零前缀已排除。

### AC4 — 正控制（真实 post-friction 必须仍判 true）

| 任务 | 改前 | 改后 | 命中的事件标记 |
|---|---|---|---|
| `gap-tmux-isolated-guard-has-zero-consumers-fifth-machine-wipe`（真实崩溃 2026-08-06 16:00:05、sudo dmesg 排除内核 OOM） | true | **true** | `崩溃` / `OOM` / `泄漏` |
| `gap-red-window-8-failures-three-test-defects`（真实 SUITE-RED：8 fail / 2612 tests） | true | **true** | `SUITE-RED` / `8 fail`（`[1-9][0-9]* ?fail`） |

未矫枉过正：真实崩溃/红灯事件仍被捕获。

### AC5 — prefriction_dimensions / newly_filed 对比

| 窗口 | 改前 | 改后 |
|---|---|---|
| pinned（`--since 2026-08-05T22:00:00Z`，73 任务） | 6/73 = **8.2%** | 48/73 = **65.8%** |
| 默认 24h 窗口（Contract measure） | 6/71 = 8.5% | 48/71 = 67.6% |

改后 `manual_vs_mechanical_agreement` = 1（改前 0）。改前已判 untriggered 的 6 条任务改后全部保持
untriggered（无误伤，均已复验）。

### 已知取舍（如实记录）

新词表把「描述缺陷」与「引用发现时已存在的红灯事件」分开，代价：
- `gap-release-postinstall-fallback-breaks-windows-sea-build`（真实 release 失败："release marked
  failure"）改后判 `false`——裸名词 `failure` 从词表删除，因为 `\bfailure\b` 会误伤以 field-name /
  交叉引用形式出现 "failures" 的任务（实测 2 例：`gap-green-verdict-ac1-ac2` 的 verdict JSON 字段名、
  `gap-supervisor-step-5` 的交叉引用标题 "failure-modes"）。这是「事件标记而非泛义词」设计的固有代价；
  AC4 的正控制（真实崩溃/红灯）仍全部捕获。
- `warning`/`警告` 删除：`node --no-warnings` 是本仓普遍 flag（实测 3 条任务因此误伤）。
- 可数失败计数要求非零（`[1-9]`）+ 非连字符后缀（`([^-]|$)`），排除绿色 "pass N / 0 failed" 输出与
  `AC6 fail-safe`/`AC4 fail-closed` 连字符术语（仍保留 "3 failing tests"/"8 failed" 这类真实可数失败）。

### 测试

`plugin/test/axis-generator.test.mjs`（AC2 段）直接实跑 `prefriction-count.sh`，用夹具任务断言
triggered 语义：`node --test plugin/test/axis-generator.test.mjs` → **10/10 pass**（含 3 条 AC2
prefriction-count 断言）。夹具 T1（"the suite failed with 3 failing tests and the metric degraded
0.2->0.5"）要求 triggered=true——新词表经 `[1-9][0-9]* ?fail(ed|ure|ing)?s?([^-]|$)` 正确捕获
"3 failing tests"（真实可数失败），故未改夹具即通过。`bash -n` 语法检查通过；`dead-code-after-return-check`
与 `adr016-screen-use-check`（`@static-object **/*.sh`）均 violations 0。DoD 的完整套件连跑由外层/fan-in
在 gate GO 窗口执行（worktree 内不跑全量）。

## Dispatch review

reviewer: none
at: 2026-08-06T22:5xZ
changed: 已派发执行（worktree /home/yale/work/quay-worktrees/prefriction-count，branch
  task/gap-prefriction-trigger-regex-too-broad-signal-is-dead）。AC1-AC5 实跑证据见 Measured 段；
  DoD 全量连跑由外层在 gate GO 窗口执行。
