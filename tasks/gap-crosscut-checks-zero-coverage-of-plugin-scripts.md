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

## Proposal

**`CROSSCUT_CHECKS` 注册表对 `plugin/scripts/` 这一整片零覆盖——四条触发器全部只认 `packages/*/src`（packaging-state/check-adr/quay-github-src 均 `^packages/[^/]+/src`，lint 是泛型 `.ts/.js/.mjs`）。而今晚 C 类「真由变更引入」的失败全部发生在 `plugin/scripts/`：改 suite-state-trigger.ts→打破 red-window-shared-gate.test.mjs；加 external-dogfooding-check.ts→打破 verify-delivery-surface.test.mjs 清单快照；改 known-load-sensitive 扫描器→打破 glob 覆盖面一致性。跨文件耦合正是 basename 配对天然选不出的形状（规则⑤ cross-cut marker 存在的意义），但注册表漏了机制层。**

### 实证（manager 2026-08-10 核实 + outer 复核）

- **人三问**：①失败是否都与变更有关？②任务是否测试不充分？③能否只跑变更相关测试？
- **Q3 先答：机制已存在，无需新建**——`scripts/test.sh --for-task <id>` + `select-tests-for-touches.ts`（26KB，6 条确定性规则：直接命中/basename 配对/镜像折叠/Test-Files 声明/cross-cut 标记/未解析必报）已是强制门，inner 每次 fan-in 前都跑。**真问题是：scoped 门每次都绿，为什么全量还是红。**
- **Q1 分类量化**（今晚红窗 ~19 条任务）：
  - **A 类·判定器/基础设施自身缺陷 ~8 条**：三次幻影红（`^✖`/`__PERFILE__`/tmux-leak-scan 正则未锚定误配自己通过的测试名）、failures=[] 空载荷、measure-trend 假阳性、动态 cap 读数错。
  - **B 类·负载/并发 flake ~7 条**：create-mcp solo+并发8+4-busy-loop 全绿、relation-sync solo 19/19 绿且 CPU 满载也绿、install 家族每轮红不同文件。
  - **C 类·真由变更引入仅 ~4 条**。
  - **A+B ≈ 79% 与被测变更无关**——scoped 门再完美也抓不到（A 类是判定器自己坏了，B 类按定义只在全量并发下才出现）。
- **Q2 只有 C 类是测试不充分，共性极具体**——C 类四条全是**跨文件耦合、basename 配对天然选不出**：改 suite-state-trigger.ts→打破 red-window-shared-gate.test.mjs；加 external-dogfooding-check.ts→打破 verify-delivery-surface.test.mjs 清单快照；改 known-load-sensitive 扫描器→打破 glob 覆盖面一致性。这正是规则⑤ cross-cut marker 要解决的。
- **真缺口（本任务）**：`CROSSCUT_CHECKS` 注册表现在 4 条——packaging-state（触发器 `^packages/[^/]+/src`）、check-adr（同上+`mcp*.ts`）、lint（空 tests）、quay-github-src（`^packages/quay-github/src`）。**四条触发器全部只认 packages/*/src，对 plugin/scripts（方法论机制层、今晚绝大多数改动所在地）零覆盖。**
- **推论（manager）**：79% 的红与变更无关 ⇒ 「红窗停派」的代价大部分时候是在为测试基础设施自己的缺陷买单。今晚已修掉一大批（三次幻影红锚定/failures 空载荷/measure-trend 假阳性/动态 cap）——**这些修复的真实价值比看起来大，它们直接减少未来红窗的分母**。

**为什么重要**：这是「scoped 门每次绿、全量却红」的结构性缺口——不是 scoped 机制不够好，是 cross-cut 注册表漏了机制层这一整片。补上后，改 plugin/scripts 的任务在 scoped 阶段就会选入对应跨切测试（red-window-shared-gate / verify-delivery-surface / known-load-sensitive 三类耦合），C 类失败从「全量才暴露」变「scoped 即暴露」。

### 选定机制方向（实现归内层，接法留执行时）

1. **加 plugin/scripts 触发器**：`CROSSCUT_CHECKS` 新增 `plugin-scripts` 条目——trigger `^plugin/scripts/`，tests 至少含三类耦合的跨切测试：red-window-shared-gate / verify-delivery-surface / known-load-sensitive 的对应测试文件。
2. **同族标注**：与 packaging-state / check-adr / quay-github-src 同机制（cross-cut marker，basename 配对选不出的跨文件耦合）。
3. **回归验证**：改 plugin/scripts/ 下任一文件 → scoped 选择包含跨切测试；未改 → 不误选（负控制）。

**验证锚**：修后 (a) 改 `plugin/scripts/suite-state-trigger.ts`（或任一 plugin/scripts 文件）→ `select-tests-for-touches` 选入 red-window-shared-gate 等跨切测试；(b) 未触 plugin/scripts → 不选（负控制）；(c) scoped 门绿。

## Acceptance Criteria

- [ ] AC1: **复现固化**——任务体记录 Q1/Q2/Q3 量化（A 类 ~8 + B 类 ~7 + C 类 ~4，79% 与变更无关；C 类全在 plugin/scripts 跨文件耦合）（本任务 Proposal 已含）
- [ ] AC2: **CROSSCUT_CHECKS 加 plugin/scripts 触发器**——新增 `plugin-scripts` 条目（trigger `^plugin/scripts/`，tests 含 red-window-shared-gate / verify-delivery-surface / known-load-sensitive 三类耦合测试）
- [ ] AC3: **scoped 选择生效**——改 plugin/scripts/ 文件 → 跨切测试进入 scoped 选择
- [ ] AC4: **负控制**——未触 plugin/scripts → 不误选
- [ ] AC5: **既有不回归**——`--for-task` scoped 门绿；既有 4 条 cross-cut 条目不受影响

## Definition of Done

- [ ] AC1–AC5 全部勾上
- [ ] 修后实跑：改 plugin/scripts 文件 → scoped 选入跨切测试（贴任务体）；负控制不误选
- [ ] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证

## Touches

- plugin/scripts/select-tests-for-touches.ts（CROSSCUT_CHECKS 加 plugin-scripts 条目 + trigger + tests）
- plugin/test/select-tests-for-touches.test.mjs（AC2-AC4 新增用例：plugin/scripts 触发选入 + 负控制）
- tasks/gap-scoped-selection-blind-to-packaging-state-diff.md（交叉标注——同族：cross-cut 注册表源）
- tasks/gap-github-client-iscompound-sabotaged-uncommitted.md（交叉标注——quay-github-src cross-cut 先例）
- tasks/gap-suite-state-trigger-crash-watchdog-breaks-running-transition-test.md（交叉标注——C 类 1：plugin/scripts 改→red-window-shared-gate 破）
- tasks/gap-loop-shipping-verify-delivery-surface-consumer-laid-ref.md（交叉标注——C 类 2：verify-delivery-surface 清单快照）
- tasks/gap-loop-shipping-threshold-scope-check-old-path-regression.md（交叉标注——C 类 3：known-load-sensitive 扫描器 glob）
- tasks/gap-crosscut-checks-zero-coverage-of-plugin-scripts.md（自身：勾 AC + 贴证据）

## Contract

measure   plugin_scripts_crosscut_selected = `node --no-warnings --experimental-strip-types plugin/scripts/select-tests-for-touches.ts --root <repo> --json` 输出里改 `plugin/scripts/foo.ts` 后 selected tests 是否含跨切测试
band      plugin_scripts_crosscut_selected = true（改 plugin/scripts → 跨切测试入选）
invariant plugin_scripts_not_touched_no_selection = 1（负控制：未触 plugin/scripts 不误选）
invariant existing_crosscut_entries_preserved = 1（既有 4 条不受影响）
invoke    `node --no-warnings --experimental-strip-types plugin/scripts/select-tests-for-touches.ts --root <repo> --json`（改 plugin/scripts 文件贴选择结果 + 负控制）
control   改 plugin/scripts → 跨切入选；未触不误选；既有不回归
resume    触发器 / 测试集 / 负控制分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager Q1/Q2/Q3 量化（79% 红与变更无关：A 判定器缺陷 8 + B 负载 flake 7 + C 真变更 4；C 类全在 plugin/scripts 跨文件耦合）+ 真缺口定位（CROSSCUT_CHECKS 4 条触发器全认 packages/*/src，plugin/scripts 零覆盖）⇒ 立案：加 plugin-scripts cross-cut 条目。实现归内层
