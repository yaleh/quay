---
id: gap-ac89-productization-verification-record
title: "AC89: 产品化验证结果落一处可机械核对的记录（per-task-suite-records.jsonl 形态，非散文报告）"
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac85-local-build-current-artifact
---

**type:** execution

## Proposal

**来源**：人 2026-08-16 裁定新阶段（manager-phase-goal.md AC89）。

**目的**：AC85–AC88 完成后，产品化状态（build 产物 / CI 等价路径 / 跨主机验证结果）要写回
**一处可机械核对的记录**，供下次"产品化健康"检查复用。

**判据**：验证结果（成功/失败 + 证据）落一份**可机械核对**的记录——**同 per-task-suite-records.jsonl
的形态**（结构化 JSON 行，不是散文报告）。⛔ 不要求新造一个仪表盘。

**依赖**：AC85（本机 build 产物）——记录的内容之一是该产物的版本号/路径；跨主机验证结果
（AC88）也写入本记录。

## Plan

1. 设计记录形态（JSON 行：`{ts, ac, ok, artifact, evidence, detail}`，对齐 per-task-suite-records）。
2. 落写入机制（plugin/scripts/ 下脚本或现有记录器的扩展），AC85/AC86/AC88 的验证结果写入。
3. 判据能取假：记录存在且可机械解析（jsonl 每行合法 JSON）；AC85-88 各一条。

## Acceptance Criteria

- [ ] AC1: 存在一份结构化记录文件（如 `.quay/productization-verification.jsonl`），每行合法 JSON。
- [ ] AC2: AC85 的 build 产物验证结果写入（成功/失败 + 版本号 + 产物路径）。
- [ ] AC3: AC86 的等价路径执行结果写入（run id / 本地验证输出 + 时间戳）。
- [ ] AC4: AC88 的跨主机验证结果写入（B/C 两机 + 安装/初始化/冷启动三项 + 时间戳）。
- [ ] AC5: 记录可机械解析（一个读取脚本/检查器能消费，不靠人读散文）。

## Definition of Done

- [ ] AC85–AC88 完成后，产品化验证状态落一处可机械核对的记录，下次"产品化健康"检查可直接消费。

## Touches

- plugin/scripts/*（记录写入机制）
- .quay/（记录文件）
- plugin/test/*（对应测试）
- tasks/gap-ac89-productization-verification-record.md（自身）
