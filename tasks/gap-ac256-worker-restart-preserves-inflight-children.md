---
id: gap-ac256-worker-restart-preserves-inflight-children
title: GOAL-017/AC-256：重启 `driver:worker` 这一个服务不杀它在飞的 worker 子进程 —— 载体
  `.quay/unified-server-verification.jsonl` 有合格记录（SPEC §6.9 不变式 3 / §8-7 后半）
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac251-unified-server-web-control-same-process
  - gap-ac254-partial-stop-web-driver-round-record
goal_ac: AC-256
---
## Proposal

**现状实测（立案当轮，2026-09-13T15:5xZ）**：

```
载体   ls .quay/unified-server-verification.jsonl   ⇒ No such file or directory
生产者 grep -rn 'unified-server-verification' plugin/ packages/   ⇒ 0 命中
CLI    node packages/quay/bin/quay.js server restart --only driver:worker
       ⇒ 打印 usage 行（动词表 <adr|goal|…|driver> 里没有 server）；exit 1
认领   grep -rn '^goal_ac: AC-256' tasks/*.md   ⇒ 0；grep -rn 'AC-256' tasks/   ⇒ 0
机制   node packages/quay/bin/quay.js driver --help ⇒
       「stop … For worker, in-flight workers are NOT killed (they orphan and finish)」
       「restart — stop then start.」
代码   plugin/scripts/driver-runtime.ts:1593 stopKind() 头注释「stop（硬停：杀 supervisor + 驱动；
       ⛔ 不杀 worker 在飞子进程）」；:1603-1604 只 SIGTERM supervisorPidFile + driverPidFile；
       :1610-1611 SIGKILL 兜底亦「⛔ 只针对 supervisor 与驱动自身，不扫 in-flight」
在飞集 .quay/worker-driver-inflight.pid 实测 5 个 pid（851153 1774338 2051834 2926709 3669508）
       ⚠️ 这是【driver 自报】的在飞集合 —— 硬规则 4b：被测对象自己维护的量
载体名 六 kind 的 round 载体权威清单在 driver-runtime.ts 的 DRIVER_KINDS[*].carriers
       （worker = ["worker-outcome.jsonl","worker-round.jsonl"]，⛔ 不硬编码）
```

⇒ 三层缺口叠加：**① 载体不存在**（该 AC 自诞生起未跑过）；**② 生产者不存在**；**③ 服务级重启面不存在**（SPEC §6.9 的 CLI 块只列 `start`/`add`/`stop`/`status` 四动词，`restart` 由不变式 3 要求「任一服务可单独重启」，现仅由 `quay driver restart --kind worker` 提供，那不是「服务」面）。

**这条 AC 的性质是「合并不得造成的能力回退」守卫，不是新功能。** SPEC §6.9 逐字：「现状 `quay driver stop` 已经是这个语义，见 CLAUDE.md『driver 进程管理』节，**合并后必须保持**」；§8-7 逐字：「合并后无法单独起停某个服务…——尤其：重启 `driver:worker` 杀掉了它在飞的 worker 子进程（违反 §6.9 三条不变式）」。现状该语义**已存在**（见上「代码」行）⇒ 本任务的风险不在「造」，在「⛔ 不在合并中弄丢它，且留下能取假的证据」。

**⚠️ 设计关键一：在合并形态（统一 server，SPEC 阶段 A2）之外产出的记录是空转。** 现状 13 进程形态下 `quay driver restart --kind worker` 本来就不杀在飞子进程 ⇒ 用旧形态产出的记录**不能取假**：它不区分「合并后保住了」与「合并后这条路径根本没被服务级 restart 管到」⇒ 不是测量（硬规则 4）。生产者必须在**统一 server 形态**上、经**服务级**重启面（`driver:worker` 作为服务）跑。这正是本任务声明对 `gap-ac251-unified-server-web-control-same-process`（统一 server 形态 + `.quay/server.json` + `server status --json`）与 `gap-ac254-partial-stop-web-driver-round-record`（`server start/add/stop` 四动词 + 服务清单单一实现）的机制前置的理由。⛔ 不重复实现这两个任务交付的东西。

**⚠️ 设计关键二（本 AC 特有，criterion 挡不住的第二个空转）：在飞集合为空时「一个都没死」恒真。** criterion 用 `len(before) < 1 ⇒ continue` 挡了「空集」这一形态，但**挡不住**「before 里的 pid 在取样那一刻就已经死了/是僵尸」——那时「一个都没死」同样恒真。⇒ 生产者必须另外要求 before 集合**逐个存活且非 Z 态**，并在记录里留 `inflight_worker_pids_before_all_alive`。同族先例：AC-254 的 `web_reachable_before=true`（「停之前就不可达」同样满足 `after=false`）。

**⚠️ 为什么在飞集合必须独立推导，⛔ 不得采信 `.quay/worker-driver-inflight.pid`**：那是 driver 进程自己维护的集合，**在它停摆时恰好也停止更新，与「一切正常」同形**（CLAUDE.md 硬规则 4b 及其「一个量若由被测对象自己产生，就不能用来判断被测对象是否活着」的自检）。criterion 在结构上无法区分「独立推导的 5 个 pid」与「自报的 5 个 pid」⇒ 生产者必须从 **driver 进程的进程树**（`/proc/<driver_pid>/task/*/children`，或 `pgrep -P <driver_pid>`，按 cmdline 过滤真 worker）推导，自报集合仅作**交叉核对**字段留档。

**已知陷阱（当作实现约束，⛔ 不重新发现）**：

- **`.quay/worker-round.jsonl` 的 `round` 是 JSON 字符串**（AC-254 实测末行：`{"ts":"2026-09-13T14:59:16.890Z","round":"2499","run_id":"wk-prod-…"}`）⇒ 写入前必须转 int，且 NOT-EVALUATED 与「不合格」要可区分。
- **criterion 对本 AC 用的是 `os.path.getmtime(worker-round.jsonl)`** —— 它是**代理量**（`touch` 即可骗过，同日 AC-255 审计已把 mtime 判为可伪量）⇒ 生产者必须另取**直接量**（末行 `round` 转 int + `run_id` + `ts`）并双读数并列留档。
- **重启 worker driver 会产生新 `run_id`**（driver 是新进程）⇒「恢复运转」的判据是**新 `run_id` 下出现晚于重启时刻的记录**，⛔ 不是「round 比之前大」（跨 run 比 round 无意义）。
- **`.quay/*driver*.pid` 的宽松 glob 实测 136 个**（把 `suite-load-*.jsonl.pid` 全数进来），真的 driver pid 文件只有个位数 ⇒ ⛔ 不得用 glob 计数进记录（这个读数若进记录就是一具假的取证）。
- **`restart` = stop then start**（`quay driver --help` 逐字）⇒ 中间存在 driver 不存在的窗口；「重启后 driver pid 变了」**必须同时**验证 `driver_pid_before` 在重启后**真的不在**，否则一个只改写 pid 文件的 no-op 也能满足 `before != after`。
- **§6.9 不变式 1 与 3 的表面张力（需正确读，⛔ 不要当成矛盾）**：不变式 1 说 `start` 一个已在跑的服务是 no-op，「⛔ 更不是静默重启（重启会打断该 driver 在飞的 worker 子进程）」；不变式 3 说**显式**重启任一服务不得影响在飞工作。两者合起来读是：不变式 1 禁的是**未经请求**的重启，不变式 3 约束的是**被请求的**重启 ⇒ `restart` ⛔ 不得由 `start` 兼职。
- **⛔ 不得为取证去杀生产在飞 worker**：本任务要的读数恰恰是「在飞 worker 不能被杀」，用杀它来取读数自相矛盾。**唯一例外**是被测动作本身 —— 生产者**就是要**重启 `driver:worker` 服务一次（SPEC 要求的行为），但它必须留档它重启了谁/argv/重启后 driver 已恢复，且 ⛔ 不碰其余五个 kind。

<!-- dedup-ref -->
**与既有任务的关系（仅追溯，不构成额外前置声明）**：`gap-ac251-unified-server-web-control-same-process`（done）交付 `quay server status` 与统一 server 形态；`gap-ac252-control-plane-hoist-to-layer0` / `gap-ac253-session-primitives-shared-layer-adoption`（ready）属阶段 A 另两步，机制与 Touches 均不相交；`gap-ac254-partial-stop-web-driver-round-record`（done）交付 `server start/add/stop` 四动词与服务清单单一实现；`gap-ac255-driver-internalization-pid-le2-six-kinds-fresh`（ready，**本趟的阻塞方**）属阶段 C，方向相反（它要 pid 文件 ≤2）；`gap-worker-driver-restart-orphan-no-outcome-no-timeout`（done）是**孤儿生命周期管理**，它**假定**了本 AC 的不变式而从未验证它，机制不同。全仓 `grep -rn '^goal_ac: AC-256' tasks/*.md` = 0、`grep -rn 'AC-256' tasks/` = 0（立案当轮实测），无重复立案。

## Plan

1. **服务级重启面（仅当 AC-254 未交付 `restart` 时才需要动 CLI 层）** —— 在 `packages/quay/src/cli/server.ts`（AC-251 新建）上加 `restart [--only <svc,...>]`；**或**由生产者组合 `stop --only driver:worker && start --only driver:worker`。**决策规则**：由 §6.9 不变式 1（`start` 一个在跑的服务必须是 no-op，⛔ 不得静默重启）⇒ `restart` ⛔ 不得由 `start` 兼职。两种形态都合格，但记录里必须留 `restarted_via`（argv 原文）使形态可核。**⛔ 服务清单与动词派发复用 AC-254 的单一实现，⛔ 不新建第二份**（SPEC §6.8 单一实现纪律 / §8 判据 1 的同族形态）。

2. **`driver:worker` 服务 = 对既有 driver CLI 的组合，⛔ 不重写 driver 起停** —— **⛔ 不改 `plugin/scripts/driver-runtime.ts:1593 stopKind()` 的语义**，它是**被测对象**不是可调项。若发现合并后服务级 restart 走了一条**新**的杀进程路径（而非复用 `stopKind`），**那本身就是本 AC 要抓的回退** ⇒ 必须修回组合形态，并把「改动前/改动后」的对照读数留档。

3. **生产者对每条读数的独立推导（本任务的核心约束）** ——
   - `driver_pid_before` / `driver_pid_after` 读 `.quay/worker-driver.pid`，**并逐个核活**（`/proc/<pid>` + 非 Z 态；⛔ 不采信 pid 文件内容本身）；另加 `driver_pid_before_dead_after`（重启后旧 pid 真的不在）与 `driver_pid_after_alive`。
   - `inflight_worker_pids_before` **从 driver 进程树独立推导**（`/proc/<driver_pid>/task/*/children` + cmdline 过滤真 worker），**逐个核活且非 Z**；`.quay/worker-driver-inflight.pid` 只作**交叉核对**字段 `inflight_declared_by_driver` 留档。
   - `inflight_worker_pids_alive_after` = **对原集合逐个再核活**（⛔ ⛔ 不是重新枚举进程树 —— 重新枚举会把「死了旧的、新起了别的」读成同一个集合，正是本 AC 要防的假阳性）。

4. **「driver 真的恢复运转」取直接量** —— 读 `.quay/worker-round.jsonl` 重启前/后的末行 `{ts, round, run_id}`；要求**新 `run_id`** 存在且其 `ts` **严格晚于重启动作时刻**；⛔ 不只靠 `os.path.getmtime`（criterion 用的是它，`touch` 即可骗过）。记录里同时留 mtime 与直接量两根读数。

5. **生产者新脚本 `plugin/scripts/server-restart-inflight-verify.ts`** —— 一次运行按顺序：① 核统一 server 形态（`quay server status --json` 报 web 与 control 同 host pid）且 `driver:worker` 在跑，否则 NOT-EVALUATED 并退出非 0；② 独立推导在飞集合并逐个核活，**为空 ⇒ NOT-EVALUATED、⛔ 不写记录**（空集下「一个都没死」恒真）；③ 取 before 读数（driver pid + 在飞 pid 集 + round 末行）；④ 执行服务级 restart（记录 argv / exit / stdout 原文）；⑤ 等到 `driver_pid_after` 出现且活 ∧ 旧 pid 不在 ∧ 新 `run_id` 有晚于 t 的记录（超时 ⇒ 零记录 + 与「没测成」**可区分**的取值）；⑥ 对**原集合**逐个核活得 after；⑦ 组装并 append 记录到 `<workspaceRoot>/.quay/unified-server-verification.jsonl`；⑧ fail-closed：任一必需字段读不出/不满足 ⇒ **不写** + 可区分的 NOT-EVALUATED + 退出非 0（硬规则 3b：「读不懂」不得返回与「合格」同形的值）。

6. **记录字段形态 fail-closed（字段类型就是判据的一部分）** —— `ac` 必须逐字 `"GOAL-017-AC-256"`；`restarted_service` 必须逐字 `"driver:worker"`；`at` 必须是 ISO-8601 字符串（criterion 取前 19 字符按 `%Y-%m-%dT%H:%M:%S` 解析）；`driver_pid_before` / `driver_pid_after` 必须是 **JSON 整数**且 `!=`；`inflight_worker_pids_before` / `inflight_worker_pids_alive_after` 必须是 **JSON 整数 list**，前者非空、后者与前者**按集合相等**。**加强字段**（判据不读，供交叉核对）：`driver_pid_before_alive` / `driver_pid_before_dead_after` / `driver_pid_after_alive` / `inflight_worker_pids_before_all_alive` / `inflight_declared_by_driver` / `inflight_source:"proc-tree"` / `worker_run_id_before` / `worker_run_id_after` / `worker_round_ts_after` / `worker_round_jsonl_mtime` / `restarted_via` / `restarted_argv_exit` / `ts`。缺任一必需字段 ⇒ **不写** + 非 0 退出。

7. **负控制（逐条能取假，⛔ 不能只报正读）** —— a) **空集控制**：在飞集合为空时跑 ⇒ 零记录 + NOT-EVALUATED（证明「无可杀」不被计为合格）；b) **假重启控制**：`driver_pid_before == driver_pid_after`（用 `quay driver status` 的 no-op，或 `server start` 一个在跑的服务）⇒ 拒写（证明该字段在做功）；c) **杀子进程控制（合成夹具，⛔ 不在生产上做）**：窗口内故意杀一个在飞 worker ⇒ `set(after) != set(before)` ⇒ 拒写（证明集合相等能抓到真回退）；d) **停机不恢复控制**：只 stop 不 start ⇒ 无新 `run_id` 记录 ⇒ 拒写（criterion 末句的加强形式）；e) **死 pid 控制**：把已死/僵尸 pid 放进 before ⇒ `inflight_worker_pids_before_all_alive` 为假 ⇒ 拒写；f) **自报控制**：让 driver 自报集合与进程树推导不一致 ⇒ 记录差异并以独立推导为准（贴两读数）；g) **判据三态**：删掉该条记录 ⇒ exit 1；移走载体 ⇒ **exit 1（未达成），⛔ 不是 exit 3**（GOAL 风险节第 4 条：本 AC 的载体即本 AC 自己的产物）；把 `at` 写成非 ISO ⇒ exit 3。

8. **夹具与自检** —— 生产者的判定/组装逻辑要有 hermetic 正/负控制并进套件，**正控制直接调生产函数**（⛔ 不让夹具复刻判定逻辑 —— 硬规则 4 推论三：只能被 fixture 满足的判据不是测量）。新脚本入场要按 `plugin/scripts/capability-catalog.sh` 头注释补**六张表各一行**（QUESTION / CADENCE / INVALIDATION / LAST_REAFFIRMED / MATCHING / CONSUMER），⛔ 否则 `--entry-surface` 会**打印 PASS 却 exit 1**。本脚本是**生产者**不是静态检查器 ⇒ ⛔ 不登记进 `runner-static-gate.ts` 的 `run_static_checks`（否则 AC 未达成期间全量套件每轮变红）。⚠️ `plugin/scripts/` 新增文件**不需要** `experiments/quay-perpetual-stream/scripts/` 镜像孪生 —— `mirror-pair-drift-check.ts` 头注释逐字：「a file present in only ONE dir is NOT a pair — a missing mirror is NOT a drift state」。

9. **真跑一次（唯一能产出合格记录的路）** —— 在生产 root（`/home/yale/work/quay`，⛔ 不是 worktree、⛔ 不是夹具进程）的统一 server 形态上跑生产者：须**等一个真有在飞 worker 的窗口**（无在飞 ⇒ 本趟 NOT-EVALUATED，⛔ 不得为凑读数而制造假在飞 worker）；记录写进生产载体；贴出记录原文 + 载体行数 + 逐字跑 `goals/AC-256-…md` criterion 的 exit code（改前 exit 1 → 改后 exit 0，两条并列）。

10. **零回退** —— 既有 `plugin/test/driver-cli.test.mjs` / `driver-runtime*` 测试全绿（证明 `stopKind()` 的不杀语义没被改坏）；`node --test packages/quay/test/serve-*.test.mjs`、`packages/quay/test/server-*.test.mjs`、`plugin/test/start-drivers.test.mjs` 全绿。⛔ 验证期间除生产者那一次受控重启外，不得对生产 driver 做任何 stop/kill。

## Touches

- `plugin/scripts/server-restart-inflight-verify.ts` (new)（生产者：进程树独立推导 + 服务级重启 + fail-closed 组装）
- `plugin/scripts/capability-catalog.sh`（新脚本的六张表各一行声明 —— outline / capability-catalog / laydown 三个登记面之一，缺则 `--entry-surface` 打印 PASS 却 exit 1）
- `.quay/unified-server-verification.jsonl`（本 AC 的载体：生产者 append 的合格记录；⛔ 与 AC-254 共用同一文件，按 `ac` 字段区分。⚠️ anti-drift-touches-check 会把写在 `.quay/` 下的证据文件计入「任务写了什么」，⛔ 不声明 = fan-in HARD FAIL。**本趟未写入**：无合格记录可写，见「阻塞」节）
- `packages/quay/src/cli/server.ts`（动词表新增 `restart`、`restarted` 取值、driver 型 kind 的组合路径、**anchor 安全闸**）
- `packages/quay/bin/quay.ts`（`restart` 的动词派发 + usage 行）
- `packages/quay/src/cli/help.ts`（`server restart` 帮助条目 ⚠️ 用户可见的帮助正本在 `cli/help.ts`，⛔ 不是 `cli/driver.ts` 内联那份）
- `packages/quay/test/server-status-web-control-same-pid.test.mjs`（AC-251 的用法行断言原先钉死四动词字面量；动词集合法长大后它变红并把它报成「文档没跟上」—— 改为从 `SERVER_VERBS` 派生）
- `plugin/test/server-restart-inflight-verify.test.mjs` (new)（生产者的类型 / fail-closed / 负控制 / /proc 直接量 / 逐字跑 criterion）
- `packages/quay/test/server-restart.test.mjs` (new)（服务级 restart 的语义 + `start` no-op 对照 + anchor 安全闸的活体负控制）
- `tasks/gap-ac256-worker-restart-preserves-inflight-children.md`（自身文件：勾 AC + 贴实跑证据）

## Acceptance Criteria

- [ ] **AC1 载体上判据翻转** ⛔ **本趟未达成（见「阻塞」节）**：逐字跑 `goals/AC-256-重启单个服务不杀在飞-worker-重启-driver-worker-后其在飞子进程一个都没死-spec-6-9-不变式.md` 的 criterion ⇒ **exit 0**（立案当轮实测 exit 1：载体不存在）。贴出该命令的 exit code、载体 `.quay/unified-server-verification.jsonl` 的行数、以及那条 `ac="GOAL-017-AC-256"` 记录的原文。
- [ ] **AC2 服务级重启面在位，且 `restart` 不是 `start` 兼职**（负控制已达成，正半未达成）：`quay server restart --only driver:worker`（或生产者的组合形态）可执行且 argv 留档（`restarted_via`）；**负控制**：`quay server start` 一个**已在跑**的服务 ⇒ exit 0 且该服务 pid **不变**（证明是 no-op 而非静默重启 —— §6.9 不变式 1）。两读数并列贴出。
- [ ] **AC3 在飞集合是独立推导且逐个存活** ⛔ **本趟未达成（无合格记录）**：`inflight_worker_pids_before` 由**进程树**推导（留 `inflight_source:"proc-tree"`）且**非空**、**每个 pid 取样时存活且非 Z 态**（留 `inflight_worker_pids_before_all_alive: true`）；贴出 driver 自报集合 `inflight_declared_by_driver` 与独立推导结果的**并列读数**。**负控制**：在飞为空时跑 ⇒ 零记录 + NOT-EVALUATED（证明「无可杀」不被计为合格）。
- [ ] **AC4 真重启（不是 pid 文件改写）** ⛔ **本趟未达成（无合格记录）**：`driver_pid_before != driver_pid_after` ∧ `driver_pid_before` 在重启后**真的不在**（`driver_pid_before_dead_after: true`）∧ `driver_pid_after` 活（`driver_pid_after_alive: true`）⇒ 三读数并列贴出。**负控制**：no-op（pid 不变）⇒ 拒写。
- [ ] **AC5 一个都没死（本任务的核心断言）** ⛔ **本趟未达成（无合格记录）**：`set(inflight_worker_pids_alive_after) == set(inflight_worker_pids_before)`，且 after 是**对原集合逐个再核活**（⛔ 不是重新枚举进程树）⇒ 贴出两个集合原文。**负控制（合成夹具，⛔ 不在生产上做）**：窗口内杀一个在飞 worker ⇒ 生产者/判据拒写（证明该断言能抓到真回退）。
- [ ] **AC6 driver 真恢复运转（直接量，⛔ 不只靠 mtime）** ⛔ **本趟未达成（无合格记录）**：`.quay/worker-round.jsonl` 出现**晚于重启时刻的新 `run_id`** 记录（留 `worker_run_id_after` + `worker_round_ts_after`），并与 `os.path.getmtime` 并列贴出。**负控制**：只 stop 不 start ⇒ 零记录（证明「停了所以没杀人」不被计为达成）。
- [x] **AC7 读数不自报（硬规则 4b）**：在飞集合与 driver 存活均由**独立推导**（进程树 / `/proc`）得到；⛔ 不采信 `.quay/worker-driver-inflight.pid`、`quay driver status` 或 `server status` 的自报（它们只作交叉核对字段留档）。贴出至少一处两者**一致或不一致**的并列读数。⇒ **达成**：`deriveInflight` 从 `/proc/<driver_pid>/task/*/children` ∩ 本 workspace 的 `task-workers` 角色名推导（`resolveWorkerProcessName(root)`，⛔ 不用写死的 `quay-task-worker`）；`aliveNonZombie` 读 `/proc/<pid>/status` 的 State 字符（⛔ 不用 `kill(pid,0)` —— 僵尸仍可被 signal）；自报文件只进 `inflight_declared_by_driver`。生产并列读数见「阻塞」节：**derived=[300998]（1 个真 worker）vs declared=1933 条**，`inflight_declared_vs_derived: "DIFFERENT — the independent derivation is authoritative"`。
- [ ] **AC8 生产载体真跑过（硬规则 4 推论三）** ⛔ **本趟未达成（出于安全，⛔ 刻意不跑）**：记录写在生产 root `/home/yale/work/quay/.quay/unified-server-verification.jsonl`，其 `ts` 晚于本任务实现落地时刻，且是在**统一 server 形态**（`quay server status --json` 报 web 与 control 同 host pid）上跑出来的。⛔ 不是 worktree、⛔ 不是夹具注入。
- [x] **AC9 零回退**：`plugin/test/driver-cli.test.mjs`、`plugin/test/driver-runtime*.test.mjs`、`packages/quay/test/serve-*.test.mjs`、`packages/quay/test/server-*.test.mjs` 全绿（贴各文件 `# pass`/`# fail` 计数）；`stopKind()` 的不杀语义未被改坏 —— 贴该函数头注释与 `driver-runtime.ts:1603-1611` 的 diff 为空。⇒ **达成**：driver-cli + driver-runtime\* **40 pass / 0 fail**；`server-*.test.mjs` **20 pass / 0 fail**；`serve-*.test.mjs` **182 pass / 0 fail**（183 tests）；`git diff develop -- plugin/scripts/driver-runtime.ts` **为空**（该文件本趟未被触碰，`stopKind()` 语义原样）。
- [ ] **AC10 全量套件绿 —— 外层 verification-round 验证**（本条的量产生在 fan-in / 外层 suite 轮，⛔ 不是 worker 自己的读数；scoped 门绿不等于全量绿）。

## 实测与阻塞（2026-09-13 22:0xZ，本任务实现落地后）

### ① 实现已落地并绿（本趟可交的部分）

| 交付物 | 状态 | 证据 |
|---|---|---|
| `quay server restart --only <svc,...>`（独立动词，⛔ 不由 `start` 兼职） | ✅ | `packages/quay/test/server-restart.test.mjs` 5/5；`quay server --help` 用法行 + `started \| already-running \| restarted \| stopped` 词表 |
| driver 型 kind 组合既有 `quay driver restart --kind X`（= stopKind + startKind） | ✅ | 同上；⛔ 未新增任何杀进程路径 |
| 生产者 `plugin/scripts/server-restart-inflight-verify.ts` + 六张表声明 | ✅ | `plugin/test/server-restart-inflight-verify.test.mjs` 15/15；`capability-catalog.sh` → `summary: 320 scripts \| 320 declared \| 0 unclassified` |
| scoped 门（driver 的 fan-in 跑的那一个） | ✅ **119/119，exit 0** | `scripts/test.sh --for-task gap-ac256-worker-restart-preserves-inflight-children --allow-thin` |
| AC9 零回退 | ✅ | 见 AC9 行 |

### ② 🔴 阻塞：本 AC 的判据在当前的 SPEC §7 阶段 C 形态下**结构上不可满足**

**实测（生产 root `/home/yale/work/quay`，2026-09-13 22:0xZ）**：

```
$ cat .quay/{promotion,worker,outer,quality,meta,goal}-driver.pid
3057428  3057428  3057428  3057428  3057428  3057428      ← 六个文件一个 pid
$ cat .quay/anchor.json
{"pid":3057428,"startedAt":"2026-09-13T20:34:46.314Z",
 "kinds":["quality","promotion","worker","outer","goal","meta"],"host":"anchor"}
$ ps -p 3057428 -o args   → node … /home/yale/work/quay-worktrees/gap-ac255-…/plugin/scripts/driver-anchor.ts __anchor --root /home/yale/work/quay
$ cat .quay/worker-driver-supervisor.pid   → No such file（阶段 C 起 supervisor 层退役）
```

`gap-ac255-driver-internalization-pid-le2-six-kinds-fresh`（**status: ready，未落地**，4 提交在 develop 之外）交付的 anchor 把六个 kind 的常驻循环收进**一个**进程，`.quay/<prefix>.pid` 的内容因此是 **anchor 的 pid**。后果：

1. **判据不可满足**：`quay server restart --only driver:worker` 在阶段 C 下是「anchor 内的事件循环 respawn」，`driver_pid_before` 与 `driver_pid_after` **永远相同** ⇒ AC-256 的 `driver_pid_before != driver_pid_after`（criterion 用它证明「真重启」）**结构上取不到真**。这不是实现问题，是**判据与架构的冲突**：本任务 15:38 立案时阶段 C 还不存在（anchor 20:26/20:34 起）。
2. **⛔ 更危险的是照旧执行会杀人**：现开发（develop）的 `driver_runtime.ts` 里 `stopKind()` 读同一批 pid 文件并 `SIGTERM` 它们 ⇒ `quay driver restart --kind worker` 会 **SIGTERM anchor，一次带走全部六个 kind** —— 既违反 §6.9「服务是可独立起停的单元」，也违反本任务 DoD 的「⛔ 重启 `driver:worker` 之外还碰了其余五个 kind」。

⇒ **本趟刻意未在生产上执行任何重启**（会被杀的正是它要保护的）。这不是省事，是 DoD「⛔ 不得为取证去杀生产在飞 worker」与「最小作用面是一个服务」的直接要求。

### ③ 已加的安全闸（把 ② 的杀人路径堵上，且它是本趟的实质产出）

`packages/quay/src/cli/server.ts` 的服务级 `restart` 在动手之前读 `.quay/anchor.json`：本 kind 若被 anchor 承载（`anchor.pid === 该 kind 的 pid 文件内容`），**拒绝**并给出 `outcome: "not-evaluated"`，⛔ 不调 `quay driver restart`。生产者同款：给出**可区分**的 `verdict: "HOSTED-BY-ANCHOR"`（硬规则 3b：「本形态下判据不可满足」⛔ 不与「没测成」同形）。

**生产实测（两条命令，anchor 与六个 kind 事后逐个复核仍在）**：

```
$ quay server restart --only driver:worker --json --root /home/yale/work/quay
  ⇒ outcome=not-evaluated, changed=false, exit 3
    detail: "kind 'worker' is hosted by the anchor process pid 3057428 (SPEC §7 stage C: one anchor runs
             all [6 kinds] in one event loop) — `quay driver restart --kind worker` would signal that anchor
             and take every hosted kind down with it, so no per-kind restart is attempted."
  事后：六个 .quay/<kind>-driver.pid 仍为 3057428（⛔ 未杀）

$ quay server start --only web --json --root /home/yale/work/quay      ← AC2 的负控制（§6.9 不变式 1）
  ⇒ outcome=already-running, pid=1323037, changed=false, exit 0
  事后：.quay/server.json 的 pid 仍为 1323037（宿主未被替换）

$ node --experimental-strip-types plugin/scripts/server-restart-inflight-verify.ts --root /home/yale/work/quay --json
  ⇒ exit 2, verdict=HOSTED-BY-ANCHOR, record_written=false
    anchor_pid=3057428, anchor_kinds=[quality,promotion,worker,outer,goal,meta]
    inflight_source=proc-tree
    inflight_worker_pids_before=[300998]            ← 进程树推导：1 个真 worker（本任务的 worker）
    inflight_declared_by_driver=1933 条             ← driver 自报的陈旧集合
    inflight_declared_vs_derived="DIFFERENT — the independent derivation is authoritative"
    driver_children_all=[300998, 420436]            ← 全部直接子进程（含被排除的例程探针，可核）

$ bash <AC-256 criterion>
  ⇒ exit 1（"no qualifying record"）；载体 .quay/unified-server-verification.jsonl 3 行，其中 ac=GOAL-017-AC-256 的 0 条
```

**AC7 的并列读数**（同一时刻、同一对象）：独立推导 **1** 个在飞 worker，driver 自报 **1933** 条 —— 相差三个数量级。这正是硬规则 4b 要防的形态：那个自报文件在 driver 停摆时恰好也停止更新，与「一切正常」同形；把它当读数，「一个都没死」在任何时刻都恒真。

### ④ 需要谁裁什么（⛔ 本任务自己解不了）

本 AC 与 AC-255 是**同一 SPEC（GOAL-017）的两个阶段**，方向相反且判据互斥；AC-256 立案（15:38）早于阶段 C 落地（20:26）。可能的处置（择一，需人/管理者裁定）：

- **(a) 重切 AC-256 的判据**：把「真重启」的证明从 `driver_pid 变化` 换成**阶段 C 下仍可取假的形态**（例如 anchor 的 per-kind stop→start 期间 kind 循环的重启计数 / 该 kind 的 round 序列出现新 run_id 且在该窗口内无在飞 worker 消失）。判据的**核心断言（在飞 worker 一个都没死）不变**，只换「重启确实发生过」的见证量。
- **(b) 声明 AC-256 只在阶段 C **之前**的形态有效**，并在阶段 C 落地时把它的结论带过去（即本条退化为「阶段 C 不得引入新的杀在飞 worker 路径」的守卫，判据改锚在 anchor 自己的 kind 重启路径上）。
- **(c) 若阶段 C 被回退**：本任务的实现（`restart` 动词 + 生产者 + 安全闸）原样可用，只需在生产上跑一次即可产出合格记录 —— 生产者已实测能在该形态下正确推导（本趟唯一的缺口是形态本身）。

**本趟未勾的 AC（1/2/3/4/5/6/8/10）全部只差这一件事**：一次**真**的 `driver:worker` 服务级重启。⛔ 本趟未用夹具、⛔ 未改写判据、⛔ 未把未测量的量标成达成 —— 载体上**没有** AC-256 的记录，这是事实。

## Definition of Done

**AC-256 的 criterion 在生产载体上 exit 0，且那条记录是一次真运行、真服务级重启、真差分的产物**：`driver:worker` 是作为**服务**被重启的（记录留 `restarted_via` argv），重启前在飞的 worker 子进程集合由**进程树独立推导**且**逐个存活**，重启后**对原集合逐个再核活**得到的集合与之前**完全相等**；`driver_pid_before` 在重启后**真的不在**；`.quay/worker-round.jsonl` 在重启后出现**晚于重启时刻的新 `run_id`** 记录（直接量，⛔ 不只 mtime）。生产者对每条读数 fail-closed：读不出/不满足 ⇒ 零记录 + 可区分的未评估值。

**⛔ 本趟未达成**：原因不是实现缺口，是**判据在 SPEC §7 阶段 C 形态下结构上不可满足**（见上「阻塞」节）——阶段 C 下 `driver_pid_before == driver_pid_after` 恒成立。实现（`restart` 动词 + 生产者 + anchor 安全闸）已落地、已绿、已过 scoped 门；缺的只有「在一个能产生真差分的形态上跑一次」。

⛔ 以下不算达成：

- 只在 worktree 的 `.quay/` 里自证，而生产 root 载体上没有记录；或记录由夹具/注入产生（硬规则 4 推论三）；
- 在**合并前的 13 进程形态**上用 `quay driver restart --kind worker` 跑出来的记录 —— 那条路径本来就不杀在飞子进程，读数**不能取假**，不区分「合并后保住了」与「合并后根本没被服务级路径管到」，不是测量（硬规则 4）；
- 在飞集合**为空**时产出的记录（「一个都没死」恒真，空转）；
- 用 `.quay/worker-driver-inflight.pid`（driver 自报）当作在飞集合的唯一来源（硬规则 4b：被测对象自己维护的量，在它停摆时恰好也停止更新，与「一切正常」同形）；
- before 集合含**已死/僵尸** pid（「都没死」恒真）而声称验证通过；
- 只验 `driver_pid_before != driver_pid_after` 而不验旧 pid **真的不在**（一个只改写 pid 文件的 no-op 即可满足前者）；
- 用 `os.path.getmtime(worker-round.jsonl)` **单独**冒充「driver 恢复运转」（`touch` 即可骗过 —— criterion 用的是它，生产者必须另附直接量）；
- 把 `driver_pid_before/after` 或 in-flight pid 以**字符串**写进记录（criterion 侧 `isinstance(..., int)` 恒假 ⇒ 必不合格）；
- 为凑「有在飞 worker」的读数而**制造假在飞/假 worker 进程**，或为取证去杀生产在飞 worker；
- 改坏 `driver-runtime.ts:1593 stopKind()` 的「⛔ 不扫 in-flight」语义（那是被测对象，不是可调项）；
- 重启 `driver:worker` 之外还碰了其余五个 kind（本任务的最小作用面是一个服务）—— **本轮实测：六个 kind 的 pid 文件事后仍全部指向 anchor 3057428**；
- 用宽松 glob（`.quay/*driver*.pid`，实测 136）数进程 / 进记录。
