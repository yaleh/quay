---
id: gap-manager-tick-log-check-mutation-case
title: manager-tick-log-check.sh 无 mutation case ⇒ P4 谱系归入
  suspicious（与坏守卫不可区分）；两个注入方向（陈旧/缩水）都要补且必须被自动 manifest 执行
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

`plugin/scripts/manager-tick-log-check.sh` 在 P4 守卫谱系里是一个**已声明**守卫：`capability-catalog.sh` 的 `GUARD_OBJECT` 块逐字声明 `manager-tick-log-check.sh → file:orchestration/manager-tick-log.md`（对象 `present: true`），且在 `orchestration/orchestrator-loop-tick.md:660` 被真实调用（`bash plugin/scripts/manager-tick-log-check.sh --json`，每轮）。但：

- 在 `guard-lineage-check.ts` 的判定窗口（2026-09-04..09-20）内它**从未变红**（`fired` = 空集）；
- 且**没有 mutation case**——`isMutationVerified()`（`guard-lineage-check.ts:227`）的实现就是"`plugin/scripts/checker-mutation-cases/<stem>.sh` 是否存在"，该文件不存在。

现场实跑（立案时 `node --experimental-strip-types plugin/scripts/guard-lineage-check.ts --json`）逐字：

```
fired 0
preventive 6   (checker-mechanical-spine-check.ts / checker-mutation-check.sh / instrument-decay-check.ts /
                outer-tick-log-check.sh / release-master-advance-needs-check.ts ×2)
suspicious 1
    manager-tick-log-check.sh | never-fired and not mutation-verified — indistinguishable from a broken guard (P4 定义)
```

**姊妹对照（唯一差别就是那个 case 文件）**：`outer-tick-log-check.sh` 同样从未变红，但它**有** case（`plugin/scripts/checker-mutation-cases/outer-tick-log-check.sh`，逐字含 "INJECT 1 … MUST go RED / RESTORE … GREEN again" 的注入→恢复契约）⇒ 归 `preventive`。⇒ `manager-tick-log-check.sh` 目前与"坏守卫"**不可区分**。

该守卫**自带可用的测试接缝**（脚本头 :35-42 逐字声明）：`--log <path>`（指向临时 fixture）、`--stale-hours <n>`（缩小以做负控制）、`--baseline <path>`（指向临时基线以做缩水棘轮负控制）。⇒ 两个方向都能变异注入：①**陈旧分支**（`--stale-hours 1` 或构造旧 mtime 的 fixture log）；②**缩水棘轮**（写一个高 `--baseline` + 一个小 log）。两条都要覆盖，因为它们是该守卫的两条独立判据（只覆盖一条 = 另一条仍是"从未被证明能红"）。

**判定**：这是**预防性守卫缺口**（不是"检测器报错了"）。修法就是把该守卫的变异验证补上，使其从 `suspicious` 移到 `preventive`。⛔ **不得**靠改 `guard-lineage-check.ts` 的判定（放宽 suspicious 阈值、或把"未验证"也算 preventive）来消掉这条——那正是 P4 反向判据（AC4）禁止的方向。

**登记面的一个真实约束**：`checker-mutation-check.sh` 的 manifest 是**从不手写**的（其头注释逐字："THE MANIFEST IS NEVER HAND-WRITTEN … parsed out of scripts/test.sh's run_static_checks / run_doc_checks functions, runner-static-gate.ts's run_operational_checks, and the CI workflows"），当前 82 个 checker 的 `uncovered` 为空——即 `manager-tick-log-check.sh` **根本不在 manifest 里**（它由 orchestration 文档每轮调用，不被这些面解析）。⇒ 只放一个 case 文件在 `checker-mutation-cases/` 下**不会被任何东西执行**（那是 hard rule 4 推论三的"回声"形态）。因此本任务的完成面包含"让它进 manifest 并被执行"。⛔ 同时：注册面**必须用临时 fixture log/baseline 调用它**——该守卫在 `LINES > BASELINE` 时会**写** `<LOG>.baseline` sidecar，不得让一个静态门在跑检查时写仓内文件。

<!-- dedup-ref -->
相关联但不同机制：[[gap-archguard-p4-guard-lineage-declaration-and-registry]]（已 done）落地的是**谱系检测器 + 声明块**，其 AC4 反向判据恰好**故意**拿本守卫当"未验证"的负样本（当时是特性、不是待修缺陷，它证明判别力真实存在）；[[gap-manager-tick-log-check-row-criterion-and-shrink-ratchet]]（已 done）修的是**判据本身**（行格式识别 + 缩水棘轮），与本条要补的"变异验证"是两件事。

## AC

- [ ] AC1（复现固化）：贴出立案读数逐字（`fired 0 / preventive 6 / suspicious 1`，含 `manager-tick-log-check.sh` 的 reason 行），以及 `ls plugin/scripts/checker-mutation-cases/ | grep -c manager-tick` = 0 与 `ls plugin/scripts/checker-mutation-cases/outer-tick-log-check.sh`（存在）的对照输出。
- [ ] AC2（case 存在、含两向注入、且**可执行**）：新增 `plugin/scripts/checker-mutation-cases/manager-tick-log-check.sh`，`bash` 直跑 exit 0，输出含"注入被逮住 + 恢复后转绿"两类断言，且覆盖**两个方向各至少一条**：①陈旧分支（`--stale-hours 1` 或旧 mtime fixture）②缩水棘轮（高 `--baseline` + 小 log）。按 `checker-mutation-cases/` 既有契约实现（参照 `outer-tick-log-check.sh`：未逮住 ⇒ exit 1；恢复后仍红 ⇒ exit 4）。贴出完整运行输出。
- [ ] AC3（不是回声·case 必须被仓内机制实际执行）：`bash plugin/scripts/checker-mutation-check.sh --list --json` 的 `checkers[]` 里出现 `{"name":"manager-tick-log-check", "covered": true}`（即它已进入由 test.sh / runner-static-gate.ts / CI **解析**出的 manifest，⛔ 不是手工在名单里加一行），且 `bash plugin/scripts/checker-mutation-check.sh --check --only manager-tick-log-check` exit 0。贴出两条命令的真实输出。
- [ ] AC4（不误伤主线·含写副作用约束）：①注册面/检查器在**新鲜检出、无 tick log** 的场景下不得把套件判红——守卫本体在 log 缺失时是 `{"ok":false,"reason":"no-log"}` + exit 1，注册面必须为它提供 fixture 或走显式 `NOT-EVALUATED` 路径（硬规则 3b：**未评估 ≠ 红 ≠ 绿**，三者取值必须可区分）；②注册面跑检查时**不得写仓内 `.baseline` sidecar**（贴出该路径的 `--log`/`--baseline` 指向临时目录的证据，以及执行前后 `git status --porcelain` 未因该检查而新增改动的输出）。
- [ ] AC5（P4 判定翻转·**生产读数 = 落地判据**）：修后重跑 `node --experimental-strip-types plugin/scripts/guard-lineage-check.ts --json`，`suspicious` 里**不再含** `manager-tick-log-check.sh`，且它出现在 `preventive`。贴出修后 `preventive`/`suspicious` 两段逐字。⛔ 不以"case 文件存在"代替这条读数。
- [ ] AC6（回归）：`node --experimental-strip-types plugin/test/guard-lineage-check.test.mjs` exit 0；`bash scripts/test.sh --for-task gap-manager-tick-log-check-mutation-case` 绿（或等价 scoped 静态门）。

## DoD

两个注入方向都在**真实脚本**上执行过一次并走完"转红 → 恢复 → 转绿"（贴完整输出），case 被 `checker-mutation-check.sh` 的自动 manifest 拾取并执行（`covered: true` + `--check --only` exit 0），且 `guard-lineage-check.ts` 的**生产读数**把该守卫从 `suspicious` 移到 `preventive`。⛔ 仅新增一个 case 文件而无人执行它，不算完成（那是 hard rule 4 推论三的"回声"形态）；⛔ 靠改判定阈值消掉这条也不算完成。

## Touches

- plugin/scripts/checker-mutation-cases/manager-tick-log-check.sh
- plugin/scripts/runner-static-gate.ts
- plugin/scripts/manager-tick-log-check.sh
- plugin/scripts/checker-mutation-check.sh
- plugin/test/guard-lineage-check.test.mjs
- tasks/gap-manager-tick-log-check-mutation-case.md
