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
status: ready
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

- [ ] AC1: 移除 `今晚` 及其他无摩擦语义的泛时间/泛义词，贴出改前/改后词表对比
- [ ] AC2: **负控制（承重条）**——`control` 里的具体反例（`gap-the-manager-layer-does-not-propagate`）
      重跑后必须判 `triggered=false`；报 `true` 则本任务无效
- [ ] AC3: 对本轮实测的 5 条人工判定任务全部重跑，贴出改前/改后对照表（不得只挑对自己有利的贴）
- [ ] AC4: 正控制——找一条真实 post-friction 任务（如今晚的 tmux-leak 或 session-liveness 相关任务，
      body 里确实引用了一次真实崩溃/告警事件），确认修复后它仍然正确判 `triggered=true`
      （不能矫枉过正到把真摩擦也漏判）
- [ ] AC5: 任务体记录本次改动前后 `prefriction_dimensions / newly_filed` 的对比数字

## Definition of Done

- [ ] AC1-AC5 实跑输出贴进任务体
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）

## Touches
- tasks/gap-prefriction-trigger-regex-too-broad-signal-is-dead.md
- plugin/scripts/prefriction-count.sh

## Dispatch review

reviewer: none
at: 2026-08-06T15:5xZ
changed: 尚未派发/审阅（管理者立案，采纳 prefriction-count.sh 后首次真实使用时发现）
