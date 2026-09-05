---
id: gap-runtime-usage-inventory-workflow-blind-spot
title: runtime-usage-inventory.ts 的 readTranscripts 不枚举 subagents/workflows
  层，执行读数系统性偏低（自报 live=112 vs 手工实测 178）——AC160，且必须排在 AC158 执行 archive 之前
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

`orchestration/SPEC-plugin-lifecycle-single-bundle-2026-09-02.md` §11b 已定位：
`plugin/scripts/runtime-usage-inventory.ts` 的 `readTranscripts` **从不枚举**
`<session>/subagents/workflows/<run>/agent-*.jsonl`——而那正是 workflow agent 干活的地方。
实证：`plugin/scripts/quay-session.ts` 被它判 `library`（`executed=0`），实际三天执行 **68** 次（其中 **52** 次在盲区层）；
**去掉 mtime 预筛数字不变** ⇒ 是**目录枚举盲区**，不是时间窗腐烂（这个对照是关键——它排除了另一个同形解释）。
⇒ 它自报 `live=112` 与 SPEC §11 手工实测的 **178** 相差约 66 个脚本。

**排序补正（本任务立案时提出，SPEC 原排序有缺陷）**：SPEC 把本条放在乙组（AC160），
而 §12e 明写「**执行 archive 前须按 §12d 重算一次死集**」，§12d 的判据是「三天零执行 ∧ 无生产调用者」
——**"零执行"读数正是本盲区的受害者**，SPEC §11b 自己也写了「⛔ 它的 `unaccounted` 清单不得作为退役依据」。
⇒ **本任务必须排在 AC158（执行 archive）之前**，否则会按一份**已知有缺口**的读数删掉 97 个脚本，
其中可能包含每天被调用几十次的对象。

⚠️ **SPEC §11b 举的另一个样本 `monitor-mount-check.sh` 已随 session-liveness 退役删除**
（`f2525e075` / `5444b8bf2`，2026-09 初；本任务立案时 `ls` 核实不存在）
⇒ **它不能再作判据锚点**；幸存的已知真样本是 `plugin/scripts/quay-session.ts`。
这本身是 SPEC 里一个带日期的读数腐烂的实例，判据必须锚在立案当下核实过存在的对象上。

## AC

- [x] AC1 修枚举：`readTranscripts` 枚举到 `<session>/subagents/workflows/<run>/agent-*.jsonl` 这一层，并一并覆盖直属 `<session>/subagents/agent-*.jsonl`（CLAUDE.md 记载的 transcript 目录结构两层都不递归）。
- [x] AC2 已知真样本干跑（零计数的配套动作）：修复**前后各跑一次**，`plugin/scripts/quay-session.ts` 的 `executed` 须由 0 变为非零；两个读数逐字入任务体。⛔ 只贴修复后的读数不算——那不能区分"修好了"与"样本本来就非零"。
- [x] AC3 fixture 负控制：新增测试，构造含 `subagents/workflows/<run>/agent-*.jsonl` 的 fixture 目录，断言被枚举到；**把枚举改回原样即红**（在未修版本上必红）。
- [x] AC4 口径差核对：修复后重跑一次全量普查，报出新的 live 计数、以及与修复前自报 112 / SPEC 手工实测 178 的差值，三个数入任务体。

## DoD

用**真实 transcript 目录**（非 fixture）跑过一次普查，`quay-session.ts` 的 `executed` 由 0 变为非零并留读数；
且 AC4 的三个数字已入任务体，供 `gap-dead-set-registry-bare-filename-scan` 的死集重算引用。
⛔ 仅 fixture 测试通过不算达成（硬规则 4 推论三：AC 必须至少有一条读生产载体；本仪器的生产载体就是真实 transcript 树）。

## Verification（真实 transcript 树，非 fixture）

**口径**：默认主窗口 `since=2026-08-02T11:00:00Z → until=2026-09-05T13:50:35Z`（工具的全量普查窗口），
`sessions-dir=~/.claude/projects/-home-yale-work-quay`。**窗口说明**：SPEC §11 的「0 / 112 / 178」是
**2026-09-02 的 3 天窗口**读数；截至本任务执行（09-05），workflow 层文件 mtime 已全部 >3 天（最新 09-01），
3 天窗口**完全不含** workflow 层 ⇒ 修复在 3 天窗口上无可见差，只能在含 workflow 文件的默认全量窗口上展示。
⇒ 判据的「前后各跑一次」落在**同一**默认窗口上。

| 读数（同窗口前后对照） | 修复前（未枚举 workflow 层） | 修复后（枚举 workflow 层） |
|---|---|---|
| `plugin/scripts/quay-session.ts` `executed` | **144** | **1078**（+934，全来自 workflow 盲区层） |
| `live` 计数 | 259 | **261**（+2） |
| 主窗口 commandCount | 132501 | 193137（+60636） |

**AC4 三数**：① 修复后全量普查 `live` = **261**；② 与修复前自报 112 的差值 = **+149**；
③ 与 SPEC 手工实测 178 的差值 = **+83**。
（②③ 是跨窗口参考：112/178 为 09-02 三天窗口锚点，261 为 09-05 默认全量窗口；同窗口可比的修复前后差是上表 259→261。
`live` 只 +2 是因为 workflow 层多为「已 live 脚本的额外执行」，把 `quay-session.ts` 这类已 live 样本的执行数从 144 抬到 1078，而非新增 live 脚本。）

**AC2 注**：SPEC 的「`executed=0`」是 09-02 三天窗口读数，已随窗口滚动腐烂（同本任务 Proposal 记录的
`monitor-mount-check.sh` 腐烂实例）。当前默认窗口修复前已是 **144**（非零，即 AC2 所警示的「样本本来就非零」）；
修复后 **1078**。前后逐字读数均已入上表，「修好了」由 144→1078 的差值区分，而非单贴一个非零读数。

## Touches

- plugin/scripts/runtime-usage-inventory.ts（readTranscripts 枚举两层 subagents 目录）
- plugin/test/runtime-usage-inventory.test.mjs（fixture 负控制：workflows 层被枚举，改回即红）
- tasks/gap-runtime-usage-inventory-workflow-blind-spot.md（自身）
