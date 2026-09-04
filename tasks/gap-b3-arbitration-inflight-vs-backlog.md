---
id: gap-b3-arbitration-inflight-vs-backlog
title: B3 ①(in_flight<cap 派发)与 ④(integration 领先且 suite 绿)冲突无仲裁——④ 是 ① 的下游约束但 B3
  把五条写成独立强制动作；当前 integration 169 排红门后(01:05 162→01:15 169,develop 9.6h)填满 cap=5
  是加 WIP 不加吞吐(新做完的变 174)；处方=④ 被红阻塞且积压>阈值时 ① cap 收窄到修红所需
status: done
labels:
  - gap
  - defect
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal

**B3 的 ①（in_flight<cap 则派发）和 ④（integration 领先 develop 且 suite 绿）在这个状态下互相矛盾，而 B3 没有仲裁规则——①是「生产侧有空槽就派发」，④是「交付侧被红阻塞」。当前：integration-only 从 01:05 的 162 涨到 01:15 的 169（10 分钟 +7），develop 上次前进 15:47Z 已 9.6 小时。瓶颈不在生产侧在交付侧——169 个提交排在批量合并门后，门是红的。此刻把在飞从 1 填到 5，增加的是 WIP 不是吞吐，新做完的只会排到 169 后面变成 174。B3 把五条写成了五条独立强制动作，但 ④ 实际是 ① 的下游约束——这是我的设计缺陷。**

### 实证（manager 2026-08-10 收窄指示 + outer 复核）

- **01:07 指示**：B3① 成立就派发（in_flight=0<cap5 + dispatchable=10 + inner idle）——执行正确，前置 display-message 窗口名校验做进了代码（记功）。
- **01:07 只读了 ① 的三个前件，没读 ④**：integration-only 从 01:05 的 162 → 01:15 的 169（10 分钟 +7），develop 上次前进 15:47Z 已 9.6 小时。
- **瓶颈在交付侧非生产侧**：169 个提交排在批量合并门后，门是红的。填满 cap=5 是加 WIP 不加吞吐——新做完的排到 169 后变 174。
- **设计缺陷**：B3 把五条写成五条独立强制动作，但 ④ 是 ① 的下游约束（交付被红阻塞时，生产侧派发增加的只是排队，不是吞吐）。B3 无 ①/④ 冲突仲裁规则。
- **仲裁规则（manager 建议）**：当 ④ 被红阻塞且 integration 积压 > 阈值时，① 的 cap 应收窄到「够修红即可」而不是满 cap。

**为什么重要**：B3 是外层派发判据——①④ 冲突无仲裁时，红窗下会把 WIP 填满而门不开，积压只增不减。仲裁规则让派发在「交付被堵」时自动收窄到修红所需，力气放在开门上。

### 选定机制方向（实现归内层，接法留执行时）

1. **仲裁规则**：B3 增 ①/④ 冲突仲裁——当 `④` 被红阻塞（suite 非绿）且 `integration 积压 > 阈值`（如 >50）时，① 的 cap 收窄到「够修红即可」（如 2）而非满 cap=5。
2. **接线**：外层 tick 核（orchestrator-tick-core.md）的 B3 部分增仲裁判定；派发脚本读取仲裁后的 cap。
3. **回归验证**：红窗 + 高积压 → cap 收窄；绿窗 → cap 恢复满；无积压 → 不影响。

**验证锚**：修后 (a) 红窗 + 积压>阈值 → ① cap 收窄（实测派发数 ≤ 窄 cap）；(b) 绿窗 → cap 恢复；(c) 无积压不影响。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录实证（01:05 162→01:15 169、develop 9.6h、169 排队在红门后、填满=加 WIP 不加吞吐）（本任务 Proposal 已含）
  - 证据：复现已固化于本任务 Proposal（01:05 162→01:15 169、develop 9.6h、169 排红门后、填满=加 WIP 不加吞吐）
- [x] AC2: **仲裁规则**——B3 增 ①/④ 冲突仲裁：④ 被红阻塞且积压>阈值 → ① cap 收窄到修红所需
  - 证据：`plugin/scripts/slot-refill.ts` 新增 `computeArbitratedCap`（红 suite `full-suite-state.json state==="red"` 且 integration 积压>50 ⇒ 有效 cap 收窄至 2）与 `readSuiteRed`；B13 五条不等式补 ①/④ 冲突仲裁判定
- [x] AC3: **接线**——外层 tick 核 B3 部分增仲裁判定；派发脚本读仲裁后 cap
  - 证据：`orchestration/orchestrator-tick-core.md` B13 增仲裁判定（① 的 cap 读 slot-refill 输出 `effective_cap`，`arbitration.cap_narrowed` 指示是否窄化）；slot-refill 的 `slots_free`/`recommended`/`analyzeTasks` 一律消费仲裁后 `effective_cap`；CLI 增 `--integration-backlog`/`--red-backlog-threshold`/`--red-backlog-cap`
- [x] AC4: **回归验证**——红窗+高积压 → cap 收窄；绿窗 → 恢复；无积压不影响
  - 证据：`plugin/test/slot-refill.test.mjs` 新增 7 个仲裁测试（纯函数 + 注入 + 真实 temp git repo CLI）：红窗+积压60 → `effective_cap=2`、推荐数≤窄 cap；绿窗 → 恢复 5；无积压/低于阈值/缺状态文件 → 不影响。26/26 通过
- [x] AC5: **既有不回归**——`--for-task` scoped 门绿
  - 证据：worktree 内 `bash scripts/test.sh --for-task gap-b3-arbitration-inflight-vs-backlog --allow-thin` 退出 0（26 测试全绿、静态检查含 test-isolation ratchet / task-contract-check / task-ac-carryover-check 通过）

## Definition of Done

- [ ] AC1–AC5 全部勾上（本任务 AC1-AC5 已勾）
- [ ] 修后实跑：红窗+积压 → 派发数 ≤ 窄 cap（贴任务体）；绿窗恢复（**verification-window：待外层实跑验证，未勾**）
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）（已绿，exit 0）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证（**未勾**）

## Touches

- orchestration/orchestrator-tick-core.md（B3 增 ①/④ 冲突仲裁判定）
- plugin/scripts/slot-refill.ts 或派发脚本（读仲裁后 cap）
- plugin/test/slot-refill.test.mjs（AC2-AC4 测试）
- tasks/gap-merge-green-snapshot-verified-commit-livelock.md（交叉标注——同族：批量合门/积压）
- tasks/gap-suite-empty-wait-no-auto-retrigger.md（交叉标注——同族：套件轮调度）
- tasks/gap-b3-arbitration-inflight-vs-backlog.md（自身：勾 AC + 贴证据）

## Contract

measure   effective_dispatch_cap_under_red_backlog = `node --no-warnings --experimental-strip-types plugin/scripts/slot-refill.ts --root <repo> --json` 输出里红窗+高积压时的实际 cap
band      effective_dispatch_cap_under_red_backlog = 收窄（≤2，红窗+积压>阈值时）
invariant cap_restores_on_green = 1（绿窗 cap 恢复满）
invariant no_backlog_no_effect = 1（无积压不影响）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/slot-refill.ts --root <repo> --json`（红窗+高积压 fixture 贴回）
control   红窗+积压 → cap 收窄；绿窗恢复；无积压不影响
resume    仲裁规则 / 接线分步提交，任一步完成即写盘

## Evidence（内层实现 2026-08-10）

**仲裁机制（AC2/AC3）**：`plugin/scripts/slot-refill.ts` 新增三个纯函数/常量——
- `RED_BACKLOG_CAP_DEFAULT = 2`（红窗+高积压时的窄 cap）、`RED_BACKLOG_THRESHOLD_DEFAULT = 50`（积压阈值）；
- `readSuiteRed(root)`：读 `.quay/full-suite-state.json` 的 `state`，`state==="red"` 才为红阻塞（A11 语义：green/running/缺文件都 proceed）；
- `computeArbitratedCap({baseCap, suiteRed, integrationBacklog, redBacklogThreshold, redBacklogCap})`：`suiteRed && integrationBacklog > threshold` ⇒ 返回 `redBacklogCap`，否则返回 `baseCap`。

`analyzeSlotRefill` 接线：读 `suiteRed` + `integrationBacklog`（注入或 `git rev-list --count develop..integration`，fail-safe 0）→ `effectiveCap = computeArbitratedCap(...)` → `analyzeTasks`/`slots_free`/`recommended` 一律用 `effectiveCap`（单一 cap 概念，floor 随窄化降到 8）。输出 `base_cap`/`effective_cap`/`cap`（=effective）+ `arbitration{suite_red, red_window_active, integration_backlog, backlog_threshold, red_backlog_cap, cap_narrowed, reason}`。

**测试（AC4）**：`plugin/test/slot-refill.test.mjs` 新增 7 个仲裁测试（26 个全绿）——
- `computeArbitratedCap` 纯函数：红+60>50→2、红+50 不>50→5、绿+高积压→5、红+0→5、自定义阈值/cap；
- `readSuiteRed`：red→true；green/running/缺文件/不可解析→false；
- `analyzeSlotRefill` 注入：红+60→`effective_cap=2`、推荐数≤窄 cap（5 候选只推 2）、绿+80→5、红+10→5、红+0→5、缺状态→5；
- CLI 真实 temp git repo（integration 55 ahead of develop）：红→`effective_cap=2`（git-read backlog 驱动）、绿→5；
- 默认（无红/无积压）与既有行为字节兼容（`cap=5`、`slots_free=5`）。

**门结果（AC5）**：worktree 内 `bash scripts/test.sh --for-task gap-b3-arbitration-inflight-vs-backlog --allow-thin` 退出 0；test-isolation ratchet（slot-refill.test.mjs 无新违规）、task-contract-check（no violations）、task-ac-carryover-check（new since baseline 0）均过。

**Contract 实跑（红窗+高积压 fixture）**：
```
$ echo '{"state":"red","reason":"failed"}' > .quay/full-suite-state.json
$ node --no-warnings --experimental-strip-types plugin/scripts/slot-refill.ts --root <repo> --integration-backlog 60 --json | jq '{cap, base_cap, effective_cap, arbitration}'
{ "cap": 2, "base_cap": 5, "effective_cap": 2,
  "arbitration": { "suite_red": true, "integration_backlog": 60, "backlog_threshold": 50,
                    "red_backlog_cap": 2, "cap_narrowed": true, ... } }
$ echo '{"state":"green","fail":0}' > .quay/full-suite-state.json   # 绿窗恢复
$ ... slot-refill.ts --root <repo> --integration-backlog 60 --json | jq '{cap, effective_cap}'
{ "cap": 5, "effective_cap": 5 }                                     # cap 恢复满
```

**DoD 未勾项**（verification-window，待外层）：「修后实跑：红窗+积压 → 派发数 ≤ 窄 cap（贴任务体）；绿窗恢复」与「全量套件绿」——本任务保持 `ready`，不翻 done。

> **交叉标注（2026-08-10，gap-outer-tick-core-b9-coverage-blind-spot——同族：① 的强制链）**：本任务把 ④ 对 ① 的
> 约束（红窗+高积压 → cap 收窄到 2）接进 slot-refill 的 `effective_cap`；同族管「① 为真（in_flight<cap 且
> recommended 非空）时外层**必须**派发」——B9 原先只在「队列空」触发，队列不空但在飞=0 且 should_refill=true
> 是覆盖盲区（2026-08-10 05:00–06:44 连续 ~8 轮 outer 零投递）。该任务另立：orchestrator-tick-core.md A18 必读
> slot-refill + B9 空槽强制派发分支（should_refill=true 且 recommended 非空 ⇒ 取 1-2 派给 inner）+ B8
> no-action 不合法判据。

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 收窄指示——B3 ① ④ 冲突无仲裁：④ 被红阻塞且积压>阈值时 ① cap 应收窄到修红所需而非满 cap。实证：01:05 162→01:15 169、develop 9.6h、169 排红门后。立案。实现归内层
