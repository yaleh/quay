---
id: gap-productize-the-manager-layer
title: "the third layer exists in practice (three layers run) but only two ship — plugin/skills/manager* is absent, all manager mechanisms are quay-local in orchestration/ (manager-loop-tick.md / manager-phase-goal.md); ship the manager layer (cadence = daily review, three functions = planning/prioritization/trend, the two verified §1.5/§1.6 rules, cold-start AC8c stale-key fix, launch-config port) so gaps 1-3 have an owner — a cold-start on another machine currently gets a two-layer system that executes fast but never plans/prioritizes/trend-watches"
status: todo
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

## Acceptance Criteria

- [ ] AC1: `plugin/skills/manager/SKILL.md`（或 `plugin/loop/manager-loop-tick.md`）存在——结晶第三层：
      节奏（每日复盘）、三职能（规划/排序/趋势）、两条已验证规则（§1.5/§1.6）；可安装（plugin/ 下随交付）
- [ ] AC2: **可安装性证明**——从干净 checkout 冷启动得到三层（manager 层出现，非 quay 本地）：
      模拟冷启动检查第三层存在（实跑输出贴任务体）
- [ ] AC3: 冷启动 `plugin/skills/cold-start/SKILL.md` AC8c 修复——2/6 废键（inner-state.sh、
      send-keys-verified 哈希）换成活机制（closure-async 探测 + pane-state-classify 或等价）；
      AC-SH1–4 不再被废键阻塞
- [ ] AC4: 启动配置三件套进交付物（check-in settings 或 cold-start 启动段），部落知识→可安装
      （`claude-deepseek --model deepseek-v4-flash` + `CLAUDE_CODE_MAX_CONTEXT_TOKENS=917000`）
- [ ] AC5: 路线图对照物——manager 层规划职能挂活参照（cross-project-portability 或 fast-mode 路线图
      指针）；复盘有对照物可查
- [ ] AC6: 11 份 `SPEC-*.md` 作为方法论来源引用（在 SKILL 中列索引，不批量结晶）
- [ ] AC7: 测试用 `node:test` 且带 `// @test-group governance`（三层存在 + AC8c 无废键检查）
- [ ] AC8: **交付维度与启动维度独立**（管理者更正，人纠正）——plugin【应当】包含 manager 层（更多开发
      者同样需要跨项目协调；不交付 = 人人重发明），但 quay:cold-start【不应】启动它（manager 不属项目
      冷启动范围，一个 network 一个就够）。**进交付物**与**不进冷启动六键**是两条独立判据：冷启动技能
      不得因为 plugin 里有 manager 就去启动它（机械复制 quay 三窗口到 meta-cc/archguard 已犯过——管理者
      自陈 + 自查改回 bash/outer/inner）

## Definition of Done

- [ ] AC1–AC7 全部勾上；AC2/AC3 实跑输出贴任务体
- [ ] 冷启动得到三层（模拟证明）；manager 层机制不再只属 quay 本地
- [ ] 全量套件绿（`fail 0` 且 `cancelled 0` 且 `FULL-SUITE-EXIT=0`）

## Touches

- plugin/skills/manager/SKILL.md (new)（或 plugin/loop/manager-loop-tick.md）
- plugin/skills/cold-start/SKILL.md（AC8c 废键修复）
- orchestration/REVIEW-cadence.md（引用，done 机制）
- orchestration/manager-loop-tick.md（§1.5/§1.6 提取源）
- orchestration/SYNTHESIS-four-gaps-2026-08-05.md（引用）
- （启动配置结晶目标文件：check-in settings 或 cold-start 启动段）

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
