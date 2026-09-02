---
id: gap-sea-artifact-consumer-e2e-ac4-assertion
title: sea-artifact-consumer-e2e.test.mjs AC4 断言失败——release artifact plugin init --loop 机制未落（expected:0 不成立）
status: ready
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

## 排查结论（实际根因 + 修法）

排查结果：失败的断言是 `assert.equal(r.status, 0)`（`sea-artifact-consumer-e2e.test.mjs:154`），`quay-init --loop` exit 2，原因是 `quay-init.sh` 的 `verify_referenced_landed` 报
`FAIL (referenced-not-landed): orchestration/SYNTHESIS-four-gaps-2026-08-05.md`。但该文件在 `plugin/skills/init/SKILL.md:162` 已声明 `<!-- reference-doc: … -->`，孤立跑 5 次全绿 ⇒ **不是 single-bundle**（该 SPEC 仅裁定、未实现），也**不是真实 drift**，而是 **load-sensitive 假阳性**：全量 suite 16-lane + phase-overlap 并发下，`verify_referenced_landed` 的声明读取（`_read_declarations` 的 `grep|sed|sort` 管道）被撕裂，已声明的 reference-doc 被误判为 `referenced-not-landed`。

根因定位：该测试 2026-08-25 被 `8d0920765`（fail=0 22-60 次高负载重复）移出 serial → product（主 body 并发 8），但 22-60 次重复**没覆盖到全量 suite 的 16-lane+overlap 负载**，故 09-02 复现 flake（第 2 次，pre-existing 历史 1 次）。

修法（load 豁免，落在 Touches 内）：`@test-group product` → `@test-group serial`（回到 concurrency-1 串行相，该测试在 serial 相 08-09→08-25 共 16 天零 flake），并更新 `@load-sensitive-entry` 与头注释。断言未弱化（AC2）：仍真跑 init --loop + 断 exit 0 + 机制落盘。

## Acceptance Criteria

- [x] AC1（能取假）：AC4 断言与新 release artifact 形态一致（single-bundle 下 init --loop 仍得机制）或 load 豁免后稳定绿；（⛔ 仍 assertion 失败 ⇒ 假）。
- [x] AC2（能取假，无回归）：AC4 仍验证「consumer 从 artifact plugin 能 init --loop 得机制」这一升级通道（不弱化为只查文件存在）；（⛔ 弱化断言 ⇒ 假）。

## Definition of Done

AC4 断言与 single-bundle 形态同步（或 load 豁免）；AC1/AC2 勾；sea-artifact-consumer-e2e 稳定绿；升级通道仍被真实验证；全量 suite 绿。

## Touches

- packages/quay/test/sea-artifact-consumer-e2e.test.mjs（AC4 断言同步 / load 豁免）
- docs/analysis/test-file-baseline.txt（test-file-snapshot 结构性 co-touch：sea-artifact-consumer-e2e 迁 serial 群后离开 --list-files 默认集；snapshot 再生成一并吸收 develop 并发新增测试文件）
- tasks/gap-sea-artifact-consumer-e2e-ac4-assertion.md（自身）
