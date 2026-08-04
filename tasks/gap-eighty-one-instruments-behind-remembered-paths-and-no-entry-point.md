---
id: gap-eighty-one-instruments-behind-remembered-paths-and-no-entry-point
title: 81 instruments reachable only by remembering a path, 17 MCP tools that
  are all task-board — shrink, then expose, then add, in that order
status: todo
labels:
  - gap
  - milestone-candidate
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**规格**：`orchestration/SPEC-instruments-behind-one-entry.md`（管理者，转人的方向裁定）。

> 人 2026-08-04：「把更多仪器集成到一个入口并把这个入口更好地暴露给 Claude Code——
> 这符合几何信息论的结晶方向。**写更多散落的仪器不是，它们很难重用**。」

| | 数 | 外层核实 |
|---|---|---|
| quay MCP 暴露的工具 | **17** | ✓ 以**运行中的 MCP 工具清单**为准（`mcp__quay__*`），不是 grep 源码——外层先用 grep 得 0，那是扫描写错了 |
| `plugin/scripts` 的仪器 | **81** | ✓ 实测 81 |
| 普查器结论（2026-08-03） | live 36 / library 72 / ci-only 1 / dormant 7 / never-runs-test 8 / **unaccounted 81** | 待重跑 |
| 脚本总数 | **205 → 207** | 退役物理删了约 51 个，**种群再生和修剪一样快** |

**一个佐证**：管理者在自己产品的源码里**连查两次都没数出那 17 个工具**，第三次读文件才对。
**可发现性不是抽象问题。**

## Contract

```
measure script_total = `node --experimental-strip-types plugin/scripts/runtime-usage-inventory.ts --json | python3 -c "import json,sys; print(json.load(sys.stdin)['total'])"` 输出的总数字段
measure unaccounted = `node --experimental-strip-types plugin/scripts/runtime-usage-inventory.ts --json | python3 -c "import json,sys; print(len(json.load(sys.stdin)['unaccounted']))"` 输出的条数字段
measure mcp_tool_count = `node --experimental-strip-types packages/quay/bin/quay.ts mcp --list-tools | wc -l` 输出的工具数字段
measure tools_without_question = `node --experimental-strip-types packages/quay/bin/quay.ts mcp --list-tools --json | python3 -c "import json,sys; print(sum(1 for t in json.load(sys.stdin) if not t.get('description')))"` 输出的无声明工具数字段
band unaccounted = 0
band tools_without_question = 0
invariant 先收缩再暴露最后新增；说不出自己回答什么问题的脚本进不了入口
invoke `node --experimental-strip-types plugin/scripts/runtime-usage-inventory.ts`
control 脚本总数必须下降——205→207 是失败信号，这一步不让数字下降就是没做
resume 第一步不收口就不做第二步；第二步不收口就不做第三步
```

## Chosen mechanism

**三步，顺序不可换。**

**第一步（收缩）**：**重跑已有的 `plugin/scripts/runtime-usage-inventory.ts`，不要新写**。
给 **81 个 `unaccounted`** 每个一个处置：保留（并说明理由）/ 退役 / 归入 library。

**第二步（暴露）**：`live` 的 36 个进 quay MCP。
**每个必须声明它让什么原本不可机械提问的问题变得可提问，那句声明就是工具的 description。**
**说不出的进不了入口** ⇒ **「进入口」本身就是筛选器，不是搬家。**

**第三步（新增）**：基于 meta-cc 封装 `task_time_breakdown(taskId) → { waitingPct, workingPct, fullSuiteRuns, gaps[] }`。
管理者做那次分析用了 **4 次工具调用 + 手工算间隔**，**它应该是一次调用**。

**不做**：**不新写普查器**（已有）；**不把 81 个原样搬进入口**（那是膨胀不是结晶）；
**不提前做第三步**——**先收缩再膨胀，否则入口一开始就装了不该装的东西**。

## Acceptance Criteria

- [ ] AC1: 普查重跑，`unaccounted` **每一项有处置**，**「以防万一」不是理由**（实跑贴出处置表）
- [ ] AC2（**可判收口**）: **脚本总数下降**。**205→207 是失败信号——这一步不让数字下降就是没做**
- [ ] AC3: 每个进入口的仪器**声明它让什么原本不可机械提问的问题变得可提问**，
      **那句声明就是 MCP 工具的 description**（贴出全部 description）
- [ ] AC4（**筛选器，不是形式**）: **说不出自己回答什么问题的脚本，进不了入口**——
      贴出**被挡在外面的那些**及理由。**一个没有拒绝过任何东西的筛选器与不存在不可区分**
- [ ] AC5: 进入口后，调用方式从「记住路径 + `--experimental-strip-types`」变成 Claude Code 自动发现的工具（实跑贴出）
- [ ] AC6: `task_time_breakdown` **必须在第一、二步之后**才做
- [ ] AC7: 测试用 `node:test` 且带恰当的 `// @test-group`

## Definition of Done

- [ ] AC2 与 AC4 的实跑输出都贴进任务体（总数下降一份、被拒名单一份）
- [ ] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）
- [ ] 任务体记录**三步的顺序理由**：先收缩再暴露最后新增，否则入口一开始就装了不该装的东西

## Touches

- plugin/scripts/runtime-usage-inventory.ts
- packages/quay/src/mcp-server.ts
- docs/analysis/runtime-usage-inventory.md

## Dispatch review

reviewer: outer
at: 2026-08-04T05:05:00Z
changed: **管理者交规格（转人的方向裁定），外层核实数字后原样落为 AC，并补三点。**

**外层核实中犯了一次并当场纠正**：数 MCP 工具时先用 `grep -oE '"(task|gate|...)_[a-z_]+"' mcp-server.ts` 得 **0**，
**差点据此说规格的 17 不对**。**0 是我的扫描写错了，不是事实**——
权威来源是**运行中的 MCP 工具清单**（本会话可见的 `mcp__quay__*` 恰为 17 个），不是源码 grep。
**这条与规格自述的那个佐证是同一件事**：管理者在自己产品源码里连查两次都没数对那 17 个工具。
**⇒ 「数不清自己暴露了什么」这个问题，外层在核实它的过程中又复现了一次**，
这比规格里的任何论证都更能说明可发现性是真问题。**AC3/AC5 因此更值得做。**

**外层补的第一点——AC2 的口径必须先定死**：「脚本总数下降」要成为可判收口，
**必须先说清数的是哪一批**（外层粗数全仓 `scripts/`+`bin/` 下的 `.ts/.sh/.mjs` 得 **249**，
与规格的 205/207 不是同一口径）。**Contract 的 `measure script_total` 因此绑死到普查器自己的输出**，
而不是任何手写 grep——**否则「下降」会变成「换一种数法」。**

**外层补的第二点——AC4 是本条唯一能防止它变成搬家的判据，外层给它加了硬要求**：
**必须贴出被挡在外面的那些及理由**。**一个没有拒绝过任何东西的筛选器，与不存在不可区分**——
这与本仓「一个从没红过的检查与永远返回空集不可区分」是同一条。
若 36 个 live 全部通过筛选、一个都没被挡，**那不是筛选器合格，那是筛选器没生效**。

**外层补的第三点——顺序不是偏好，是不可逆性**：第三步产出的是**一个新工具**，
而入口一旦装上就有人依赖，**再摘下来比不装上去贵得多**。
第一、二步产出的是**减法与声明**，两者都可逆。**⇒ 把不可逆的排在最后，是本条顺序的真正理由**，
写进 DoD 免得后来的人把它读成「先易后难」。

**排期**：动 `mcp-server.ts` 与普查器，**与在飞的 3b、与新立的另外三条均不相交**。
**但它是本批里唯一的多步任务**——三步各自可收口，**建议按步派发而不是一次派完**，
否则第三步会在第一步的收口判据还没兑现时就开工。
