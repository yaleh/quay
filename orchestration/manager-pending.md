# 管理者待办：条件触发项（短期，触发即消费）

> **本文件由主循环在每轮 tick 读取**（workflow `.js` 脚本层零 I/O，读不了文件，
> 所以它只负责"叫你读这里"，内容在这里维护）。
> **触发并发出后，把该条从本文件删除**——它不是历史记录，是待办队列。
> 历史留在 `manager-tick-log.md` 的熔态列里。
> 持久判准（①-⑦、§0 停点、发送纪律）仍在 `.claude/workflows/manager-tick-readings.js`，不要搬来这里。

---

## ⑧ inner 与 outer 都停 → 同步系统时间（人 2026-08-07 23:4x）

**触发**：`tmux capture-pane` 判定两者**同时**空闲（无 `esc to interrupt`）。
**先查再动**：`timedatectl`——若 `System clock synchronized: yes` 且 `NTP service: active`，
**没有可同步的东西，据实报告，不做空操作、不假装做了**。
**首次检查结果（2026-08-07 23:47）**：local=UTC=RTC=23:47:14，NTP 活跃，**无偏移**。
**勿混淆**：outer 的 **tick-log 标签**曾比真实 UTC 快约 42 分钟（17:43 标 `18:25Z`；另有 `23:29ZZ` 双 Z 笔误）
——那是**标签生成**，不是机器时钟；要修是改 outer，不是动系统时间。

## ⑨ 耗时分解任务 → 等两条件都成立再发（人 2026-08-08 01:0x）

**条件（两个都要，逐条机械判定）**
- (a) 本轮全量套件 **green** + 三趟 selected 齐全（product,engine / serial / lowconc）+ fail 0 + cancelled 0 + 日志证据完整
- (b) `git rev-parse develop` == `git rev-parse integration`，且该轮测的就是这个点；跑完后无新分歧引入冲突面
  - **注**：条件 (b) 有两种解读，已提请人裁，未回复前按"测的那个点没引入冲突"执行

**待发内容**
理论墙钟下界 **551.0s** = main 195.4（165 文件 1563.0s @cc8）+ serial 161.7（cc1 求和）+ lowconc 193.9（20 文件 581.7s @cc3）；
实测 703s ⇒ **固定开销+并行损失 152.0s（22%）**。**500s 靠调参达不到——下界已 551s，必须动结构。**
- 杠杆① **lowconc cc3→cc5 ≈ -78s**（下界 193.9→116.3）——**拆分后才可行**，此前尾部 211.4s 封顶
- 杠杆② serial 161.7s 最多 -78s，但 cc1 是它的定义；那 3 个文件正是嵌套 runner（21/18/23），移出即毁掉刚修好的隔离，**代价最高**
- 杠杆③ **固定开销 152s 未拆解**——今晚八项优化没有一项碰过它，全在优化"测试跑多久"，没人量过"跑测试之前花了多久"。**下一个该量的**

## ⑩ FF 假设四处矛盾 → 等 outer 处理完当前问题（人 2026-08-08 02:0x）

**触发**：`tasks/gap-merge-introduced-referenced-not-landed-manager-tick-log.md` 的 `status: done`。
**背景**：人已裁定**放下**「develop 在批量合前不变」这一假设。实测反驳——今天 develop 105 条直提中
①纯任务文本 31 / ②任务文本+编排记账 39 / **③含代码 35（33%）**；含代码的不止管理者
（`3e849401 fix: declare manager-tick-log.md as reference-doc`、`79ee8293 inner: batch-merge shared-file glob`
都是 outer/inner 直提 develop 的代码）。今晚那次 red 即该假设不成立的实证代价。

**四处矛盾**
1. `plugin/loop/orchestrator-loop-tick.md:755`「永远是 develop 后代 ⇒ fast-forward 无冲突」（出厂模板）
2. `orchestration/orchestrator-loop-tick.md:640` 同上；括号里「develop 只被外层批量合推进」即被放下的那个假设
3. `plugin/scripts/capability-catalog.sh:129` 只描述 FF 路径，`--merge` 真合模式不在描述里
4. `plugin/test/branch-model.test.mjs` AC3 三条：FF-when-descendant / **TRUE divergence FAILS closed** / --dry-run

**要点不是"这些检查错了"，是【默认值反了】**：`integration-batch-merge.sh` 的 `--merge` 真合模式
（共享文件自动解 + 真代码冲突 fail-closed）机制已全，但**默认路径是 FF-only**；
人裁定后 NOT-FF 从**例外**变**常态** ⇒ 默认每次 fail-closed，第 4 条那个负控制会拦住每一次正常批量合。

**SPEC 自己已预告此缺口**（`SPEC-branching-model-integration-branch-2026-08-05.md:138-139`）：
> develop 每分钟都可能被内层/外层/管理者直提。后续若要把 `--merge` 变成外层默认，需一并更新
> `orchestrator-loop-tick.md` 的批量合步骤（本任务 Touches 不含 loop 文档，未改）。

⇒ 当时是待办，人今日裁定后变成必须。**改法（哪几行、`--merge` 是否成默认、第 4 条断言怎么调）是 outer/inner 的活，不代写。**
