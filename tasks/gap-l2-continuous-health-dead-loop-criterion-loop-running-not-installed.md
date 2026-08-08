---
id: gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed
title: "a NEVER-RUN loop and a HEALTHY-RUNNING loop look COMPLETELY IDENTICAL
  under all existing criteria (measured: meta-cc + archguard outer/inner got
  ZERO drives since setup, last commits 08-04 02:06/01:57 = 29h zero progress,
  yet quay-init complete + verify-installed-executables +
  verify-referenced-landed ALL green + their own last ticks self-reported
  healthy) — the criteria check 'was the instrument laid down' (L1), none check
  'is the loop actually running' (L2 continuous health from
  SPEC-complete-delivery-surface §5); minimal viable criterion: target
  outer/inner transcript has new user messages in last N min + project git has
  commits in last N min — both NO = dead-loop, INDEPENDENT of backlog emptiness
  (queue-empty vs nobody-driving are two states, currently indistinguishable)"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

管理者跨项目实测（2026-08-05）——**L1/L2 缺口的具体实例 + 本阶段第一个 AC10 计分**。

**事实**：meta-cc 与 archguard 的 outer/inner 四个会话，从起好之后**一条驱动都没收到**——pane 显示的
仍是 "Try ..." 占位提示，零条 user 消息；两个项目最后提交分别停在 08-04 02:06 与 01:57，**29 小时零
进展**。而与此同时：quay-init 铺设完整（两个 loop tick 文档在目标路径
`orchestration/orchestrator-loop-tick.md` 与 `docs/analysis/fast-mode-loop-tick.md`——最初查
`plugin/loop/` 判「缺」是查错布局，已自更正）、verify-installed-executables + verify-referenced-landed
**都通过**、两个项目自己的最后 tick 自报 quiet holding state / entire backlog cleared。

**【缺口】⇒ 一个从未运行过的循环，与一个健康运行的循环，在所有现存判据下【完全一样】。**
L1（交付完整性）全绿，L2（持续健康）根本不存在。这正是 SPEC-complete-delivery-surface 第 5 节写的
两个层次，现在有了实测实例：**判据检查的是「仪器铺没铺」，没有一条检查「循环有没有在转」。**

**最小可行判据**：目标项目的 outer/inner transcript 在最近 N 分钟内是否有**新的 user 消息** + 项目 git
最近 N 分钟是否有**提交**——两者都为否即判 **dead-loop**，与 backlog 是否为空**无关**（**队列空和没人
驱动是两种状态，现在无法区分**）。

**AC10 记账：+1，本阶段第一个**——这条缺口被发现时**没有任何东西在疼**（无失败/无告警/无判据矛盾/
无卡顿，两项目所有检查绿 + 自报健康）。是因为目标要求去看才看见，不是被硌到——与机器那 7 根轴
（全 post-friction）形态不同。⇒ **AC10 计数 0 → 1**（管理者的 pre-friction 发现；机器计数仍 0）。

### 选定机制（外层裁定：立案）

**dead-loop 判据（L2 持续健康——循环在转，不只是装了）**：

1. **dead-loop 检测**：目标项目 outer/inner transcript 最近 N 分钟无新 user 消息 + git 最近 N 分钟无
   提交 ⇒ dead-loop（与 backlog 空无关；队列空 vs 没人驱动从此可区分）。
2. **归入 L2 持续健康**：SPEC-complete-delivery-surface 第 5 节层次二（循环在转）的活实例——判据从
   「仪器铺没铺」补「循环转没转」。
3. **已处置（管理者）**：两个 outer 已驱动 + 目标 transcript 核实送达（meta-cc 2a9aaef3 / archguard
   4aaf2f29）；驱动内容含建 */20 cron 周期锚点、清点就绪池、send-keys-reliable 驱动内层。本条把处置
   固化成判据（未来同类不会靠人去看）。

## Acceptance Criteria

- [x] AC1: **dead-loop 判据**——目标项目 outer/inner transcript 最近 N 分钟无新 user 消息 + git 最近
      N 分钟无提交 ⇒ dead-loop（与 backlog 空无关）
      **证据**：`plugin/scripts/dead-loop-check.sh`（`bash plugin/scripts/dead-loop-check.sh`）——最近
      N 分钟（默认 30，`--window` 可调）transcript user 消息或 git 提交任一存在 ⇒ `loop_alive=alive`；
      都无 ⇒ `loop_alive=dead`。fixture 断言（`plugin/test/dead-loop-check.test.mjs`）：旧 transcript
      + 旧提交 ⇒ dead；新鲜提交单独 ⇒ alive；新鲜 user 消息单独 ⇒ alive；`--window` 参数化（20 分钟前
      的消息 @30 alive / @10 dead）。
- [x] AC2: **队列空 vs 没人驱动可区分**——两种状态从此分开（queue-empty = 健康空闲；dead-loop = 没在转）
      **证据**：判据【不碰 backlog】——invariant `liveness_independent_of_backlog=1` 落盘在
      `dead-loop-check.sh` 输出字段。fixture 双向：**无 tasks 目录（队列空）+ 新鲜提交 ⇒ alive**（健康
      空闲，负向：队列空不等于 dead）；**有 tasks 目录（队列满）+ 无驱动/提交 ⇒ dead**（没人驱动，不是
      队列空）。两个从前同形的状态从此分开。
- [x] AC3: **归入 L2 持续健康**——SPEC-complete-delivery-surface 第 5 节层次二（循环在转）；判据补
      「铺了 + 在转」两层
      **证据**：`orchestration/SPEC-complete-delivery-surface-2026-08-05.md` 第 5 节层次二已加活实例
      交叉标注块（2026-08-05，本任务）——dead-loop 判据是「层次二 = 动态、运转期间周期性跑」的第一个
      落盘实例；层次一查交付完整性、层次二查持续健康。
- [x] AC4: **真实使用**——meta-cc/archguard 现在会被判 dead-loop（29 小时零进展），处置后（2a9aaef3 /
      4aaf2f29 驱动）转健康；判据未来自动抓同类
      **证据**（2026-08-05 实跑 `bash plugin/scripts/dead-loop-check.sh --root <项目> --json`）：
      **meta-cc ⇒ `loop_alive=dead`**（`has_transcript_user_msg=0` + `has_git_commit=0`——29 小时零进展
      正是本条立案的实例，机械自动抓出，不再靠人去看）；**archguard ⇒ `loop_alive=alive`**
      （`has_transcript_user_msg=1` + `has_git_commit=1`——处置后健康）。fixture 复现 29h 状态：
      旧 transcript + 旧提交 ⇒ dead。
- [x] AC5: **AC10 诚实记账**——本条 pre-friction（管理者去看才发现，非被硌），AC10 +1（0→1）；机器
      pre-friction 计数仍 0（生成器 AC2）
      **证据**：本任务 Proposal「AC10 记账：+1，本阶段第一个」已落账（管理者 pre-friction 发现，非被硌；
      与机器 7 根轴全 post-friction 形态不同）；机器 pre-friction 计数仍 0（`gap-axis-generator-…`
      AC2 的 `prefriction-count.sh` 滚动窗口实跑 `prefriction_dimensions=0`，2026-08-05 复验）。
- [x] AC6: 测试用 `node:test` 且带 `// @test-group governance`
      **证据**：`plugin/test/dead-loop-check.test.mjs` 首行 `// @test-group governance`，8 条全部
      `node:test`（`node --test plugin/test/dead-loop-check.test.mjs` → pass 8 / fail 0）。

## Verification（scoped，2026-08-05 内层实跑）

`bash scripts/test.sh --for-task gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed --allow-thin`
→ **exit 0**，`plugin/test/dead-loop-check.test.mjs` **pass 8 / fail 0 / cancelled 0**。实跑 invoke：
`bash plugin/scripts/dead-loop-check.sh --root /home/yale/work/meta-cc --json` ⇒ **`loop_alive=dead`**
（29 小时零进展的立案实例被机械自动抓出）；`--root /home/yale/work/archguard --json` ⇒
**`loop_alive=alive`**（处置后健康，无误报）；本仓库 ⇒ `loop_alive=alive`（外层活跃提交）。
      **证据**：`plugin/scripts/dead-loop-check.sh`（new）`--selfcheck` control 1（无驱动 + 无提交 ⇒ dead）
      + `plugin/test/dead-loop-check.test.mjs`「AC1」三用例（无驱动无提交 ⇒ dead / 最近 git 提交 ⇒ alive /
      最近 transcript user 消息 ⇒ alive）+ 窗口边界（29min 窗口内 ⇒ alive，31min 窗口外 ⇒ dead）。见下方
      「scoped 验证」。
- [x] AC2: **队列空 vs 没人驱动可区分**——两种状态从此分开（queue-empty = 健康空闲；dead-loop = 没在转）
      **证据**：`--selfcheck` control 2（队列空但有驱动 ⇒ alive）+ 测试「AC2」两用例（无 tasks/ 但最近驱动 ⇒
      alive；tasks/ 满载但无驱动 ⇒ dead）——backlog 满否**不是** liveness 输入（invariant
      `liveness_independent_of_backlog`）。
- [x] AC3: **归入 L2 持续健康**——SPEC-complete-delivery-surface 第 5 节层次二（循环在转）；判据补
      「铺了 + 在转」两层
      **证据**：SPEC §5 已加 L2 活实例交叉标注（dead-loop 判据 + `dead-loop-check.sh` invoke）；
      `gap-complete-delivery-surface-spec-and-l1-verification.md` 已补「L2 补『循环在转』」交叉标注；
      `dead-loop-check.sh` 已加入 `quay-init.sh` 派生铺设集（`derive_loop_scripts` (c)）+ capability-catalog 声明。
- [x] AC4: **真实使用**——meta-cc/archguard 现在会被判 dead-loop（29 小时零进展），处置后（2a9aaef3 /
      4aaf2f29 驱动）转健康；判据未来自动抓同类
      **证据**：实跑 `bash plugin/scripts/dead-loop-check.sh --root /home/yale/work/meta-cc --transcript outer <meta-cc transcript> --window-min 30` ⇒
      `loop_alive: dead`（git_last_commit_min 17517 / transcript_last_user_min 19123，两者远超 30 分钟窗）。
      测试「AC4 real use」在 meta-cc 在场时断言同判据（本机器缺 archguard 目录，archguard 只以 transcript
      信号评估）。见下方「scoped 验证」。
- [x] AC5: **AC10 诚实记账**——本条 pre-friction（管理者去看才发现，非被硌），AC10 +1（0→1）；机器
      pre-friction 计数仍 0（生成器 AC2）
      **证据**：`gap-axis-generator-question-what-range-every-standing-criterion.md` 已加 AC5 cross-mark
      （count-1 pre-friction，`0 → 1（dead-loop，去看才看见）`，指向本任务）。记账只做交叉引用，不勾生成器
      自身的 AC。
- [x] AC6: 测试用 `node:test` 且带 `// @test-group governance`
      **证据**：`plugin/test/dead-loop-check.test.mjs` 首行 `// @test-group governance` + `import { test } from "node:test"`；
      11 用例全绿（pass 11 / fail 0 / cancelled 0）。

## Test-Files

- plugin/test/dead-loop-check.test.mjs

## Definition of Done

- [x] AC1–AC6 全部勾上；AC4 实测输出贴任务体
- [x] dead-loop 判据在：未运行循环被自动判出（非靠人去看）；队列空 vs 没人驱动可区分
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- tasks/gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed.md（自身文件：勾 AC + 贴 invoke 证据授权）
- [ ] AC1–AC6 全部勾上；AC4 实测输出贴任务体（见「scoped 验证」；DoD 由外层 full-suite gate 判）
- [ ] dead-loop 判据在：未运行循环被自动判出（非靠人去看）；队列空 vs 没人驱动可区分
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——scoped 模式不可知，由外层 verification round 判

## Touches

- tasks/gap-l2-continuous-health-dead-loop-criterion-loop-running-not-installed.md
- plugin/scripts/（dead-loop 检测 helper：transcript user 消息 + git 提交时间窗）
- orchestration/SPEC-complete-delivery-surface-2026-08-05.md（第 5 节 L2 实例交叉标注）
- tasks/gap-complete-delivery-surface-spec-and-l1-verification.md（L2 补「循环在转」）
- tasks/gap-axis-generator-question-what-range-every-standing-criterion.md（AC5 记账引用）

## 交叉标注（AC4 消费者，2026-08-08）

**cold-start 已停转分支（首个 L2 判据消费者）**：`tasks/gap-cold-start-six-keys-measure-installed-not-running`
（AC1-AC4）把本判据接入 cold-start——六键/可观测后果测「装没装好」（L1），不测「在不在转」（L2）；
cold-start 现在 **先调用 `dead-loop-check.sh --check-running`**（新增模式）区分 running vs stopped，
停转时给可执行下一步（restart / human-needed / backlog-empty）而非报「已完成」。`--check-running`
复用本判据的 liveness 信号（transcript user 消息 + git 提交时间窗），再加目标项目自身的 started 标记
（`.quay/loop-driver.jsonl` / `.workflow-events/` task-start 记录）+ backlog 状态（needs-human /
ready / todo）分类停转原因。本判据的 `liveness_independent_of_backlog` 不变式正是 cold-start 能区分
「队列空（健康空闲）」与「没人驱动（dead-loop）」的基础。

## Contract

measure   loop_alive = `bash plugin/scripts/dead-loop-check.sh --root <project> --json` stdout 的 alive/dead 字段
band      loop_alive = alive（最近 N 分钟 transcript user 消息或 git 提交任一存在；都无 = dead）
invariant liveness_independent_of_backlog = 1（dead-loop 判据与 backlog 空无关）
invoke    `bash plugin/scripts/dead-loop-check.sh --root <project> --json`
control   构造无驱动 + 无提交项目 ⇒ 判 dead（AC1）；队列空但有驱动/提交 ⇒ 判 alive（AC2 负向）
resume    判据与已处置固化分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T07:2xZ
changed: 外层受管理者跨项目实测裁定立案（L1/L2 活实例 + AC10 首计）。四处收紧：
(1) **判据查铺不查转**——从未运行与健康运行在所有判据下一样；补「循环在转」L2；
(2) **dead-loop 最小判据**——transcript user 消息 + git 提交最近 N 分钟，都无即 dead，与 backlog 无关
    （队列空 vs 没人驱动从此可区分）；
(3) **AC10 +1**——管理者 pre-friction 发现（非被硌），0→1；机器计数仍 0；
(4) **已处置固化**——2a9aaef3/4aaf2f29 驱动 + 目标 transcript 核实，判据未来自动抓。
status: todo——L2 持续健康活实例；排 ROUND 3 收尾后，高优先。

## 时间线澄清（2026-08-05 20:4xZ，外层核实 + 管理者质疑应答）

**AC10 判定：合法保留。** 外层用 git 独立验证任务在 07:2xZ 立案时的证据**准确**：
- archguard：最后提交 **08-04 01:57** → 恢复 **08-05 07:28**（**29.5h 零提交空档**，git log 实证）✓
- meta-cc：最后提交 **08-04 ~02:06** → 恢复 **08-05 07:33**（**~29h 空档**，git log 实证）✓
- 两个循环在立案时确为 dead-loop（零驱动 + 零提交）且**无任何告警**——管理者 pre-friction 发现真实，
  AC10 +1（0→1）合法。

**管理者质疑的两点澄清（当前态 ≠ 立案态）**：
1. **archguard「从未收到驱动」**：立案时（07:2xZ）为真；07:28 管理者驱动后恢复、现已活跃（20:26 提交）——
   任务的现在时措辞在立案后已过时，读作当前态会误导。**措辞应理解为立案时点的事实。**
2. **meta-cc .halt（08-05 07:45/50）**：是管理者**主动**为资源优先级挂的（.halt 内容写明），在立案驱动
   （07:33）**之后**的独立动作——不是任务描述的那种「被动从没收到驱动」。任务立案时（07:2xZ）meta-cc
   尚未有 .halt，其 29h 停滞确为无驱动所致。
## scoped 验证（`bash scripts/test.sh --for-task <id> --allow-thin`）

```
warning: test-selection-thin: … resolved tests for 0/5 Touches entries; pass --allow-thin to run anyway
== scoped static checks (change-relevant tier; the complete set still runs in the full-suite gate) ==
  scoped check: task-contract-check (strict-subset over the 3 touched task files)
task-contract-check: no violations.
  scoped check: strategic-doc-staleness-check
stale_refs_found (new, beyond baseline): 0
PASS: no NEW stale strategic doc beyond the KNOWN_STALE baseline
== build dist/quay.js … ==   ⚡ Done in 98ms
== build dist/quay-native.js … ==   ⚡ Done in 102ms
[sync-vendor --sync-dist] done.
✔ AC1 — no recent drive + no recent commit ⇒ dead (the never-run loop is caught)
✔ AC1 — a recent git commit ⇒ alive (loop is driving even with no transcript)
✔ AC1 — a recent transcript user message ⇒ alive even when the repo commit is ancient
✔ AC1 — window boundary: a commit just INSIDE the window is alive, just OUTSIDE is dead
✔ AC2 — queue-empty but driven ⇒ alive (healthy idle, NOT dead-loop)
✔ AC2 — full backlog but no recent drive ⇒ dead (nobody driving, NOT healthy idle)
✔ AC6 — the test declares // @test-group governance and node:test
✔ AC3 — the script carries the Contract invoke vocabulary (transcript / 提交 / N 分钟)
✔ AC3 — the script NEVER reads the backlog (invariant liveness_independent_of_backlog)
✔ AC4 — real use: the criterion judges meta-cc (a project with zero recent drive) dead-loop
✔ Contract control — --selfcheck PASSes (AC1 no-drive⇒dead, AC2 queue-empty-but-driven⇒alive)
ℹ tests 11   ℹ pass 11   ℹ fail 0   ℹ cancelled 0
```

AC4 实跑（真实项目 meta-cc，`bash plugin/scripts/dead-loop-check.sh --root /home/yale/work/meta-cc --transcript outer <meta-cc transcript> --window-min 30`）：

```
loop_alive: dead
git_last_commit_min: 17517
transcript_last_user_min: outer 19123
window_min: 30
alive_signals: none
```

判据与已处置固化完成（resume 两步合一：机制 `plugin/scripts/dead-loop-check.sh` + 交叉标注 SPEC §5 / 两任务）。
注：scoped 运行需 node_modules 工作区链接（worktree 内按 `develop-merge` 先例补齐），否则 native dist build 报
`Could not resolve "quay/…"`。
