---
id: gap-b5-input-shape-path-to-content
title: B5·层 3 输入形状 path→content——判定逻辑对字符串纯函数，先 3-5 checker 示范测收益
status: todo
labels:
  - gap
  - feature
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

SPEC §1.4 实测：~70% checker 吃【文件系统路径】⇒ 85 个 checker 测试中 70 个要 mkdtemp 建 fixture。真正的可测试性杠杆是【输入形状 path→content】——判定逻辑对【字符串】纯函数，I/O 留薄 CLI 壳。样板已存在：`experiments/quay-perpetual-stream/scripts/audit-independence-check.ts`（纯函数 39 断言 0.49s 零 spawn，对照 checker 测试中位 2.53s）。⛔ 不以「缩短套件时间」为论据（§1.5② 已自证否定：checker 测试折叠 ≈ 705s 轮次 1.5%，93% 在 packages/）。真实论据 = checker 测试撰写/维护成本（32,881 行）。

## Plan

先 3-5 个 checker 做示范（用 audit-independence-check.ts 作模板，把判定逻辑抽成对字符串的纯函数导出 + 薄 main() CLI 壳），测出实际收益（测试耗时下降 + 撰写成本下降）再决定是否推广。⛔ 不凭已被否定的「缩短套件」链条推广，先测后写。

## Acceptance Criteria

- [ ] AC1（能取假，纯函数导出）：≥3 个 checker 导出对【字符串/内容】的纯判定函数（非路径），其测试可零 spawn 零 mkdtemp 运行（grep + 实测测试耗时）；（⛔ 仍吃路径 ⇒ 假）。
- [ ] AC2（能取假，负控制）：该纯函数测试确实覆盖判定逻辑（注掉判定逻辑一处，测试须红）；（⛔ 注掉不红 ⇒ 假）。
- [ ] AC3（能取假，收益实测）：示范 checker 的测试耗时（vs 改造前）记录在案，作推广/不推广的依据（先测后写，不凭链条）；（⛔ 无收益记录 ⇒ 假）。

## Definition of Done

≥3 个 checker 示范 path→content；AC1/AC2/AC3 全勾；收益实测记录（决定推广与否）。

## Touches

- plugin/scripts/（3-5 个示范 checker 抽纯函数 + 薄 main 壳）
- plugin/test/（纯函数测试 + 负控制 + 耗时对照）
- tasks/gap-b5-input-shape-path-to-content.md（自身）
