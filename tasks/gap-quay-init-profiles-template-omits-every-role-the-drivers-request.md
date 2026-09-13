---
id: gap-quay-init-profiles-template-omits-every-role-the-drivers-request
title: quay-init 的 profiles 模板缺少生产 driver 请求的全部五个角色 —— 第三方项目 GOAL 永不闭环、worker 永远派不出
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
---
## Proposal

**现象（实测）**：第三方项目 quay-fleet 的 GOAL-001 六条 AC 全部 achieved、`goal-ring` 已 verified，
**但 GOAL 始终停在 `active` 翻不过去**。goal-round 载体给出成因：

```
goal-sufficiency  verified  sufficiency=not-evaluated（cause=judge-unavailable）（在域 AC 6 条）
```

I2 的 flip 条件是「全部在域 AC achieved **且** 充分性判定为 `covered`」（`goal-driver.ts`），
充分性停在 `not-evaluated` ⇒ 永不 flip。

**根因（定位到行）**：充分性判定是一次真 LLM spawn，生产路径是
`goal-driver.ts:775` `argv = launchArgv("fix-worker", prompt, root)`，
而 `driver-runtime.ts:639 launchArgv()` 会 `resolveRole(config, role)`，**解析不到角色就抛错**
（`role "..." resolves an empty launcher/name`）。goal-driver 的 catch 把它记成
`judge-unavailable`（注释原文：「launchArgv 失败（profiles 缺失）… ⛔ 不回落 covered」——
**fail-closed 是对的，问题在配置侧**）。

**模板缺的不止一个角色，是全部五个。** 统计生产代码实际请求的角色：

```
launchArgv("fix-worker"   21 处
launchArgv("task-worker"   9 处
launchArgv("pool-judge"    2 处
launchArgv("selector"      1 处
launchArgv("meta-driver"   1 处
```

而 `quay-init` 复制的模板 `plugin/.quay/profiles.yml`（`quay-init.sh:2550/2563` `write_template`）
只给出 `manager` / `outer` / `inner` 三个角色：

```
quay 自己的 roles     : fix-worker, manager, meta-driver, outer, pool-judge, selector, task-worker
quay-init 给第三方的  : manager, outer, inner
缺失                  : fix-worker, task-worker, pool-judge, selector, meta-driver（全部五个）
```

**两个已实证/可推定的后果**：
1. **GOAL 永不闭环**（已实证）——`fix-worker` 缺失 ⇒ 充分性 judge 不可用 ⇒ I2 不 flip。
   任何第三方项目的任何 GOAL 都闭不了环，无论 AC 做得多完整。
2. **worker 永远派不出**——`task-worker` 缺失 ⇒ worker-driver 派发时 `launchArgv` 抛错。
   这解释了为什么 quay-fleet 的执行层从头到尾空转（promotion pool=0、worker in_flight=0）。

**两个附带问题，一并修**：
- 模板里的 **`inner` 是已退役角色**（SPEC-tmux-retirement-2026-09-03：inner 由 worker-driver 取代），
  模板仍在发它 ⇒ 新项目一出生就带一个死角色。
- 模板里三个角色的 `name` **硬编码 `quay-` 前缀**（`quay-manager`/`quay-outer`/`quay-inner`）。
  第三方项目照抄后，其会话名与 quay 自己的会话**撞名** ⇒ SendMessage 按名寻址会误路由
  （本工作区已知：共用 worker 名导致误投）。

**已验证的修复形态**（我在 quay-fleet 上补齐五个角色后实测）：`launchArgv` 对
fix-worker/task-worker/pool-judge/selector/meta-driver/manager/outer **七个角色全部解析成功**。
角色定义本身极简，例如 `fix-worker: {profile: worker-default, name: <前缀>-fix-worker,
env: {CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: "0"}}`。

## Plan

1. `plugin/.quay/profiles.yml` 模板补齐五个角色（照 quay 自己的定义，`profile: worker-default`；
   `fix-worker`/`task-worker` 需带 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: "0"`——
   缺该键会导致 spawn 超时，见 `gap-fix-worker-spawn-timeout-persists-post-fix`）。
2. 删除已退役的 `inner` 角色。
3. `name` 不再硬编码 `quay-` 前缀：改为 quay-init 按目标项目名生成（或模板用占位符由 init 替换），
   使两个项目的会话名不相撞。
4. **加一条结构性静态检查防止再漂移**：模板声明的角色集合必须 ⊇
   生产代码中 `launchArgv("<role>"` 出现的角色集合。这条是本缺陷的根治——
   否则下次新增一个 driver 角色，模板又会静默落后。

## Acceptance Criteria

- [ ] AC1（负控制，改前必须红）：用当前模板 `quay-init` 一个全新临时 workspace，
      改前 `launchArgv("fix-worker","",<ws>)` 抛错；改后返回一个 argv 且 `-n` 后的名字非空。
      对 `task-worker` 同样断言。
- [ ] AC2（结构性，防漂移）：静态检查器比对「`plugin/.quay/profiles.yml` 的 roles 键集」与
      「`plugin/scripts/**` 中 `launchArgv("<role>"` 的角色名集合」，前者未覆盖后者即红。
      双向控制：从模板删一个角色必须红；给代码加一个新角色名而模板未跟进也必须红。
- [ ] AC3：模板不再含 `inner`（已退役角色），且该断言由 AC2 的同一检查器覆盖
      （代码从不请求 `inner` ⇒ 模板含它属于反向冗余，检查器应能报出）。
- [ ] AC4：两个不同项目各自 `quay-init` 后，其 profiles 的 `name` 值互不相同
      （断言不含硬编码的 `quay-` 字面前缀，或按项目名派生）。
- [ ] AC5：全量 `scripts/test.sh` 绿。

## Definition of Done

在一个**真实的第三方项目**上（非 fixture）：`goal-driver` 的 `goal-sufficiency` fact 的 reason
不再含 `judge-unavailable`，且 `worker-driver` 能真正启动一个 worker 进程（派发不再因
`launchArgv` 抛错而失败）。fixture 满足不算数（硬规则 4 推论三）。

## Touches

- plugin/.quay/profiles.yml
- plugin/scripts/quay-init.sh
- plugin/scripts/profiles-role-coverage-check.ts
- plugin/test/profiles-role-coverage-check.test.mjs
- tasks/gap-quay-init-profiles-template-omits-every-role-the-drivers-request.md

## 立案备注（quay-task 立案时追加，⛔ 非报告原文，⛔ 不改上文任何一字）

**① 查重结果（按机制，不按症状）**：机制「init 模板的角色集与生产代码请求的角色集不匹配 ⇒
`resolveRole` 抛错」**已有一条既有任务**：`gap-shipped-profiles-missing-worker-roles`（**status: done**，
goal_ac=AC-207，2026-09-09）。它的 Proposal 逐字描述同一条链：「roles 只有 manager/outer，缺 task-worker
（及 selector/fix-worker/pool-judge/meta-driver）；worker-driver 派发走 `launchArgv("task-worker", …)`
→ `profile-policy.ts:140` `resolveRole` 对缺失 role 抛 `role not found`」。它的 AC1/AC2 已勾，
**AC3（全量 suite 绿）仍未勾，标「待外部」**。
相关但不同的第二条：`gap-ac207-e2e-target-driver-driven-real-commit-task-done`（done）把同一缺陷
记为其「阻塞①」。**本条不是它们的重复**——见 ③。

**② ⚠️ 与当前源码的事实冲突（立案者当场读盘核实，⛔ 不是推测）**：上文 Proposal 断言
「`plugin/.quay/profiles.yml` 只给出 manager / outer / inner 三个角色」，而**本仓库当前该文件
（`/home/yale/work/quay/plugin/.quay/profiles.yml`，2026-09-13 读盘）实际声明七个角色**：
`manager`(:28) `outer`(:31) `task-worker`(:38) `selector`(:43) `fix-worker`(:46) `pool-judge`(:51)
`meta-driver`(:54)，**且不含 `inner`**；`task-worker`(:42) 与 `fix-worker`(:50) 均已带
`CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: "0"`。`quay-init.sh:2550/2563` 的 `write_template` 逐字复制
的就是这个文件（无内联第二份模板）。
⇒ **「模板缺五个角色」在当前源码上不复现**。quay-fleet 观测到的形态与**修复前**的模板一致，
最可能的成因是**该项目装的是 `gap-shipped-profiles-missing-worker-roles` 落地之前的安装物**
（同族先例：AC-207 第 10 轮的「缺陷 B——安装物陈旧」）。
**⊢ 执行者第一步必须做的对照**（硬规则 4b：别用代理量，读直接量）：在 quay-fleet 上读
**它自己安装物**里的 `plugin/.quay/profiles.yml` 与其安装 build_sha，与本仓库 develop tip 比对；
若确系陈旧安装物 ⇒ 本条的 AC1 之「改前必须红」在当前源码上**结构上不可满足**（会恒绿空转，硬规则 4c），
届时应把 AC1 改写为「对陈旧安装物复现 + 对当前源码为绿」的双向对照，⛔ 不要为了让它红而改坏模板。

**③ 本条仍然成立、且不被既有任务覆盖的部分（真正的新增价值）**：
- **AC2 的结构性检查器从不存在**——`task_list(search:"profiles-role-coverage")` 计数 **0**
  （零计数已按硬规则 2 校准：同形谓词对已知为真的串 `quay-init-closure-ratchet` 返回 61 条 ⇒ 谓词有效），
  且 `plugin/scripts/profiles-role-coverage-check.ts` 在盘上**不存在**（Read ⇒ File does not exist）。
  **这条正是既有任务只修了被报出来的那一个实例、没造防漂移产物的缺口**（硬规则 5b）。
- **AC4 的 `name` 硬编码 `quay-` 前缀确实仍在**（上述七个角色的 name 逐个为 `quay-*`），
  既有任务从未处理撞名问题。
- **AC3 的 `inner` 反向冗余**：当前模板已无 `inner`，该断言在本仓库上会直接绿；
  其价值在于由 AC2 的检查器**持续**钉住（⛔ 若只当一次性断言写死，就是一个恒真量，非测量——硬规则 4）。

**④ 未打 `delivery-critical`**（按要求）。**未设 `goal_ac`**——注意
`delivery-critical-without-goal-ac-never-promotes` 的反面：本条不带该标签，故无此结构性阻塞。
