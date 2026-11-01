---
id: gap-task-efficiency-baseline
title: E1：任务级端到端效率基线——关联尝试/会话/fan-in/suite/落地，分清费用、时间与计算
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal

按人 2026-11-01 授权顺序，首先建立每个成功落地任务的效率基线，并并行推进既有 MCP blacklist 扩展。3832 个 task-worker 会话不等于任务数；11/177 是历史分类失败次数而非 suite 跳过率，不能推导 94% 全量命中。现有平均占用和 suite wall-hours 也不能直接证明吞吐瓶颈或 CPU-hours。本任务复用现有遥测与用户 CSV，记录来源窗口、关联覆盖率、缺失与不确定性；不改调度、模型、上下文 cap 或任何质量门。
<!-- dedup-ref -->
与 gap-fan-in-queueing-model-does-concurrency-help（已 done）保持独立：旧任务分析锁竞争，本任务交付任务级费用/尝试/会话/验证联合账本。合并候选检查无开放同文件任务。用户提到的 A3 未在当前 provider 中识别到对应减轮数测量任务，本任务纳入轮数与返工归因；若随后找到同机制 A3，复用其结果，避免重复实现。

## Plan

先盘点 CSV 和各 jsonl 的真实字段及身份语义，明确 task、attempt、session、fan-in run、suite run、受测 SHA 与落地 SHA，禁止把跨尝试重复 run_id 当唯一键。实现只读、可复跑报告，已有记录不足时明确 not-evaluated。按项目/角色/时间窗口分层，拆 ready 等待、资源门阻塞、worker 执行、fan-in 等锁、持锁步骤、suite 等槽/执行与返工；不能区分的区间不得强行归因。轮数分析区分探索、工具等待、重复读取、验证、修复及无法分类项，不直接设置轮数上限。真实基线后再提出收益目标。E5 只输出是否存在持续队列及显著锁等待的证据，不启动锁改造。

## Acceptance Criteria

- [ ] AC1 `node --test scripts/task-efficiency-baseline.test.mjs` exit 0：重复尝试、重复记录、跨窗口任务、缺结束事件、复用 run_id、suite 无法唯一关联均有反例，缺失不能变成零或成功。
- [ ] AC2 `node scripts/task-efficiency-baseline.mjs --help` exit 0；公开输入 schema、时区、窗口边界、数据来源及身份关联规则，明确 completed outcome 与权威落地证据的区别。
- [ ] AC3 以真实窗口运行报告并在 docs/analysis/task-efficiency-baseline.md 给出完整复跑命令：成功落地任务/所有尝试两套分母、p50/p90、每任务累计费用/ITE与返工，无法关联记录数量及覆盖率可机械核对。
- [ ] AC4 报告逐项列出 worker/fan-in 等锁/suite 等槽与执行/其它可测步骤；CPU-seconds 只取真实 CPU 计量，不能用 wall-time 换算。缺 CSV、ready 事件或 CPU 数据均明确 not-evaluated 并给所缺字段。
- [ ] AC5 轮数分解可下钻至原会话，不能分类者单列；报告实测 suite 跑/跳过/分类失败分母、资源门拒绝及 ready 池空证据，不能用 11/177 或全窗口平均并发替代。
- [ ] AC6 基线报告给出 E2 可复用的身份/窗口接口，以及 E5 锁等待与持续队列证据；未确认吞吐瓶颈时结论保持未知，不修改锁、fail-closed、AC/DoD 或 G3。

## Definition of Done

- [ ] 工具对当前工作区真实遥测运行，提交可复跑报告及覆盖率读数，抽查至少一个多次尝试任务和一个无法关联实例；证据必须来自真实对象而非仅 fixture。
- [ ] CSV 若无法取得，明确记录费用维度未评估与需要的输入，不把 token 估计写成实际账单；只有真实可测部分可宣称已建立基线。
- [ ] 改动通过相应检查，报告无未经测量的优化收益承诺，任务状态及 AC/DoD 仅由有明确授权的流程推进。

## Touches
- scripts/task-efficiency-baseline.mjs (new)
- scripts/task-efficiency-baseline.test.mjs (new)
- docs/analysis/task-efficiency-baseline.md (new)
- tasks/gap-task-efficiency-baseline.md
