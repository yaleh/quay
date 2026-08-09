---
id: gap-loop-driver-check-ac3-layer2-cron-observability
title: "loop-driver-check AC3 LAYER 2: 'registry has a row but the driver is
  dead' must not report LIVE — layer-1 (self-declared registry) structurally
  cannot distinguish real drivers from stale rows (registry is self-declared,
  cron is session-internal, bash checker can't see session cron list); layer-2 =
  swap to an OBSERVABLE source (CronList output / session-internal task list)
  whose precondition is UNANSWERED: 'can a bash checker see session-internal
  cron?' — not guessed before answered; carried from gap-the-loop-driver-check
  (done, AC3 explicitly recorded unsolved per its own DoD)"
status: ready
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---
**type:** execution

## Proposal

**loop-driver-check AC3 第二层：把「注册表一行、驱动已死」的判据换成可观测来源。**

**【来自亲代（gap-the-loop-driver-check，done，AC3 显式未解决）】**：第一层（文档补注册 + gitignore +
STALLED 措辞）**在结构上分辨不了「注册表有一行、但那个驱动早已不存在」**：

1. **注册表是自述的**——`loop-driver-check.sh` 只数 `.quay/loop-driver.jsonl` 的行，不观测任何
   真实驱动；
2. **cron 是会话内的**（tick 文档自己写着「会话一结束就没了」），bash 检查器**看不到**会话内的
   cron 列表；
3. 已实证的观测路径（dead-loop-check 的 transcript 时间窗）属于 L2 持续健康判据，接进来是**换判据**，
   正是第二层要做、第一层不许顺手猜的事。

**第二层范围**：判据换成**可观测来源**（CronList 输出 / 会话内任务列表），让「一行注册但驱动已死」
能被机械判定。**前置问题未答——不猜实现**：bash 检查器能否看到会话内的 cron？

### 选定机制

1. **回答前置问题**：bash/脚本能否观测到会话内 cron（CronList 的会话可见性）——实测确定
2. 若能：把判据换成 CronList/会话任务列表的可观测来源，陈旧注册不再报 LIVE
3. 更新 `plugin/test/loop-driver-check.test.mjs` 的层 1 pin 测试（亲代明示：未来第二层改动须同步更新）

## Acceptance Criteria

- [x] AC1: 前置问题回答——bash 检查器能否看到会话内 cron（实测，贴证据）——**不能**：cron 列表是会话
      进程内的（CronCreate/CronList MCP 工具状态），磁盘上无 cron 配置；唯一磁盘痕迹是会话 transcript 的
      历史 CronCreate 记录（死会话的 transcript 仍躺一份，grep 会把「曾经建过」误读成「现在活着」）。
      bash 能看的是驱动每次 tick 写的**可观测 last-alive 证据**（tick-log.md / git HEAD / verification-round
      / docs/analysis 的 mtime）。实测证据见「实跑证据」第 1 节。
- [x] AC2: 判据换成可观测来源——「注册表一行、驱动已死」不再报 LIVE（实测构造）——`loop-driver-check.sh`
      现以「注册表恰一行 cron **且** 可观测 last-alive 证据新鲜（或刚安装）」判 LIVE；构造「注册表一行 +
      注册表 mtime 2 天前 + 无可观测活动」⇒ 报 **DEAD**（exit 6），`grep -c 'LIVE\|STALLED'` = 0。
      实测证据见「实跑证据」第 2 节。
- [x] AC3: 与 gap-the-loop-driver-check（done）交叉标注——本任务承载其 AC3（## Carries）——见文末
      「## Carries」。
- [x] AC4: loop-driver-check.test.mjs 层 1 pin 测试同步更新（亲代要求）——层 1 的 AC3 pin（「层 1 分辨不了
      陈旧」）改为层 2 判据（陈旧 ⇒ DEAD + `stale_registry_exit=0` + 活驱动仍 LIVE + invoke 契约），
      单跑 12/12 绿（`node --test plugin/test/loop-driver-check.test.mjs`），scoped 门通过。

## Touches

- plugin/scripts/loop-driver-check.sh（判据换成可观测来源）
- plugin/test/loop-driver-check.test.mjs（层 1 pin 测试更新）
- tasks/gap-the-loop-driver-check-reads-a-self-declared-registry-nobody-writes.md（AC3 交叉标注）

## Contract

measure   stale_registry_exit = `bash plugin/scripts/loop-driver-check.sh --check 2>&1 | grep -c 'LIVE\|STALLED'` stdout 数字段（构造「注册表一行、驱动已死」形态）
band      stale_registry_exit = 0（陈旧注册不再报 LIVE；判据基于可观测来源）
invoke    `grep -n 'CronList\|会话内\|可观测\|cron' plugin/scripts/loop-driver-check.sh`
control   构造陈旧注册 ⇒ 不报 LIVE（AC2）；层 1 pin 测试更新（AC4）
resume    前置问题与判据更换分步提交，任一步完成即写盘

## Dispatch review

reviewer: outer
at: 2026-08-06T06:4xZ
changed: 红窗分诊（AC-carryover ratchet：loop-driver AC3 未勾无 successor）立案——创建第二层任务承载
AC3。亲代（done）AC3 显式记录「第一层未解决、转入第二层」，本任务是该第二层。前置问题（bash 能否看
会话内 cron）未答前不猜实现。

## 带时间戳实例（2026-08-06T09:1xZ，管理者实测，贴为证据）

**AC3 第一层失效的具体实例（带时间戳）**：

`.quay/loop-driver.jsonl` 当前唯一一行：
```json
{"mechanism":"cron","interval":"*/20 * * * *","source":"outer-cold-start-2026-08-04T02:45Z"}
```
- **mtime 2026-08-04 02:40**——距今 2 天 6 小时（管理者实测）。
- 08-05 当天发生四次全灭 + 多次会话重建；**CronCreate 是会话作用域**，那个 08-04 的会话早就不存在。
- **但 `loop-driver-check.sh` 此刻仍报 `loop-driver: LIVE (1) — exactly one loop driver (cron */20)`**。

**结论**：注册表是自述的（只数 `.quay/loop-driver.jsonl` 的行），不观测任何真实驱动；注册表 2 天没更新、
其描述的 cron 已随会话死亡，检查照样报 LIVE。**这正是 AC3 标题「陈旧注册表不得报 LIVE」的具体形态**。

**判别克制（管理者）**：不用「outer tick 提交间隔 08:04 与 08:45 差 40 分钟」反推 cron 没在 */20 触发——
轻触 tick 不一定产生提交，那个推论不成立。本证据只基于注册表时间戳 + 检查输出。

## Carries

from: gap-the-loop-driver-check-reads-a-self-declared-registry-nobody-writes
acs: AC3
note: 亲代（done）AC3 显式未解决并转入本第二层（其「## AC3 处置（第一层未解决）」段）。
      本任务承载该 AC3 并已解决：LIVE 判据从「注册表行数」换成「可观测 last-alive 证据」，
      构造「注册表一行、驱动已死」⇒ 报 DEAD（exit 6），不再报 LIVE。亲代任务体已加
      交叉标注（见 `tasks/gap-the-loop-driver-check-reads-a-self-declared-registry-nobody-writes.md`
      的「## Carries / ## AC3 处置」段）。

## 实跑证据（2026-08-08 执行）

### 1. AC1 前置问题实测——bash 检查器能看到会话内 cron 吗？

**不能。** 实测证据：

```text
$ find ~/.claude -name '*cron*' -o -name '*schedule*'   # 磁盘上有 cron 配置吗？
（无 cron/schedule 配置文件——命中的只有仓库里的 scheduler 脚本，不是会话 cron 状态）

$ grep -l 'CronCreate' ~/.claude/projects/-home-yale-work-quay/*.jsonl | wc -l
38        # 38 个会话 transcript 里留有历史 CronCreate 记录——全是过去式工具调用日志

$ ls -la ~/.claude/projects/-home-yale-work-quay/0e28a885-5bbd-4399-9d08-c67b6fce7ed4.jsonl
（08-04 死会话的 transcript 还在磁盘上——grep 它照样能找到 CronCreate，但那个 cron 早已随会话消失）
```

**结论**：CronCreate/CronList 的输出住在**会话进程内**（MCP 工具状态），bash 无法调用 MCP 工具，
故**看不到会话内 cron 列表**。磁盘上唯一的 cron 痕迹是 transcript 历史日志——它是过去式、死会话的
还在，grep 它会得到「曾经建过」的假阳性，正是本检查要避免的。

**bash 能看什么**：驱动每次 tick 会写的**可观测 last-alive 证据**（session-liveness.sh 的外层多源
心跳同族）：

```text
$ stat -c '%y' orchestration/tick-log.md .quay/verification-round.jsonl
orchestration/tick-log.md       2026-08-08 11:35:57  # 外层每 tick 写
.quay/verification-round.jsonl  2026-08-08 10:29:40  # 外层异步轮次写
$ git log -1 --format='%ci'                            # HEAD 提交时间 = 产出
2026-08-08 11:35:44 +0000
$ stat -c '%y' .quay/loop-driver.jsonl                 # 自述注册表（2 天前写的）
2026-08-06 16:20:28 +0000
```

**⇒ 判据换成可观测来源**：LIVE = 注册表恰一行 cron **且** 可观测 last-alive 证据新鲜（或刚安装等待首
tick）；陈旧注册（注册表旧 + 无可观测活动）⇒ DEAD。

### 2. AC2 判据换成可观测来源——实测构造「注册表一行、驱动已死」

```text
$ TMP=$(mktemp -d); mkdir -p "$TMP/.quay"
$ printf '%s\n' '{"mechanism":"cron","interval":"*/20 * * * *","source":"outer-cold-start-2026-08-04T02:45Z"}' > "$TMP/.quay/loop-driver.jsonl"
$ touch -d "2026-08-04 02:40" "$TMP/.quay/loop-driver.jsonl"   # 注册表 2 天前写的，无任何可观测活动
$ bash plugin/scripts/loop-driver-check.sh --check "$TMP" 2>&1; echo "exit=$?"
loop-driver: DEAD (1) — registered cron has no fresh observable activity (last observable activity 6299min old, window 60min); the driver died with its session
exit=6
$ bash plugin/scripts/loop-driver-check.sh --check "$TMP" 2>&1 | grep -c 'LIVE\|STALLED'
0        # Contract measure stale_registry_exit = 0 ✓
```

正控制（活驱动必须仍报 LIVE）：

```text
$ bash plugin/scripts/loop-driver-check.sh --check <当前仓>   # 注册表 2 天前但可观测活动新鲜
loop-driver: LIVE (1) — exactly one loop driver (cron */20 * * * *); observable activity 1min old (window 60min)
exit=0
```

负控制（照文档冷启动 / 双触发 / 零驱动全部不回归）：

```text
$ bash plugin/scripts/loop-driver-check.sh --check <干净仓照文档写注册表>   # 刚安装，首 tick 未到
loop-driver: LIVE (1) — exactly one loop driver (cron */20 * * * *); observable activity 0min old (window 60min)
exit=0
$ bash plugin/scripts/loop-driver-check.sh <两行注册表仓>
loop-driver: DOUBLE-TRIGGER (2) — 2 loop drivers registered; a literal reader double-installed
exit=4
$ bash plugin/scripts/loop-driver-check.sh <零驱动仓>
loop-driver: STALLED (0) — no loop driver registered; the loop will never tick
exit=3
```

### 3. invoke——判据来源在脚本里可见（Contract invoke）

```text
$ grep -n 'CronList\|会话内\|可观测\|cron' plugin/scripts/loop-driver-check.sh
（命中：脚本头部第二层注释明确写着 CronList 住在会话进程里、bash 看不到会话内 cron 列表、
    判据换成可观测 last-alive 证据、窗口 LOOP_DRIVER_LIVENESS_MIN；正文 DEAD/LIVE/BANNED-MECHANISM 分支）
```

### 4. AC4——层 1 pin 测试同步更新 + scoped 门

`plugin/test/loop-driver-check.test.mjs` 单跑 12/12 绿（`node --test`）。新增/更新的测试：AC3 陈旧 ⇒
DEAD + `stale_registry_exit=0`（位置参数与 `--check` 一致）、invoke 契约、活驱动仍 LIVE、冷启动宽限仍
LIVE、层 1 文档级 `rm -f` 处置保留。

scoped 门（执行者实跑）：

```text
$ bash scripts/test.sh --for-task gap-loop-driver-check-ac3-layer2-cron-observability
... scoped static checks: task-contract-check no violations; adr016 PASS; dead-code-after-return PASS ...
✔ AC3 (layer-2) — a registry line whose driver died reports DEAD (exit 6); the Contract measure stale_registry_exit = 0
✔ invoke — the criterion source (CronList / 会话内 / 可观测 / cron) is visible in the script
✔ AC2 (layer-2) — a genuinely-alive driver (registry line + fresh observable activity) reports LIVE (exit 0)
✔ AC2 (layer-2) — a freshly-installed driver (registry just written, first tick not yet fired) still reports LIVE (cold-start grace)
ℹ tests 12
ℹ pass 12
ℹ fail 0
ℹ cancelled 0
EXIT=0
```

另跑 `quay-init-loop-driver.test.mjs` 的驱动行为测试（laid-down 端到端，5/5 绿）：零驱动 STALLED、恰一个
cron 驱动 LIVE（端到端：一个触发源）、第二个驱动 DOUBLE-TRIGGER、删除唯一驱动 STALLED、被废弃机制
BANNED-MECHANISM——新判据未破坏任何既有驱动行为。

### 5. 已知后续（文档漂移，超出本任务 Touches，不在此改）

判据换成可观测来源后，两处文档措辞已不再准确（本任务 Touches 不含它们，留作后续任务）：

- `plugin/loop/orchestrator-loop-tick.md` 步骤 4 的「注意：陈旧注册报的是 LIVE，不是 STALLED。……
  这是自述注册表的结构性极限（判据换成可观测来源是第二层的事）」——第二层已实现，陈旧注册现在报
  **DEAD**（exit 6），该句应更新。
- `plugin/skills/cold-start/SKILL.md` 步骤 5 的 pre-check 退出码分支（exit 0 ⇒ STOP / exit 3 ⇒ 建 cron）
  未覆盖新退出码 6（DEAD）；其后的「stale registration … clear the stale registry」措辞仍以「pre-check
  报 LIVE」为前提。DEAD 分支应显式指示先 `rm -f <root>/.quay/loop-driver.jsonl` 再建 cron。
