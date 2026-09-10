---
id: AC-226
title: B域身份字面量检查器：存在 + 枚举归零 + 被突变覆盖，三者缺一不可（GOAL-012 退出条件①⑤）
status: draft
kind: criterion
goal: GOAL-012
criterion: test -f plugin/scripts/target-identity-literal-check.ts && node
  --no-warnings --experimental-strip-types
  plugin/scripts/target-identity-literal-check.ts --root . --json && bash
  plugin/scripts/checker-mutation-check.sh --list --json | python3 -c 'import
  json,sys; m=json.load(sys.stdin); ok="target-identity-literal-check" in
  json.dumps(m); print("covered:",ok); sys.exit(0 if ok else 1)'
expect: '`target-identity-literal-check.ts` 存在、在本仓库跑 exit 0（TARGET 域违例枚举为 0），且被
  `checker-mutation-check` 清单标为已覆盖（能取假）。TARGET 域违例 = kernel 代码里把「逐项目不同的身份」写成无
  override 的字面量（分支名/test_command/tasks_dir）。立条时已知实例：`driver-filters.ts` 的
  `DOC_BRANCH = "author"`（扫描确认是唯一无覆盖能力的一处——develop/integration/master 均有 CLI 覆盖且
  quay-init 为每个项目建这些分支）。三个断言缺一不可：存在 + 绿 + 被突变覆盖。'
origin: >-
  GOAL-012 的机器判据之一。立条依据见 GOAL-012 的 origin（人 2026-09-10 三条裁定后授权设立；8 个缺陷同属
  kernel↔target 边界三域归属缺口；§6b 已有契约但只覆盖一域且无强制力，人工枚举 3 次 3 漏）。


  本条判据在立条当轮已干跑取真实读数：exit 1（可评估、非 spawn 失败），符合「判据落笔当轮必须取一次真实读数」（硬规则
  4c）。判据只引用不会自行回退的量——代码状态与套件绿红，⛔ 不含进程存活/远程主机可达性/真实第三方项目当前跑通状态（后者归 GOAL-009
  AC-207 与例行监控）。
---
