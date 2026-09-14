---
id: gap-serve-stale-signal-has-no-consumer
title: serve 陈旧信号无消费者：/health 已报 stale:true 而 start-drivers 只探可达 ⇒ 生产实例跑 pre-fix
  代码、/dashboard 冷请求 14.59s 越过 AC-179 criterion 的 --max-time 10，verdict pass⇄fail
  振荡
status: ready
labels:
  - gap
  - defect
  - delivery-critical
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-179
---
## Finding

**结论**：AC-179 的 criterion 在最近 20 次复验里翻转 **6 次**——根因**不是 goal-card 消失**（卡片就在响应里），而是**跑着的生产 serve 在跑 pre-fix 代码**，冷请求付全额构建成本，越过 criterion 的 `--max-time 10`。而"serve 陈旧"这件事**早就可被检测、信号正在发、却没有任何决策点读它**。

### 一、检测机件存在且正在发信号（实测，本会话取）

```
$ curl -s --max-time 20 http://0.0.0.0:4173/health
{"ok":true,"stale":true,"evaluated":true,
 "processStartedAt":"2026-09-14T06:53:32.785Z",
 "latestCodeCommitAt":"2026-09-14T08:11:11.000Z","source":"git"}
```

该端点由 `gap-webui-server-stale-code-no-restart-detection`（done，2026-08-23，落地提交 `4e80c8da1`）交付：`packages/quay/src/serve.ts:229 computeStaleStatus`，且 `:245` 已 `console.warn`。**⇒ 信号这一半是好的、在工作；本任务不重做它。**

### 二、信号无消费者（本任务命名的机制）

<!-- dedup-ref -->
与 `gap-webui-server-stale-code-no-restart-detection`（done，造的是**检测器**）和 `gap-ac179-criterion-cold-miss-30s-ttl-always-expired`（done，修的是**冷路径代码**）相关，但机制不同：**本条命名的机制是"谁去读那个信号"**。两者都不是本条的前置，也都没有把本条的机制建起来。

- **唯一决定"要不要起 serve"的地方**是 `plugin/scripts/start-drivers.ts:16`——"probe `GET /` on `<host>:<port>` ⇒ reachable ⇒ skip"。它读的是**可达性**，**从不读 `/health` 的 `stale`**。
- 该决策是**纯函数且已导出**：`planActions`（同文件 `:245`）的签名 `{promotionAlive,workerAlive,outerAlive,goalAlive,serveListening}` **没有陈旧维** ⇒ `startServe: !serveListening`。**一个活着但陈旧的 serve 永远不会被重启。**
- 载体也不记代码身份：`.quay/server.json` 只有 `schemaVersion/pid/startedAt/services` ⇒ 事后无法从载体判定那次 serve 跑的是哪一版。

⇒ 在每一个决策点上，**"陈旧但可达"与"健康"同形**（硬规则 3b：读不懂的输入不得返回与合格同形的值）。

### 三、代价（本会话实测，非引用）

**a. 进程确实跑 pre-fix 代码（静态可核）**：serve PID 3373657 起于 `06:53:32Z`（`.quay/server.json` 的 `startedAt` 同值）；该时刻 `author` 的 tip 是 `62fbe4bb`（06:51:34Z），而
`git show 62fbe4bb:packages/quay/src/serve-dashboard.ts | grep -c DASHBOARD_SNAPSHOT_REFRESH_MS` = **0**（HEAD = 3）。
三个快照修复提交 `32661ab4e` / `607bbc96f` / `8525bac58` **都不是** `62fbe4bb` 的祖先；它们首次进入 `author` 是 `1c8854958` @ **09:35:54Z**——**比 serve 启动晚 2h42m**。⇒ 该进程结构上不可能带快照机制。

**b. 冷/热对照（同一实例，决定性）**：冷请求（>30s 静默后）**14.588600s**（curl exit 0，全量 82127 字节，byte 47583 处 `id="goal-card"`）；热请求 **2.439383s**。criterion 的 10s 帽**正好切在两者之间** ⇒ 每次复验的 pass/fail 由"是否恰好命中热缓存"决定。

**c. ledger 振荡**：`item_id=AC-179` 在 `.quay/gate-events.jsonl` 共 807 条、历史翻转 62 次；**最近 20 次里 6 次翻转**——09-13T09:00 至 09-14T03:14 **连续 13 次 pass**，09-14T04:49 起 **fail/pass 交替**。最新一条 `2026-09-14T09:34:26.290Z verdict=fail`，reason 明写 `last candidate addr=0.0.0.0:4173`（即 curl 确实跑了、10s 帽内没拿到 goal-card）。

### 四、为什么前几次修复没有保住（复发计数 = 2）

- **2026-08-23**（`gap-webui-server-stale-code-no-restart-detection`）：serve 陈旧 8.5h、11 条 UI 任务不可见，**由人发现**；止血动作是 outer **手工重启** server。该任务交付了**检测器**（其 Plan 选项 1），Plan 选项 2（supervisor 自动重启）**未建**。
- **2026-09-14**（本条）：陈旧 3h+、AC-179 振荡 6/20，**同样没有任何东西会重启它**。

⇒ **两次同一形态：信号要么不存在（08-23 之前）、要么存在但无消费者（08-23 之后）；两次的止血都是人工重启。** 这正是硬规则 3b 的形态——一个"可达"的读数把"陈旧"记成了"健康"，且**退出码 0、结构完整、数字合理**。

另：`gap-ac179-criterion-cold-miss-30s-ttl-always-expired`（done）的 DoD 第 1 条**至今未勾**、标注 `（待外部）`——"判据在运行中的生产 serve 实例上实跑（**须重启该实例以加载新代码**）"。**代码修好了，跑着的那个进程没换。**（硬规则 4 推论三：实现了、测试绿了、生产没跑过 ⇒ 与没实现同形。）

### 五、本任务的口径

让 criterion **重新为真**，需要**换掉那个进程**；让它**不再第三次复发**，需要**让陈旧在决策点上可区分**。两件都做——且二者在同一点收敛：`start-drivers` 一旦消费陈旧信号，"重载陈旧 serve"就由机械动作完成，不再是人工止血。

⛔ **不改 criterion 的任何字节**：它读"运行中的服务"而非源码是**有意设计**（`goals/AC-179-web-card-and-cli.md` 的 origin 明写依据硬规则 4 推论三），前序任务已立此约束。

## AC

- [ ] **AC1（判据原样、冷窗连跑）**：`goals/AC-179-web-card-and-cli.md` 的 criterion **逐字未改**，在**重启后**的生产 serve 实例上连跑 **≥5 轮**、每轮之前 ≥30s 无任何请求（确保每轮都是冷未命中）⇒ **5/5 退出码 0**。证据：5 条读数（时刻 + 墙钟 + 退出码 + 该轮 `/health` 的 `stale`）。
- [ ] **AC2（ledger tail 翻 pass，且晚于重启）**：`.quay/gate-events.jsonl` 中 `item_id=AC-179` 的**最新一条** `verdict` 为 `"pass"`，且其 `timestamp` **晚于本次重启时刻**（⛔ 不得拿重启前的旧 pass 顶替——那是硬规则 4 的"回声"）。证据：该行原始 JSONL + 本次重启时刻。
- [ ] **AC3（决策点必须区分陈旧，不再与"健康"同形）**：`start-drivers` 在 serve **陈旧但可达**时**不再 skip**——陈旧维进入 `planActions`（或等价判定），使 `stale:true` ⇒ `startServe: true`（幂等启动面据此重载），`stale:false` ∧ 可达 ⇒ 仍 skip。证据：`plugin/test/start-drivers.test.mjs` **双向**用例绿，两向读数都贴出。
- [ ] **AC4（AC3 的镜像半边，硬规则 3b）**：`/health` **取不到 / 解析不了 / 无该字段**时判为 **NOT-EVALUATED**（独立取值），**不得**与"新鲜"共用输出、也不得静默当作"陈旧"去重启。证据：该分支的测试 + 输出字面量。

## DoD

- [ ] 生产 serve 已重启到当前代码：贴重启前后 `pid` / `startedAt` 对照，与重启后 `/health` 的原始 JSON（`processStartedAt` 应晚于 `latestCodeCommitAt`）。
- [ ] AC-179 的 criterion / expect **零字节改动**：`git diff -- goals/AC-179-web-card-and-cli.md` 为空，且 `md5sum` 仍为 `59c88b885b09753adbb368f51e9065c0`。
- [ ] ⛔ 不以调大 `--max-time`、也不以加长任何 TTL 收口——10s 帽是 AC 的一部分；⛔ 不以「加了缓存所以没问题」收口。
- [ ] 写清为什么前几次没保住：08-23 只造了检测器（信号无消费者）、09-14 只修了代码（跑着的进程没换），**两次的止血都是人工重启**。
- [ ] 若 5 轮冷请求中仍有 ≥1 轮越过 10s，须给出逐轮读数与根因，⛔ 不得以"差不多"收口。

## Touches

- plugin/scripts/start-drivers.ts
- plugin/test/start-drivers.test.mjs
- packages/quay/plugin/scripts/start-drivers.ts（mirror，与上者逐字相同）
- packages/quay/plugin/test/start-drivers.test.mjs（mirror）
- packages/quay/src/serve.ts（`computeStaleStatus` / `SERVE_CODE_PATHS` 的导出面）
- tasks/gap-serve-stale-signal-has-no-consumer.md（自身）
