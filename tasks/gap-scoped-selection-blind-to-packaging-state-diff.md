---
id: gap-scoped-selection-blind-to-packaging-state-diff
title: "scoped selection blind to packaging-vs-source diff (manager usage-view
  Q; archguard TASK-62 self-note applies verbatim to quay): basename pairing
  never matches packaging tests (npm-pack-e2e/build-dist/...), src-touching task
  scoped-green can still break packaged; fix: src-touching task forces ≥1
  packaging test in selection"
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**跨切判据 scoped 系统性失明——三个项目三种检查的通用问题 + 任务模板治本（管理者 14:26/16:1x + archguard 三实例 + 外层裁定）**：

**三个独立实例（跨项目证据）**：
1. **打包态一致性**（quay + archguard）：select-tests-for-touches basename 配对不匹配打包态测试
   （npm-pack-e2e/build-dist/...），src 任务 scoped 选不中 → 打包态坏等到 CI/采用者。
2. **ADR-007 合规**（archguard TASK-64/65/66）：加 MCP tool 缺 canonical CLI flag，scoped 全绿 AC 全勾
   但没跑 check-adr（跨切测试，scoped 覆盖不到）。三连复发后 archguard 落档「MCP-tool 任务 AC 必含
   check-adr 0 violations」。
3. **lint**（archguard TASK-66，第三个独立实例）：测试文件引入 14 个新 lint error，scoped 全绿 AC 全勾，
   npm run lint 仍 exit 1。

**共同模式**：跨切判据无法通过 basename/touches 配对进 scoped 选中集，只能靠全量/独立复验兜底。
**三个项目、三种检查，共同点完全一样**——不是单项目偶发，是「scoped 层对跨切判据系统性失明」。

**治本方向（archguard 建议 + 外层采纳）**：任务模板 AC 默认应含一份「跨切检查清单」（哪些检查必须在
任务内跑而非留给全量）——**不是逐个检查各自加规则**（每出现第 4 个跨切检查又要再加一条）。与「机制
在一处做好、下游配置复用」同原则：quay 侧一份通用任务模板，不是每个项目各自总结治本规则。

### 选定机制

1. **范围扩大**：本任务从「打包态 vs 源码态」扩大为「跨切判据类」通用问题（三实例统领）
2. **治本**：任务模板（plugin/skills/author/SKILL.md）AC 默认含「跨切检查清单」——新代码 lint-clean +
   check-adr 0 violations + 打包态一致性（按任务类型），使跨切检查成为任务内可测项
3. **scoped 侧**：select-tests-for-touches 加「跨切」标记（标记为跨切的判据测试无论 touches 必须进 scoped
   选中集）——机制层兜底
4. 验证：任务模板生成的 AC 含跨切清单；跨切判据测试进 scoped

## Acceptance Criteria

- [ ] AC1: 任务模板（author SKILL.md）AC 默认含「跨切检查清单」——新代码 lint-clean + check-adr 0 violations + 打包态一致性（按任务类型，实测模板生成含）
- [ ] AC2: select-tests-for-touches 加「跨切」标记——跨切判据测试（打包态/ADR/lint 检查器）无论 touches 进 scoped 选中集（实测）
- [ ] AC3: 触碰 packages/*/src 的任务 scoped 含至少一个打包态测试（实测，原打包态 AC 保留）
- [ ] AC4: 触碰 src 或新增 MCP tool 的任务 scoped 含 check-adr（ADR 跨切检查，实测）
- [ ] AC5: 新代码 lint 检查进任务内（scoped 跑 lint 或任务 AC 含 lint-clean，实测 14-error 形态被抓）
- [ ] AC6: 纯 plugin/文档任务不含跨切测试（不误加，scoped 保持秒级）
- [ ] AC7: 与 archguard TASK-62/64/65/66 + CLAUDE.md packaging e2e + 自适应并发（机制一次下游复用）交叉标注

## Definition of Done

- [ ] AC1-AC7 全勾（author SKILL 模板含跨切检查清单；select-tests-for-touches 加跨切标记；触碰 packages/*/src 含打包态测试；触碰 src/MCP tool 含 check-adr；新代码 lint 检查进任务内；纯 plugin/文档不含跨切测试；与 archguard TASK-62/64/65/66 + packaging e2e + 自适应并发交叉标注）
- [ ] 跨切判据实测：打包态/ADR/lint 检查器无论 touches 进 scoped 选中集
- [ ] scoped 门 `scripts/test.sh --for-task gap-scoped-selection-blind-to-packaging-state-diff` 绿

## Touches

- plugin/skills/author/SKILL.md（任务模板 AC 默认跨切检查清单）
- plugin/scripts/select-tests-for-touches.ts（跨切标记）
- plugin/test/select-tests-for-touches.test.mjs（AC2-AC6 测试）
- CLAUDE.md（packaging e2e 边界 + 跨切判据说明）
- tasks/gap-vendor-runtime-not-in-git-clone-broken-mcp-entry.md（AC7 交叉标注）

## Contract

measure   crosscut_in_scoped = `node --experimental-strip-types plugin/scripts/select-tests-for-touches.ts --task <src-touching-task> 2>&1 | grep -c 'npm-pack-e2e\|build-dist\|check-adr\|lint'` stdout 数字段
band      crosscut_in_scoped >= 1（src/新 tool 任务 scoped 含跨切测试）
invariant task_template_has_crosscut = 1（任务模板 AC 默认含跨切检查清单）
invoke    `grep -n '跨切\|lint\|check-adr\|crosscut' plugin/skills/author/SKILL.md plugin/scripts/select-tests-for-touches.ts`
control   src 任务 ⇒ 含打包态/ADR/lint（AC3/4/5）；纯 plugin 任务 ⇒ 不含（AC6）
resume    模板 AC 清单与 scoped 跨切标记分步提交，任一步完成即写盘
## Dispatch review

reviewer: none
at: 2026-08-05T18:2xZ
changed: contract-ratchet compliance，外层 18:2xZ 补齐（未审）
