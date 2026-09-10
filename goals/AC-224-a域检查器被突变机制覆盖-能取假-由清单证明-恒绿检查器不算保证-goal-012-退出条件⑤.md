---
id: AC-224
title: A域检查器被突变机制覆盖——「能取假」由清单证明，⛔ 恒绿检查器不算保证（GOAL-012 退出条件⑤）
status: achieved
kind: criterion
goal: GOAL-012
criterion: node --no-warnings --experimental-strip-types --test
  plugin/test/kernel-sibling-resolution-check.test.mjs && bash
  plugin/scripts/checker-mutation-check.sh --list --json | python3 -c 'import
  json,sys; m=json.load(sys.stdin);
  ok=any(c.get("name")=="kernel-sibling-resolution-check" and c.get("covered")
  for c in m.get("checkers",[])); print("registered:",ok); sys.exit(0 if ok else
  1)'
expect: |-
  双向，两个断言缺一不可：**①能取假（本条的重点）**——`plugin/test/kernel-sibling-resolution-check.test.mjs` 在**自建夹具**上跑通两个方向：干净树 ⇒ 检查器绿；注入一处 naive 锚点（`path.join(__dirname, "x.sh")` / `path.join(root, "plugin", "scripts", ...)` / 模板字符串形态**各一例**，⛔ 不止一种拼接形态——GOAL-012 风险 4）⇒ 检查器**必须红**。**②登记**——该检查器出现在 `checker-mutation-check.sh --list --json` 的 checkers 数组里且 `covered: true`，从而被本仓库既有的 `--check` fail-closed 闸长期看住。

  ⛔ 本条**不**把 `--check` 本身当判据：它会因**别的**检查器的问题而红（立条时实测 `--check` 就是 FAIL），判据将不再隔离本 GOAL；且 72.6s × 每轮的代价过大。`covered: true` 只证明"登记了突变用例"、不证明"会红"（立条时实测 `checkers_total: 63 / checkers_with_mutation: 63`）——所以"会红"由断言①的专用单测直接证明，⛔ 不靠 `covered` 字段冒充。

  **可直接验证**：两个断言都是当前树的纯函数，跑一次即得，⛔ 不依赖任何需要多轮积累的生产读数。
origin: >-
  GOAL-012 的机器判据之一。立条依据见 GOAL-012 的 origin（人 2026-09-10 三条裁定后授权设立；8 个缺陷同属
  kernel↔target 边界三域归属缺口；§6b 已有契约但只覆盖一域且无强制力，人工枚举 3 次 3 漏）。


  本条判据在立条当轮已干跑取真实读数：exit 1（可评估、非 spawn 失败），符合「判据落笔当轮必须取一次真实读数」（硬规则
  4c）。判据只引用不会自行回退的量——代码状态与套件绿红，⛔ 不含进程存活/远程主机可达性/真实第三方项目当前跑通状态（后者归 GOAL-009
  AC-207 与例行监控）。
activatedAt: 2026-09-10T03:05:02.728Z
statusLog:
  - at: 2026-09-10T03:05:02.729Z
    from: draft
    to: active
    actor: cli:human-ruling-2026-09-10
    reason: 人授权激活（单次授权）
  - at: 2026-09-10T07:00:52.078Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---
