---
id: gap-kernel-sibling-check-stays-no-block-after-ac225-migration-zero
title: kernel-sibling 检查器在套件里仍带 --no-block（REPORT-ONLY
  不阻塞），而代码注释自己写明的移除条件「AC-225 迁移归零」已满足——叠加 GOAL-012 关闭后 AC-225 退出 I5
  复验域，「枚举归零」此刻无任何会红的守卫
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**代码自己写下的待办，前置条件已满足而未执行**（实测 2026-09-10，非主张）。`plugin/scripts/runner-static-gate.ts:576-579` 的注释**逐字**：

> ⛔ 常驻路径用 `--no-block`（REPORT-ONLY，exit 0 但打印违规）：本检查器默认 fail-closed（AC-225 criterion 与突变用例/单测都以默认跑），但本任务落地时全店仍有 ~9 处 naive `__dirname` 残量 + 一批待补 DEV-TREE-ONLY 标记的 target-root 站点（AC-225 迁移范围）——fail-closed 会让全量 suite 恒红、挡住所有 fan-in。**AC-225 迁移归零后移除此 flag 转 fail-closed。**

`:581` 的注册行**仍带** `--no-block`。而移除条件**已满足**——实测 `kernel-sibling-resolution-check.ts --root . --json` ⇒ **exit 0 / `violations: []` / `total: 0`**。

**为什么此刻这条不变式实际无人阻塞地守着**——它此前有两道守卫，现在一道停了、一道不阻塞：

1. **goal 层（已停）**：AC-225 的判据（**不带** `--no-block` ⇒ fail-closed）由 goal-driver 每约 42 秒复跑。GOAL-012 于 `2026-09-10T07:03:36Z` 翻 achieved 后，**AC-225 退出 I5 复验域**——实测 I5 `inScope: [AC-188, AC-189, AC-190, AC-201, AC-202]`，AC-224…228 一条都不在内（作用域＝achieved AC under **ACTIVE** goal ∪ `long_term: true`；AC-224…228 实测 `long_term=False` 且其 goal 非 active）。
2. **套件层（不阻塞）**：`:581` 带 `--no-block` ⇒ REPORT-ONLY，打印违例但 exit 0。

⇒ **此刻若新落一处 naive `__dirname` 或跨包源码锚点：套件里打印一份报告、exit 0、不红任何东西，也没有任何复验会把它报出来。**

「**能取假**」那一半仍被守住（`plugin/test/kernel-sibling-resolution-check.test.mjs` 在套件默认 glob 内，实测 21 pass，含 P4 三形态 RED + 边界 GREEN + 双向豁免）——**缺的是「枚举归零」那一半的强制力。**

**对照（两域注册不对称）**：B 域同族检查器 `runner-static-gate.ts:252` 的 `target-identity-literal-check` **不带** `--no-block` ⇒ fail-closed。

**兄弟实例已枚举（硬规则 5b，⛔ 不只修被报出来的那一个）**：全部 5 条 `--no-block` 注册已实测分诊，只有本条的理由已过期——

```
task-contract-check              有违例 ⇒ --no-block 仍有理由
task-ac-carryover-check          有违例 ⇒ 仍有理由
kernel-sibling-resolution-check  CLEAN  ⇒ 理由已过期        ← 本任务
suite-duration-exceed-check      有违例 ⇒ 仍有理由
instrument-decay-check           有违例 ⇒ 仍有理由
```

⇒ 本任务**只改这一条**，⛔ 不做「全面审计 REPORT-ONLY 注册」的泛化机制——另外 4 条此刻的 REPORT-ONLY 是正确的（硬规则 12：不为尚未发生的问题先加机制）。

**与 GOAL-012 的关系**：GOAL-012 标题为「kernel↔target 边界三域归属**并接上强制力**」，范围② 为「A/B 两域的静态检查器……**接入常规套件**」。A 域此刻是「接入了、但不强制」。GOAL-012 已 achieved 且**不因本条重开**（其退出条件的机械判据均实质成立，实测三读数）；本任务是它的**收尾**。

## Plan

1. 去掉 `runner-static-gate.ts:581` 注册行末的 `--no-block`。
2. **同步改 `:576-579` 那段解释注释**——该待办已执行，⛔ 不得留下一段声称「待移除」的陈述与代码矛盾（否则下一个人读到的是一条已失效的指令，正是本仓库 CLAUDE.md 开篇警告的漂移形态）。
3. 加一条回归断言到 `plugin/test/scoped-static-checks.test.mjs`（该文件已有读同一 `runner-static-gate.ts` 的 AC3 registry test）：kernel-sibling 的 `run_checker` 注册行**不得**带 `--no-block`——**按位置判定该注册行**，⛔ 不是全文 grep 关键词（注释里提到 `--no-block` 不算命中）。
4. 负控制取真实读数：注入一处违例 ⇒ 套件路径下**红**；移除注入 ⇒ 绿。

## Acceptance Criteria

- [x] AC1（**行为**，非文本）：注入一处 naive `__dirname` 或跨包源码锚点后，跑套件的 static gate ⇒ **红**（贴出退出码 + 违例行）；移除注入 ⇒ 绿。⛔ 只贴「flag 不见了」的 grep **不算通过**——那是文本不是行为（硬规则 4：一个结构上不可能取假的量不是测量）。
- [x] AC2（当前树不红）：翻 fail-closed 后 `kernel-sibling-resolution-check` 在全量套件里 exit 0（前置实测已取：`--root . --json` ⇒ `violations: []`）。
- [x] AC3（回归守卫**能取假**）：`plugin/test/scoped-static-checks.test.mjs` 的新断言在**把 `--no-block` 加回去**时必须**失败**——贴出该反向干跑的输出。⛔ 一个不做反向干跑的断言与恒绿同形。
- [x] AC4（注释与代码一致）：`:576-579` 注释块不再声称「AC-225 迁移归零后移除此 flag」这条待办——按位置检查该注释块，贴出改后原文。
- [ ] AC5：全量 `scripts/test.sh` 绿。（待外部）

## Definition of Done

A 域的「枚举归零」重新有一个**会红**的守卫，与 B 域 `:252` 对称；该守卫由**注入即红**的负控制证明，⛔ 不是由「flag 文本不见了」证明；解释注释与代码状态一致（无残留的失效待办）；全量 `scripts/test.sh` 绿。

## Touches

- plugin/scripts/runner-static-gate.ts
- plugin/test/scoped-static-checks.test.mjs
- tasks/gap-kernel-sibling-check-stays-no-block-after-ac225-migration-zero.md