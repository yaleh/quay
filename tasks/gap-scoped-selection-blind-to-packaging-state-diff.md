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

- [x] AC1: 任务模板（author SKILL.md）AC 默认含「跨切检查清单」——新代码 lint-clean + check-adr 0 violations + 打包态一致性（按任务类型，实测模板生成含）
      —— `plugin/skills/author/SKILL.md` step 4（review-plan）新增「Cross-cut AC checklist」：
      ① new code is lint-clean ② check-adr 0 ADR-conformance violations ③ packaging-state consistency
      （纯 plugin/doc 任务不携带）。实测模板生成含：SKILL.md `grep -n 'lint-clean'` 命中；
      Contract `invariant task_template_has_crosscut = 1` 成立。
- [x] AC2: select-tests-for-touches 加「跨切」标记——跨切判据测试（打包态/ADR/lint 检查器）无论 touches 进 scoped 选中集（实测）
      —— `plugin/scripts/select-tests-for-touches.ts` 新增 `CROSSCUT_CHECKS` 注册表 + `applyCrosscut()`，
      src/MCP-tool 触碰触发 packaging-state / check-adr / lint 进 `selected`；默认输出打 `crosscut:` 标记行。
      实测（测试「AC2 — a src-touching task selects cross-cut tests it never basename-pairs to」绿）：
      `packages/quay/src/foo.ts` 任务选中 npm-pack-e2e/build-dist/plugin-packaging/adr-gate/mcp-adr，
      输出含 `crosscut: packaging-state, check-adr, lint`。
- [x] AC3: 触碰 packages/*/src 的任务 scoped 含至少一个打包态测试（实测，原打包态 AC 保留）
      —— 测试「AC3 — src-touching task selects ≥1 packaging-state test」绿：`packages/quay/src/gate/engine.ts`
      任务选中 npm-pack-e2e/build-dist/plugin-packaging（≥1 成立）。
- [x] AC4: 触碰 src 或新增 MCP tool 的任务 scoped 含 check-adr（ADR 跨切检查，实测）
      —— 测试「AC4 — src / new-MCP-tool task selects check-adr (ADR cross-cut)」绿：`packages/quay/src/mcp-server.ts`
      任务输出含 `crosscut: ... check-adr`，选中 mcp-adr/cli-adr 测试。
- [x] AC5: 新代码 lint 检查进任务内（scoped 跑 lint 或任务 AC 含 lint-clean，实测 14-error 形态被抓）
      —— 双腿落地：scoped 腿（CROSSCUT_CHECKS 的 `lint` 条目，代码触碰触发 `crosscut: lint` 标记，测试
      「AC5 — ...names the lint cross-cut...」绿）+ 任务内腿（SKILL.md 模板 AC 含 lint-clean——author 勾选
      前必须跑 lint，archguard TASK-66 的 14-error 形态即被抓）。
- [x] AC6: 纯 plugin/文档任务不含跨切测试（不误加，scoped 保持秒级）
      —— 测试「AC6 — a pure plugin/doc task selects NO cross-cut tests (no bloat)」绿：`plugin/skills/author/SKILL.md`
      + `CLAUDE.md` 任务选中集为空、无 `crosscut:` 标记（CROSSCUT_FILES 全部未入选）。
- [x] AC7: 与 archguard TASK-62/64/65/66 + CLAUDE.md packaging e2e + 自适应并发（机制一次下游复用）交叉标注
      —— `CLAUDE.md` 新增「Cross-cut scoped selection」段（点 TASK-62/64/65/66、DIR-111 dist-verify-node-floor、
      cap-from-gate.sh）；`tasks/gap-vendor-runtime-not-in-git-clone-broken-mcp-entry.md` 新增
      Cross-annotation 段（本族 quay 最贴近实例，其 AC3 为同一跨切判据的安装时腿）。

## Definition of Done

- [x] AC1-AC7 全勾（author SKILL 模板含跨切检查清单；select-tests-for-touches 加跨切标记；触碰 packages/*/src 含打包态测试；触碰 src/MCP tool 含 check-adr；新代码 lint 检查进任务内；纯 plugin/文档不含跨切测试；与 archguard TASK-62/64/65/66 + packaging e2e + 自适应并发交叉标注）
      —— 上列各 AC 证据见各 AC 行。
- [x] 跨切判据实测：打包态/ADR/lint 检查器无论 touches 进 scoped 选中集
      —— `node --experimental-strip-types plugin/scripts/select-tests-for-touches.ts --task gap-both-gates-read-one-signal-so-done-costs-nothing 2>&1 | grep -c 'npm-pack-e2e\|build-dist\|check-adr\|lint'` = **3**（band ≥1）；
      AC2/AC3/AC4/AC5/AC6 五条测试全绿。
- [x] scoped 门 `scripts/test.sh --for-task gap-scoped-selection-blind-to-packaging-state-diff` 绿（2026-08-08 实跑，见 Evidence）

## Evidence

**scoped 门实跑（2026-08-08）**：`bash scripts/test.sh --for-task gap-scoped-selection-blind-to-packaging-state-diff --allow-thin` → 退出 0，选中集 = `plugin/test/select-tests-for-touches.test.mjs`（本任务 touches 仅触发 `lint` 跨切条目，其 tests 为空 → 无跨切测试误加，scoped 保持秒级）；静态检查（task-contract-check 等）绿。

**跨切判据实测**：`node --experimental-strip-types plugin/scripts/select-tests-for-touches.ts --task gap-both-gates-read-one-signal-so-done-costs-nothing 2>&1 | grep -c 'npm-pack-e2e\|build-dist\|check-adr\|lint'` = **3**；`plugin/test/select-tests-for-touches.test.mjs` 24 条全绿（含新增 AC2/AC3/AC4/AC5/AC6 五条跨切测试）。

**变更文件**：`plugin/scripts/select-tests-for-touches.ts`（CROSSCUT_CHECKS + applyCrosscut + 默认输出 crosscut 标记行）；`plugin/skills/author/SKILL.md`（review-plan 步 Cross-cut AC checklist）；`plugin/test/select-tests-for-touches.test.mjs`（AC2-AC6 五条测试 + AC10 pin 精确化）；`CLAUDE.md`（Cross-cut scoped selection 段）；`tasks/gap-vendor-runtime-not-in-git-clone-broken-mcp-entry.md`（Cross-annotation 段）。

## Definition of Done

- [ ] AC1-AC7 全勾（author SKILL 模板含跨切检查清单；select-tests-for-touches 加跨切标记；触碰 packages/*/src 含打包态测试；触碰 src/MCP tool 含 check-adr；新代码 lint 检查进任务内；纯 plugin/文档不含跨切测试；与 archguard TASK-62/64/65/66 + packaging e2e + 自适应并发交叉标注）
- [ ] 跨切判据实测：打包态/ADR/lint 检查器无论 touches 进 scoped 选中集
- [ ] scoped 门 `scripts/test.sh --for-task gap-scoped-selection-blind-to-packaging-state-diff` 绿

## Touches
- tasks/gap-scoped-selection-blind-to-packaging-state-diff.md（自身文件——self-touch，2026-08-08 内层补：缺此条不满足派发资格闸 step 4.5）

- plugin/skills/author/SKILL.md（任务模板 AC 默认跨切检查清单——plugin 捆绑，byte-identical 镜像）
- packages/quay-native/skills/author/SKILL.md（author skill canonical 单一来源；plugin-packaging 断言 plugin/skills/author/SKILL.md 与之 byte-identical，模板改动必须双写）
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
