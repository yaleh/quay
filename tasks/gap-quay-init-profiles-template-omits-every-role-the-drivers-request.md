---
id: gap-quay-init-profiles-template-omits-every-role-the-drivers-request
title: quay-init 的 profiles 落地走内联陈旧模板，shipped 模板被 skip —— 第三方项目缺全部五个 worker role
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

**术语澄清（先读这段，否则下面的清单会被误读）**：本任务说的 `fix-worker` / `task-worker` /
`pool-judge` / `selector` / `meta-driver` 是 **`.quay/profiles.yml` 里的 role 名**——
`launchArgv(role, prompt, root)` 用它经 `resolveRole()` 解析出 launcher / model / 会话名 (`-n`)。
**它们不是 driver。** quay 的 driver 是 **promotion-driver / worker-driver / outer-driver / goal-driver**
（`DRIVER_KINDS`），是常驻进程；role 是那些 driver **spawn 子会话时用的配置条目**。

⚠️ 尤其注意 **`meta-driver` 既是一个 driver 名、又是一个 role 名**，两者不是一回事：
`plugin/scripts/meta-driver.ts` 是 driver，它内部调 `launchArgv("meta-driver", ...)` 取的是 role。

对应关系（实测自 `grep -rn 'launchArgv("' plugin/scripts/*.ts`）：

```
driver（常驻进程）              它请求的 role（profiles.yml 条目）
goal-driver.ts            ->  fix-worker        12 处
worker-driver.ts          ->  task-worker        9 处
quality-gate-driver.ts    ->  fix-worker 6 处 / pool-judge 2 处
promotion-driver.ts       ->  fix-worker         3 处
meta-driver.ts            ->  meta-driver        1 处
driver-runtime.ts         ->  selector           1 处
```

**现象（实测）**：第三方项目 quay-fleet 的 GOAL-001 六条 AC 全部 achieved、`goal-ring` 已 verified，
**但 GOAL 始终停在 `active` 翻不过去**。goal-round 载体给出成因：

```
goal-sufficiency  verified  sufficiency=not-evaluated（cause=judge-unavailable）（在域 AC 6 条）
```

I2 的 flip 条件是「全部在域 AC achieved **且** 充分性判定为 `covered`」（`goal-driver.ts`），
充分性停在 `not-evaluated` ⇒ 永不 flip。

**近因（定位到行）**：充分性判定是一次真 LLM spawn，生产路径是
`goal-driver.ts:775` `argv = launchArgv("fix-worker", prompt, root)`，
而 `driver-runtime.ts:639 launchArgv()` 会 `resolveRole(config, role)`，**解析不到角色就抛错**
（`role "..." resolves an empty launcher/name`）。goal-driver 的 catch 把它记成
`judge-unavailable`（注释原文：「launchArgv 失败（profiles 缺失）… ⛔ 不回落 covered」——
**fail-closed 是对的，问题在配置侧**）。

### 根因：两份模板，先写的那份赢，修好的那份被 skip（2026-09-13 干净对照实验查实）

**⛔ 不是「陈旧安装物」**——决定性实验用**当前主检出**在一个全新空目录 + 全新 git repo 上跑：

```
bash plugin/scripts/quay-init.sh --root <tmp> --plugin-root /home/yale/work/quay/plugin ...
  init says: Created <tmp>/.quay/profiles.yml
  init says:   skipped (exists): <tmp>/.quay/profiles.yml
结果： roles = ['inner', 'manager', 'outer']
       header = "# .quay/profiles.yml — Claude Code profile 承载（quay init 默认模板，AC154 profile 抽层）。"
```

（先单独验证过 `--dry-run` 无副作用——空目录跑完仍无该文件 ⇒ 排除「dry-run 先写脏」这个竞争解释。）

**仓库里存在两份 profiles 模板，头注释就能区分它们**：

```
① packages/quay/src/init.ts:374  内联模板（generateProfilesContent()，:372 起）
   头注释 "…（quay init 默认模板，AC154 profile 抽层）"
   → roles: manager(:399) / outer(:402) / inner(:405)   ⇒ 含已退役的 inner，五个 worker role 一个都没有
   函数自己的 doc 注释 :369 仍写着 "3 roles"
   最近改动 51595c008（2026-09-11）

② plugin/.quay/profiles.yml      头注释 "…shipped fallback profile carrier"
   → roles 七个齐全（manager/outer/task-worker/selector/fix-worker/pool-judge/meta-driver），
     且 task-worker(:42) 与 fix-worker(:50) 已带 CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: "0"
   最近改动 3524b3a3f（2026-09-09）← 正是 gap-shipped-profiles-missing-worker-roles 那次修复
```

**执行顺序决定了结果**：init 路径**先用 ① 创建**该文件，随后 `write_template ②`
（`quay-init.sh:2550/2563`）看到文件已存在 ⇒ 打印 `skipped (exists)` ⇒ **② 从未落地**。

⇒ **`gap-shipped-profiles-missing-worker-roles`（done）修的是一份在 init 路径上不被使用的文件。**
它的 AC 大概率是对着 ② 验的，所以当时绿；而真实新项目拿到的一直是 ①。
**⊢ 本任务最重要的一条推论：光把五个 role 补进 ② 无效——那正是上一条任务已经做过、且已经被证明无效的事。**
（同形教训本工作区已有：修了一个副本、生产用的是另一个。）

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

**已验证的修复形态**（在 quay-fleet 上补齐五个角色后实测）：`launchArgv` 对
fix-worker/task-worker/pool-judge/selector/meta-driver/manager/outer **七个角色全部解析成功**。
角色定义本身极简，例如 `fix-worker: {profile: worker-default, name: <前缀>-fix-worker,
env: {CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: "0"}}`。

## Plan

⛔ **原 Plan 的 1/2（「把五个 role 补进 `plugin/.quay/profiles.yml` / 从中删 inner」）作废**——
那份文件在 init 路径上不被使用，补它等于重做一遍已被证明无效的修复。

1. **消除双模板**：`packages/quay/src/init.ts` 的内联模板（`generateProfilesContent()`）与
   `plugin/.quay/profiles.yml` 必须收敛为**单一真相源**。推荐：init.ts 不再内联，改为读 shipped 文件；
   若因打包约束必须内联，则加一条**构建期/测试期的逐字节一致断言**（⛔ 不接受「人工保持同步」）。
2. **修正 skip 语义**：`write_template` 对一个**本次 init 自己刚创建的**文件报 `skipped (exists)` 是错的
   ——必须区分「用户已有的文件，尊重不覆盖」与「本次运行自己刚写的中间产物」
   （⛔ 两者共用一个取值，正是本缺陷得以静默存活的原因；硬规则 3b）。
3. `name` 不再硬编码 `quay-` 前缀：改为 quay-init 按目标项目名生成（或模板用占位符由 init 替换），
   使两个项目的会话名不相撞。
4. **加一条结构性静态检查防止再漂移（保留且更重要）**：模板声明的 profile role 集合必须 ⊇
   driver 通过 `launchArgv` 请求的 **profile role** 集合。
   **⚠️ 该检查器必须对【init 实际产出的文件】做断言，⛔ 不得对 `plugin/.quay/profiles.yml` 做断言**
   ——否则下次又会出现「检查器盯着一份没人用的文件，全绿」（这正是本缺陷的成因形态）。

## Acceptance Criteria

- [ ] AC1（负控制，对 **init 的实际产出**，改前必须红）：在一个干净临时目录跑一次**真** `quay-init`，
      **改前**：产出的 `.quay/profiles.yml` 的 roles 集 == `{manager, outer, inner}`，且
      `launchArgv("fix-worker", "", <tmp>)` 抛错；
      **改后**：roles ⊇ `{fix-worker, task-worker, pool-judge, selector, meta-driver}`，
      且该调用不抛、返回 argv 中 `-n` 后的名字非空。对 `task-worker` 同样断言。
      （⚠️ 该形态已于 2026-09-13 用当前主检出实测为**红**，⛔ 不是恒绿空转。）
- [ ] AC2（结构性，防漂移）：静态检查器比对「**一次真 init 产出的** `.quay/profiles.yml` 的 roles 键集」
      与「driver 通过 `launchArgv` 请求的 **profile role** 名集合」（即 `plugin/scripts/**` 中
      `launchArgv("<role>"` 的 role 名集合），前者未覆盖后者即红。
      **⛔ 断言对象是 init 产出，不是 `plugin/.quay/profiles.yml`。**
      双向控制：从模板删一个 profile role 必须红；给代码加一个新 profile role 名而模板未跟进也必须红。
      **第三个控制（针对本缺陷的成因）**：把两份模板改成不一致 ⇒ 必须红
      （检查器不得只看其中一份而给出绿）。
- [ ] AC3（对 **init 产出**断言）：一次真 init 产出的 `.quay/profiles.yml` 不再含 `inner`
      （已退役的 profile role），且该断言由 AC2 的同一检查器覆盖
      （没有任何 driver 通过 `launchArgv` 请求 `inner` ⇒ 产出含它属于反向冗余，检查器应能报出）。
      （⚠️ 当前 ① 里仍有 `inner`（`init.ts:405`）⇒ 这条现在也是**红**的，有意义。）
- [ ] AC4：两个不同项目各自 `quay-init` 后，其 profiles 的 `name` 值互不相同
      （断言不含硬编码的 `quay-` 字面前缀，或按项目名派生）。
- [ ] AC5：全量 `scripts/test.sh` 绿。

## Definition of Done

在一个**真实的第三方项目**上（非 fixture）：`goal-driver` 的 `goal-sufficiency` fact 的 reason
不再含 `judge-unavailable`，且 `worker-driver` 能真正启动一个 worker 进程（派发不再因
`launchArgv` 抛错而失败）。fixture 满足不算数（硬规则 4 推论三）。

## Touches

- packages/quay/src/init.ts
- plugin/.quay/profiles.yml
- plugin/scripts/quay-init.sh
- plugin/scripts/profiles-role-coverage-check.ts
- plugin/test/profiles-role-coverage-check.test.mjs
- tasks/gap-quay-init-profiles-template-omits-every-role-the-drivers-request.md

## 立案备注（quay-task 立案/改写时追加，⛔ 非报告原文）

**① 查重结果（按机制，不按症状）**：机制「init 产出的 profile role 集与 driver 经 `launchArgv`
请求的集合不匹配 ⇒ `resolveRole` 抛错」**已有一条既有任务**：
`gap-shipped-profiles-missing-worker-roles`（**status: done**，goal_ac=AC-207，2026-09-09）。
**但根因查实后，本条与它的关系变了**：它不是「同一缺陷的重复立案」，而是
**它那次修复打在了一份 init 路径上不被使用的文件上**（见 Proposal 根因段）⇒
本条要修的是**它没碰到的那一份 ①，以及让这种「修错副本还全绿」得以发生的机制**（Plan 1/2/4）。
相关但不同的第二条：`gap-ac207-e2e-target-driver-driven-real-commit-task-done`（done）把同一缺陷
记为其「阻塞①」，其解除记录写的也是「② 已落 develop」——**同样是对着不被使用的那份文件确认的**。

**② ⚠️ 我（立案者）在第一版备注里给出的「陈旧安装物」推测已被证否，照实记账。**
第一版我读盘发现 ② 有七个 role、且不含 `inner`，据此推测 quay-fleet 装的是修复前的安装物。
**那是一个能【解释】现象的说法，不是一个被【检验】的结论**（硬规则 4 推论四）。
推翻它的是协调方做的一个**能区分的对照**：用**当前主检出**在干净空目录跑真 init ⇒ 产出仍是
`{inner, manager, outer}` ⇒ **与安装物新旧无关**。若我的推测为真，这个实验应当产出七个 role。
⇒ 真因是**双模板 + `skipped (exists)`**。
**⊢ 本条 Proposal 的根因段与 Plan/AC 已按该实验整体改写；⛔ 不要再按「去查 quay-fleet 安装物 build_sha」行动。**

**③ 根因已由立案者独立按位置复核（⛔ 不是采信转述）**：`packages/quay/src/init.ts`
`generateProfilesContent()`（:372）返回的数组中，`roles:`(:398) 下**只有**
`manager`(:399) / `outer`(:402) / `inner`(:405) 三个键，header 行 :374 与实验输出逐字一致；
该函数自己的 doc 注释 :369 仍写着「3 roles」——**注释与缺陷同时存在，说明这不是回归，是从未跟进**。

**④ 本条的新增价值（不被既有任务覆盖）**：
- **AC2 的防漂移检查器从不存在**——`task_list(search:"profiles-role-coverage")` 计数 **0**
  （零计数已按硬规则 2 校准：同形谓词对已知为真的串 `quay-init-closure-ratchet` 返回 61 条 ⇒ 谓词有效），
  且 `plugin/scripts/profiles-role-coverage-check.ts` 在盘上**不存在**（Read ⇒ File does not exist）。
- **它必须盯 init 产出**：一个盯着 ② 的检查器今天就会全绿，而生产照样坏——
  **那正是「一个恒绿的检查比没有检查更贵」的实例**（硬规则 3b）。
- **AC4 的 `quay-` 前缀撞名**既有任务从未处理；**AC1/AC3 在当前源码上均为红**，⛔ 非空转。

**⑤ 未打 `delivery-critical`**（按要求）。**未设 `goal_ac`**——注意
`delivery-critical-without-goal-ac-never-promotes` 的反面：本条不带该标签，故无此结构性阻塞。

**⑥ 改写授权与范围**：Proposal 术语澄清段、根因段改写、Plan 1/2 作废与重写、AC1/AC2/AC3 改写、
Touches 增补 `packages/quay/src/init.ts`、**标题改写**，均由协调方 2026-09-13 逐条授权。
⛔ 未改动：现象段、两个后果的实证、`quay-` 撞名、AC4/AC5、DoD。
**状态说明**：本任务建时为 `todo`（按要求），随后由生产 promotion-driver 自行晋升为 `ready`
（第二次写曾因此撞 CAS 冲突、被拒且盘上零改动，读回确认后才改用 `expectedStatus: ready` 重发）。

**⑦ 观察项（⛔ 非阻塞、⛔ 非本任务 AC；协调方 2026-09-13 裁定）**：
`gap-shipped-profiles-missing-worker-roles`（done，goal_ac=AC-207）的验收是对着
`plugin/.quay/profiles.yml`（② 号、init 路径不使用的那份）做的。
**AC-207 自己的 criterion 读 `.quay/productization-verification.jsonl`，不碰 profiles，
因此 I5（achieved-but-failing）复跑不会自动证否它**——criterion 查的是别的对象，
「让机制自己发现」这条路在这里不通。
这意味着 AC-207 的**前置阻塞解除判定用的是错对象**，**但不等于 AC-207 的结论为假**
——它当时在 archguard / ad-arm1 上真跑过，那里的 profiles 来源未查（也不该在本任务里查）。
**⇒ 本任务落地后**，若第三方项目的 e2e 派发能力发生实质变化，才值得回头复核 AC-207；
在此之前**不动它**（硬规则 12：给不出「AC-207 结论为假」的发生率 ⇒ 前置降为观察项，不作阻塞）。
⛔ 执行者不得因本段去修改 AC-207 或那两条 done 任务。
