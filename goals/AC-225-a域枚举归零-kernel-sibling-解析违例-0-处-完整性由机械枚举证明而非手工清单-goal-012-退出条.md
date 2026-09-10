---
id: AC-225
title: A域枚举归零——kernel sibling 解析违例 0 处，完整性由机械枚举证明而非手工清单（GOAL-012 退出条件①）
status: achieved
kind: criterion
goal: GOAL-012
criterion: test -f plugin/scripts/kernel-sibling-resolution-check.ts && node
  --no-warnings --experimental-strip-types
  plugin/scripts/kernel-sibling-resolution-check.ts --root . --json
expect: "`kernel-sibling-resolution-check.ts` 存在，且在本仓库当前树上跑 exit 0——即 KERNEL
  域违例（把自己的 sibling 脚本锚在 target root / worktree / naive `__dirname` 而非经
  `resolveKernelSibling`/`resolveKernelPluginRoot`）**枚举为 0 处**。立条时实测残量 **9 处**
  naive `__dirname` ⇒ 红。本条与 AC-224 构成双向：AC-224 证明该检查器会红（能取假），本条证明它此刻是绿（迁移已完成）。⛔
  完整性由检查器的机械枚举给出，不是手工清单——人工枚举已做过 3 次、3 次都有遗漏。"
origin: >-
  GOAL-012 的机器判据之一。立条依据见 GOAL-012 的 origin（人 2026-09-10 三条裁定后授权设立；8 个缺陷同属
  kernel↔target 边界三域归属缺口；§6b 已有契约但只覆盖一域且无强制力，人工枚举 3 次 3 漏）。


  本条判据在立条当轮已干跑取真实读数：exit 1（可评估、非 spawn 失败），符合「判据落笔当轮必须取一次真实读数」（硬规则
  4c）。判据只引用不会自行回退的量——代码状态与套件绿红，⛔ 不含进程存活/远程主机可达性/真实第三方项目当前跑通状态（后者归 GOAL-009
  AC-207 与例行监控）。
activatedAt: 2026-09-10T03:05:03.797Z
statusLog:
  - at: 2026-09-10T03:05:03.798Z
    from: draft
    to: active
    actor: cli:human-ruling-2026-09-10
    reason: 人授权激活（单次授权）
  - at: 2026-09-10T07:00:55.022Z
    from: active
    to: achieved
    actor: goal-driver
    reason: "I2: criterion pass"
---
