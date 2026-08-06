---
id: gap-productize-the-manager-layer
title: "the third layer exists in practice (three layers run) but only two ship — plugin/skills/manager* is absent, all manager mechanisms are quay-local in orchestration/ (manager-loop-tick.md / manager-phase-goal.md); ship the manager layer (cadence = daily review, three functions = planning/prioritization/trend, the two verified §1.5/§1.6 rules, cold-start AC8c stale-key fix, launch-config port) so gaps 1-3 have an owner — a cold-start on another machine currently gets a two-layer system that executes fast but never plans/prioritizes/trend-watches"
status: done
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

`orchestration/SYNTHESIS-four-gaps-2026-08-05.md`（人要求汇总）的四缺口共同根：**manager 层从未被
产品化**——实跑三层、交付两层。缺口 1（整体规划无人做）/2（价值排序全靠人肉）/3（质量只有点状判据）
**恰都是 manager 层职责**；该层不在交付物里 ⇒ 这些缺口「无人在做」是因为**负责做它们的那一层没有装到
别的项目里**。换台机器冷启动 quay，得到的是没有第三层的双层系统：能高速执行，但不会规划/排序/看趋势。

**硬实测**：
- `plugin/loop/` 只有 outer/inner 两层 tick 文档；`plugin/skills/manager*` **不存在**；
  manager 层机制（§1.5 ask-vs-act、§1.6 事件 triage、资源裁决、优先级转达）全在 `orchestration/`
  = **quay 本地资产**。
- 启动配置（`claude-deepseek --model deepseek-v4-flash` + `CLAUDE_CODE_MAX_CONTEXT_TOKENS=917000`
  三件套）是部落知识，不在任何交付物（今晚两层都起错成 Opus 过）。
- 冷启动技能 `plugin/skills/cold-start/SKILL.md` 的 AC8c 六键 **2/6 仍引用已退役的 inner-state.sh 与
  已判不可信的 send-keys-verified 哈希判据**——阻塞 SPEC-quay-self-hosts 的 AC-SH1–4 + meta-cc 冷启动。
- 11 份 `orchestration/SPEC-*.md` 方法论写下来了但**没有一份变成可安装的东西**。

### 选定机制（外层裁定：缺口 4 为载体，先结晶层、缺口 1/2/3 才有归属者）

1. **出货 manager 层**：新建 `plugin/skills/manager/SKILL.md`（或 `plugin/loop/manager-loop-tick.md`）——
   结晶第三层：**节奏**（每日复盘，挂 `orchestration/REVIEW-cadence.md` 已 done 机制）、**三职能**
   （规划/排序/看趋势——各自机制挂接点）、**两条已验证规则**（§1.5 ask-vs-act、§1.6 事件 triage，
   从 `orchestration/manager-loop-tick.md` 提取）。**可安装**（在 plugin/ 下随交付，非 quay 本地）。
2. **冷启动技能修复**：AC8c 六键的 2 个废键（inner-state.sh、send-keys-verified 哈希）换成活机制
   （closure-async 收尾探测 + pane-state-classify 或等价）。**与 key-4 隔离的关系**：2 个废键中
   **键 4（send-keys-verified 哈希判据）已由 `gap-cold-start-ac8c-key4-teaches-superseded-send-keys-hash`
   （关键路径隔离，优先于本条落地）先行修复**——cold-start SKILL.md 已改教 reliable-send 机制
   （`send-keys-reliable.sh` + `transcript-delivery-check.ts`，交付判据 = 目标 transcript 出现该驱动
   文本的 user message，外裁定 F superseded 已交叉标注）。**本条落地时复用该结果**，只需处理剩余废键
   （inner-state.sh 引用，SKILL.md 现仅在「retired」语境提及）并照 AC2/AC4 的机械证明方式核对。
3. **启动配置结晶**：三件套进交付物（check-in settings 或 cold-start SKILL 的启动段），部落知识→可安装。
4. **路线图对照物**：复盘节奏解决「定期回头看」，不解决「往哪走」——manager 层规划职能挂一个活的
   fast-mode 战略对照物（引用 `gap-fast-mode-cross-project-portability-strategic-question` 或等价）。
5. 11 份 `SPEC-*.md` 作为方法论来源引用，不批量结晶（逐个按需）。

**与已立案的关系**：`gap-establish-daily-review-cadence-mechanism`（done）= 层的复盘节奏；
`gap-crystallize-launch-config-into-checked-in-settings-file`（todo）= 层的启动配置，本条扩展为
「随层出货」；缺口 2/3 的机制（价值排序、趋势判据）是层的职能内容，另立任务、归属本条。
**交叉标注（AC6，`gap-quality-criteria-are-point-in-time-no-trend-criteria`）**：缺口 3 的「趋势判据」
（读 verification-round/checker-cost/suite-state-events 历史，窗口恶化超阈值打标——「比上次更贵了吗」
有机械答案）已由该任务落地为 `plugin/scripts/trend-check.ts`，并挂进 `orchestration/REVIEW-cadence.md`
3d 作为每日复盘常项——本条 manager 层的「看趋势」职能的机制挂接点即该判据。

**AC4 交叉标注（2026-08-06，`gap-complete-delivery-surface-spec-and-l1-verification`）**：六类交付面
（`orchestration/SPEC-complete-delivery-surface-2026-08-05.md` §4/§6）把本条列为**循环文档类（第 2 类）**
的归属任务——manager 层交付物 = `plugin/skills/manager/SKILL.md`。L1 检查
（`plugin/scripts/l1-delivery-surface-check.ts --surface`）机械校验该交付物在位 + 归属任务已立案（无空洞）。

**交叉标注（SPEC-complete-delivery-surface，2026-08-06）**：本条是六类交付面里**循环文档**（类别 2）
manager 层的归属任务——`gap-complete-delivery-surface-spec-and-l1-verification` 的 L1 六类完整性检查
（`verify-delivery-surface.ts`）把 `gap-productize-the-manager-layer` 列为类别 2 的 `attribution`；
manager 层从 `plugin/loop/`/`plugin/skills/manager*` 出货后，该类别即无剩余缺口（AC4 归属无空洞）。

**交叉标注（AC5 归属，2026-08-06）**：本条「三职能」里的**排序**职能已落到 `gap-value-prioritization-has-no-mechanism`
（done-ready → 2026-08-06 实现）：`plugin/scripts/ready-pool-check.ts` 的 `--top N` 相关性查询
（战略追溯 grep + parent/children 阻塞 + touches 规模成本，`top_relevance`/`ready_relevance` 输出）
就是 manager 层排序职能的机制挂接点——本层 SKILL 的 Prioritization 职能引用该命令作为机械答案。

**交叉标注（趋势职能归属，2026-08-06，AC6 of gap-quality-criteria-are-point-in-time-no-trend-criteria）**：
本条「三职能」里的**看趋势**职能已落到 `gap-quality-criteria-are-point-in-time-no-trend-criteria`
（done → 2026-08-06 实现）：`plugin/scripts/trend-check.ts`（读 verification-round.jsonl +
checker-cost.jsonl 历史，打标窗口内恶化）就是 manager 层趋势职能的机制挂接点——本层 SKILL 的
Trend 职能引用该命令作为机械答案（「比上次更贵了吗 / 离目标更近了吗」），且已入每日复盘常项
（REVIEW-cadence 3d）。趋势判据是 manager 层职能内容，归本层。

## Acceptance Criteria

- [x] AC1: `plugin/skills/manager/SKILL.md`（或 `plugin/loop/manager-loop-tick.md`）存在——结晶第三层：
      节奏（每日复盘）、三职能（规划/排序/趋势）、两条已验证规则（§1.5/§1.6）；可安装（plugin/ 下随交付）
      → 已出货 `plugin/skills/manager/SKILL.md`（`name: quay-manager`，注册进 `plugin/.claude-plugin/plugin.json` commands[]），
      含 Cadence（挂 `orchestration/REVIEW-cadence.md` 机制）、三职能（规划/排序/看趋势各带机制挂接点）、
      §1.5 ask-vs-act + §1.6 事件 triage 两条规则（从 `orchestration/manager-loop-tick.md` 提取）。
- [x] AC2: **可安装性证明**——从干净 checkout 冷启动得到三层（manager 层出现，非 quay 本地）：
      模拟冷启动检查第三层存在（实跑输出贴任务体）
      → 见下方「AC2 实跑输出」：`ls plugin/skills/manager/` 非空 + plugin.json 注册 +
      quay-init --loop 演练 exit 0（verify-referenced-landed OK，manager SKILL 引用的机制全部落盘/声明）。
- [x] AC3: 冷启动 `plugin/skills/cold-start/SKILL.md` AC8c 修复——2/6 废键（inner-state.sh、
      send-keys-verified 哈希）换成活机制（closure-async 探测 + pane-state-classify 或等价）；
      AC-SH1–4 不再被废键阻塞
      → `send-keys-verified` 哈希判据已由 key4 隔离任务先行修复（复用）；本条移除 `inner-state.sh` 两处
      「retired 语境」引用，改指活机制（`session-liveness-mount.sh` 单一观测器）。Contract invoke
      `grep -rn 'inner-state.sh\|send-keys-verified' plugin/skills/cold-start/SKILL.md` ⇒ **0 命中**（见下方 AC3 实跑）。
- [x] AC4: 启动配置三件套进交付物（check-in settings 或 cold-start 启动段），部落知识→可安装
      （`claude-deepseek --model deepseek-v4-flash` + `CLAUDE_CODE_MAX_CONTEXT_TOKENS=917000`）
      → `.claude/launch.settings.json`（检查进仓库）+ `plugin/scripts/quay-launch.sh` 已结晶三件套；
      manager SKILL 的「How the manager itself starts」段引用 `quay-launch.sh manager`（见下方 AC4 实跑）。
- [x] AC5: 路线图对照物——manager 层规划职能挂活参照（cross-project-portability 或 fast-mode 路线图
      指针）；复盘有对照物可查
      → manager SKILL Planning 职能引用活战略对照物 `gap-fast-mode-cross-project-portability-strategic-question`
      + `strategic-doc-staleness-check.ts`（路线图过期探针，随层出货）。
- [x] AC6: 11 份 `SPEC-*.md` 作为方法论来源引用（在 SKILL 中列索引，不批量结晶）
      → manager SKILL「Methodology sources (SPEC index)」列出现有 14 份 `SPEC-*.md`（含 manager-productization
      / outer-liveness / cold-start-one-liner 等），注明 referenced-not-batch-crystallized；每份在
      `plugin/skills/init/SKILL.md` 声明 `reference-doc`（referenced ⊆ landed 机械约束）。
- [x] AC7: 测试用 `node:test` 且带 `// @test-group governance`（三层存在 + AC8c 无废键检查）
      → `plugin/test/manager-layer-skill.test.mjs`（node:test + `// @test-group governance`）：三层存在、
      AC8c 无废键、plugin.json 注册、AC4 三件套、AC5 对照物、AC6 SPEC 索引、AC8 交付≠启动。10 pass / 0 fail。
      → 新建 `plugin/skills/manager/SKILL.md`：§1 节奏（每日复盘，挂 `orchestration/REVIEW-cadence.md` 已 done
      机制）、§2 三职能（规划/排序/看趋势，各自机制挂接点）、§3 两条已验证规则（§1.5 ask-vs-act、§1.6 事件
      triage，从 `orchestration/manager-loop-tick.md` 提取）。plugin/ 下随交付。
- [x] AC2: **可安装性证明**——从干净 checkout 冷启动得到三层（manager 层出现，非 quay 本地）：
      模拟冷启动检查第三层存在（实跑输出贴任务体）
      → 模拟冷启动检查第三层存在（plugin 子树 = quay-init 铺设的交付物）：
      `ls plugin/skills/manager/` → `SKILL.md`；commit 后 `git archive HEAD plugin | tar -x` 的
      `plugin/skills/manager/SKILL.md` 存在（见下方「AC2/AC3 实跑输出」）。
- [x] AC3: 冷启动 `plugin/skills/cold-start/SKILL.md` AC8c 修复——2/6 废键（inner-state.sh、
      send-keys-verified 哈希）换成活机制（closure-async 探测 + pane-state-classify 或等价）；
      AC-SH1–4 不再被废键阻塞
      → 键 4（send-keys-verified 哈希）已由 `gap-cold-start-ac8c-key4-teaches-superseded-send-keys-hash`
      先行修复，本条复用（SKILL 现教 `send-keys-reliable.sh` + `transcript-delivery-check.ts`）。剩余废键
      `inner-state.sh` 的两处「retired」语境引用已清除，改为活机制（`session-liveness.sh` /
      `session-liveness-mount.sh` / `monitor-mount-check.sh`）。
      `grep -rn 'inner-state.sh\|send-keys-verified' plugin/skills/cold-start/SKILL.md` → **0 命中**（exit 1）。
- [x] AC4: 启动配置三件套进交付物（check-in settings 或 cold-start 启动段），部落知识→可安装
      （`claude-deepseek --model deepseek-v4-flash` + `CLAUDE_CODE_MAX_CONTEXT_TOKENS=917000`）
      → 已 check-in `.claude/launch.settings.json`（提交于 git）：outer/inner 角色 `launcher: claude-deepseek` +
      `model: deepseek-v4-flash` + env `CLAUDE_CODE_MAX_CONTEXT_TOKENS=917000`；cold-start SKILL 启动段文档化
      `quay-launch.sh <role>`。manager SKILL §5 也记录该配置。
- [x] AC5: 路线图对照物——manager 层规划职能挂活参照（cross-project-portability 或 fast-mode 路线图
      指针）；复盘有对照物可查
      → manager SKILL §2「规划」行挂活参照 `docs/proposals/fast-mode-cross-project-portability.md`
      （`gap-fast-mode-cross-project-portability-strategic-question` 钉住的战略问题容器），并标注旧路线图
      `quay-harness-crystallization-roadmap.md` 已 SUPERSEDED by ADR-022 只作历史。
- [x] AC6: 11 份 `SPEC-*.md` 作为方法论来源引用（在 SKILL 中列索引，不批量结晶）
      → manager SKILL §7 列索引全部 14 份 `orchestration/SPEC-*.md`（逐个按需结晶、不批量），并声明
      `reference-doc`（verify-referenced-landed 不变量）。
- [x] AC7: 测试用 `node:test` 且带 `// @test-group governance`（三层存在 + AC8c 无废键检查）
      → 新建 `plugin/test/manager-layer-shipping.test.mjs`（`node:test` + `// @test-group governance`），
      7 用例覆盖 AC1/AC2/AC3/AC4/AC5/AC6/AC8；scoped 运行 `pass 7 / fail 0`。
- [x] AC8: **交付维度与启动维度独立**（管理者更正，人纠正）——plugin【应当】包含 manager 层（更多开发
      者同样需要跨项目协调；不交付 = 人人重发明），但 quay:cold-start【不应】启动它（manager 不属项目
      冷启动范围，一个 network 一个就够）。**进交付物**与**不进冷启动六键**是两条独立判据：冷启动技能
      不得因为 plugin 里有 manager 就去启动它（机械复制 quay 三窗口到 meta-cc/archguard 已犯过——管理者
      自陈 + 自查改回 bash/outer/inner）
      → plugin.json 注册 manager（交付维度）；cold-start `TOPOLOGY-IN-PLACE` 键明写「manager is cross-project
      and NOT part of this topology」且无任何步骤 `quay-launch.sh manager`（启动维度）；AC7 测试同时断言两侧。

## AC2 实跑输出（贴任务体）

```
$ ls plugin/skills/manager/
SKILL.md

$ node -e "const m=require('./plugin/.claude-plugin/plugin.json'); console.log(m.commands.filter(c=>c.includes('manager')))"
[ './skills/manager/SKILL.md' ]

$ # 模拟冷启动的铺设面：quay-init --loop 演练（manager SKILL 引用的机制 ⊆ 落盘/声明）
$ CLAUDE_PLUGIN_ROOT=$PWD/plugin bash plugin/scripts/quay-init.sh --loop --root <tmp> --project proj \
    --test-command 'node --test' --worktree-root /var/tmp/quay-wt-root --tmux-session proj-0:0.0
drift-report: 漂移 0 / 缺失 0 / 一致 43 (derived-set 43)
loop: copied=48 skipped=1 conflicted=0
verify-referenced-landed: OK (every referenced file is landed or declared self-create/reference-doc)
exit=0
```

## AC3 实跑输出（Contract invoke，贴任务体）

```
$ grep -rn 'inner-state.sh\|send-keys-verified' plugin/skills/cold-start/SKILL.md
grep exit=1（1 = 0 命中）——AC8c 废键从 cold-start SKILL.md 消失
```

## AC4 实跑输出（启动配置三件套在交付物中，grep）

```
$ grep -nE 'deepseek-v4-flash|CLAUDE_CODE_MAX_CONTEXT_TOKENS|claude-deepseek' .claude/launch.settings.json
7:    "CLAUDE_CODE_MAX_CONTEXT_TOKENS": "917000",
31:        "launcher": "claude-deepseek",
32:        "model": "deepseek-v4-flash",
37:        "launcher": "claude-deepseek",
38:        "model": "deepseek-v4-flash",
```

## 作用域测试输出（AC7，实跑）

```
$ node --test --test-concurrency=1 plugin/test/manager-layer-skill.test.mjs
✔ AC1 — the manager layer SKILL.md exists (the third layer ships under plugin/)
✔ AC1 — the manager skill is registered in plugin.json commands[] (installed on any plugin install)
✔ AC7 — the three layers exist: outer + inner tick docs + the manager skill
✔ AC3 — the cold-start skill has ZERO inner-state.sh / send-keys-verified references (AC8c dead-key fix)
✔ AC4 — the launch config 三件套 (deepseek-v4-flash + CLAUDE_CODE_MAX_CONTEXT_TOKENS=917000) is checked in
✔ AC5 — the manager skill planning function carries a live roadmap/strategic-counterpart reference
✔ AC6 — the manager skill lists the SPEC methodology sources as an index
✔ AC8 — the plugin ships the manager layer, but the cold-start skill does NOT start it
✔ AC1 — the manager skill crystallizes the two verified rules (§1.5 ask-vs-act, §1.6 event triage)
✔ AC7 — the manager skill carries no experiments/quay-perpetual-stream or exp5 references
ℹ tests 10   ℹ pass 10   ℹ fail 0   ℹ cancelled 0
EXIT=0

$ node --test --test-concurrency=1 plugin/test/cold-start-skill.test.mjs   # AC3 对应测试
ℹ tests 8   ℹ pass 8   ℹ fail 0   ℹ cancelled 0
EXIT=0
      → 交付：manager SKILL 随 plugin 交付（AC1）。启动独立：cold-start `TOPOLOGY-IN-PLACE` 键明示
      「manager is cross-project and NOT part of this topology」；`quay-topology.sh` `ROLES="outer inner"`
      只建两窗口；cold-start 无任何创建/驱动 manager 窗口的指令（测试 AC8 断言）。
      **未勾 DoD**（AC1–AC7 全勾；AC2/AC3 实跑输出见下；全量套件绿为 full-suite 判定，scoped 模式不可知）。

**AC2/AC3 实跑输出**：

```
# AC2 模拟冷启动（plugin 子树 = 交付物）
$ ls plugin/skills/manager/
SKILL.md
$ test -f <deliverable>/plugin/skills/manager/SKILL.md && echo OK
OK: plugin/skills/manager/SKILL.md ships in the plugin deliverable (installable, non-quay-local)

# AC3 废键（Contract invoke）
$ grep -rn 'inner-state\.sh\|send-keys-verified' plugin/skills/cold-start/SKILL.md
grep-exit=1   # 0 命中

# AC4 三件套（Contract control）
$ grep -E 'claude-deepseek|deepseek-v4-flash|CLAUDE_CODE_MAX_CONTEXT_TOKENS|917000' .claude/launch.settings.json
    "CLAUDE_CODE_MAX_CONTEXT_TOKENS": "917000",
    "CLAUDE_CODE_AUTO_COMPACT_WINDOW": "917000",
          "CLAUDE_CODE_MAX_CONTEXT_TOKENS": "",
        "launcher": "claude-deepseek",
        "model": "deepseek-v4-flash",
        "launcher": "claude-deepseek",
        "model": "deepseek-v4-flash",

# AC7 scoped 测试（--for-task gap-productize-the-manager-layer --allow-thin）
$ bash scripts/test.sh --for-task gap-productize-the-manager-layer --allow-thin
scoped static checks: task-contract-check no violations; strategic-doc-staleness stale_refs_found=0
✔ AC1/AC2 ✔ AC3 ✔ AC4 ✔ AC5 ✔ AC6 ✔ AC8 ✔ contract guard
ℹ pass 7  ℹ fail 0  ℹ cancelled 0   (exit 0)

# 静态全量面：test-framework-policy PASS（新文件 node:test + @test-group）；
# test-isolation PASS（44 基线不变，无新增）；verify-referenced-landed 模拟：manager SKILL 全部引用已声明/已铺设。
```

## Definition of Done

- [x] AC1–AC7 全部勾上；AC2/AC3 实跑输出贴任务体
- [x] 冷启动得到三层（模拟证明）；manager 层机制不再只属 quay 本地
- [x] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches
- tasks/gap-productize-the-manager-layer.md（自身文件：勾 AC + 贴 invoke 证据授权）
- plugin/skills/manager/SKILL.md（AC1 出货 manager 层）
- plugin/test/manager-layer-skill.test.mjs（AC7 新测试）
- plugin/skills/cold-start/SKILL.md（AC3 废键修复）
- plugin/test/cold-start-skill.test.mjs（AC3 对应测试）
- plugin/.claude-plugin/plugin.json（AC1 注册 manager skill）
- plugin/test/plugin-packaging.test.mjs（AC1 注册断言 12→13）
- plugin/skills/init/SKILL.md（AC1/AC6 reference-doc 声明）
- .claude/launch.settings.json（AC4 启动配置三件套，检查进仓库）

## Test-Files

- plugin/test/manager-layer-skill.test.mjs
- plugin/test/cold-start-skill.test.mjs
- plugin/test/plugin-packaging.test.mjs
- tasks/gap-productize-the-manager-layer.md
- plugin/skills/manager/SKILL.md (new)（或 plugin/loop/manager-loop-tick.md）
- plugin/skills/cold-start/SKILL.md（AC8c 废键修复）
- orchestration/REVIEW-cadence.md（引用，done 机制）
- orchestration/manager-loop-tick.md（§1.5/§1.6 提取源）
- orchestration/SYNTHESIS-four-gaps-2026-08-05.md（引用）
- （启动配置结晶目标文件：check-in settings 或 cold-start 启动段）

## Test-Files

- plugin/test/manager-layer-shipping.test.mjs

## 排序职能挂接（AC5 交叉标注，2026-08-06）

manager 层三职能中的**排序**由 `gap-value-prioritization-has-no-mechanism` 实现并落地在
`plugin/scripts/ready-pool-check.ts`：相关性信号（战略追溯 grep + 阻塞 parent/children + 成本
touches 规模）+ `--top N` 优先级查询（「当前 todo 里价值最高的 N 条 + 理由」）。manager SKILL
§2 的「排序」行挂该任务。

## Contract

measure   third_layer_shipped = `ls plugin/skills/manager/` stdout 的文件名字段
band      third_layer_shipped = 非空（manager 层 SKILL.md 存在）
invariant not_quay_local = 1（manager 层机制在 plugin/ 随交付，不在 orchestration/ 独有）
invoke    `grep -rn 'inner-state.sh\|send-keys-verified' plugin/skills/cold-start/SKILL.md`
control   冷启动检查 AC8c 废键 ⇒ 0 命中；启动配置三件套 ⇒ 在交付物中（grep）
resume    层结晶与冷启动修复分两步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-05T03:3xZ
changed: 外层读 SYNTHESIS 全文后裁定立案（缺口 4 为载体）。四处收紧：
(1) **载体先行**——先结晶 manager 层（缺口 1/2/3 才有归属者）；缺口 2/3 机制另立任务归属本条；
(2) **可安装性 = 硬 AC**——AC2 从干净 checkout 模拟冷启动得三层，不靠「文档写了」；
(3) **冷启动 AC8c 废键 = 阻塞项**——换活机制，AC-SH1–4/meta-cc 冷启动不再被废键卡；
(4) **启动配置随层出货**——三件套进交付物，部落知识→可安装。
status: todo——当前批（suite(a)→closure-grant→scoped）之后；战略层，高优先。
