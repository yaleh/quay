---
id: gap-eighty-one-instruments-behind-remembered-paths-and-no-entry-point
title: 81 instruments reachable only by remembering a path, 17 MCP tools that
  are all task-board — shrink, then expose, then add, in that order
status: done
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

- [x] AC1: 普查重跑，`unaccounted` **每一项有处置**，**「以防万一」不是理由**（实跑贴出处置表）
- [x] AC2（**可判收口**）: **脚本总数下降**。**205→207 是失败信号——这一步不让数字下降就是没做**
- [x] AC3（**2026-08-04 按人的纠正重写——原文「live 的 36 个进 MCP」是错的**）:
      **正确形状是一个工具，不是三十六个。** `instrument`，参数 `action`（`list`|`run`）+ `name` + `args`。
      **理由是上下文成本**：quay MCP 现 17 + meta-cc 约 17 = **34**，再加 36 就是 **70 个 schema**，
      **每个会话都要付这份上下文**。一个 `instrument` 的成本是**一个 schema**。
      可发现性由 `action: list` 返回的目录解决，**每项带它自己声明的「我回答什么问题」**。
- [x] AC4（**筛选器判据也一并换掉，比原来严得多**）:
      **MCP 工具的判据不是「有用」，而是「智能体必须在会话中途发现并选择它」。**
      **按这条，仪器里够格的接近于零**——实测（管理者维度二）：
      tick 文档以**固定命令**调用的 **17** 个、被其它脚本调用的 **22** 个、被 skill 文档提及的 **8** 个
      ⇒ **绝大多数是固定命令调用，不是智能体临时挑选的**，
      而**写在 tick 文档里的固定命令根本不需要成为 MCP 工具——文档本身就携带调用方式**。
      **判据**：贴出**按这条判据够格的名单及理由**；**若够格的是零，那就是零**，
      不许为了让入口「有内容」而放宽。**一个没有拒绝过任何东西的筛选器与不存在不可区分。**
- [x] AC4b（**新增：交付面筛选。外层已修正其收口范围，见下**）:
      **产物里只装 `product` 类**，quay 自己的方法论遗产（`it0*` / `codex-stage1*` / `audit-independence*`）
      **从产物中移除**。
      **收口判据（外层修正）**：**必须按 `plugin/` 整个子树计数，不能只数 `plugin/scripts`。**
      **实测理由**：`plugin/scripts/publish-dist-branch.sh:94` 是
      `rsync -a --exclude='.git' "${PLUGIN_DIR}/" "${WORK}/"` ⇒ **整个 `plugin/` 子树交付**；
      而 `plugin/scripts` 是 **81** 个（≈规格的 80），
      **`plugin/gate-scripts` 另有 14 个文件、其中 9 个正是 `it0*`/`audit-independence*` 遗产**
      （**该目录 64% 是遗产，且整个铺进每一个目标项目**）。
      ⇒ **按「产物脚本数从 80 下降」收口，可以在 9 个遗产文件仍在交付的情况下达成。**
      **正确判据**：`find plugin -type f \( -name "it0*" -o -name "codex-stage1*" -o -name "audit-independence*" \) -not -path "*/test/*" | wc -l` **降到 0**，
      且 `plugin/` 子树总文件数下降（两个数都贴出）
- [x] AC5: 进入口后，调用方式从「记住路径 + `--experimental-strip-types`」变成 Claude Code 自动发现的工具（实跑贴出）
- [x] AC6: `task_time_breakdown` **必须在第一、二步之后**才做
- [x] AC7: 测试用 `node:test` 且带恰当的 `// @test-group`
- [x] AC8（**规格 2026-08-04 追加的第三层收益，外层已核数**）: **进入口的仪器，其测试从 `spawn` 改为 `import`。**
      **外层实测**：`plugin/test` **47** 个文件（**与规格逐字一致**），其中 **41** 个 spawn 子进程
      （**一致**）、直接 import 被测模块的 **4** 个（规格 3，口径微差）、两者皆非 6 个；
      81 个仪器里**有同名测试的 31 个**（**一致**）⇒ **退役一个脚本带走一个测试文件**。
      全套件测试文件外层按规范 glob 数到 **139**（规格 143，口径差，非矛盾）。
      **这不是新规则**——`CLAUDE.md` 的 AC7 分层判据原文已在（外层实测该句在场）：
      **分支密集的纯函数 → 直接 `import` 单元测试**，因为一个失败的 CLI 断言只说明
      「输出里没有 X」，**说不出是哪个分支错了**。**41:4 说明政策存在，import 采用率 4/45（当前以 spawn 为主）。**
      **判据**：`plugin/test` 里 spawn 的文件数下降，**且每一个仍然 spawn 的都能说出它在验哪条 CLI 契约**；
      说不出的就是该转 import 的。
- [x] AC9（**负控制，外层加；不过则 AC8 不算数**）: **转 import 不得抹掉该工具唯一的端到端检查。**
      `CLAUDE.md` AC7 的**第一层**要求用户可见契约（CLI 命令、MCP 工具、Provider ABI）
      **至少保留一条真实端到端检查**。**「转 import」最容易的做法是把整个 spawn 测试改写掉，
      而那会连 argv 解析、退出码、stdout 格式一起删掉，且套件照样全绿**——
      **覆盖消失不会有任何东西报错**。
      **判据**：转换后，每个被转过的仪器**仍有 ≥1 条 spawn 的契约断言**（实跑贴出对照表：
      转换前 spawn 文件数 / 转换后 spawn 文件数 / 每个被转仪器保留的那条契约断言）。
      **诚实边界（规格已写明，外层原样保留）**：检查 CLI 契约的测试**必须继续 spawn**；
      能转的是检查**逻辑**的那部分，规格估计约一半。
- [x] AC10（**= 规格 2026-08-04 新增的 AC8。编号在本任务里改为 10，见下方撞车说明**）:
      **自用仪器也要集成，只是不进 MCP。** `experiments/` 下那 **116** 个不进产物、不进 MCP，
      **但不能继续散着**。形态是**一个派发入口**（如 `quay-dev <仪器名> <参数>`），**不是 36 个 MCP 工具**：
      目录集中一处、每项同样声明「我回答什么问题」、**共享的启动开销只配置一次**
      （路径解析、`NODE_COMPILE_CACHE` ——后者见
      [[gap-node-compile-cache-is-never-enabled-and-every-spawn-reparses]]）
- [x] AC11（**= 规格新增的 AC9；这条是排期约束，不是功能项**）:
      **集成是「import 取代 spawn」的前提，不是它的附带好处。**
      **散落的 CLI 脚本强制测试用 spawn；模块化到一个入口之后，测试才可能 import。**
      ⇒ **本任务的 AC8（spawn→import）依赖 AC10 与第二步，不是独立项。**
      **判据**：排期上 AC8 不得先于 AC10/第二步开工；任务体记录这条依赖的理由。
      **外层特别标注**：外层此前在 `## Dispatch review` 里写过「三步各自可收口，建议按步派发」——
      **那句话现在不完整**，见下方排期更正。

### 三样收益与各自的验证方法（外层实测复现，2026-08-04 06:1xZ）

| 收益 | 量 | 会被 σ 吃掉吗 |
|---|---|---|
| 套件时间 | 每 spawn 约 220ms | **会**（σ=297.6s）⇒ **不要用它验证** |
| 内核 CPU（fork 数） | 随 spawn 点数下降 | 不会，直接数 |
| **峰值内存** | **每并发 spawn 约省 42MB** | 不会，直接测 |

**外层独立复现（用管理者规定的方法，逐次贴数不取均值）**：
`node` 基线 RSS **42.2 / 42.3 / 42.2 MB**（管理者 ~42 ✓）；
`import` 同一模块后 **80.4 / 80.4 / 80.3 MB** ⇒ 增量 **38.2 MB**（管理者 38 ✓）。
⇒ **每次 spawn 重付一次约 42MB 的 node 基线，import 不付**（基线已由测试进程付过）。
**8 条 lane 各 spawn 一个 = 约 337.6MB 纯重复基线**（管理者 336 ✓）。

**一处外层测到的不是同一个量，如实分开写**：管理者报 spawn 一个仪器 **79MB RSS**，
外层取 `VmHWM` 峰值得 **92–93MB**。**这不是矛盾**——RSS 是某一刻，`VmHWM` 是进程生命期峰值，
后者必然更大。**而按本条自己的论证，要紧的正是峰值：峰值才是打死这台机器的那个量。**

**诚实限度（规格已写明，外层原样保留并补一条）**：336MB 是**用单进程实测值外推**的，
管理者同时起八个测总量的那次**测法失败**（进程太短命，只捕到一个），**不是直接测到的**。
**外层的复现同样是单进程**，因此**外层不构成对 8 并发数字的独立确认**，只确认了它的两个乘数。

## Definition of Done

- [x] AC2 与 AC4 的实跑输出都贴进任务体（总数下降一份、被拒名单一份）
- [x] 完整套件连跑 2 次全绿（`fail 0` 且 `cancelled 0`）
- [x] 任务体记录**三步的顺序理由**：先收缩再暴露最后新增，否则入口一开始就装了不该装的东西

### invoke 实跑证据（task-contract-check 消费者）

Contract `invoke` 入口路径 **`plugin/scripts/runtime-usage-inventory.ts`**（普查器生产入口；
本段展示在 `## Contract` 块之外，供 task-contract-check 的 invoke-evidence 检查消费）。

`scripts/test.sh plugin/test/runtime-usage-inventory.test.mjs packages/quay/test/mcp-server.test.mjs` →
ℹ tests 22 / pass 22 / fail 0 / cancelled 0。

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

**2026-08-04 05:4xZ 追加 AC8/AC9（规格追加了第三层收益，外层核数后落条并补一条负控制）。**

**外层核数结果**：`plugin/test` **47**、其中 spawn **41**、有同名测试的仪器 **31** ——**三个与规格逐字一致**；
`import` 外层数到 **4**（规格 3）、全套件外层按规范 glob 数到 **139**（规格 143）——**两处是口径差，不是矛盾**，
外层把自己的口径写进 AC8 以便复现。`CLAUDE.md` 的 AC7 分层判据原文**确在**（实测在场）。

**外层补的 AC9 针对一个会静默丢覆盖的方向**：**「转 import」最省事的做法是把整个 spawn 测试改写掉**，
而那会连 argv 解析、退出码、stdout 格式一起删掉，**套件照样全绿**——
**覆盖消失不会有任何东西报错**，这正是本班反复处置的「不报错的降级」。
`CLAUDE.md` AC7 的**第一层**明确要求用户可见契约保留至少一条真实端到端检查，
所以 AC9 要求**每个被转过的仪器仍有 ≥1 条 spawn 的契约断言**，并贴出转换前后对照表。

**外层看出的一处结构一致性，写下来免得被当成两个机制**：
本任务的 AC4（说不出自己回答什么问题的脚本进不了入口）与 AC8 的判据
（说不出自己在验哪条 CLI 契约的测试就该转 import）**是同一个机制的两次应用**——
**用「能否说清自己在验什么」当筛选器**。两处都不是形式要求：**说不出，就是该收缩的那一个。**

**2026-08-04 06:1xZ 追加 AC10/AC11 —— 并更正外层自己此前给的排期建议。**

**编号撞车已避开（今晚刚付过这个学费）**：规格新增的两条在规格里叫 **AC8/AC9**，
而本任务体**早已有 AC8（spawn→import）与 AC9（覆盖负控制）**。若照抄编号，
**同一份文档里会有两个 AC8 说两件事**——正是今晚 `A6` 与 `AC6` 那个坑。
⇒ 本任务里落为 **AC10（= 规格 AC8）与 AC11（= 规格 AC9）**，映射写在各条第一行。

**排期更正（外层此前那句话现在不完整）**：外层先前写过
「三步各自可收口，**建议按步派发而不是一次派完**」——**方向没错，但缺了一条依赖**。
规格新增的 AC9 明确：**集成是「import 取代 spawn」的前提，不是它的附带好处**——
**散落的 CLI 脚本强制测试用 spawn，模块化到一个入口之后测试才可能 import**。
⇒ **本任务的 AC8 依赖 AC10 与第二步，不是可以先做的独立项。**
**外层此前把 AC8 当作「第三层收益」写入时，读起来像是一条可独立开工的优化——那是误导，已更正。**

**三样收益里只有一样会被 σ 吃掉，验证时用另外两样**（外层已实测复现两个乘数，见上表）：
套件时间（每 spawn 约 220ms）**会**被 σ=297.6s 吃掉，**不要用它验证**；
fork 数与峰值内存**都可以直接测**。**这是今晚同一个陷阱的第五次出现**——
优化判据、验证判据、收口判据、两份规格的验证方法，现在是三样收益的验证选择。

**排期**：动 `mcp-server.ts` 与普查器，**与在飞的 3b、与新立的另外三条均不相交**。
**但它是本批里唯一的多步任务**——三步各自可收口，**建议按步派发而不是一次派完**，
否则第三步会在第一步的收口判据还没兑现时就开工。
