---
id: gap-fan-in-delta-shadow-evaluation
title: E2：delta 分类解释与影子评估——现行放行不变，测可证缩小全量验证面的收益
status: todo
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-task-efficiency-baseline
---
## Proposal

按人 2026-11-01 授权，E1 基线后开展 delta 影子评估，与减轮数测量并行；E5 等锁等待证据显著后再议。现行 delta 三态与 fail-closed、scoped/doc 检查、suite 证书、AC/DoD 和 G3 均维持原义。新逻辑仅记录现行判定、候选判定、覆盖论证及分歧，候选跳过仍执行现行要求的全量验证。不能把不碰 HUB_FILES、孤立 package 或纯测试新增直接当安全证明。
<!-- dedup-ref -->
复用已 done 的 gap-fan-in-delta-classify-declared-doc-surfaces 与 gap-fan-in-delta-scope-doc-only-skip；本任务新增解释与影子对照，不重复其分类修复。文件重叠检查未发现开放合并候选。依赖 E1 的身份与窗口接口；不得依赖一个含义未确认的 A3 名称。

## Plan

为判定补充结构化依据，明确 registry/declared/conservative-default 模式、匹配检查面、未知路径与分类失败。从真实 delta 找到保守误判候选，只选择一个覆盖论证充分的类别做影子规则。记录精确基准/候选 SHA、delta 范围、task/attempt/suite 身份与规则版本；不保留无界日志，不记录会话敏感内容。用同一受测树的现行完整验证作对照，分开静态检查和动态测试覆盖，记录候选漏检、无法比较及样本构成。输出是否值得另立启用任务；本任务自身不启用跳过。

## Acceptance Criteria

- [ ] AC1 `node --test plugin/test/select-static-checks-for-touches.test.mjs plugin/test/fan-in-driver-mechanical-orchestration.test.mjs` exit 0，现行分类与放行决策在影子开/关下保持一致。
- [ ] AC2 结构化输出能核对当前与候选判定、原因、规则版本、基准/候选 SHA、delta 和 task/attempt/suite 身份；分类失败、未知路径、配置或注册表不可读可区分，不能当作空覆盖。
- [ ] AC3 负控制覆盖跨包消费者、构建/打包/锁文件、共享夹具、测试发现、静态 checker 读取文档、证书失效及目标分支前进：候选规则不得凭文件后缀或非 HUB_FILES 自动宣称安全。
- [ ] AC4 真实影子窗口报告复跑命令、样本构成、候选缩小集合、完整验证结果、分歧与不可比较记录；候选跳过的样本仍有现行所要求的完整验证证据，不追加重复 suite 只为统计。
- [ ] AC5 以实测 duration 和 CPU 数据估算潜在收益，未采 CPU 时标未评估；不设 40% 跳过率硬目标。出现候选漏检必须显式报告，不能用零观察漏检替代覆盖论证。
- [ ] AC6 本任务 diff 不放宽当前 fail-closed，不缩短落地锁，不启用新的 suite 跳过，不改 AC/DoD 或 G3；无法证明安全仍走当前全量验证路径。

## Definition of Done

- [ ] 至少一个真实 delta 通过生产判定路径生成影子记录，并可关联到对应完整验证结果；只有测试 fixture 或散文设计不算完成。
- [ ] docs/analysis/fan-in-delta-shadow.md 提供可复跑分歧清单和逐候选覆盖依据，明确建议启用、继续观察或拒绝；任何实际放宽验证面需独立任务与授权。
- [ ] 影子功能失败不改变现行裁决，诊断失败独立可见；相关测试和真实读数随变更留存。

## Touches
- plugin/scripts/select-static-checks-for-touches.ts
- plugin/scripts/worker-fan-in.ts
- plugin/test/select-static-checks-for-touches.test.mjs
- plugin/test/fan-in-driver-mechanical-orchestration.test.mjs
- docs/analysis/fan-in-delta-shadow.md
- tasks/gap-fan-in-delta-shadow-evaluation.md
