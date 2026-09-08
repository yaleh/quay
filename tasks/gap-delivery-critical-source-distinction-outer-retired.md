---
id: gap-delivery-critical-source-distinction-outer-retired
title: delivery-critical 标签：dispatch-preference.md 说明文字过期（仍写"由 outer
  按证据打"）且来源无字段区分（outer 退役 + DIR-130 新增来源）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Finding

**背景（本次对话已查证，非猜测）**：`orchestration/dispatch-preference.md:23` 已有通用谓词——「候选中凡满足 `delivery-critical` 标签者，一律优先」，这条谓词在真实生产派发链路（`worker-driver.ts` → `driver-runtime.ts:704-740` 的 LLM selector）里确实生效（`.quay/worker-dispatch.json` 里能看到 selector 实际读取并按此推理）。

但该谓词的说明文字（`dispatch-preference.md:30`）逐字写着：「`delivery-critical` 标签——由 outer 在立案/晋升时按证据打，**从不移除**」，并以此为前提论证"标签数量不需要清理也不会失控，靠 ready 池自行衰减即可到期"（`orchestration/manager-phase-goal.md:3586-3588` 同一论证）。

**两处现状变化使这个前提不再成立，但文字未同步**：

1. **outer 已退役**（`CLAUDE.md:17`：「outer 作为独立会话角色亦已退役(2026-09-04, gap-retire-outer-tmux-window-logic done, 职能并入 manager 直接 subagent 派发)」）。"立案时打 delivery-critical" 这个原始职责随之无人执行——`task-authoring` 语义职责虽已划归 manager 派 subagent（`manager-phase-goal.md:117` AC145），但实际使用的 `plugin/skills/quay-file-task/SKILL.md` 全文没有任何 delivery-critical 相关指引；`todo→ready` 晋级逻辑（`ready-pool-check.ts:1750-1756`、`task-ops.ts:72-113` 的 `ensureDeliveryCriticalLabel`）只是**保留**已存在的标签，从不做"是否够格"的判定。

2. **`DIR-130`（2026-09-02, done, dirStatus: applied）已授权 manager 不逐次请示直接加/删 `delivery-critical` 类标签**（`plugin/skills/quay-task-operator/SKILL.md:29-30`：「MAY act without per-write "yes"...`labels` add/remove (incl. `delivery-critical`-class priority labels)」）——这开辟了第二个合法来源：人类对 Claude Code 下达临时优先派发指令时，manager 可直接打标签插队（2026-09-07 本仓库实际发生过一次：人要求优先派发 `gap-goal-evidence-cache-should-not-enter-git`）。

**风险**：同一个标签现在有两种语义完全不同的来源（"outer 按证据打"vs"人类/manager 临时插队打"），没有任何字段区分。`dispatch-preference.md:31` 那类"实测 N 条带该标签者中 done/superseded/ready 分布"式的统计，若被将来当作"delivery-critical 出现率/质量"的证据引用，会被两种来源混淆而失真；"从不移除也安全"的论证前提（标签稀有、严格按证据）也已被 DIR-130 事实上打破。

**⛔ 明确排除**：不是要求恢复"必须按证据才能打"的强制门禁（DIR-130 的临时插队授权本身是人已裁定的合法用法，不应被本条推翻）；只是要让"这条标签当前是哪种来源"变得可辨。

## AC

- [x] `orchestration/dispatch-preference.md` 覆盖段该谓词条目的说明文字更新：不再单一声称"由 outer 按证据打"，改为反映现状——来源分两类（证据类：立案/晋升时打；临时指令类：DIR-130 授权下 manager 按人类指令打），且写明 outer 已退役、"立案时按证据打"这一步目前无人机械执行。
- [x] 任务 frontmatter 新增一个可选字段区分来源（如 `extra.deliveryCriticalSource`，取值如 `evidence` / `adhoc`，具体命名由实现者定），`ensureDeliveryCriticalLabel`（`plugin/scripts/task-ops.ts:72-113`）或等价写入路径在打标签时能设置/保留该字段。
- [x] 一条机械检查器或测试验证：该字段在两种典型写入路径（晋级时保留 / manager 经 DIR-130 临时打）下各自取到预期值，不是散文承诺。
- [x] 负控制（硬规则 3b）：一个没有该字段的历史 delivery-critical 任务（现有 72 条中的旧任务，实测见 `dispatch-preference.md:31`）不因缺字段被误判为"来源不明确=有问题"——需要一个明确的"未知/legacy"三态，不得与"evidence"或"adhoc"任一确定态同形。

## DoD

- [x] 上述判据本轮实跑并贴出输出，不是转述。
- [x] `git log` 可见一次真实针对现有 delivery-critical 任务（存量或新打标签）的读写验证，不是只跑单元测试 fixture。

## Touches

- `orchestration/dispatch-preference.md`
- `plugin/scripts/task-ops.ts`
- `plugin/scripts/task-schema.ts`
- `experiments/quay-perpetual-stream/scripts/task-schema.ts`
- `docs/references/task-schema-canonical.md`
- `plugin/test/task-ops.test.mjs`
- `docs/analysis/quay-init-closure-ratchet.baseline.json`
- `tasks/gap-delivery-critical-source-distinction-outer-retired.md`

## Execution record

**判据实跑（DoD1，贴输出非转述）**

- `plugin/test/task-ops.test.mjs` → 15/15 pass（新增 4 条：三态投影负控制 / promote-evidence 盖章 / preserve-adhoc / manager-adhoc 透传）
- `plugin/test/ready-pool-check.test.mjs`（delivery-critical 相关 8 条）→ 8/8 pass（`setTaskStatus` promote 路径盖章不破坏既有断言）
- `plugin/test/slot-refill.test.mjs`（DELIVERY-CRITICAL 7 条）→ 7/7 pass（e2e promote 端到端不回归）
- 真实存量读（develop 快照，`frontmatterDeliveryCriticalSource` 投影）：110 条 delivery-critical 任务 → `{evidence:0, adhoc:0, unknown:110}`

**真实读写验证（DoD2，git log 可见，非 fixture）**

- 写：`task_write` 对真实 done 任务 `gap-ac36-delivery-critical-priority-axis` 打 `extra.deliveryCriticalSource: "evidence"`（历史来源=outer 按证据打），commit `3d038410a`（author → ff develop）
- 读回：`git show develop:tasks/gap-ac36-delivery-critical-priority-axis.md` 投影 → `deliveryCriticalSource: evidence`（其余 109 条仍 `unknown`）
