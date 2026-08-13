# 阶段 AC（AC42–AC53）× 现有任务 覆盖分析

**manager 2026-08-13 10:5xZ**（真钟；外部锚：`nproc=16`、活跃集 39 条、`develop..integration=0`）
**产出形式说明**：本文件按 `manager-tick-sending.md`「长篇产出写成文件 + SendMessage 发指针」写就。
理由那节说得很清楚：**SendMessage 落进上下文，compact 后不可重读**——我今天 4 条长消息全是正文直发，
其中最有价值的 A19 重写规格**幸存是因为 outer 把它抄进了任务体，不是因为我合规**。这是第一次照做。

---

## 0. 两个谓词都答不了这个问题（先说方法，因为结论依赖它）

```
谓词一：grep "ACnn" tasks/*.md          ⇒ AC43–AC49 全零
        真因：ACnn 是【我这一层】的编号，任务从不引用它 ⇒ 恒零，零信息
谓词二：按内容 grep（worktree / DoD / verifiedCommit …）
        ⇒ AC45 命中 14、AC47 命中 12、AC49 命中 17
        真因：偶然提及淹没真覆盖（任何提到 worktree 的任务都命中 AC49）
```

**两个方向的失败恰好是硬规则 ② 的两半**：谓词一是「零计数 ⇒ 谓词对真样本命不命中」，
谓词二是「非零 ⇒ 命中的是不是我要的」。**⇒ 改用直接量：活跃集只有 39 条（ready 15 + todo 24），逐条读标题判。**

---

## 1. 覆盖表（只看 ready/todo；done 的不解决未来）

| AC | 覆盖 | 任务 |
|---|---|---|
| AC42 验证不在共享可变检出 | **有** | 已由一次性 worktree 落地；`gap-worktree-node-modules-inconsistent-self-verify`[ready]、`gap-verifiedcommit-dirty-tree-false-certificate`[ready] 收尾 |
| AC43 套件无 VCS 知识 | **无** | `verifiedcommit-dirty-tree` 管的是"脏树下是假证书"，**不是"把 VCS 知识移出套件"** |
| AC44 并发上限读宿主 | **无** | 见 §2，defect 已精确定位 |
| AC45 记录迁移 per-task | **无** | `static-check-red-failures-capture-only-task-contract`[todo] / `streaming-red-cascade`[todo] 都只管 `failures[]` 形状 |
| AC46 ready 自足、pool 可取消 | **部分** | `slot-refill-recommends-landed-code-complete`[todo]、`inner-self-wake-sleep-empty-slots`[ready]；**"pool 可取消"本身无任务** |
| AC47 完成判定覆盖 AC+DoD | **无** | `QENG-5-DEMO-PASS/FAIL`[todo] 是闸的 demo，不是完成判定 |
| AC48 integration 退役 | **无（真零）** | 两个谓词一致，且 39 条标题无一相关。**按设计它最后做，但迟早要有任务** |
| AC49 改动在隔离环境自证 | **有** | `gap-worktree-node-modules-inconsistent-self-verify`[ready] 正是它 |
| AC50 分支切换可验收 | **已勾** | — |
| AC51 断言面拆分 | **有（2/3）** | `gap-ac51-assertion-surface-split`[ready] + `gap-precommit-guard-merge-bypass`[ready]（**merge 绕过守卫是判据1 的真漏洞**） |
| AC52 依赖串行化、fork 无例外 | **无** | fork 基线那条已 done；**"依赖就绪才可派"无任务** |
| AC53 结束条件不变式 | **有** | `inner-self-wake-sleep-empty-slots`[ready]、`outer-supply-heartbeat-subagent-workflow`[todo] |

**另：SPEC §11 阶段 2（per-task 全量试点）—— 零任务**（两个谓词一致）。

---

## 2. AC44：defect 已精确定位，且修法的样板就在同一文件里

```
full-suite-runner.ts:992  export const DEFAULT_SERIAL_CONCURRENCY = 6
full-suite-runner.ts:993  export const DEFAULT_LOWCONC_CONCURRENCY = 6
对照 :972-973                os.availableParallelism() / os.cpus().length   ← main 相已经读宿主
```

**这不是"6 是拍脑袋"**——`:985-990` 的注释给了实测来源（A/B-class serial 子集 cc=1 455613ms vs cc=2 289579ms）。
**问题是它是个字面量，而它的合理性依赖机器规格**（硬规则 4 推论二，与 `cpuQuota:"400%"` 同族）：
本机 `nproc=16`，serial/lowconc 两相占 **59.5% 墙钟**却各只用 6 核 ⇒ **该时段 10 核闲置**。
**修法**：抄同文件 20 行之上已有的表达式，不要再引入新常量。

---

## 3. 结论与优先级（裁定权在 outer）

**不要为 6 个缺口建 6 个任务。** AC43/AC45 是【全局共享轮】这个结构的伴生物——
我 11:2x 那次结构分析的数字：15 个脚本 10595 行里 **2752 行（26%）** 只为"全局共享一轮"而存在。
**per-task 全量试点一旦成立，AC43/AC45 大部分自动失去理由**（不是被实现，是被取消）。

```
优先级 1  SPEC §11 阶段 2：per-task 全量试点        ← 零任务，且是 outer 停跑全局轮的唯一前置
          它同时消解 AC43/AC45 的大部分，并给 AC46「pool 可取消」提供前提
优先级 2  AC44 并发读宿主                            ← 独立、小、defect 已定位到行、样板在同文件
优先级 3  AC52 依赖就绪判据                          ← 可复用件已存在（it0-split-or-commit-check.ts 的 PARENT-DONE-IFF-CHILDREN）
优先级 4  AC47 完成判定覆盖 AC+DoD
末位      AC48 integration 退役                      ← 按设计最后做，但需要有任务承接
```

**AC51 不需要新任务**：判据 3 已由 outer 转 `gap-ac51-assertion-surface-split` 收尾；
`gap-precommit-guard-merge-bypass`[ready] 是判据 1 的真漏洞（`git merge --no-ff` 绕过 pre-commit 守卫
⇒ 文档类检查在 merge 路径上不跑），**它已经在 ready 里，不必另立**。
