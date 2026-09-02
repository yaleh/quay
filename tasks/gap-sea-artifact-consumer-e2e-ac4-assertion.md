---
id: gap-sea-artifact-consumer-e2e-ac4-assertion
title: sea-artifact-consumer-e2e.test.mjs AC4 断言失败——release artifact plugin init --loop 机制未落（expected:0 不成立）
status: todo
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`packages/quay/test/sea-artifact-consumer-e2e.test.mjs` 的 AC4「a consumer can init --loop from the RELEASE ARTIFACT's plugin and gets the mechanisms」断言失败（22.8s，`kind: real-install`，`@load-sensitive-entry`）。pre-existing 历史 1 次（本轮 runner-grouping-flaky fan-in 撞第 2 次）。

该测试是真实安装 e2e（stage plugin sidecar → assemble release bundle → `quay-init.sh --loop` from bundle → assert 机制文件 present + verify-sea-artifact 过）。**嫌疑方向**：`SPEC-plugin-lifecycle-single-bundle-2026-09-02`（d13adbfdb 人裁定「单一 bundle、原生交付、安装只写配置」）可能改变了 release artifact 的 plugin 承载形态（sidecar → single bundle），AC4 的「sidecar 目录 init --loop」断言未同步。或为 load-sensitive 真安装 e2e 在并发 16 核下 git/init 操作失败。

## Plan

1. 排查 AC4 失败的具体断言（expected:0 哪个机制文件缺失/哪个 check 非 0）。
2. 判定根因：plugin-lifecycle single-bundle 改了 release artifact 形态（AC4 断言需同步）vs load-sensitive 真安装 e2e 在并发下失败（需加超时/隔离）。
3. 修：同步 AC4 断言到新 bundle 形态，或加 load 豁免。

## Acceptance Criteria

- [ ] AC1（能取假）：AC4 断言与新 release artifact 形态一致（single-bundle 下 init --loop 仍得机制）或 load 豁免后稳定绿；（⛔ 仍 assertion 失败 ⇒ 假）。
- [ ] AC2（能取假，无回归）：AC4 仍验证「consumer 从 artifact plugin 能 init --loop 得机制」这一升级通道（不弱化为只查文件存在）；（⛔ 弱化断言 ⇒ 假）。

## Definition of Done

AC4 断言与 single-bundle 形态同步（或 load 豁免）；AC1/AC2 勾；sea-artifact-consumer-e2e 稳定绿；升级通道仍被真实验证；全量 suite 绿。

## Touches

- packages/quay/test/sea-artifact-consumer-e2e.test.mjs（AC4 断言同步 / load 豁免）
- tasks/gap-sea-artifact-consumer-e2e-ac4-assertion.md（自身）
