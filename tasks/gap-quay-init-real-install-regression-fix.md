---
id: gap-quay-init-real-install-regression-fix
title: quay-init real-install 回归修复——AC80-INNER-ANCHOR reference-doc + 指针化两落地破坏 2 个 real-install 测试（round170 红，outer 分诊，归属 inner）
status: done
labels:
  - gap
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on: []
---

**type:** execution

## Proposal

**（round170 红窗真实回归——outer 分诊，两个 real-install 测试失败，归属 inner 实现面）**。

**现象**：round170 state=red reason=failed，2 个 real-install 测试失败（非 flake——round168→170 同两文件从 passed 变红，回归签名）：
```
1. quay-init-loop-consumer-doc-refs.test.mjs — AC3 + AC2+AC5 红
2. quay-init.test.mjs — AC5 红（--loop --manager 铺三核 + quay-session.ts）
```

**根因（两条落地均在 plugin/ 实现面，inner 最近落地）**：
- **① 7e64a86b（AC80-INNER-ANCHOR）**：给 `plugin/skills/init/SKILL.md` 加了 `<!-- reference-doc: plugin/loop/fast-mode-loop-tick.md -->`。round168 树该文件 0 个 plugin/loop 引用 → 现 1 个。而 `quay-init-loop-consumer-doc-refs.test.mjs` AC3 断言「shipped docs/skills 零 plugin/loop 引用」且**不 consult declaredSet**——同文件 AC2+AC5 反而 consult reference-doc/self-create declaredSet ⇒ **机制内部自相矛盾：reference-doc 声明机制建了，AC3 没豁免它**。
- **② 指针化（cb75d552）**：`plugin/loop/manager-tick-core.md` 从真实内容变 122B 单行指针。`quay-init.test.mjs` AC5 断言 `--loop --manager` 在 target `orchestration/` 铺下三核可读——若铺的是指针行，非真核（byte-identical 断言失败）。

**修复方向（outer 建议，供实现者按实际判）**：
- ① AC3 改为 consult reference-doc/self-create declaredSet（与同文件 AC2+AC5 对齐）——reference-doc 声明机制本身是好的，是 AC3 没跟上；先查 declaredSet 豁免路径。
- ② quay-init 铺三核时指向正本而非 plugin/loop 指针行——manager-tick-core 的 laydown 应解析指针、铺 orchestration/ 正本真核，或等价修复（使 --loop --manager 铺下的 manager-tick-core 是真核、可冷启动读）。

**判据1**：quay-init-loop-consumer-doc-refs.test.mjs AC3 通过（consult declaredSet，豁免 reference-doc/self-create 声明；不再对声明路径报 plugin/loop 引用违规）。
**判据2**：quay-init.test.mjs AC5 通过（--loop --manager 铺下的 manager-tick-core 是真核、byte-identical 到正本，可冷启动读）。
**判据3（能取假）**：round170 的两个失败测试重跑全绿；`--for-task` scoped 门绿。
**判据4**：既有测试全绿；不破坏 reference-doc 声明机制（AC2+AC5 的 declaredSet consult 保留）。

**不覆盖**：不动 AC80-INNER-ANCHOR 的 reference-doc 声明本身（机制是好的）；不改指针化的「指针非副本」方向（cb75d552 已落地）。

**本任务不新建过程纪律型 AC**：负控制沿用 AC49。

## Plan

1. 读 quay-init-loop-consumer-doc-refs.test.mjs（AC3 扫描 + AC2+AC5 的 declaredSet consult 路径）+ quay-init.test.mjs（AC5 三核 laydown + byte-identical 断言）+ quay-init.sh 的 derive_loop_scripts/laydown 逻辑。
2. 判据1：AC3 consult declaredSet（豁免 reference-doc/self-create 声明）。
3. 判据2：quay-init 铺三核时解析指针、铺 orchestration/ 正本真核（或等价）。
4. 判据3：两个失败测试重跑绿 + scoped 门绿。
5. 判据4：既有测试全绿。

## Acceptance Criteria

- [x] AC1 判据1：quay-init-loop-consumer-doc-refs.test.mjs AC3 通过（consult declaredSet）。
- [x] AC2 判据2：quay-init.test.mjs AC5 通过（--loop --manager 铺真核）。
- [x] AC3 判据3 能取假：round170 两失败测试重跑全绿；`--for-task` scoped 门绿。
- [x] AC4 判据4：既有测试全绿；reference-doc 声明机制保留。

## Definition of Done

- [x] 两个 real-install 回归测试全绿 + reference-doc 机制保留 + scoped 门绿。

## Touches

- plugin/test/quay-init-loop-consumer-doc-refs.test.mjs（AC3 consult declaredSet）
- plugin/test/quay-init.test.mjs（AC5 若断言需对齐——铺真核后 byte-identical 到正本）
- plugin/scripts/quay-init.sh（manager-tick-core laydown 解析指针、铺 orchestration/ 正本真核——若需要）
- tasks/gap-quay-init-real-install-regression-fix.md（自身）

## Evidence

**round170 分诊**：2 个 real-install 测试失败，根因 7e64a86b + cb75d552，非 flake（round168→170 同两文件从 passed 变红，回归签名）。

**修复 ①（AC3 consult declaredSet）**：
- `quay-init-loop-consumer-doc-refs.test.mjs` AC3 原扫描 shipped docs/skills 的 `plugin/loop/*` 引用且**不 consult declaredSet**，而同文件 AC2+AC5 已 consult reference-doc/self-create declaredSet——内部自相矛盾（reference-doc 声明机制建了、AC3 没豁免它）。
- **改动**：AC3 现在对每个 `plugin/loop/` 引用检查 `refdoc.has(ref) || selfcreate.has(ref)`，命中的声明路径豁免（declaration 本身不是 content reference）。AC2+AC5 的 `plugin/loop/` 分支同样把 declaredSet 豁免前置到 plugin/loop 扫描之前。
- **实测 before**：AC3 offenders = `[loop/fast-mode-loop-tick.md: plugin/loop/fast-mode-loop-tick.md, skills/init/SKILL.md: plugin/loop/fast-mode-loop-tick.md]`；AC2+AC5 missing = `[fast-mode-loop-tick.md: plugin/loop/ ref (never lands) — plugin/loop/fast-mode-loop-tick.md]`。
- **实测 after**：AC3/AC2+AC5 全绿（两者都是 7e64a86b 声明的 reference-doc `plugin/loop/fast-mode-loop-tick.md`）。

**修复 ②（quay-init --loop --manager 铺真核）**：
- `plugin/loop/manager-tick-core.md` 已是 122B 单行指针（cb75d552 指针化）——原 laydown 把指针行铺进 target `orchestration/`，且真实核引用的 `plugin/scripts/quay-session.ts`（derive_loop_scripts (a) 只扫 shipped docs）停止随包。
- **改动**（`plugin/scripts/quay-init.sh`）：
  1. 新增 `resolve_tick_core_src <name>`：若 `plugin/loop/<name>` 首行匹配指针形态 `> 正本: <path>`，返回 `${PLUGIN_ROOT}/../<path>` 正本绝对路径；否则原样返回 shipped 路径（非指针核心保持 verbatim）。
  2. laydown 循环（原 :1775）：`copy_one "$(resolve_tick_core_src "$s")" ...` —— 铺 REAL core，byte-identical 到正本，可冷启动读。
  3. `compute_drift_report`（原 :1380）：drift 轴同样 resolve 指针正本，避免正确安装后的 manager core 被误报 漂移。
  4. `derive_loop_scripts` 显式集补 `quay-session.ts`（manager core A0 读数的依赖，指针化后 (a) 推导丢失；恢复指针化前的随包行为）。
- **实测 after**：manual `--loop --manager` install → target `orchestration/manager-tick-core.md` = 60410 bytes、首行 `# manager tick — 执行核`、`cmp` byte-identical 到 `orchestration/manager-tick-core.md` 正本；`plugin/scripts/quay-session.ts` 已铺（2938 bytes）。

**验证**：
- 两个 real-install 回归测试：`node --test plugin/test/quay-init-loop-consumer-doc-refs.test.mjs plugin/test/quay-init.test.mjs` → **9/9 pass**（before：AC3+AC2+AC5 红 ×2 文件 / AC5 quay-session.ts 未铺红）。
- `--for-task` scoped 门：`bash scripts/test.sh --for-task gap-quay-init-real-install-regression-fix --allow-thin` → **exit 0**。
- 相关既有测试：tick-core-static-check / manager-tick-core / manager-cold-start / manager-install-vector → **46/46 pass**；quay-init-check-drift / quay-init-drift-report / quay-init-loop-core → **22/22 pass**。
- ts-typecheck 门：无新 .ts → **ADMITTED (exit 0)**。
- reference-doc 声明机制保留（SKILL.md 未动）；指针化方向未反转；AC2+AC5 的 declaredSet consult 保留（负控制 AC37 / AC2-negative 仍红、仍 FAIL）。
