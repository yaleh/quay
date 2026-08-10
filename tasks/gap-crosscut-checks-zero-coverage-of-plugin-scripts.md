---
id: gap-crosscut-checks-zero-coverage-of-plugin-scripts
title: CROSSCUT_CHECKS 注册表对 plugin/scripts/ 零覆盖——4 条触发器全认 packages/*/src，而今晚 C
  类「真由变更引入」4 条失败全在 plugin/scripts(改 suite-state-trigger→red-window-shared-gate
  破、加 external-dogfooding→verify-delivery-surface 清单破、改
  known-load-sensitive→glob 破)；79% 红与变更无关(A 判定器 8+B 负载 flake 7+C 真变更 4)；补
  plugin-scripts cross-cut 条目使 C 类 scoped 即暴露非全量才暴露
status: ready
labels:
  - gap
  - defect
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal（范围已重定，2026-08-10 manager STOP-AND-RESCOPE）

**原任务基于错误前提：以为 plugin/scripts 下的东西不进 scoped 选择。实跑核实：`select-tests-for-touches.ts` 对 `plugin/scripts/send-keys-verified.sh` 的 Touches 解析出 `plugin/test/send-keys-verified.test.mjs`，coverage 1.00（2/2 resolved），crosscut lint 进入——规则 2 basename 配对和规则 3 mirror fold（条文里明写 plugin/scripts/X.ts）本来就覆盖 plugin/scripts。原前提作废。重定范围后的真实（较小）缺口：CROSSCUT_CHECKS 的 4 条触发器只匹配 `packages/*/src`，所以 plugin/scripts 触碰不会拉进 packaging-state / check-adr / quay-github-src（但 lint 会进，影响比原判断小得多）。值不值得补，需要重新评估，不照抄原说法。**

### 实证（manager 2026-08-10 STOP-AND-RESCOPE + outer 复核）

- **原前提错误**：`select-tests-for-touches.ts --task gap-send-keys-verified-hash-check...` → 解析出 `plugin/test/send-keys-verified.test.mjs`，coverage 1.00（2/2 Touches resolved），crosscut lint。plugin/scripts 覆盖是满的（规则 2 basename + 规则 3 mirror fold，条文里明写 plugin/scripts/X.ts）。
- **manager 错因自述**：只读了 CROSSCUT_CHECKS 那 4 条触发器都匹配 packages/*/src 就外推到整个 plugin/ 是盲区，没跑选择器——又一次从局部读数外推到全集。
- **真实（较小）缺口**：CROSSCUT_CHECKS 4 条触发器确实只匹配 packages/*/src，所以 plugin/scripts 触碰不会拉进 packaging-state / check-adr / quay-github-src（这些 cross-cut 测试不进 scoped 选择）；但 lint 会进（泛型 .ts/.js/.mjs 触发）。影响比原判断小得多。
- **评估**：plugin/scripts 触碰（如改 known-load-sensitive.ts / suite-state-trigger.ts / ready-pool-check.ts）时，packaging-state（npm-pack-e2e/build-dist）确实不会进 scoped——但 packaging-state 测的是打包产物，plugin/scripts 改动是否会影响打包产物需要逐项评估（多数 plugin/scripts 改动不影响 packages 打包）。check-adr 同理（ADR 检查对象是 packages src / mcp 工具）。**结论：值得补的优先级低**——plugin/scripts 触碰与 packaging-state/check-adr 的耦合是稀有的（今晚 C 类 4 条全是测试/脚本层耦合，不是打包层），且 lint 已覆盖基础面。**不立新任务补触发器，除非未来出现「改 plugin/scripts 打破打包产物」的真实实例。**

**为什么重要**：纠正错误前提，避免 inner 在错误范围上实现无用功能。真实缺口在别处（verification-round.jsonl 无 failures 字段——已立 gap-suite-round-record-missing-failures-field）。

### 选定机制方向（实现归内层，接法留执行时）

1. **本任务收缩为「评估结论」**：CROSSCUT_CHECKS 不加 plugin/scripts 触发器（评估后优先级低，未来有真实实例再补）。若 inner 已开始实现，回退到评估结论。
2. **真实缺口另行处理**：verification-round.jsonl 无 failures 字段 → 立 gap-suite-round-record-missing-failures-field。

**验证锚**：修后 (a) 选择器对 plugin/scripts Touches coverage 1.00（已实测）；(b) CROSSCUT_CHECKS 不变（评估后不加触发器）；(c) 无新插件/打包耦合实例。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录实跑核实（plugin/scripts Touches → 选择器 coverage 1.00）+ 原前提作废 + manager 错因（本任务 Proposal 已含）
- [x] AC2: **范围收缩**——本任务改为评估结论：CROSSCUT_CHECKS 不加 plugin/scripts 触发器（优先级低，有真实实例再补）
- [x] AC3: **真实缺口转交**——verification-round.jsonl 无 failures 字段 → 立新任务（gap-suite-round-record-missing-failures-field）
- [x] AC4: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [ ] AC1–AC4 全部勾上
- [ ] 修后实跑：选择器 coverage 1.00 贴任务体；CROSSCUT_CHECKS 不变
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- tasks/gap-crosscut-checks-zero-coverage-of-plugin-scripts.md（范围收缩为评估结论；若 inner 已实现则回退）
- tasks/gap-suite-round-record-missing-failures-field.md（交叉标注——真实缺口转交）
- tasks/gap-suite-blocking-red-window-unattributable.md（交叉标注——另一条错误前提任务的更正）

## Contract

measure   plugin_scripts_touch_resolution = `node --no-warnings --experimental-strip-types plugin/scripts/select-tests-for-touches.ts --task <id> --root <repo>` 的 coverage
band      plugin_scripts_touch_resolution = 1.00（plugin/scripts Touches 全解析——前提更正）
invariant crosscut_registry_unchanged = 1（评估后不加 plugin/scripts 触发器）
invariant no_new_crosscut_entry = 1（无新条目）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/select-tests-for-touches.ts --task gap-send-keys-verified-hash-check-cannot-tell-typed-from-submitted --root <repo>`（贴 coverage 1.00）
control   选择器 coverage 1.00；注册表不变；评估结论在档
resume    范围收缩 / 真实缺口转交分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager STOP-AND-RESCOPE——原前提错误（plugin/scripts 被规则2 basename + 规则3 mirror fold 覆盖,选择器实测 coverage 1.00）。范围收缩为评估结论：CROSSCUT_CHECKS 不加 plugin/scripts 触发器（优先级低,真实缺口是 verification-round.jsonl 无 failures 字段,另行立案）。实现归内层（若已实现则回退）

## Evidence（内层实现 2026-08-10 — RESCOPE 评估结论）

**AC1 复现核实**：`select-tests-for-touches.ts --task gap-relation-sync-load-flake-child-spawn-under-suite`（touches `plugin/scripts/known-load-sensitive.ts`）→ 选中 `known-load-sensitive.test.mjs`（basename 配对, 规则 2/3）——plugin/scripts 触摸的自身测试覆盖 1.00, **original 前提（plugin/scripts 零覆盖）作废**。CROSSCUT_CHECKS 维持 4 条 packages/*/src trigger, 不加 plugin-scripts。

**AC2 结论**：不向 CROSSCUT_CHECKS 加 plugin/scripts 触发器（manager 裁定 + outer RESCOPE 02d30522）。下游耦合（verify-delivery-surface→loop-shipping AC1b 等）作为全量套件表面接受, 不以 scoped 增重换取提前浮现。

**AC3 真实缺口转交**：`tasks/gap-suite-round-record-missing-failures-field.md` 已立（209 轮 round 记录无 failures 字段, red-window 归因无法反查失败文件）——RESCOPE 的真实缺口。

**AC4 既有不回归**：CROSSCUT_CHECKS 4 条既有 trigger 零改动; `select-tests-for-touches.test.mjs` 27/27 绿（agent 实现已被裁定丢弃, 此评估不改 selector 代码）。
