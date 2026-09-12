---
id: gap-ac242-naive-frontmatter-split-hides-own-long-term-self-latching-false-positive
title: AC-242 判据用朴素三横线切分取 frontmatter，看不见自己的 long-term ⇒ 自报为冻结、且红了不会自愈
status: ready
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
## Finding

**AC-242 的判据用朴素三横线切分取 frontmatter，看不见自己的 `long-term` 声明，于是把自己列为「冻结的 achieved 却失败」——一旦它因任何原因红过一次，就永久红下去。**

机理（逐字）：AC-242 的判据里 `for line in s.split("---",2)[1].splitlines()` 在**字段值内部**的三横线处截断。AC-242 自身的字段顺序是 `id, title, status, kind, goal, criterion, expect, origin, activatedAt, statusLog, long-term, fidelity` —— **`long-term` 排在 `criterion` 之后**，而 criterion 正文含三横线 ⇒ 切分只拿到 631 字符（真实 frontmatter 3250 字符），可见键只有 `id/title/status/kind/goal/criterion`。

于是它的豁免集 `longterm` 系统性缺项。而 `status`/`goal` 恰好排在 `criterion` 之前、读得到 ⇒ 误判方向是**假阳性**（把已声明常设的 AC 报成冻结）。

**自锁**：AC-242 红 ⇒ 它自己的台账尾事件变 `fail` ⇒ 它看不见自己的 `long-term` ⇒ 把自己算进「achieved ∧ 尾事件 fail ∧ 不在豁免集」⇒ 继续红。⛔ 这条不会自愈。

## Evidence

2026-09-12 实测：

- 标了 `long-term: true` 的 AC 共 **17** 条；AC-242 的朴素切分**看得见 14 条**，**看不见 3 条**：`AC-214`、`AC-242`、`AC-244`（正是判据正文含三横线的那几条）。
- AC-242 当前实跑 `exit 1`，输出 `frozen achieved-but-failing, no mechanism re-runs them: AC-147,AC-149,AC-172,AC-228,AC-242` —— 前 4 条是真问题（另有任务承接），末一条 `AC-242` 是本缺陷造成的假阳性。
- **自锁对照**：把那 4 条真问题的尾事件模拟为 `pass` 后重跑同一逻辑，仍报 `['AC-242']` ⇒ 即便真问题全修好，它也不会自己恢复。
- 同一写法的分布（5b 扫兄弟实例）：`goals/AC-*.md` 里用朴素切分的**只有 AC-242 一条**；`AC-214`、`AC-244`、`AC-246` 已是**行首锚定**写法 ⇒ 修法有同仓先例可抄，⛔ 不必新造解析器。

## AC

- [ ] AC1（改前读数，可取假）：跑一条命令打印 AC-242 判据解析出的 `longterm` 集合大小与成员，并与「实际标了 `long-term: true` 的 AC 集合」对比；改前两者应**不相等**（14 vs 17），差集逐条列出。
- [ ] AC2（自锁复现）：把 `AC-147/AC-149/AC-172/AC-228` 的尾事件模拟为 `pass` 后跑 AC-242 的判定逻辑，改前输出仍含 `AC-242` ⇒ 自锁成立。
- [ ] AC3（修法）：AC-242 的 frontmatter 解析改为**行首独立三横线判边界**，抄 `AC-214` / `AC-244` / `AC-246` 已有的写法，⛔ 不新造第四种解析器。
- [ ] AC4（改后读数）：AC-1 的两个集合**相等**（17 == 17，差集为空）；AC2 的模拟重跑输出**不再含** `AC-242`。
- [ ] AC5（双向控制，⛔ 防止把检测能力一起改没）：构造一条「achieved ∧ 尾事件 fail ∧ 其 goal 非 active ∧ 未标 long-term」的样本，改后 AC-242 **仍报出它**；把该样本标上 `long-term` ⇒ 不再报出。两次结果必须不同。
- [ ] AC6（真问题不被掩盖）：改后 AC-242 对 `AC-147/AC-149/AC-172/AC-228` 的判定不变（仍报出，除非它们已被独立处置）——修假阳性不得顺手把真阳性一起去掉。
- [ ] AC7（全量绿）：`scripts/test.sh` 全量绿。

## DoD

生产读数可验证：AC-242 在真实仓库上实跑，其输出不再含自身；且它对真正冻结的 AC 仍能报出（AC5/AC6 的双向控制在生产数据上各给一条读数）。⛔ 「解析器改好了」不算——判定输出必须在真实 goal 记录上取到两种值。fixture 与单测是必要不充分条件（DIR-026 Reading A）。

## Touches

- goals/AC-242-台账不得留下-已离开复验域却尾事件为-fail-的-ac-否则下游判据-ac-241-结构上永不通过-被误读成-还有真缺.md
- packages/quay/test/goal-store.test.mjs
- tasks/gap-ac242-naive-frontmatter-split-hides-own-long-term-self-latching-false-positive.md
