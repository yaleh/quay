---
id: AC-226
title: B域身份字面量检查器：存在 + 枚举归零 + 被突变覆盖，三者缺一不可（GOAL-012 退出条件①⑤）
status: achieved
kind: criterion
goal: GOAL-012
criterion: node --no-warnings --experimental-strip-types --test
  plugin/test/target-identity-literal-check.test.mjs && test -f
  plugin/scripts/target-identity-literal-check.ts && node --no-warnings
  --experimental-strip-types plugin/scripts/target-identity-literal-check.ts
  --root . --json && bash plugin/scripts/checker-mutation-check.sh --list --json
  | python3 -c 'import json,sys; m=json.load(sys.stdin);
  ok=any(c.get("name")=="target-identity-literal-check" and c.get("covered") for
  c in m.get("checkers",[])); print("registered:",ok,file=sys.stderr);
  sys.exit(0 if ok else 1)'
expect: >-
  三个断言缺一不可：**①能取假**——`plugin/test/target-identity-literal-check.test.mjs`
  在自建夹具上双向跑通：注入一处「kernel 代码里把逐项目不同的身份写成无 override
  的字面量」（分支名/`test_command`/`tasks_dir` 各一例）⇒ 检查器红；移除 ⇒
  绿。**②本仓库枚举归零**——检查器在本仓库当前树跑 exit 0。**③登记**——出现在突变清单且 `covered: true`。


  TARGET 域违例的判别标准（写进检查器，⛔ 不留给读者意会）：该字面量是否**逐项目不同**且**没有 override 通道**。立条时扫描确认
  `driver-filters.ts` 的 `DOC_BRANCH = "author"`
  是唯一无覆盖能力的一处；`develop`/`integration`/`master` 有 CLI 覆盖且 quay-init 为每个项目建这些分支 ⇒
  它们是**合法默认值**，检查器不得误报（这是①的负控制要覆盖的方向之一）。


  **可直接验证**：三个断言都是当前树的纯函数，⛔ 不依赖多轮积累的生产读数。
origin: >-
  GOAL-012 的机器判据之一。立条依据见 GOAL-012 的 origin（人 2026-09-10 三条裁定后授权设立；8 个缺陷同属
  kernel↔target 边界三域归属缺口；§6b 已有契约但只覆盖一域且无强制力，人工枚举 3 次 3 漏）。


  本条判据在立条当轮已干跑取真实读数：exit 1（可评估、非 spawn 失败），符合「判据落笔当轮必须取一次真实读数」（硬规则
  4c）。判据只引用不会自行回退的量——代码状态与套件绿红，⛔ 不含进程存活/远程主机可达性/真实第三方项目当前跑通状态（后者归 GOAL-009
  AC-207 与例行监控）。
activatedAt: 2026-09-10T03:05:04.876Z
statusLog:
  - at: 2026-09-10T03:05:04.877Z
    from: draft
    to: active
    actor: cli:human-ruling-2026-09-10
    reason: 人授权激活（单次授权）
  - at: 2026-09-10T05:42:55.178Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---
