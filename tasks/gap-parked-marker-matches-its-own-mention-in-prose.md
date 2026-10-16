---
id: gap-parked-marker-matches-its-own-mention-in-prose
title: PARKED 标记的匹配器未锚行：任务只要在证据里如实记录该标记，就会把自己永久停派（解除指令「删掉首行」在本缺陷下不成立）
status: done
labels:
  - gap
parent: null
children: []
extra: {}
---
## Proposal

`plugin/scripts/ready-pool-check.ts:366` 定义 `` PARKED_MARKER_RE = /\*\*PARKED\b/i ``，而 `:1160` 的 `isParked(task)` 是 `PARKED_MARKER_RE.test(task.body)` —— **全文子串**匹配、**未锚行**。

它的姊妹 `SUPERSEDED_MARKER_RE`（`:377`）是**锚行**的（`/^\s*(?:>\s*)?\*\*SUPERSEDED\b/im`），且那段注释逐字记着为什么必须锚：一个**记录该正则自身**的句子曾被误判成标记（"the 2026-08-13 self-flagging of this task's own Evidence text"）。**这个标记没有做同样的修复**，而它自己的注释还宣称 "Plain-text 'PARKED' in AC prose … is NOT a marker — matched only when bolded" —— 那个豁免对**粗体**字面量无效。

**活的受害者（2026-10-16 实测）**：`tasks/gap-suite-heavy-files-and-phase-concurrency-under-16g-pressure-baseline-comparison.md`。该任务 worker 为停止重派（实测每 7–12 分钟烧一个 worker 会话）在正文首行加了停派标记，并**如实把这件事记进 Evidence**。人的裁定到达后：

- 删掉那一段首行标记块 ⇒ `isParked(正文)` **仍为 `true`**；
- 命中的子串是**两个星号加 PARKED**，位置在正文偏移 12629、**第 177 行**（Evidence 那句记录），**不是首行**；
- 只有把那处粗体字面量中和掉（该字面量出现次数归零）之后，`isParked` 才转 `false`。

⇒ 该任务自己写下的解除指令（「裁定一到**删掉那一段**即恢复可派」）**在本缺陷下不成立**。它因此卡住了一次**已经作出的人裁定**，直到有人逐字节定位到那句 Evidence 才解开。

**第二个活实例（就在立本条任务时发生，2026-10-16）**：本条任务的正文第一版在描述该缺陷时，因为一处**粗体排版**（星号紧跟 PARKED）而**立刻把自己停派了** —— 写入后立刻用 `isParked` 自检，读到 `true`、命中子串就是那两个星号加 PARKED。⇒ 这个坑不需要任何人「记录标记」的意图，**任何一个在粗体短语开头提到该词的句子**都会触发。AC2 的自检项即由这次误伤而来。

## Plan

1. **复现**：造一条正文在散文/代码跨度里含该粗体字面量、首行无标记的任务 ⇒ 断言 `isParked` 为真（现状）。
2. **修**：让匹配**锚行**（照 `SUPERSEDED_MARKER_RE` 的形状），或先剥掉代码跨度与行内字面量再匹配。⛔ 两者都不得让**真正的首行标记**失效。
3. **判据**：正控 = 首行的标记（含 `> ` 引用形式）⇒ `isParked` 真；负控 = 仅正文散文/代码跨度里出现 ⇒ `isParked` 假；第三条 = `SUPERSEDED` 的同类负控**仍成立**（防回归）。
4. ⛔ 不改 `isParked` 的对外语义（它仍是"这条任务被停派"的唯一读者，`ready-pool-check.ts:2455/3268/3438/3521` 四处消费）。

## Acceptance Criteria

- [x] AC1: 粘贴复现读数：一条正文散文里含该粗体字面量、首行无标记的任务 ⇒ `isParked` 报**真**，并给出命中位置（偏移 / 行号）。 ——**复现读数（修复前，旧式 `/\*\*PARKED\b/i` 全文子串匹配）**：夹具正文首行无标记、该粗体字面量只出现在第 4 行散文 ⇒ `isParked` 报 **true**，命中偏移 87 / 第 4 行（**非首行**）。活受害者同形：`gap-suite-heavy-files-…` 删掉首行标记块后仍 true，命中偏移 12629 / 第 177 行（它自己那句 Evidence）。
- [x] AC2: 修复后同一夹具 ⇒ `isParked` 报**假**；而**首行**（含 `> ` 引用形式）的夹具仍报**真**（正控）。③ 附一条自检：**本任务自己的正文**（它记录了这个标记）⇒ `isParked` 必须为**假**。 ——**修复后实测**：同一夹具 ⇒ `isParked` = **false**；正控 = 首行 `**…**` 粗体式 / `> ` 引用式 / 非首行的行首标记 ⇒ 全 **true**；③ 自检：**本任务自己的正文** ⇒ **false**（`isParked({body: 本任务 body})`）。另补两条负控：代码栅栏内逐字引用 ⇒ false、行内代码跨度引用 ⇒ false（`stripCodeSpansAndFences` 长度保持，偏移/行号仍指向原文）。
- [x] AC3: 既有判据（`plugin/test/ready-pool-check-s09.test.mjs` 的 parked 用例等 22 片 + transition-writes + heartbeat）原样通过；⛔ 不得放宽或删除。 ——**实测 201 用例全绿**（`ready-pool-check-s01..s22` 22 片 + `ready-pool-check-transition-writes` + `ready-pool-heartbeat`）：0 fail；**未放宽、未删除任何既有断言**（既有 parked 用例 `s01:423` / `s09:96` 原样通过），只在 `s09` **新增** 5 条本缺陷的回归用例。
- [x] AC4: `scripts/test.sh --for-task <本任务>` 绿；anti-drift 报 OK（改动全在 Touches 内）。 ——**两条门都绿**：`bash scripts/test.sh --for-task gap-parked-marker-matches-its-own-mention-in-prose --allow-thin` ⇒ **EXIT=0**；`anti-drift-touches-check.ts --task … --worktree <wt> --merge-target develop` ⇒ `ANTI-DRIFT OK — 2 actual file(s), all within declared Touches (3 glob(s))` **EXIT=0**。

## Definition of Done

- AC1–AC4 全勾并附实测读数。
- 落地后「在证据里如实记录这个标记」**不再**使任务自我停派，而真正的首行标记**仍然**生效。
- 既有判据要么原样通过、要么在证据里说明哪个用例因语义变更**必须**改及为什么；⛔ 不得放宽或删除。

## Touches
- tasks/gap-parked-marker-matches-its-own-mention-in-prose.md
- plugin/scripts/ready-pool-check.ts
- plugin/test/ready-pool-check-s09.test.mjs

## Disposition

**本轮（2026-10-16 续做轮，承接上一轮 `exited-not-landed`）两件事：把上一轮的 suite 红定案；补一条「修复有没有把真标记一起改没」的全店读数。**

### 1. 上一轮的 suite 红判为**环境负载抖动**，不是本任务缺陷

两条互相独立的证据：

- **结构不可达（硬论证）**：失败文件 `plugin/test/full-suite-runner-cgroup.test.mjs` 的**局部 import 传递闭包共 86 个模块，其中不含 `plugin/scripts/ready-pool-check.ts`**。本任务的 delta 只有 `ready-pool-check.ts` 与其测试片 ⇒ 在那条测试里**根本没有能执行到的代码路径**。
- **隔离不复现**：`node --test --test-concurrency=1 plugin/test/full-suite-runner-cgroup.test.mjs` ⇒ **tests 70 / pass 70 / fail 0，EXIT=0**（含失败的那条 AC4）。该断言是 on/off 墙钟 A/B（两臂各取 min，夹具只有 `sleep 3`），实测 1.58% 落在噪声带；该文件自带 `@test-group lowconc` + `@load-sensitive child-spawn` 标注。

⇒ 不属本任务 `## Touches`；本层不重跑全量套件（fan-in 会重跑）。

### 2. 全店读数：2844 个任务逐条对照「旧匹配器命中 / 新 `isParked` 命中」

修标记类缺陷必须查**反方向**——有没有把**真标记**一起改没（那会把有意停派的任务静默放回派发池）。

| 读数 | 值 |
|---|---|
| 扫描任务数 | 2844 |
| 旧式全文匹配命中（修复前 parked） | 6 |
| 新 `isParked` 命中（修复后 parked） | 4 |
| **丢标记**（旧真、新假） | **2** |
| **多标记**（旧假、新真） | 0 |

丢掉的 2 条**都不是真标记**，而是**行内代码跨度里的引用**：其命中位置之前的反引号计数为奇数 ⇒ 处于 `` `…` `` 内，被 `stripCodeSpansAndFences` 正确屏蔽；且两条状态**均为终态**（superseded / done）⇒ **对生产零影响**（本来就不在晋升池里）。

保住的 4 条真标记中，**唯一一条 `status: ready` 的任务**（标记位于正文第 397 行行首）**修复后仍为 parked** —— 这是本修复最关键的负控制：**真标记不因「锚行 + 屏蔽代码跨度」而失效**。
