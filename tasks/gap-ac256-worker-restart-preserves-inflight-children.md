---
id: gap-ac256-worker-restart-preserves-inflight-children
title: GOAL-017/AC-256：重启 `driver:worker` 这一个服务不杀它在飞的 worker 子进程 —— 载体
  `.quay/unified-server-verification.jsonl` 有合格记录（SPEC §6.9 不变式 3 / §8-7 后半）
status: ready
needs_human_cause: unclassified
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
- `packages/quay/test/cli.test.mjs`（AC-256 的**第二处**同类陈旧点，与上一行是【同一次硬规则 5b 扫描的两个实例】：usage-fallback drift gate 的 `handlerSubs` 手工清单里 `server <verb>` 那一角没跟上 `restart` 动词 ⇒ 门把新动词报成 `extra`、整个文件红；修法同型 —— 从 `SERVER_VERBS` 派生，⛔ 不手抄第二份）
- `plugin/test/server-restart-inflight-verify.test.mjs` (new)（生产者的类型 / fail-closed / 负控制 / /proc 直接量 / 逐字跑 criterion）
- `packages/quay/test/server-restart.test.mjs` (new)（服务级 restart 的语义 + `start` no-op 对照 + anchor 安全闸的活体负控制）
- `tasks/gap-ac256-worker-restart-preserves-inflight-children.md`（自身文件：勾 AC + 贴实跑证据）

## Acceptance Criteria

- [x] **AC1 载体上判据翻转**：逐字跑 `goals/AC-256-重启单个服务不杀在飞-worker-重启-driver-worker-后其在飞子进程一个都没死-spec-6-9-不变式.md` 的 criterion ⇒ **exit 0**（立案当轮实测 exit 1：载体不存在）。贴出该命令的 exit code、载体 `.quay/unified-server-verification.jsonl` 的行数、以及那条 `ac="GOAL-017-AC-256"` 记录的原文。 ⇒ **达成（2026-09-14 05:09Z，生产 root）**：criterion 改前 **exit 1**（载体 3 行、`ac="GOAL-017-AC-256"` 的记录 0 条）→ 改后 **exit 0**（载体 **4 行**、该 ac 的记录 **1 条**）。记录原文见「实测」节。
- [x] **AC2 服务级重启面在位，且 `restart` 不是 `start` 兼职**：`quay server restart --only driver:worker`（或生产者的组合形态）可执行且 argv 留档（`restarted_via`）；**负控制**：`quay server start` 一个**已在跑**的服务 ⇒ exit 0 且该服务 pid **不变**（证明是 no-op 而非静默重启 —— §6.9 不变式 1）。两读数并列贴出。 ⇒ **达成**：正半 —— `restarted_via` 逐字留档 argv `…/packages/quay/bin/quay.ts server restart --only driver:worker --json --root /home/yale/work/quay`，exit 0，`outcome:"restarted"`，pid **2381279 → 169682**。负控制（§6.9 不变式 1）—— `quay server start --only driver:worker`（**已在跑**）⇒ `outcome:"already-running"`、exit 0、pid **169682 不变**；`--only web` ⇒ 同样 `already-running`、pid 1323037 不变、exit 0。
- [x] **AC3 在飞集合是独立推导且逐个存活**：`inflight_worker_pids_before` 由**进程树**推导（留 `inflight_source:"proc-tree"`）且**非空**、**每个 pid 取样时存活且非 Z 态**（留 `inflight_worker_pids_before_all_alive: true`）；贴出 driver 自报集合 `inflight_declared_by_driver` 与独立推导结果的**并列读数**。**负控制**：在飞为空时跑 ⇒ 零记录 + NOT-EVALUATED（证明「无可杀」不被计为合格）。 ⇒ **达成**：`inflight_source:"proc-tree"`；`inflight_worker_pids_before=[2593072,3562333,3600343,3611837,4148384]`（非空，5 个），`inflight_worker_pids_before_all_alive:true`。并列读数：独立推导 **5** vs driver 自报 `inflight_declared_by_driver` **1956 条**（`inflight_declared_vs_derived:"DIFFERENT — the independent derivation is authoritative"`）。**负控制（真实端到端，合成 root，⛔ 不碰生产）**：在飞为空 ⇒ `verdict:"NOT-EVALUATED"`、exit 2、**零记录**（载体文件不生成）。
- [x] **AC4 真重启（不是 pid 文件改写）**：`driver_pid_before != driver_pid_after` ∧ `driver_pid_before` 在重启后**真的不在**（`driver_pid_before_dead_after: true`）∧ `driver_pid_after` 活（`driver_pid_after_alive: true`）⇒ 三读数并列贴出。**负控制**：no-op（pid 不变）⇒ 拒写。 ⇒ **达成**：`driver_pid_before:2381279` ≠ `driver_pid_after:169682` ∧ `driver_pid_before_dead_after:true`（旧 pid 重启后真的不在）∧ `driver_pid_after_alive:true`。**负控制**：`--control no-op-read` 结构性对照 ⇒ `verdict:"NOT-A-RESTART"`、`record_written:false`、exit 1（证明该字段在做功而非装饰）。
- [x] **AC5 一个都没死（本任务的核心断言）**：`set(inflight_worker_pids_alive_after) == set(inflight_worker_pids_before)`，且 after 是**对原集合逐个再核活**（⛔ 不是重新枚举进程树）⇒ 贴出两个集合原文。**负控制（合成夹具，⛔ 不在生产上做）**：窗口内杀一个在飞 worker ⇒ 生产者/判据拒写（证明该断言能抓到真回退）。 ⇒ **达成**：`inflight_worker_pids_before` 与 `inflight_worker_pids_alive_after` **按集合相等**，且 after 是**对原集合逐个再核活**（⛔ 非重新枚举进程树）。两处原文均为 `[2593072,3562333,3600343,3611837,4148384]`。**负控制（合成夹具，⛔ 不在生产上做）**：`plugin/test/server-restart-inflight-verify.test.mjs` 的 (f) 用例 —— 窗口内杀一个在飞 worker ⇒ `verdict:"INFLIGHT-KILLED"` 且 reason 点名该 pid ⇒ 拒写。
- [x] **AC6 driver 真恢复运转（直接量，⛔ 不只靠 mtime）**：`.quay/worker-round.jsonl` 出现**晚于重启时刻的新 `run_id`** 记录（留 `worker_run_id_after` + `worker_round_ts_after`），并与 `os.path.getmtime` 并列贴出。**负控制**：只 stop 不 start ⇒ 零记录（证明「停了所以没杀人」不被计为达成）。 ⇒ **达成**：新 `run_id` **wk-prod-1789362571**（改前 wk-prod-1789350883），`worker_round_ts_after:"2026-09-14T05:09:35.418Z"` **严格晚于**重启动作时刻；并列 mtime 读数 `worker_round_jsonl_mtime:"2026-09-14T05:09:35.418Z"`（⛔ 不只靠 mtime）。**负控制**：只 stop 不 start ⇒ 测试 (e) `verdict:"DRIVER-NOT-RESUMED"` ⇒ 拒写。
- [x] **AC7 读数不自报（硬规则 4b）**：在飞集合与 driver 存活均由**独立推导**（进程树 / `/proc`）得到；⛔ 不采信 `.quay/worker-driver-inflight.pid`、`quay driver status` 或 `server status` 的自报（它们只作交叉核对字段留档）。贴出至少一处两者**一致或不一致**的并列读数。⇒ **达成**：`deriveInflight` 从 `/proc/<driver_pid>/task/*/children` ∩ 本 workspace 的 `task-workers` 角色名推导（`resolveWorkerProcessName(root)`，⛔ 不用写死的 `quay-task-worker`）；`aliveNonZombie` 读 `/proc/<pid>/status` 的 State 字符（⛔ 不用 `kill(pid,0)` —— 僵尸仍可被 signal）；自报文件只进 `inflight_declared_by_driver`。生产并列读数见「阻塞」节：**derived=[300998]（1 个真 worker）vs declared=1933 条**，`inflight_declared_vs_derived: "DIFFERENT — the independent derivation is authoritative"`。
- [x] **AC8 生产载体真跑过（硬规则 4 推论三）**：记录写在生产 root `/home/yale/work/quay/.quay/unified-server-verification.jsonl`，其 `ts` 晚于本任务实现落地时刻，且是在**统一 server 形态**（`quay server status --json` 报 web 与 control 同 host pid）上跑出来的。⛔ 不是 worktree、⛔ 不是夹具注入。 ⇒ **达成**：记录写在生产 root `/home/yale/work/quay/.quay/unified-server-verification.jsonl`，`at:"2026-09-14T05:09:26.328Z"` 晚于本任务实现落地时刻（分支提交 2026-09-13T22:19Z；本趟另有 05:0xZ 的探针修复提交）；且是在**统一 server 形态**上跑出（`quay server status --json` 报 web 与 control 同 host pid 1323037）。⛔ 唯一由夹具驱动的是【负控制】那几行，正记录来自生产真跑。
- [x] **AC9 零回退**：`plugin/test/driver-cli.test.mjs`、`plugin/test/driver-runtime*.test.mjs`、`packages/quay/test/serve-*.test.mjs`、`packages/quay/test/server-*.test.mjs` 全绿（贴各文件 `# pass`/`# fail` 计数）；`stopKind()` 的不杀语义未被改坏 —— 贴该函数头注释与 `driver-runtime.ts:1603-1611` 的 diff 为空。⇒ **达成**：driver-cli + driver-runtime\* **40 pass / 0 fail**；`server-*.test.mjs` **20 pass / 0 fail**；`serve-*.test.mjs` **182 pass / 0 fail**（183 tests）；`git diff develop -- plugin/scripts/driver-runtime.ts` **为空**（该文件本趟未被触碰，`stopKind()` 语义原样）。
- [ ] **AC10 全量套件绿 —— 外层 verification-round 验证**（本条的量产生在 fan-in / 外层 suite 轮，⛔ 不是 worker 自己的读数；scoped 门绿不等于全量绿）。

## 实测（2026-09-14 05:09Z，生产 root，真跑）

### ① 上一趟的阻塞已消失：阶段 C 的 anchor 不在

上一趟（2026-09-13 22:0xZ）报的阻塞是「阶段 C 的 anchor 把六个 kind 收进一个进程 ⇒
`driver_pid_before == driver_pid_after` 恒成立 ⇒ 判据结构上不可满足」。本趟开工前实测
（2026-09-14 05:07Z）该形态**已不存在**：

```
$ cat .quay/anchor.json                ⇒ No such file or directory
$ for k in promotion worker outer quality meta goal; do cat .quay/$k-driver.pid; done
2381001  2381279  2381709  4071640  4054342  4041369    ← 六个【不同】的 pid（各 kind 独立进程）
$ ps -p 2381279 -o args= ⇒ node …/plugin/scripts/dist/worker-driver.js --root /home/yale/work/quay …
$ quay server status --json ⇒ "pid 1323037 hosts web + control on one process"   ← 统一 server 形态
```

⇒ 上一趟列的处置 **(c)**（阶段 C 被回退 ⇒ 实现原样可用，只需在生产上跑一次）成立，本趟据此执行。

### ② 本趟新增并修掉的一个真缺陷（本任务第 4 个提交）

生产者判「这个 pid 是不是 worker 驱动」用的标记取自注册表的**源树文件名** `worker-driver.ts`，
而**生产跑的是出厂 bundle** `…/plugin/scripts/dist/worker-driver.js` ⇒ 该探针对**每一个真实生产
驱动恒假** ⇒ 生产者对**完全正确的 pid** 报 `refusing to act on an unrelated process` 而拒绝对它
动手。「恒假」与「驱动没在跑」同形（硬规则 4b：一个永远说不出「是」的读数携带零信息）。
修法：从【同一个】注册表条目派生 `.ts` + `.js` 两个形态，⛔ 不写第二个字面量；且⛔ 不放宽到裸
`worker` —— supervisor 的 cmdline 是 `driver-runtime.js __supervise --kind worker …`，带 kind 词
但不带驱动入口名，放宽就会把它误认成驱动。两个形态 + supervisor 排除各有 hermetic 用例钉住。

### ③ 真跑（就是本任务要的那一次服务级重启）

```
$ node --experimental-strip-types plugin/scripts/server-restart-inflight-verify.ts \
    --root /home/yale/work/quay --cli <worktree>/packages/quay/bin/quay.ts --json
⇒ verdict=OK, record_written=true, exit 0
```

写入载体 `.quay/unified-server-verification.jsonl`（第 4 行）的记录原文（节选全部判据字段）：

| 字段 | 值 |
|---|---|
| `ac` | `GOAL-017-AC-256` |
| `restarted_service` | `driver:worker` |
| `at` | `2026-09-14T05:09:26.328Z` |
| `driver_pid_before` → `driver_pid_after` | `2381279` → `169682` |
| `driver_pid_before_dead_after` | `true`（旧 pid 重启后**真的不在**） |
| `driver_pid_after_alive` | `true` |
| `inflight_worker_pids_before` | `[2593072, 3562333, 3600343, 3611837, 4148384]` |
| `inflight_worker_pids_alive_after` | `[2593072, 3562333, 3600343, 3611837, 4148384]`（**集合相等 ⇒ 一个都没死**） |
| `inflight_worker_pids_before_all_alive` | `true` |
| `inflight_source` | `proc-tree` |
| `worker_run_id_before` → `worker_run_id_after` | `wk-prod-1789350883` → `wk-prod-1789362571` |
| `worker_round_ts_after` | `2026-09-14T05:09:35.418Z`（严格晚于重启动作时刻） |
| `worker_round_jsonl_mtime` | `2026-09-14T05:09:35.418Z`（与直接量并列，⛔ 不只靠 mtime） |
| `restarted_via` | `<worktree>/packages/quay/bin/quay.ts server restart --only driver:worker --json --root /home/yale/work/quay` |
| `restarted_exit` | `0` |

被重启的服务自身的 stdout（服务级面）：

```
$ quay server restart --only driver:worker --json --root /home/yale/work/quay   ⇒ exit 0
{ "action":"restart", "changed":true, "changedCount":1,
  "services":[{"name":"driver:worker","outcome":"restarted","pid":169682,
  "detail":"driver restarted via `quay driver restart --kind worker` — pid 2381279 → 169682;
            in-flight worker children are NOT killed (stopKind does not scan in-flight)"}] }
```

事后核对（⛔ 最小作用面 = 一个服务）：

```
$ for k in promotion worker outer quality meta goal; do …; done
promotion 2381001(S)   worker 169682(R)   outer 2381709(S)
quality 4071640(S)     meta 4054342(S)    goal 4041369(S)
⇒ 其余五个 kind 的 pid 与本趟开工时【逐字相同】——一个都没被碰
$ ps -p 4148384 -o state= ⇒ S
⇒ 本会话（本任务自己的 worker 进程，重启前在被杀驱动的进程树里）在重启后仍存活
```

### ④ 判据翻转（AC1 的直接读数）

```
改前（本趟开工时 05:07Z）：载体 3 行，ac=GOAL-017-AC-256 的记录 0 条  ⇒ criterion exit 1
改后（05:1xZ）：           载体 4 行，ac=GOAL-017-AC-256 的记录 1 条  ⇒ criterion exit 0
```

criterion 从 `goals/AC-256-….md` 的 frontmatter `criterion:` 折叠块解出（yaml，⛔ 未手抄、⛔ 未改一字）后原样执行：

```
$ bash /tmp/ac256-criterion.py ; echo EXIT=$?
EXIT=0
```

### ⑤ 负控制（逐条能取假）

| 控制 | 怎么做的 | 结果 |
|---|---|---|
| 结构 no-op（AC2/AC4） | `--control no-op-read`：拿 `server status` 纯读顶替重启动作 | `verdict=NOT-A-RESTART`、`record_written=false`、exit 1 —— 证明 `driver_pid_before != after` 在做功 |
| `start` 不静默重启（AC2，§6.9 不变式 1） | `quay server start --only driver:worker`（**已在跑**） | `outcome=already-running`、exit 0、pid **169682 不变**；`--only web` ⇒ pid 1323037 不变、exit 0 |
| 空集（AC3，**真实端到端**，⛔ 不碰生产） | 合成 root：`server.json`（web+control 同 pid）+ 一个真进程顶着 `worker-driver.js` 的 cmdline、无子进程 | `verdict=NOT-EVALUATED`、exit 2、**零记录**（载体文件不生成） |
| 杀子进程（AC5，合成夹具） | 测试 (f)：窗口内杀一个在飞 worker | `verdict=INFLIGHT-KILLED`，reason **点名该 pid** ⇒ 拒写 |
| 停机不恢复（AC6，合成夹具） | 测试 (e)：run_id 不变 / round ts 不晚于重启 | `verdict=DRIVER-NOT-RESUMED` ⇒ 拒写 |
| 僵尸前集（AC3 b，合成夹具） | 测试 (a)/(b)：before 含已死/僵尸 pid | `verdict=NOT-EVALUATED` ⇒ 拒写 |

### ⑥ 被测对象未被修改

`git diff develop -- plugin/scripts/driver-runtime.ts` ⇒ **0 行**（`stopKind()` 的「⛔ 不扫
in-flight」语义原样未动）。重启走的正是既有 `quay driver restart --kind worker`（= stopKind +
startKind）的组合形态，⛔ 未新增任何杀进程路径。

### ⑦ 未勾的 AC

只剩 **AC10**（全量套件绿 —— 外层 verification-round 验证）⛔ 保持未勾：它的量产生在 fan-in /
外层 suite 轮，⛔ 不是 worker 自己的读数（scoped 门绿 ≠ 全量绿）。其余 9 条全部达成。

### ⑧ 本趟（2026-09-14 续做）：上一趟那堵「归因不出」的 suite 红已定位并修掉

上一趟以「suite 红但归因不出任何失败测试文件」标了 needs-human。**本趟查明它不是基建缺陷 —— 是一个真缺陷 + 一个跑法陷阱**。

**根因（真缺陷，本任务自己的 `5d6d61d91` 引入）**：AC-256 把 `restart` 加进了 `bin/quay.ts` 的 fallback
usage 行，却漏了 `packages/quay/test/cli.test.mjs` 的 usage-fallback drift gate（block28）里那份**手工抄的**
`handlerSubs` 清单 ⇒ 门把新动词报成 `extra`（present in the usage line, absent from the expected set），整个文件红。
**这正是硬规则 5b**：上一趟已在 `47680e3f5` 把**兄弟实例**（`server-status-web-control-same-pid.test.mjs` 的用法行断言）
改成从 `SERVER_VERBS` 派生，**只修了被报出来的那一个**，漏了同一缺陷类在这份载体里的第二个实例。
**修法同型**：`handlerSubs` 的 `server <verb>` 一角也改为 `SERVER_VERBS.map((v) => \`server ${v}\`)` —— 类被关掉，不是打一个补丁。

**为什么上一趟「归因不出」**：`cli.test.mjs` 用**自带 harness**（自定义 `FAIL: …` 打到 stdout、然后 exit 1），
而全量套件日志**不落该文件的 stdout** ⇒ 日志里只剩 `test at …:1:1 'test failed'`，**没有任何测试名**。
⇒ 归因的位置不是在套件日志里找，是**单独跑那个文件**。（同族硬规则 3b：一个只报「失败」不报「哪条失败」的载体，与「查不出」同形。）

**第二个红（10 条 golden-replay）是跑法陷阱，⛔ 不是缺陷**：直接 `node --test` 时 `dist/` 是陈旧的
⇒ `cli-entry.mjs` 回退到 `.ts` 源，**子进程**于是为 `plugin/scripts/shape-sections.ts`（根 `package.json` 无 `"type":"module"`）
打出 `MODULE_TYPELESS_PACKAGE_JSON` 警告，**而该警告文本里带 node 进程号** ⇒ 与进程内那侧**永远不可能**逐字节相同。
**⇒ 走 `scripts/test.sh`（会重建 dist）才有意义** —— 与本仓既知陷阱 `direct-node-test-in-worktree-reds-golden-replay-no-dist` 同形。

**本趟读数（⛔ 非 fixture；`cli.test.mjs` 一行为 fresh dist 下无任何 env 技巧直跑）**：

| 读数 | 值 |
|---|---|
| `packages/quay/test/cli.test.mjs`（fresh dist） | **exit 0，pass 1 / fail 0，0 条 `FAIL:`** |
| 同文件 · 改前对照（main checkout，无本修） | `FAIL: usage fallback command set == dispatch-table command set (missing: , extra: server restart)` |
| `plugin/test/driver-resolves-code-root-separate-from-workspace.test.mjs` | **7 pass / 0 fail**（上一趟另一条红；随 merge 带入 develop 的 `951fbb15c` 后消失 —— 纯滞后，非缺陷） |
| `anti-drift-touches-check` | **`ANTI-DRIFT OK` — 9 actual file(s), all within declared Touches (11 globs)** |
| AC-256 criterion（生产 root，从 frontmatter 折叠块解出后逐字跑） | **exit 0**（载体 4 行、`GOAL-017-AC-256` 记录 1 条） |
| scoped 门 `--for-task … --allow-thin` | **exit 0** |

**5b 扫描（本趟产物）**：按「手工抄的 server 动词集」在 `packages/quay/{src,test,bin}` + `plugin/{scripts,test}` 全扫，
命中 **3 处**：`src/cli/server.ts`（`SERVER_VERBS` 单一真源 ✓）、`bin/quay.ts:223`（fallback usage 行，已含 `restart` ✓）、
`src/cli/help.ts:61/389`（两处 `quay server restart` 都在 ✓）⇒ **陈旧的手工清单只有 `cli.test.mjs` 这一处**，已修。

**⚠️ 一处结构性遗留（本趟未动，⛔ 不在本任务范围）**：scoped 门的测试选择是按每个测试文件**自报的 `@judges` glob** 取交，
而 `cli.test.mjs` 不声明自己 ⇒ **本趟的改动不在 scoped 门的选择面内**（实测：门选中 105 个测试文件，其中**没有** `cli.test.mjs`）。
**这正是上一趟「scoped 绿而全量红」的机制半边** —— scoped 门绿 ⇒ 不等于这个文件被跑过。


## Definition of Done

**AC-256 的 criterion 在生产载体上 exit 0，且那条记录是一次真运行、真服务级重启、真差分的产物**：`driver:worker` 是作为**服务**被重启的（记录留 `restarted_via` argv），重启前在飞的 worker 子进程集合由**进程树独立推导**且**逐个存活**，重启后**对原集合逐个再核活**得到的集合与之前**完全相等**；`driver_pid_before` 在重启后**真的不在**；`.quay/worker-round.jsonl` 在重启后出现**晚于重启时刻的新 `run_id`** 记录（直接量，⛔ 不只 mtime）。生产者对每条读数 fail-closed：读不出/不满足 ⇒ 零记录 + 可区分的未评估值。

**✅ 本趟达成（2026-09-14 05:09Z，生产 root，真跑）**：上面每一条都在生产上跑出来了 ——
`driver:worker` 是作为**服务**被重启的（`restarted_via` 留 argv 原文，exit 0）；重启前在飞的
**5 个** worker 子进程由**进程树独立推导**（`inflight_source:"proc-tree"`）且**逐个存活**
（`inflight_worker_pids_before_all_alive:true`）；重启后**对原集合逐个再核活**得到的集合与之前
**完全相等**；`driver_pid_before`(2381279) 重启后**真的不在**（`driver_pid_before_dead_after:true`）
而 `driver_pid_after`(169682) 活；`.quay/worker-round.jsonl` 出现**晚于重启时刻的新 `run_id`**
记录（`wk-prod-1789362571`，`ts=2026-09-14T05:09:35.418Z`，直接量），并与 mtime 并列留档。
criterion 逐字跑 **exit 0**。⛔ 唯一由夹具驱动的是【负控制】那几行，正记录来自生产真跑。

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

## Needs-Human

**执行 2026-09-14T05:29:48.867Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 2 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (the suite log names nothing a worker could fix); stopping instead of spending another worker session
- 成因类：unclassified
- 失败步/判词：adopted orphan worker exited (exit code unobservable) — task status=ready (not done) and leftover worktree task/gap-ac256-worker-restart-preserves-inflight-children still present
- run_id：wk-prod-1789350883
## Needs-Human

**执行 2026-09-14T11:19:05.619Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：suite 红但归因不出任何失败测试文件（基建/契约疑似，非实现缺陷）——停止重派，⛔ 不再拿新会话撞同一堵墙：suite red could not be attributed to any failing test file in 3 consecutive rounds (bounded to at most one retry) — infra/contract suspected, not an implementable defect (the suite log names nothing a worker could fix); stopping instead of spending another worker session
- 成因类：unclassified
- 失败步/判词：adopted orphan worker exited (exit code unobservable) — task status=ready (not done) and leftover worktree task/gap-ac256-worker-restart-preserves-inflight-children still present
- run_id：wk-prod-1789367589
