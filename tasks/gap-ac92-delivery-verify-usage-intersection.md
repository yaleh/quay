---
id: gap-ac92-delivery-verify-usage-intersection
title: "AC92: 交付验证面必须与实际使用面相交——装完 tgz 后按实测频次取前 N 个真实使用机件逐个真跑"
status: todo
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**判据正本（直接引用，勿转述）**：`orchestration/manager-phase-goal.md` 「🆕 AC90–AC93」区块 → `### AC92`。

**实测（manager 已跑过，get_work_patterns 全历史）**：`develop-deliver-tgz.sh:140-161` 装完只跑
`quay --help`（`:140`）+ 铺临时 workspace 跑 `quay serve --port 18091` 并 curl `http_code==200`
（`:141-161`）。而开发过程真正吃重的是 **Bash 16428 次**打向 `plugin/scripts/` 的 245 个 ship 脚本
+ 4 个被点名的 workflow + 14 个 skill；**MCP 面 18 个工具里 12 个实测零调用**。
**⇒ 验证的是「端口活着」，使用的是「几百个脚本能不能跑」——两者几乎不相交。**

## Plan

> **排期建议（非前置，depends_on 已拆，manager 2026-08-16 裁定）**：建议在 AC93 land 之后做
> （派发顺序，人手执行——四条里最重，放最后）；无真前置。

1. 按**实测调用频次**取前 N 个真实被使用的机件（**N 由读数②的分布决定，⛔ 不许拍一个数字**——
   硬规则④推论：成本/分布未知前不设阈值）。
2. 至少必须含 `capability-catalog.sh`（目录自身）+ 三层执行核点名的那 ≈60 个脚本里可离线跑的子集。
3. 装完 tgz 的目标机上，逐个**真实执行一次**并断言退出码与非空输出。
4. **负控制**：删掉目标机上任一被验证的脚本 ⇒ 验证必须失败。
5. 与 AC88 的分工：AC88 管「跑没跑过」，本 AC 管「跑的是不是该跑的东西」。

## Acceptance Criteria

- [ ] AC1: 前 N 个真实使用机件（N 由实测分布决定，非拍数）装完 tgz 后逐个真跑，断言退出码 + 非空输出。
- [ ] AC2: 至少含 `capability-catalog.sh` + 三层执行核点名 ≈60 脚本里可离线跑的子集。
- [ ] AC3: 负控制成立——删掉目标机上任一被验证脚本 ⇒ 验证必失败。
- [ ] AC4: 验证面（跑的是该跑的东西）与实际使用面（几百脚本/机件）相交，不再是「端口活着」单点。

## Definition of Done

- [ ] 交付验证面覆盖实际使用面的前 N 机件（分布决定 N），负控制验证，不再「端口活着」冒充可用。

## Touches

- plugin/scripts/develop-deliver-tgz.sh（验证面扩展）
- plugin/scripts/capability-catalog.sh（被验证对象之一）
- packages/quay/scripts/（如需）
- tasks/gap-ac92-delivery-verify-usage-intersection.md（自身）
