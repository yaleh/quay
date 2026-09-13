---
id: gap-ac203-record-schema-has-no-kind-dimension
title: AC-203「driver 在第三方项目真活」的记录 schema 没有 kind 维度 —— 三条证据无法区分验的是哪个 driver
  kind，而 goal/quality/meta 当场复现了它声称已排除的形态
status: ready
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**症状（2026-09-13 实测，人裁定「所有 driver 都应作为产品化的一部分分发，并在目标项目开发过程中实际运行」后当场撞到）**：

在 ad-arm1 的 archguard（真实第三方项目）上启动 `goal` / `quality` / `meta` 三个 driver kind，三次全部打印：

```
started: supervisor pid=4035869 kind=goal run_id=gl-prod-1789266411
```

并 **退出 0**，而紧随的 status 是：

```json
{"supervisor_alive":0,"driver_alive":0,"alive":0,"running":0,"carrier_records":0}
```

直接量交叉核实（⛔ 不采信 status 自述）：三个 kind 的实际进程数 **全为 0**，三个载体 `goal-round.jsonl`/`quality-round.jsonl`/`meta-driver-round.jsonl` **全部不存在**。

真实死因**只写在目标项目内部日志** `.quay/<kind>-driver-supervisor.log`，全文仅 54 字节一行：

```
/usr/bin/node: bad option: --experimental-strip-types
```

**这与 GOAL-009 背景第 2 条逐字记载的形态完全相同**（当时是 promotion kind、根因是 `driver-runtime.ts:986` 把路径锚在 `opts.root`）：「**`quay driver start` 报成功、退出 0，而 driver 根本没活**」。

**而 `AC-203`（「driver 在无 `plugin/` 的第三方项目里真活——判据读载体，⛔ 不读 start 退出码」）已 achieved。**

**⚠️ 本任务的主体不是「AC-203 漏了几个 kind」，而是比那更硬的一条 —— 它的记录 schema 里根本没有 kind 这个维度**（实测）：

```
载体中 ac=GOAL-009-AC-203 的记录数：3
字段集：{ts, host, project_root, has_plugin_dir, driver_alive, carrier_records, build_sha}
含 kind 字段的记录数：0
```

⇒ 该 AC 结构上**不可能**区分「验的是 promotion 还是 goal」。它的绿只能说明「**某一个**（未记录是哪个）driver kind 在第三方项目里活过」，⛔ 不能说明「driver 在第三方项目里真活」这个它标题声称的命题。

**同一模式的第三次出现（⛔ 不是孤例）**：该 AC 三条记录的 `project_root` 分别是
`/home/yale/quay-verify-coldstart-63ee9681-root`、`-b95bd6f1-root`、`-4a9654a1-root`
——**全部是 `quay-init` 造的一次性项目**。与 `AC-234`（web 第三方渲染，三条证据同样全来自 `quay-verify-coldstart-*-root`）、`AC-206`（goals+tasks 双载体）构成同一族：**AC 在一个天然具备 quay 自身形状的子集上取得绿，被当成了全集的保证。**

**为什么现在必须修（发生率已给出，⛔ 不是假想）**：人 2026-09-13 裁定所有 driver 都要在目标项目实际运行 ⇒ 该 AC 覆盖的对象从 1 个 kind 扩到 5 个（promotion/worker/goal/quality/meta；outer 已于 2026-09-04 退役）。**扩容当天，三个新 kind 全部复现了该 AC 声称已排除的形态。**

## Plan

1. **先取直接量**：打印载体中 `GOAL-009-AC-203` 全部记录的完整字段集与取值（⛔ 不只报数量），标出缺哪些维度。
2. **补 kind 维度**：让该 AC 的记录能区分 driver kind；**并决定该 AC 的语义边界** —— 是「每个 kind 各需一条记录」还是「一条记录携带已验证 kind 的集合」，给出选择理由，⛔ 不要两种都做。
3. **⛔ 不得只改判据文本而不改产出侧**：产出侧（写记录的那一处）与判据（读记录的那一处）必须同时覆盖新维度，否则就是本仓库已立案的 `gap-ac-record-schema-duplicated-between-criterion-and-writer` 那类两处漂移。
4. **start 的存活确认**（与 kind 维度同源、一并处理）：`quay driver start` 在 driver 未能存活时**不得**打印 `started:` 并以 0 退出。给出你选的形态（启动后短暂等待再确认 / 读 supervisor 首轮日志 / 其他），并说明它为什么不会把「慢启动」误判为「死亡」。
5. **负控制**：构造一个必死的启动（例如 PATH 中放一个不支持 `--experimental-strip-types` 的 node），`start` 必须以非零退出或明确报错；正常启动仍须成功。

## Acceptance Criteria

- [ ] AC1 能取假：载体中存在**至少两条** `GOAL-009-AC-203` 记录，其 kind 维度取值**不同**（例如 promotion 与 goal 各一条）；打印两条记录原文。今天此项为假（全部 3 条无 kind 字段）。
- [ ] AC2 产出侧与判据侧同时覆盖：打印「判据实际读取的字段集」与「产出侧实际写入的字段集」的**两向差集**，差集为空。
- [ ] AC3 start 存活确认能取假：注入一个必死的 driver 启动 ⇒ `start` 非零退出且报出死因；移除注入后 ⇒ 正常启动成功。**两态输出逐字贴出。**
- [ ] AC4 慢启动不误判：构造一个启动耗时明显长于确认窗口的 driver ⇒ 必须**不**被判为死亡（贴出该用例的实际耗时与判定结果）。

## Definition of Done

- 四条 AC 满足，AC3/AC4 的两态输出有实际留档。
- ⛔ 不得通过放宽 AC-203 判据（例如删掉 `driver_alive` 断言）来满足任何一条。
- ⛔ 本任务不负责让五个 kind 全部在 archguard 上跑起来——那已于 2026-09-13 手工完成（五个 supervisor 均存活）；本任务只负责让「**报成功但实际死亡**」这件事今后会被机械拦下。
- 项目自身闸门（scoped 门 + 全量套件绿）。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- packages/quay/src/cli/driver.ts
- plugin/test/verify-deliver-coldstart.test.mjs
- tasks/gap-ac203-record-schema-has-no-kind-dimension.md
