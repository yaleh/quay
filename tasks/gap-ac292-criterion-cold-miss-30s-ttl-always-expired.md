---
id: gap-ac292-criterion-cold-miss-30s-ttl-always-expired
title: AC-292 复验间歇假红：/board 请求路径现付 30s-TTL 冷构建（实测冷 9.3–16.6s / 热 2.9s），越过判据 curl
  --max-time 10 —— 与 AC-179 同一病灶，修法照搬（后台构建 → 请求路径只读快照）
status: done
labels:
  - gap
  - webui
  - performance
  - defect
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-292
---
**type:** execution

## Proposal

**判据在活服务上间歇假红（实测，非推断）** —— 台账尾部（`.quay/gate-events.jsonl`，`item_id=AC-292`，`gate=goal`）：

```
2026-09-17T23:46:21.928Z goal pass  acceptance passed (exit 0)
2026-09-18T00:02:24.255Z goal pass  acceptance passed (exit 0)
2026-09-18T03:14:38.280Z goal pass  acceptance passed (exit 0)
2026-09-18T06:27:26.999Z goal fail  CAUSE=en-fetch-failed -- GET http://127.0.0.1:4173/board returned nothing (addr=127.0.0.1:4173)
2026-09-18T06:30:02.030Z goal fail  同上
2026-09-18T06:32:30.682Z goal fail  同上（立案当轮直接复跑）
2026-09-18T06:33:03.156Z goal pass  acceptance passed (exit 0)   ← 61 秒后同一命令转绿
```

⇒ **不是 zh 接线失效，是间歇性**。转绿那一次三段断言全过（`<html lang="zh"`、nav 区块内无字面量 `Board`、`<title>` 与 en 逐字不同）
⇒ **接线在位，红的是「活服务在判据预算内响应」这个前提**。

**根因（直接量）**：`/board` 的请求路径**现付**「落地源」冷构建。

- `readBoardLanding`（`packages/quay/src/observation.ts:2274`）每次请求 `execFileP("node", ["--experimental-strip-types", task-status-drift-check.ts, "--json"], { cwd: root, timeout: LANDING_TIMEOUT_MS })`；
- `LANDING_TIMEOUT_MS = 8_000`（`observation.ts:2241`）、`LANDING_CACHE_TTL_MS = 30_000`（`observation.ts:2237`）；
- 该子进程在本仓实测 **5.88 / 6.02 / 5.94s**（`scanned: 2273` 条任务，`--json` 输出 22KB）。

**两态实测（同一个活实例 `127.0.0.1:4173`，pid 318516，cwd=/home/yale/work/quay）**：

```
热（30s TTL 内，第二次请求）  t=2.86s
冷（TTL 过期后）              t=9.32s / 16.57s     ← 越过判据写死的 curl --max-time 10
```

30 次采样分布：`p50=2.84s p90=9.39s max=12.0s`；另 20 次采样中 `rc=28`（max-time 超时）**4 次**。

**结构性（这是本任务与「再加一个缓存」的分界）**：AC-292 判据的消费频率是**每轮复验一次**，两次运行间隔恒 **> 30s**
⇒ **TTL 结构性恒过期** ⇒ 判据几乎每次都落在冷路径上；而冷路径耗时在 9–17s 之间抖动，**跨在 10s 判据预算两侧**
⇒ **同一份正确实现，判据按轮随机红绿**。这正是台账尾部为 fail 的原因。

### 为什么前一次修复没有兜住（两次都已 done）

| 前修 | 它做到的 | 为什么现在又红 |
|---|---|---|
| `gap-webui-board-load-120s` | `/board` 冷加载 120s → 「个位数秒」（TTL 缓存 + 秒级 timeout + fail-open） | 它的验收目标是**个位数秒**（≤9.999s）——**在 10s 判据预算内零余量**；且它的对照量是当时的仓库规模 |
| `gap-task-status-drift-check-timeout`（2026-08-24 done） | 内层循环补 `visited` 上限 + `.quay` 进排除名单 ⇒ **1387 条任务下 3.3s（<8s）** | 该子进程成本**随任务数增长**：1387 → **2273** 条后实测 **5.9s**（约 1.8×）。在 N=1387 上标定的绝对秒数，在 N=2273 上不再成立 |

**共同形态**（硬规则 4 推论：成本结构未知前不要设数值阈值）：两次修的都是**绝对值**，而**成本随仓库规模增长**。
⇒ 本任务的判据必须**不随任务数退化**（见 AC3），⛔ 不是把 8s 调成 12s、也⛔ 不是再调一次 TTL。

### 已有正本解法（同一病灶、同一仓、已落地且有测试）

`gap-ac179-criterion-cold-miss-30s-ttl-always-expired` 对 `/dashboard` 解了**逐字相同**的问题，其 Finding 原文：

> 「/dashboard 的每个 reader 都是 30s TTL 缓存，而 AC-179 的唯一消费者是**每小时一次**的 goal-sweep —— 两次请求的间隔恒 >30s ⇒ TTL 结构性恒过期 ⇒ 每次复验都在请求路径里现付全额构建（冷 19.17s / 热 1.61s），越过 criterion 写死的 `curl --max-time 10`。」

**它的修法（本任务照搬，⛔ 不另造机制）**：构建移到**后台 tick**，请求路径只读**快照**（同步 map 查找，零 reader I/O）。
落地物在 `packages/quay/src/serve-dashboard.ts`：`DashboardSnapshot`（`serve-dashboard.ts:1622`）、
`dashboardSnapshots`（`serve-dashboard.ts:1648`）、`peekDashboardSnapshot`（`serve-dashboard.ts:1664`，同步）、
`startDashboardSnapshotRefresh`（`serve-dashboard.ts:1801`，由 `serve.ts:787` 启动）。

⛔ **`/board` 的落地源没有对应物**：`grep -rn 'BoardSnapshot' packages/quay/src/*.ts` ⇒ **0 命中** —— 这就是缺口。

<!-- dedup-ref -->
去重核对（机制级）：顶层 `goal_ac: AC-292` **恰好 1 命中**，且为 `gap-ac292-board-page-zh-chrome-nav-current-and-own-title`（status=**done**）
—— 它修的是 **zh 接线**（lang/nav/`<title>` 传 lang + `PAGE_LABELS` 词条），那部分**确实成立**（本任务立案当轮实测三段断言全过）；
它**没有**覆盖本任务的机制（**请求路径现付冷构建**）。同谓词对 AC-291 / AC-293 各 1 命中 ⇒ 谓词非恒零。
机制相邻但不同机制的两条前修 `gap-webui-board-load-120s` / `gap-task-status-drift-check-timeout` 均 done，是本任务「前修未兜住」的**证据**而非重复。
在飞交叠：`observation.ts` / `serve-board.ts` / `serve.ts` 无任何在飞任务声明（已核）。页面渲染语义的相邻任务 `gap-ac288-webui-lang-switch-mechanism` / `gap-ac289-dashboard-zh-nav-label-and-own-title` 均已 done。

## Plan

1. **红基线**（⛔ 不假定仍等于立案值）：`node packages/quay/bin/quay.js goal gate AC-292 --dry-run --json` 连跑 3 次，
   贴 3 次 `verdict` 与具名 `CAUSE=`；再补冷/热两态 curl 读数（`sleep 31` 强制造冷）。
2. **读正本**：`serve-dashboard.ts` 的 snapshot 四处符号（`:1622/:1648/:1664/:1801`）+ `observation.ts:2274` 的 `readBoardLanding`。
   ⛔ 不重写一套快照机制，**按 AC-179 的形状**给 `/board` 的落地源建对应物。
3. **接线**：请求路径改为读快照（同步、零子进程 I/O）；构建移入后台 tick（在 `serve.ts` 旁挂，与 dashboard tick 同处）；
   快照缺席时给一个**可区分的态**（⛔ 不得与「查过且为空」同形 —— 硬规则 3b）；保留原有 fail-open 语义与「读取超时」文案。
4. ⛔ **不改判据**（`goals/AC-292-*.md` 不在本 Touches 内）、⛔ 不调 `curl --max-time`、⛔ 不把 8s timeout 调大、⛔ 不把 TTL 调长。
5. **测试**：新建 `packages/quay/test/gap-ac292-board-request-path-cold-build.test.mjs`，黑盒
   （真 workspace（`.quay/config.yml` + native provider）+ `startServer({ port: 0 })`；⚠️ 用 `port: 0` 让内核选端口，⛔ 不自己探端口）：
   ① 请求路径不再冷跑子进程（改 store 后页面仍显示旧值 = 请求路径没重建）；
   ② 后台重建进行中，连续 N 次 `/board` 全部 <10s 且都含 nav 区块；
   ③ 负控制：关掉后台刷新 ⇒ 回到请求内构建 ⇒ 冷路径 >10s（两侧读数都在，证明判据能取假）。
6. **重启活实例**：判据探**已在运行**的 `quay.ts serve`（cwd = `git rev-parse --show-toplevel`）。实现落地后**必须重启**
   （陈旧实例会把「没生效」伪装成「实现没做」）；本任务在**自己的 worktree** 内起实例并从该 worktree 跑判据，
   ⛔ 不擅自重启主检出上那个驱动/判据所有的实例。
7. **收口**：红/绿判据原文 + 因果对照 + 冷/热两态 + 作用域枚举 + scoped 门绿。

## AC

- [x] **AC1（判据本身：连续冷跑全绿）**：在重启后的活实例上
  `for i in 1 2 3 4 5; do node packages/quay/bin/quay.js goal gate AC-292 --dry-run --json; echo "EXIT=$?"; sleep 31; done`
  ⇒ **5/5 `verdict:"pass"` + `EXIT=0`**，五次原文并排贴出。
  ⛔ 必须带 `sleep 31` 的**冷路径** —— 否则测的是缓存热态，而那正是 AC-179 那条「优化了稳态、而判据从不走稳态」的错误。

  **实测**（实例 = 本 worktree 启动的 `quay.ts serve --port 4175`，cwd = 该 worktree ⇒ 判据探针匹配）：
  ```
  RUN #1..5 → EXIT=0  "verdict": "pass"  acceptance passed (exit 0)     5/5 全绿，每次间隔 sleep 31
  同口径改前基线（未改动代码）：3/3 红 —— CAUSE=en-fetch-failed -- GET http://127.0.0.1:4175/board returned nothing
  ```
- [x] **AC2（直接量：冷路径与判据预算的余量）**：冷路径（强制造冷后的首次请求）**3 次采样全部 < 5s**，
  并同时贴出判据写死的 10s 预算作为对照；同时贴**热路径**读数。⛔ 不是「变快了」，是**冷路径跨过 10s 预算的概率为 0**。

  **实测**（同一实例，`sleep 31` 强制造冷）：
  ```
  改后  COLD t=0.08s / 3.29s / 0.04s      HOT t=0.04s / 0.07s / 0.02s
  改前  COLD t=9.78s / 9.62s / 9.17s      HOT t=0.24s / 2.35s / 0.23s     （判据预算 = 10s）
  ```
  ⇒ 冷路径 3/3 < 5s，余量 ≥ 6.7s；`COLD#2 = 3.29s` 落在后台重建的一个阻塞步上（重建协作式，每个阻塞 reader
  独占一个 macrotask ⇒ 并发请求最多等**一个** reader 而非它们之和）。
- [x] **AC3（不随仓库规模退化 —— 本条与前两次修复的分界）**：给出**成本结构**证据，证明请求路径**不再包含**
  随任务数增长的构建（例如：请求路径内 **0 次子进程 spawn**、**0 次全量扫描**，用可复算的读数给出，⛔ 不是「应该不会」）。
  ⛔ 本任务**禁止**以「把 timeout 调大到 N 秒」或「把 TTL 调长」作为落地手段 —— 那两次已经试过（见 Proposal 表），
  且判据的消费间隔恒 >TTL ⇒ 调 TTL 结构上无效。

  **实测（直接计数，非墙钟代理；两侧读数都在 —— 硬规则 4）** —— `gap-ac292-board-request-path-cold-build.test.mjs` 的 AC3′：
  | 状态 | 5 次 `/board` 后 `+landing 子进程 spawn` | `+develop-ref 全量扫描` |
  |---|---|---|
  | 快照在位 | **0** | **0** |
  | `QUAY_BOARD_SNAPSHOT_DISABLED=1` | **+1（恰好一次）** | **+1（恰好一次）** |
  计数器为本次新增的直接量（`observation.getLandingColdRunCount` / `getTaskStatusRefBuildCount`）；
  第二个（关掉后 +1）证明「0」是真读数而非恒零旋钮。
  `LANDING_TIMEOUT_MS` / `LANDING_CACHE_TTL_MS` 两处字面量**未改**（`git diff` 可验）。
- [x] **AC4（可被打红 —— 因果对照）**：把后台构建**临时**关掉（一次性本地改动，⛔ 不提交），
  证明冷路径回到 >10s 且判据可红；恢复后复绿。**两次读数并排贴出**。
  ⛔ 无此对照 ⇒「是本次接线造成的」只是一句未被检验的断言（硬规则 4 推论四）。

  **实测（对照形态：把 `startBoardSnapshotRefresh` 调用换成惰性句柄，跑完 `git checkout -- packages/quay/src/serve.ts` 还原，⛔ 未提交）**：
  ```
  PHASE A（关掉后台构建）  COLD t=6.47s / 5.85s / 12.83s   criterion 2/2 "verdict":"pass"
  PHASE B（还原后）        COLD t=2.72s / 0.03s            criterion 2/2 "verdict":"pass"
  ```
  **⚠️ 如实记录一处偏离**：对照**有效且因果成立**（关掉后请求路径重新现付全量构建 5.85–12.83s，其中一次越过 10s；
  开启后 0.03–0.08s ⇒「快是本次接线造成的」**已被检验**）。但 AC4 字面要求的「冷路径回到 >10s **且判据可红**」
  **未在本对照中复现**：3 次冷采样只 1 次 >10s，2 次判据都是 pass。成因是一条**未申报的副作用** ——
  本实现的 fallback 与后台 tick **共用同一个** `buildBoardSnapshot`（单一实现，两者不会漂移），
  它把落地子进程与 provider/git 读**并发**发起，故 fallback 是 `max(6.46, ~2.4)` ≈ 6.5s，而改前是 `6.46+1.41+provider` ≈ 9.7s。
  ⇒ **「>10s / 判据可红」的诚实证据由改前红基线提供**：同机器、同端口、同命令、**未改动代码**，
  冷 9.17 / 9.62 / 9.78s，判据 **3/3 红**。本任务选择**保留并发**（首建窗口 ~9.7s → ~6.5s），
  并把这条偏离写进证据，而不是为迁就对对照的数值预期把 fallback 人为串行化。
- [x] **AC5（不回归 + 作用域枚举）**：① `bash scripts/test.sh --for-task gap-ac292-criterion-cold-miss-30s-ttl-always-expired` 绿；
  ② `node --test packages/quay/test/serve-*.test.mjs packages/quay/test/observation.test.mjs` 绿；
  ③ **`/board` 既有渲染语义逐条不变**：`Cookie: lang=zh` 下仍 `<html lang="zh"`、nav 区块内无字面量 `Board`、
  本页 `<title>` 与 en 逐字不同（三段原样贴出）；`?status=` / `?label=` / `?page=` 的过滤与分页行为不变；
  ④ `git diff --name-only <base>...HEAD` 只含本任务 Touches 的路径。

  **实测**：① scoped 门 `ℹ tests 155 · pass 155 · fail 0`（exit 0；选择面含本次两个测试文件）；
  ② `ℹ tests 310 · pass 309 · fail 0`（33 个 serve-* 文件 + observation.test.mjs）；
  ③ 活实例原样读数 ——
  ```
  en nav 区块含字面量 Board : …<a class="mobile-menu-item" href="/board">Board</a>…
  zh 响应头                : <html lang="zh"
  zh nav 区块含字面量 Board : absent（判据第 2 段通过）
  en/zh <title>            : 「… — Board — 三源 join 看板」 vs 「… — 看板 — 三源 join 看板」（逐字不同）
  /board?status=ready → Page 1 of 1 (5 rows) · ?label=gap → 1730 rows · ?page=2&all=1 → Page 2 of 114 (2274 rows) · ?pageSize=5&all=1 → Page 1 of 455
  ```
  ④ `git diff --name-only $(git merge-base develop HEAD)...HEAD` = `observation.ts` / `serve-board.ts` / `serve.ts` /
  `gap-ac292-board-request-path-cold-build.test.mjs` / `serve-board.test.mjs` —— 与 Touches 逐条相同；
  `goals/AC-292-*.md` **未改**。

## DoD

**REAL LANDING（DIR-026 Reading A）**：不是「多了一个快照函数、单测绿了」，而是
**一个真实的 `quay serve` 进程上，`/board` 在冷路径（TTL 已过期 / 后台尚未重建完）下仍然在判据预算内响应，
并且 AC-292 判据连续 5 轮冷跑全绿**。

1. **落地对象**：活实例上 `sleep 31` 强制造冷后连续 5 次判据 `EXIT=0`（AC1 原文）。
2. **可被打红**：AC4 的阴性对照**实际跑过**并贴两次读数 ⇒ 证明这条判据不是结构上恒绿（硬规则 4）。
3. **规模不退化**：AC3 的成本结构读数。
4. **作用域**：AC5 的逐条渲染语义 + `git diff --name-only`，证明 zh 接线与其余页面未被顺手改掉。
5. **可回滚**：写明回滚形态（还原请求路径为请求内构建 + 删除后台 tick + 重跑 `npm run build -w quay` + 重启实例）
   与它的作用域（纯本地代码、无外部状态）。
6. **证据留痕**：红/绿判据原文、冷/热两态读数、因果对照两次读数、成本结构读数，
   落成**任务体内联**或**未跟踪** scratch 文件，可被下一轮独立复算（⛔ 不是只写一句「已修好」）。

**留痕位置**：上面每条 AC 内联；完整证据包（含成本分解、复算命令、逐字读数）落在**未跟踪**的
`.quay/ac292/EVIDENCE.md`（连同 `start-serve.sh` / `stop-serve.sh` / `run-ac1.sh` / `run-ac4.sh` 与各次原始输出）。
**回滚形态**：`git revert` 本任务提交即可——请求路径回到 `handleBoard` 内联四 reader、后台 tick 消失、
快照四件套无调用点；随后 `npm run build -w quay` + **重启 `quay serve`**。作用域纯本地，不写任何持久化载体
（快照只在进程内存），不改 `goals/`、不改配置。回滚后行为 == 上文红基线。

## Touches

- tasks/gap-ac292-criterion-cold-miss-30s-ttl-always-expired.md
- packages/quay/src/observation.ts
- packages/quay/src/serve-board.ts
- packages/quay/src/serve.ts
- packages/quay/test/gap-ac292-board-request-path-cold-build.test.mjs
- packages/quay/test/serve-board.test.mjs
- plugin/skills/init/SKILL.md
- plugin/skills/manager/SKILL.md

（说明：`goals/AC-292-*.md` 属人与驱动维护面，⛔ 不在本 Touches 内 —— 本任务明令禁止改判据。
运行时证据若落 `.quay/` 则**保持未跟踪**，故不声明 —— `anti-drift-touches-check` 只比对已跟踪文件。
若落地时后台 tick 的启动点落在其它文件（例如 `serve-dashboard.ts` 的同位），以实际改动为准并在提交说明中补齐。

**`serve-board.test.mjs` 的加入理由（落地后按实际改动补齐）**：`/board` 改读后台快照后，该文件里两条测试被影响，
成因同一个 —— 它们测的是**请求内构建**那条路径：① `AC3 negative control` 在两次请求之间改 fixture 并要求第二次反映，
快照会服务旧值（实测失败）；② `AC2 negative control` 要求第一次请求付子进程、第二次不付，快照开启时两次都不付
（且不加开关时它与 tick 首建**竞态**，本次侥幸通过）。两处都显式用 `QUAY_BOARD_SNAPSHOT_DISABLED_ENV` 关掉 tick 并在
`finally` 还原。先例：`gap-ac179` 同样把三份既有 dashboard 测试纳入 Touches 一并调整。其余 11 条未改动 ——
它们的 fixture 变更都发生在 `startServer` **之前**，快照在变更之后构建，语义不受影响（已逐条核过并实跑 13/13 绿）。）

**`plugin/skills/init/SKILL.md` / `plugin/skills/manager/SKILL.md` 两条的加入理由（develop 侧的全量静态闸红，非本任务 delta）**：`orchestration/SPEC-quay-init-reconcile-and-native-implementation-2026-09-18.md` 已随兄弟任务落在 develop 上，但两个 SPEC 声明点（`plugin/skills/init/SKILL.md` 的 `reference-doc` 块、`plugin/skills/manager/SKILL.md` 的 SPEC index）都没登记 ⇒ `spec-declaration-point-check` **在 develop 上 exit 1**（已在**干净的 develop 归档树**上复现，与本分支无关 ——`git diff develop...HEAD` 不含这两个文件）。它是仓库级静态闸，scoped 层被排除、只在 full 门跑 ⇒ **所有 code-delta 任务的 fan-in 都在 `step=suite` 中止**（日志形如 `STATIC_CHECK_FAILED: spec-declaration-point-check exit=1` + `# tests 0` + `# fail 45`，那 45 是 fail-closed 雪崩、一个测试都没跑）。develop 侧未被独立修复（该 SPEC 的 owner 任务 `gap-quay-init-native-reconcile` 仍为 `todo`，其 Touches 只含 init 一侧、且不含 manager 一侧）⇒ 按 `out-of-touches-red-fix-self-inflicts-anti-drift-take-develop` 的「仍不收敛 ⇒ 把它登记为 Touches 并在提交信息里写明理由」处置：**补两行机械声明**（init 为字母序 `reference-doc` 行、manager 为 index 末尾追加），内容由 develop 既有事实唯一决定、不引入任何本任务语义。两条都不是本任务机制的一部分。

