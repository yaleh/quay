---
id: GOAL-026
title: 架构收敛（shell 层）：内嵌 python3 的大脚本收进 TS——5.2 三个脚本薄入口化、develop-deliver-tgz 与
  quay-init 不再内嵌 python3、shell 层棘轮不回升
status: active
kind: goal
origin: SPEC-architecture-consolidation §10.2 第二个 GOAL（Phase 5；GOAL-025 已
  achieved，Phase 0 基线已出）。人 2026-09-20 指示 GOAL-B 应由 Claude 自行查
  cap、自行起草退出条件并创建。cap=5（.quay/config.yml:224），创建时 active 仅 GOAL-022，余量 4。
activatedAt: 2026-10-01T17:56:00.328Z
statusLog:
  - at: 2026-10-01T17:56:00.328Z
    from: draft
    to: active
    actor: goal-cli
    reason: 人 2026-10-02 裁定激活：该 draft GOAL 及其子 AC 因分诊对象集只覆盖 active GOAL 名下的 draft AC
      而永久不可达（goal-driver.ts:2254-2256），9 条 draft 自 09-21/09-23 起惰性。激活使其子 AC
      进入分诊与判定域。
---
## 背景

`orchestration/SPEC-architecture-consolidation-ts-and-shell-2026-09-19.md`（位于分支 `worktree-spec-architecture-refactor`，未合入 develop；本 GOAL 与各 AC 正文自足）§10.2 论证过：架构收敛按阶段拆成两个 GOAL，时间上串行。**GOAL-025（Phase 0–4：三个仪器、反向边、环、副本、kernel/、catalog 数据化）已于 2026-09-19 achieved。本 GOAL 是第二个（Phase 5：shell 层收敛），SPEC 当时写明「量化阈值在 Phase 0 基线前不可定」——现在基线出来了**：2026-09-20 `sh-census-check --json` 读数为 150 个 tracked `.sh`、非例外脚本里 60 个内嵌解释器、`embeddedInterpreterLines=9503`、`exceptionLines=7500`。

「以 bash 为壳、内嵌 python3 为实」的程序不受 archguard 分析、无类型、难测。SPEC 的原则是**把「程序」收进 TS，把「胶水」留在 bash**（非目标 1：不把所有 bash 都改 TS）。

## 范围与非目标

范围（每项对应一条 AC）：
①SPEC Phase 5.2 三个脚本收成 ≤25 有效行的薄入口或删除：`integration-batch-merge.sh`（697 行，node+python3）、`checker-mutation-check.sh`（490 行）、`cross-machine-verify.sh`（489 行，python3）——**AC-312**；
②SPEC Phase 5.3 第一阶段：`develop-deliver-tgz.sh`（2354 行）的 python3 heredoc 抽成 `.ts`——**AC-313**；
③SPEC Phase 5.1 残余：`quay-init.sh`（1332 行，`gap-quay-init-native-reconcile` 的 DoD 明写「载体迁移暂缓」）的 python3 heredoc 收进原生 `init.ts`——**AC-314**；
④棘轮：内嵌解释器行数与重复副本数不回升，且例外清单不得被拿来逃棘轮——**AC-315**（`long-term: true`，会回升的量）。

**为什么 AC-312 与 AC-313/314 判据形态不同（口径，不是随意）**：census 的「内嵌解释器」把 `node --experimental-strip-types x.ts` 这种**调用 TS 程序的胶水**也计为 `node`，所以「embedded 为空」对薄入口恒假。故 AC-312 用**有效行 ≤25**（薄入口或删除）；AC-313/314 这两个脚本内嵌的是 `python3`，用「`embedded` 不含 `python3`」——胶水保留在 bash，正合 SPEC 意图。`checker-mutation-check.sh` 的 `embedded` 本就为空（它是纯 bash 程序，不是内嵌解释器），所以它只能用行数口径量。

非目标（⛔ 每一项都是有意排除，不是遗漏；充分性闸据此判退出条件是否被 AC 覆盖）：
- **`verify-deliver-coldstart.sh`（6293 有效行，SPEC Phase 5.4）**：人 2026-09-19 裁定「列入路线图但先不立案，等前几步落地后按实测成本再裁定」——它在 `plugin/sh-census-exceptions.txt` 族②。**本 GOAL 落地后再据实测成本裁定，届时可能开 GOAL-C。**
- **控制面 shell**（`send-keys-reliable` / `supervisor-*` / `process-budget`，例外清单族①）：人 2026-09-19 裁定暂保持 bash 现状、长期考虑退役。
- **`scripts/test.sh`（SPEC Phase 5.5）**：调度骨架保留（SPEC 非目标 2）；它对 `.ts` 检查器的调用按 census 口径恒计 `node`，没有可判的单调终点。
- **长尾**：除上述 4 个脚本外，仍有约 56 个脚本内嵌解释器、合计约 4631 有效行（9503 − 4872，2026-09-20 实测；`resource-gate.sh` 348、`sync-vendor.sh` 324、`closure-lag-check.sh` 244 等，多为几十到几百行的小脚本）。**SPEC §10.2 的原退出条件写的是「例外清单外内嵌解释器 sh = 0」，本 GOAL 有意收窄为四个大脚本 + 棘轮**：长尾逐个立 task 收益低、且没有先做 characterization 的成本结构数据（硬规则 4 推论）。长尾是否另立 GOAL，待本 GOAL 落地、AC-315 棘轮读数稳定后按实测再定。**这是对 SPEC 的一处有意偏离，已在此显式记账。**
- **Phase 1b/1c/1d**（孤儿 sh 退役、薄壳直调、悬空链接）与 **Phase 6**（巨型 TS 模块拆分）：由 task 承担，不进 AC（无可机械判定的单调终点；行数不是判据）。
- 不改 Provider ABI 与公开 CLI/MCP 表面。

## 判据形态

- 所有判据读**真检查器在真实仓库根的输出**（`sh-census-check.ts --json`），不是 fixture；检查器不存在或未评估时判据一律 exit 1，⛔ 不是 0（硬规则 3b）。四条判据落笔当轮均已在真实仓库上取过读数：AC-312/313/314 现在 exit 1（分别带 `CAUSE=` 点名 697/490/489 行、develop-deliver-tgz.sh 与 quay-init.sh 仍含 python3），AC-315 现在 exit 0；正控（把 AC-312 阈值放宽则 exit 0）与负控（把 AC-315 例外上限压低 1 行则 exit 1、检查器缺失则 exit 1）均已实跑。
- 判据均为「读本地检查器输出」的轻量形态，⛔ 不是 suite 规模命令（goal-mechanism §11 成本边界）。
- 主防线在同步侧：`sh-census-check` 的真实仓库读数已由 `plugin/test/sh-census-check.test.mjs` 断言并随 suite 运行，回升在 fan-in 那一刻就变红；AC-315 的 `long-term` 是后备（覆盖绕过 suite 的直改）。
- 每条 AC 各有承载它的 task：AC-312 ← `gap-arch-tsify-{integration-batch-merge,checker-mutation-check,cross-machine-verify}-sh`；AC-313 ← `gap-arch-tsify-develop-deliver-tgz-python-heredocs`；AC-314 ← `gap-arch-quay-init-sh-python-heredocs-to-native`。各 task 自带「characterization 先于改写」与「至少一条 AC 读生产载体」。

## 退出条件

4 条 AC 全部 achieved：AC-312（5.2 三个脚本 ≤25 有效行或已删除）；AC-313（`develop-deliver-tgz.sh` 不再内嵌 python3）；AC-314（`quay-init.sh` 不再内嵌 python3，或对自举不可替代的保留项如实标注）；AC-315（shell 层棘轮未回升且例外清单未增长，long-term）。