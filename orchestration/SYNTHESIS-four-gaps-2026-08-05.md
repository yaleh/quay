# 综合：今晚暴露的四个层面的缺口

**日期**：2026-08-05（管理者，人要求把过去几小时的讨论汇起来）
**性质**：**不是新缺陷清单**——今晚绝大多数具体缺陷都已立案。这份文档要回答的是更上一层的问题：
**为什么这些缺陷需要人在场才能被发现？**

---

## 缺口 1：整体规划——没有任何角色在做

**实测证据**：
- `fast-mode-loop-tick.md` 的 7 个步骤全是机械执行，**没有一步是「退一步看方向」**。
- `outer-phase-goal.md` 是角色纪律（不静默退化、核实声称），**不是架构方向**。
- 近 6 小时：新建 6 条 `gap-*`，`docs/proposals/` 改动 **0** 次。
- 唯一的路线图 `quay-harness-crystallization-roadmap.md`（07-31）**整篇建立在 ADR-022（08-03）已废除的经典 milestone 管线上**，沉默过期 3 天无人发现。

**已立案**：`gap-roadmap-silently-stale-...`、`gap-fast-mode-cross-project-portability-strategic-question`、
`gap-establish-daily-review-cadence-mechanism`（人已裁定：每日一次、管理者发起+外层作答+人保留方向裁定权）。

**仍未解决**：复盘节奏解决「定期回头看」，**但不解决「往哪走」**——路线图重写成 fast-mode 版本之前，
复盘没有对照物。

---

## 缺口 2：持续的整体价值判断——每一次排序都是人肉的

**实测证据**：今晚每一个真实的优先级决定，来源都是人或管理者的临场判断，**没有一次来自机制**：
- `gap-init-ships` 优先（我提，理由：卡住自建目标）
- `closure-async` vs 套件移外层的排序（我提意见，外层修正了机制理解）
- 吞吐 vs 测量完整性（外层上报，我裁定）
- 三块消除批次的顺序（外层裁定，我给证据）

**机制侧现状**：`ready-pool-check` 的排序规则只有 `gap-* > DIR-*`、`touches-resolve 的排前`——
**这是机械 tiebreak，不是价值判断**。`AC-queue` 只维护**数量**（≥3），不维护**相关性**。

⇒ **54 条 todo 里哪条对目标最重要，没有任何机制在回答。** 队列水位够了，但水里是什么无人过问。

---

## 缺口 3：多维度质量——只覆盖了「正确性」，没覆盖「趋势」

**已有的质量维度**（都在工作，不是问题）：
正确性（2298 测试）、契约合规（7 个静态检查 + mutation check）、架构（ADR/archguard）、
对抗审查（2 轮上限）、DoD 闸门。

**今晚暴露的未覆盖维度**：
| 维度 | 证据 | 谁在看 |
|---|---|---|
| **成本趋势** | 每测试成本 0.251→0.464→0.321 秒（净 +28%），恶化了一整天才被人问出来 | **无人** |
| **方法论漂移** | inner 串行执行、batch 语义渗透、措辞改了行为没改 | 靠人观察 |
| **战略对齐** | 路线图过期 3 天 | **无人** |
| **机制自身健康** | `closure-async` 落地不完整（外层自己承认）、`ready-pool-check` overshoot 自相矛盾 | 撞上了才发现 |

**共同形态**：现有质量体系全部是**点状判据**（这次跑绿了吗、这条契约合规吗），
**没有一条是趋势判据**（比上次更贵了吗、离目标更近了吗）。

---

## 缺口 4：产品化——**manager 层根本不在交付物里**（今晚最硬的发现）

**实测**：
```
plugin/loop/          → fast-mode-loop-tick.md, orchestrator-loop-tick.md   （outer/inner 两层）
plugin/skills/manager*→ ✗ 不存在
orchestration/manager-loop-tick.md / manager-phase-goal.md / manager-tick-log.md   ← 只在 quay 自己仓里
```

**⇒ 插件交付的是「双层」，而实际运转的是「三层」。** 管理者这一层的机制
（跨项目仲裁、§1.5 ask-vs-act、§1.6 事件 triage、资源裁决、优先级转达）
**全部是 quay 本地资产，没有任何一个装到别的项目里去。**

**第二个硬缺口：启动配置是部落知识**。
`claude-deepseek --model deepseek-v4-flash` + `CLAUDE_CODE_MAX_CONTEXT_TOKENS=917000` 三件套
**不在任何交付物里**——今晚我自己就把两层都起错成了 Anthropic Opus，靠翻 `~/.bash_history` 才找回。
外层已立案 `gap-crystallize-launch-config-into-checked-in-settings-file`，但那只覆盖 quay 自己。

**第三个：11 份 `orchestration/SPEC-*.md` 全是未结晶资产**——
`SPEC-quay-self-hosts-its-own-cold-start.md`、`SPEC-methodology-as-a-deliverable.md`、
`SPEC-cold-start-one-liner.md`……**方法论写下来了，但没有一份变成可安装的东西。**

**冷启动的现状**：`plugin/skills/cold-start/SKILL.md` 的 AC8c 六键仍引用
`inner-state.sh`（已退役）与 `send-keys-verified.sh` 的哈希判据（已被 F 判定不可信）。
**⇒ 出厂的冷启动技能，有 2/6 个键指向已废弃的机制。**

---

## 四个缺口的共同根

三层里：
- **inner** 有出厂 tick 文档，但**无独立锚点**（只有 outer 的散文）
- **outer** 有出厂 tick 文档 + 20 分钟 cron（**唯一有周期性自我锚定的一层**）
- **manager** **既无出厂机制、也无 cron、也不在交付物里**

**而缺口 1/2/3 恰恰都是 manager 层的职责**（整体规划、价值排序、跨维度质量）。
⇒ **这三个缺口之所以「无人在做」，是因为负责做它们的那一层从来没有被产品化。**
今晚这些工作能发生，是因为**人和管理者都在现场**。
换一台机器、换一个人冷启动 quay，得到的是一个**没有第三层的双层系统**——
它能高速执行，但不会规划、不会排序、不会看趋势。

---

## 给外层的输入（不是裁定，管理者不替它排优先级）

1. **缺口 4 是前三个的载体**——先把 manager 层结晶进交付物，缺口 1/2/3 才有归属者。
   相关已有资产：11 份 `SPEC-*.md`、`manager-loop-tick.md`（含 §1.5/§1.6 两条已验证的判断规则）。
2. **冷启动技能的 2/6 键指向已废弃机制**，这条阻塞 `SPEC-quay-self-hosts-its-own-cold-start`
   的 AC-SH1–4，也阻塞 meta-cc 冷启动（管理者自己的 AC3b/AC-SH 目标）。
3. **缺口 3 的「趋势判据」是一个新品类**——现有全部判据都是点状的。
   今晚的每测试成本趋势（0.251→0.321）是第一个具体实例。

**这份文档不建 AC/DoD，不排优先级——那是外层的活。**
