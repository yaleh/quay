---
id: gap-md-deletion-token-evaporation-check
title: md 删除 164 行时三种机件名全蒸发无人拦——抽样当全集的判据形态错(今晚第 5 次同族, 来源完备性硬规则⑤无产物);处方=「提交净删
  *.md ≥50 行 ⇒ 算被删内容独有词条集, 零出现即失败+打清单」的静态检查(全集不抽样/零出现才算无家/失败给清单不给布尔, 判准③枚举不布尔)
status: done
labels:
  - gap
  - mechanism
parent: "null"
children: []
extra: {}
---
**type:** execution

## Proposal

**manager（2026-08-10）自曝：把 CLAUDE.md 从 292 行删到 165 行时，抽查 7 个关键词确认 test.sh/ci.yml 有正本，就把 164 行整体删了；逐项复核发现三条 `ToolSearch`（延迟 MCP 工具必须先取 schema）、`makeWorkspace()`（测试需真 .quay/config.yml）、`gate-gameability`（覆盖率不是目标）在 CLAUDE.md/test.sh/ci.yml/任务体**全为 0**——已恢复。这是判据形态错不是判断失误：验证的是「这些内容**有**正本」，该验证的是「**所有**内容都有正本」——抽样当全集，今晚第 5 次同族。**

### 实证（manager 2026-08-10 + C17 对照）

- **C17 对照铁证**：今晚无产物的纪律被违反 5 次（抽样当全集、关键词法 3 次假阳性、来源完备性），有产物的（投递工具名进记录 / A16 按位置计数 / 收尾先清扫后写日志）违反 0 次。**标注是准确的——该造产物，不是把规则写得更醒目。**
- **具体事故**：`ToolSearch`、`makeWorkspace()`、`gate-gameability` 三个词条在删除后仓库里零出现，机械上可被「被删内容独有词条集」检查拦下——非空即失败+打清单。
- **判据形态（manager 三要点）**：①**全集不抽样**——逐词条验证，不是抽查；②**零出现才算无家**——词条在别处仍出现即视为有正本，不追究语义等价，先要能拦住整段蒸发；③**失败信息给词条清单本身**，不是布尔（判准③「枚举不布尔」）。

**为什么重要**：来源完备性硬规则（CLAUDE.md 认识论硬规则第 5 条）今晚无产物被违反 5 次——这条机械检查就是它的第一个产物化。

### 选定机制方向（实现归 inner，判定归 outer）

1. **静态检查（@static-tier always，跑进 run_static_checks）**——非 pre-commit：仓库无 pre-commit 基建，loop 在 worktree 里 `git commit`，本地 hook 可绕过且 CI 不强制；`run_static_checks` 是唯一每轮必跑的执行面（对照 capability-catalog --superseded-check 同款）。
2. **触发**：一个提交从 `*.md` 净删 ≥50 行。
3. **判定**：算被删内容的**独有词条集**——在删除后仓库里零出现的标识符/路径/专名；非空即失败，打清单。

**验证锚**：修后 (a) 对 manager 的真实删除（CLAUDE.md 292→165 临时态）跑一遍能拦下 ToolSearch/makeWorkspace/gate-gameability；(b) 正常 doc 编辑不误报；(c) 失败输出是词条清单不是布尔。

## Acceptance Criteria

- [x] AC1: **复现固化**——任务体记录 manager 事故（164 行删除 + 3 词条零出现）+ 判据形态错（抽样当全集,今晚第 5 次同族）+ C17 对照（无产物 5 违/有产物 0 违）（本任务 Proposal 已含）
- [x] AC2: **静态检查实现**——`@static-tier always` 跑进 run_static_checks；触发=提交净删 `*.md` ≥50 行；判定=被删内容独有词条集（删除后仓库零出现的标识符/路径/专名），非空即失败
- [x] AC3: **全集不抽样**——逐词条验证，不是抽查
- [x] AC4: **零出现才算无家**——词条在别处仍出现即视为有正本（不追究语义等价）
- [x] AC5: **失败给清单**——失败信息输出词条清单本身，不是布尔（判准③枚举不布尔）
- [x] AC6: **负控制**——正常 doc 编辑（词条在别处仍在）不误报
- [x] AC7: **既有不回归**——`--for-task` scoped 门绿

## Definition of Done

- [x] AC1–AC7 全部勾上
- [x] 修后实跑：对 manager 事故的复现 fixture 跑通（拦下 3 词条）+ 正常编辑不误报（贴输出）
- [x] 既有测试 + 新增测试全绿（`--for-task` scoped）
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）——外层 verification-round 验证（round-227 green，2026-08-10，e5a15273 在 verified commit 018d5868）

## Touches

- plugin/scripts/<新检查器>.ts（独有词条集判定：被删内容 tokenize → 删除后 repo grep 零出现）
- scripts/test.sh（`@static-tier always` 接线进 run_static_checks）
- plugin/test/<新检查器>.test.mjs（AC3-AC6 测试：全集不抽样/零出现/清单输出/负控制）
- tasks/gap-md-deletion-token-evaporation-check.md（自身：勾 AC + 贴输出）

## Contract

measure   evaporation_check_wired = `grep -c "md-deletion-token-evaporation\|evaporation-check\|@static-tier always.*md" scripts/test.sh` 的 stdout 数字
band      evaporation_check_wired >= 1（接线进 run_static_checks）
invariant whole_set_not_sampled = 1（全集不抽样——逐词条验证）
invariant zero_occurrence_is_homeless = 1（零出现才算无家,别处仍在=有正本）
invariant failure_lists_tokens = 1（失败输出词条清单,非布尔）
invoke    `bash plugin/scripts/md-deletion-token-evaporation-check.sh --root <复现fixture目录>`（贴输出：3 词条被拦——AC5 实测拦下 ToolSearch/makeWorkspace/gate-gameability 见 Evidence）
control   触发=净删 ≥50 行；全集不抽样；零出现判定；清单输出；负控制不误报
resume    检查器 / 接线 / 测试分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-10
changed: manager 请求（判据已实证,实现归 inner）——来源完备性硬规则第一个产物化;裁定:静态检查(非 pre-commit,仓库无 hook 基建),阈值 50 行;触发用机械量,判定用词条集算术;实现归 inner

## Evidence（内层实现 2026-08-10）

**AC2 静态检查实现**：新 `plugin/scripts/md-deletion-token-evaporation-check.sh`——触发=提交净删 `*.md` ≥阈值（默认 50，`--threshold` 可调）；判定=被删内容词条化后逐词条 grep 当前工作树（排除 .git/node_modules/检查器自身），零出现即无家；非空即 FAIL + 打清单。`@static-tier always` 接线进 scripts/test.sh run_static_checks（`run_checker "md-deletion-token-evaporation-check"`）。支持 `--diff <a> <b>`（指定范围）与 `--root <dir>`（测试/复现指向临时仓库）。

**AC3 全集不抽样**：逐词条验证（sort -u 后 for 循环逐个 grep），不是抽查。

**AC4 零出现才算无家**：词条在别处仍出现（grep -rIl 命中任一文件）即视为有正本，不追究语义等价。

**AC5 失败给清单**：FAIL 输出词条清单本身（非布尔）——实测拦下 3 个独有词条并逐一列出。

**AC6 负控制**：词条在别处仍在（keeper 文件）→ PASS；纯小删（<阈值）不触发——测试固定。

**AC7 scoped 门绿**：`bash scripts/test.sh --for-task gap-md-deletion-token-evaporation-check --allow-thin` → exit 0。测试 `plugin/test/md-deletion-token-evaporation-check.test.mjs` 3/3 绿（真实删除被拦+清单 / 负控制不误报 / 阈值不触发）。

**复现（AC1，manager 场景）**：临时仓库建含 3 独有词条的 doc → 整删 → 检查器 FAIL 列出 3 词条（来源完备性硬规则产物化生效）。
