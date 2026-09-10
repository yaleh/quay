---
id: gap-ac203-record-lacks-build-sha-makes-ac214-permanently-unsatisfiable
title: AC-203 的记录写入点是裸 printf、不带 build_sha，而 AC-214 的新鲜度锚只认 build_sha ⇒
  该记录即便产出也被判为「无证据」⇒ AC-214 结构上永远 exit 1
status: todo
labels:
  - gap
  - defect
  - delivery-critical
  - mechanism
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-cross-host-evidence-run-incomplete-and-step-order-makes-ac234-unsatisfiable
goal_ac: AC-214
---
## Proposal

**AC-214 的判据逐字**（`goals/AC-214-*.md` 的 criterion）：

```python
NEED = ["GOAL-009-AC-201", "GOAL-009-AC-203", "GOAL-009-AC-205", "GOAL-009-AC-207"]
...
        sha = r.get("build_sha") or r.get("commit")
        ts  = str(r.get("ts") or "")
        if sha and (a not in newest or ts > newest[a][1]): newest[a] = (sha, ts)
missing = [a for a in NEED if a not in newest]
if missing:
    sys.stderr.write("no evidence yet: %s\n" % ",".join(missing)); sys.exit(1)
```

⇒ **一条没有 `build_sha`（也没有 `commit`）的记录，对 AC-214 而言等同于「这条 ac 根本没有证据」**——`if sha and ...` 直接跳过它，该 ac 落进 `missing`，判据 exit 1。

**写入点逐个核对（按位置，只看真实写入语句——⛔ 不匹配注释；本条第一次核对时我正是匹配到了 helper 的注释块而得出错误映射，重取后如下）**：

| ac | 写入点 | 形态 | 带 `build_sha`? | 在 NEED 里? |
|---|---|---|---|---|
| AC-201 | `verify-deliver-coldstart.sh:468` | 裸 `printf` | **✓**（显式写了 `"build_sha":"%s"`） | 是 |
| **AC-203** | **`:912`** | **裸 `printf`** | **✗** | **是** |
| AC-206 | `:936` | 裸 `printf` | ✗ | 否 |
| AC-204 | `:1077` | 裸 `printf` | ✗ | 否 |
| AC-205 | `:1117` | `ac89_append_goal009` | ✓ | 是 |
| AC-232 | `:1387` | `ac89_append_goal009` | ✓ | 否 |
| AC-234 | `:1254` | 裸 `printf` | ✗ | 否 |
| AC-207 | worktree `gap-ac207-…:532` | `ac89_append_goal009` | ✓ | 是 |

`ac89_append_goal009()`（`:485-494`）是统一补锚的 helper：`BUILD_SHA` 非 40-hex ⇒ **fail-closed 拒写**，否则 `printf '{"build_sha":"%s","ts":"%s"%s}\n'`。

⇒ NEED 四条里，**AC-203 是唯一走裸 printf 且没写 build_sha 的**。**AC-214 因此结构上永远不可能 exit 0**，无论 AC-203 的记录将来产没产出、新不新鲜。

**现状佐证**：AC-214 当前干跑 exit 1，stderr 形如 `no evidence yet: GOAL-009-AC-203,GOAL-009-AC-205,GOAL-009-AC-207`——今天三条都还没产出，所以这个缺陷被「反正也还没有证据」掩盖着；等 `gap-cross-host-evidence-run-incomplete-…` 把 AC-203 的产出打通之后，**AC-203 会从「没产出」变成「产出了但仍被判为没证据」**——那时缺陷才显形，且形态更难查（记录明明在载体里）。⇒ 现在修，比等它显形便宜。

**为什么不是「顺手给所有记录都加 build_sha」**：AC-204/206/234 不在 AC-214 的 NEED 里，给它们加锚是范围外改动，且会改变既有已转绿记录的形态（AC-204/AC-206 刚于 2026-09-10T22:49Z 转 achieved）。本条**只**修 AC-203 这一条被 NEED 引用却缺锚的。若将来 NEED 扩容，扩容那条任务负责同步补锚。

## Plan

1. 把 `:912` 的 AC-203 写入点改走 `ac89_append_goal009`（与 AC-205/AC-232/AC-207 同形），由 helper 统一补 `build_sha`/`ts`——⛔ 不手写 `"build_sha"` 字面量（那会多出第二个补锚点，硬规则①：用机件不手搓；且下次改锚格式必漏一处）。
2. helper 的 fail-closed 语义要保留：`BUILD_SHA` 非 40-hex ⇒ 不写记录并返回非 0，⛔ 不得为了「至少写点什么」而降级成无锚记录（硬规则 3b）。
3. 同步镜像副本 `packages/quay/plugin/scripts/verify-deliver-coldstart.sh`。
4. 加一条把「NEED 与写入点带锚情况」对齐起来的机械检查或测试，防同族复发（硬规则 5b：修一处 ≠ 只有一处）——枚举 AC-214 criterion 里的 NEED 列表，逐条断言其写入点经 `ac89_append_goal009`（或显式含 `build_sha`）。

## Acceptance Criteria

- [ ] AC1 缺陷存证（改前读数）：贴改前 `:912` 的完整 `printf` 语句（可见无 `build_sha`），与 AC-214 criterion 里 `sha = r.get("build_sha") or r.get("commit")` 那一行。
- [ ] AC2 已改走 helper（能取假）：改后 `grep -nE '^\s*(printf .*GOAL-009-AC-203|ac89_append_goal009 ".*AC-203)' plugin/scripts/verify-deliver-coldstart.sh` 命中的是 `ac89_append_goal009` 形态；贴命中行。
- [ ] AC3 记录真带锚（⛔ 不靠读代码断言）：用 hermetic 方式（`--selfcheck` 或等价的受控调用）让 AC-203 写入点真写一条记录到临时 `--ac89` 路径，`python3 -c` 读回该行并打印 `build_sha` 字段值为 40-hex；贴该行 JSON。
- [ ] AC4 fail-closed 保留（能取假）：令 `BUILD_SHA` 为空或非 40-hex ⇒ 该写入点**不写记录**且返回非 0，stderr 含 helper 的拒写提示；贴输出与「临时载体行数未变」的前后读数。
- [ ] AC5 同族防复发检查：新增/扩展一条机械检查——解析 AC-214 criterion 中的 NEED 列表，逐条断言其写入点带锚；对当前状态它应**改前红、改后绿**；贴前后两次运行输出。
- [ ] AC6 镜像无漂移：`node --no-warnings --experimental-strip-types plugin/scripts/mirror-pair-drift-check.ts --root .` exit 0。
- [ ] AC7 全量绿：`scripts/test.sh` 全量绿。

## Definition of Done

AC-214 的 NEED 列表里每一条 ac 的写入点都经 `ac89_append_goal009` 补锚（或显式带 40-hex `build_sha`），且该对应关系由**机械枚举**守着（⛔ 不是人工清点一次）；helper 的 fail-closed 语义未被降级。⛔ 本任务**不**主张 AC-214 因此转绿——它还需要 AC-203/205/207 三条记录真的产出（归 `gap-cross-host-evidence-run-incomplete-…` 与 `gap-ac207-e2e-producer-section-never-landed-on-develop`）；本条只保证「产出之后不会被判成没产出」。

## Touches

- plugin/scripts/verify-deliver-coldstart.sh
- packages/quay/plugin/scripts/verify-deliver-coldstart.sh
- plugin/test/verify-deliver-coldstart.test.mjs
- tasks/gap-ac203-record-lacks-build-sha-makes-ac214-permanently-unsatisfiable.md
