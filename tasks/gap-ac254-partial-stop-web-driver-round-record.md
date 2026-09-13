---
id: gap-ac254-partial-stop-web-driver-round-record
title: GOAL-017/AC-254：服务可独立起停 —— `quay server stop --only web` 后 driver round
  心跳仍推进，且 `.quay/unified-server-verification.jsonl` 有合格记录（SPEC 阶段 B / §6.9 不变式
  2）
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
depends_on:
  - gap-ac251-unified-server-web-control-same-process
goal_ac: AC-254
---
## Proposal

**AC-254 现状（立案当轮实测，2026-09-13T15:0xZ，取假形态）**：

```
载体   ls .quay/unified-server-verification.jsonl   ⇒ No such file or directory
CLI    node packages/quay/bin/quay.js server status --json
       ⇒ 打印 usage 行（动词表 <adr|goal|…|driver> 里没有 server）；
         packages/quay/src/cli/server.ts 不存在
认领   grep -rn '^goal_ac: AC-254' tasks/*.md       ⇒ 0
进程   六个 kind 的 .quay/<kind>-driver{,-supervisor}.pid 各自认领的进程逐个 kill -0 ⇒
       12 个全存活；+ .quay/serve.pid = 3157065（etime 3-16:44:19，
       cmdline `node --watch --experimental-strip-types packages/quay/bin/quay.ts serve
       --host 0.0.0.0 --port 4173`）⇒ 13 个长驻进程
web    curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4173/health ⇒ 200
心跳   promotion round=300 run_id=pm-prod-1788972469 ts=15:02:25Z /
       worker round=2499 run_id=wk-prod-1789139008 ts=14:59:16Z /
       outer round=2560 run_id=ot-prod-1789060079 ts=15:01:29Z /
       goal round=62 run_id=gl-prod-1788972477 ts=14:59:15Z /
       quality round=441 run_id=qg-prod-1788972493 ts=15:02:28Z /
       meta round=489 run_id=mt-prod-1788972492 ts=15:02:51Z（六 kind 全新鲜）
```

⇒ 三层缺口叠加：**① 载体不存在**（`.quay/unified-server-verification.jsonl` 从未被创建，该 AC 自诞生起未跑过）；**② 生产者不存在**（全仓 `grep -rn 'unified-server-verification' plugin/ packages/` ⇒ 0 命中）；**③ CLI 面不存在**（SPEC §6.9 的四个动词里 `status` 属阶段 A2/AC-251，`start`/`add`/`stop` 属本阶段 B，今天一个都没有）。三者都不满足 ⇒ 判据结构上必然取假。

**为什么这是 SPEC 阶段 B、不是新功能**：`orchestration/SPEC-unified-quay-server-2026-09-13.md` §7 阶段 B 逐字：「CLI 先行（§6.8）：实现 §6.9 的四个动词 + 服务清单」，其判据是「① 每个服务可独立起停（逐个负控制）；② 停 `web` 时 driver 的 round 心跳不中断；③ 合并后的独立起停能力 ≥ 合并前」。AC-254 是②的机器判据。§6.9 的三条不变式各自可取假：幂等（start 一个已在跑的服务 = no-op，⛔ 不是静默重启）、部分操作不波及其余（停 web ⇒ driver 心跳不中断）、⛔ 不得只能整体重启。

**⚠️ 本任务设计的关键：在阶段 A 之前，「停 web」这个读数结构上是空转。** 现状 13 个进程时 `quay serve` 与 driver 分属不同进程（实测：`serve.pid` = 3157065，与 12 个 driver pid 全不相等）⇒ **无论实现质量如何，停掉 serve 都不可能影响 driver 的 round**，即在旧形态上产出的记录**不能取假** ⇒ 它不是测量（硬规则 4）。⇒ 生产者必须在**统一 server 形态**（web + control 同 host 进程，SPEC §7 阶段 A2）上跑，这也是本任务声明 `depends_on` `gap-ac251-unified-server-web-control-same-process` 的机制理由（本任务消费它的 `server status` 子命令、`.quay/server.json` 载体与合进程形态，⛔ 不重复实现）。

**两条对判据的加强（⛔ 本任务不改判据文件 `goals/AC-254-*.md`）**，与 `gap-ac250-web-observe-tailscale-progress-record` 在载体生产者形态上的做法同族：

1. criterion 只要求 `web_reachable_after=false` —— 但**「停之前就不可达」同样满足它**（空转）⇒ 生产者必须另外要求 `web_reachable_before=true`，两读数并列留档。
2. criterion 只要求 `driver_round_after > driver_round_before` —— 但若两点读数取自**不同 `run_id`**（driver 被重启，round 从 1 重数），会得到一条「发生了什么」也没观察到的记录 ⇒ 生产者必须要求**同一 `run_id`**。

**为什么「host 进程仍活 + control 仍可达」是必须的（不是加戏）**：§6.9 逐字「服务是可独立起停的单元，**进程只是宿主**」，不变式 2 是「部分操作不波及其余」。若 `stop --only web` 的实现等同杀掉 host 进程，那么同进程的 `control` 服务一并死掉 —— 那正是「波及其他服务」。⇒ 停 web 之后必须同时读到：web 端口不可达 ∧ **host pid 不变** ∧ `control` 端口仍响应。三读数缺一，则「独立起停」与「整体重启」在记录上无法区分。

**已知陷阱（实测，直接作为实现约束，⛔ 不重新发现）**：

- **round 载体里 `round` 是 JSON 字符串**：`.quay/worker-round.jsonl` 末行实测 `{"ts":"2026-09-13T14:59:16.890Z","round":"2499","run_id":"wk-prod-1789139008",…}`。criterion 侧是 `isinstance(b, int)` ⇒ **直接把字符串 dump 进记录必然不合格**（恒假），写入前必须转换。同族先例：`nested-field-read-null-indistinguishable-from-genuine-null`（报字段值前先打印承载对象的完整键集）。
- **每个 kind 的 round 载体 = `.quay/<kind>-round.jsonl`**，六个 kind 的权威清单在 `plugin/scripts/driver-runtime.ts` 的 `DRIVER_KINDS[*].carriers`（⛔ 不硬编码六文件名）。判定用**直接量**（末行 `round`/`ts`/`run_id`），⛔ 不用「pid 文件存在」这种代理量（CLAUDE.md 硬规则 4b）。
- **⛔ 不用宽松 glob 数进程**：`ls .quay/*-driver*.pid | wc -l` 实测 **136**（把 `suite-load-*.jsonl.pid` 全数进来），真值 12 —— 这个读数若进记录就是一具假的取证。
- **`quay serve` 没有 supervisor**（`plugin/scripts/start-drivers.ts` 是自行背景化起它的）⇒ 停掉 web 后的**恢复**是生产者自己的责任，⛔ 不得把生产 web 留在停机态（它是人观察 dashboard 的唯一入口）。
- **⛔ 不得对生产 driver 实跑 `quay driver stop`**（会停掉在跑的 driver），与 AC-251 的边界一致；本任务只停 `web` 这一个服务。

<!-- dedup-ref -->
**与既有任务的关系（仅追溯，不构成任何依赖声明）**：`gap-ac251-unified-server-web-control-same-process`（ready）交付 `quay server status` 子命令、`.quay/server.json` 进程自发布载体与 web+control 合进程（阶段 A2），其 Touches 含 `packages/quay/src/cli/server.ts` 与 `packages/quay/src/serve.ts`；`gap-ac252-control-plane-hoist-to-layer0`（ready）与 `gap-ac253-session-primitives-shared-layer-adoption`（ready）属阶段 A 的另两步，机制（控制面上收 / 会话原语统一）与本任务（部分停机 + 载体记录）不同、Touches 不相交；`gap-ac250-web-observe-tailscale-progress-record`（done）是本任务在「AC 自己要求一个载体 ⇒ 如何立案一个 fail-closed 生产者」这一形态上的先例（其跨机绑定判据与本任务无关）。全仓 `grep -rn '^goal_ac: AC-254' tasks/*.md` = 0（立案当轮实测），`grep -rln 'unified-server-verification' plugin/ packages/` = 0，无重复立案。

## Plan

1. **CLI 先行，补齐阶段 B 的四动词（§6.8）** —— 在 `packages/quay/src/cli/server.ts`（AC-251 新建）上与既有 `status [--json]` 并列实现 `start [--only <svc,...>] [--without <svc,...>]` / `add <svc,...>` / `stop [--only <svc,...>]`，动词派发与 usage 行在 `packages/quay/bin/quay.ts`，帮助条目在 `packages/quay/src/cli/help.ts`。**服务清单单一实现**（web / control / driver:promotion|worker|outer|goal|quality|meta），四个动词与 `status` 共用同一份清单与同一份判定（§6.8 单一实现纪律：⛔ 不出现第二份并行实现；SPEC §8 判据 1 的同族形态）。⛔ 本任务不加新的 Web 能力面（Web 是 CLI 的投影，§6.8；⛔ 也不得出现「只有 Web 能做」的动作）。

2. **`driver:<kind>` 服务是对既有 driver CLI 的组合，⛔ 不重写 driver 起停** —— `start --only driver:worker` ≡ 既有 `quay driver start --kind worker`，`stop --only driver:worker` ≡ 既有 `quay driver stop --kind worker`（**其「不杀在飞 worker 子进程」的语义原样保留**，SPEC §6.9 不变式 3）。本任务不改 `plugin/scripts/driver-runtime.ts` / `driver-shared.ts`（那是阶段 A1/AC-252 的 Touches）。

3. **部分停机的实现语义（本任务的核心约束）** —— `stop --only web` **只关掉 web 面**（释放 HTTP listener），**⛔ 不杀 host 进程**：同进程的 `control` 必须仍然可达，`server status --json` 必须仍能报出该 host。控制通道走 §6.3 的「拉」路径（既有 MCP 控制面，单一实现），若需要一个新的控制动词，它落在**同一份**控制面实现里（⛔ 第二份实现即未达成）；⛔ 不得用「杀掉 host 进程再靠外层重新拉起」冒充部分停止（那正是 §6.9 排除的形态）。

4. **幂等（§6.9 不变式 1）** —— `start` 一个已在跑的服务 = **no-op**：exit 0 且服务 pid / 该 kind 的在飞子进程集合**不变**（两读数并列留档）；⛔ 不是报错、⛔ 尤其不是静默重启（重启会打断在飞 worker）。`add` 追加启动时 ⛔ 不影响已在跑的服务的进程与心跳。`stop` 一个本来就不在跑的服务 ⇒ **可区分取值**（如 exit 0 + `already-stopped` 标记，或 exit 非 0），⛔ 不得与「刚刚停掉」同形（硬规则 3b）。

5. **生产者（新脚本 `plugin/scripts/server-partial-stop-verify.ts`）** —— 一次运行按顺序：① 真 HTTP 探 web（**before**，必须 200，否则本趟只输出可区分的 NOT-EVALUATED 并退出非 0）；② 读六个 `.quay/<kind>-round.jsonl` 末行，取 `run_id` + `int(round)` + `ts`；③ 执行 `quay server stop --only web`（记录其 argv/exit/stdout 原文）；④ 探 web 不可达 ∧ `kill -0 <host pid>` ∧ 对 control 端口发一条 JSON-RPC（`initialize` 或未注册方法探针）拿到 JSON-RPC 形态响应；⑤ 在窗口内等到**同一 `run_id`** 的 round 前进（或超时 ⇒ 零记录）；⑥ 读 after 读数并组装记录 append 到 `<workspaceRoot>/.quay/unified-server-verification.jsonl`；⑦ **恢复 web** 并核 `/health` = 200（恢复失败要响亮报错，⛔ 不静默留下停机态）。任一条读不出/不满足 ⇒ **零记录** + 可区分的 NOT-EVALUATED + 退出非 0（硬规则 3b：「读不懂」不得返回与「合格」同形的值）。

6. **记录字段形态 fail-closed（字段类型就是判据的一部分）** —— `ac` 必须逐字 `"GOAL-017-AC-254"`；`stopped_service` 必须逐字 `"web"`；`driver_round_before`/`driver_round_after` 必须是 **JSON 整数**且 `after > before`；`web_reachable_after` 必须是 JSON **`false`**（⛔ 不是 `"false"`/`0`）；`driver_kinds_alive_after` 必须是非空 list。另加**加强字段**（判据不读，供交叉核对）：`web_reachable_before: true`、`driver_run_id`、`driver_carrier`、`host_pid_before/after`、`control_reachable_after: true`、`ts`、`stopped_via`。缺任一必需字段 ⇒ **不写** + 非 0 退出。

7. **负控制（逐条能取假，⛔ 不能只报正读）** —— a) **空转控制**：`web_reachable_before` 不为 200（web 本来就没起）⇒ 零记录 + NOT-EVALUATED；b) **整体停机控制**：杀掉 host 进程（而不是 `stop --only web`）⇒ control 不可达 / host pid 变了 ⇒ **拒写**（证明「部分停止」与「整体重启」在记录上可区分）；c) **不同 run 控制**：after 取自另一个 `run_id` ⇒ 拒写；d) **零推进控制**：窗口内 round 未前进 ⇒ 零记录 + 与「没测成」**可区分**的取值（测量了、没推进 ≠ 没测成）；e) **类型控制**：把 `round` 以字符串写入 ⇒ 判据侧必须判不合格（贴出该读数）；f) **判据三态**：载体副本删该记录 ⇒ exit 1；载体移走 ⇒ 本 AC 是 spec 里的特例（载体即本 AC 产物）⇒ **exit 1（未达成），⛔ 不是 exit 3**，与 exit 0 并列留档。

8. **夹具与自检** —— 生产者的判定/组装逻辑要有 hermetic 正/负控制并进套件，**正控制直接调生产函数**（⛔ 不让夹具复刻判定逻辑，硬规则 4 推论三：只能被 fixture 满足的判据不是测量）。新脚本 `plugin/scripts/server-partial-stop-verify.ts` 入场要按 `plugin/scripts/capability-catalog.sh` 头注释补**六张表各一行**（QUESTION / CADENCE / INVALIDATION / LAST_REAFFIRMED / MATCHING / CONSUMER），⛔ 否则 `--entry-surface` 会打印 PASS 却 exit 1。本脚本是**生产者**不是静态检查器 ⇒ ⛔ 不登记进 `runner-static-gate.ts` 的 `run_static_checks`（否则 AC 未达成期间全量套件每轮变红）。

9. **真跑一次（唯一能产出合格记录的路）** —— 在生产 root（`/home/yale/work/quay`，⛔ 不是 worktree、⛔ 不是内嵌端口 0 的测试进程）的统一 server 形态上跑生产者，记录写进生产载体；贴出记录原文 + 载体行数 + 逐字跑 `goals/AC-254-*.md` criterion 的 exit code（改前 exit 1 → 改后 exit 0，两条并列）。

10. **零回退** —— `quay driver stop --kind X` 的既有语义由既有测试覆盖并全绿；`node --test packages/quay/test/serve-*.test.mjs`（Web 全部既有路由）全绿；`plugin/test/start-drivers.test.mjs`、`plugin/test/driver-cli.test.mjs` 全绿。⛔ 实现与验证期间不得对生产 driver 实跑 `quay driver stop`。

## Touches

- `packages/quay/src/cli/server.ts`（阶段 B 的 `start`/`add`/`stop`；`status` 由 AC-251 交付）
- `packages/quay/bin/quay.ts`（`server` 子动词派发 + usage 行）
- `packages/quay/src/cli/driver-vocab.ts`（服务清单的**单一实现**：`web`/`control` + 六个 `driver:<kind>`；四个动词与 `serve.ts` 都从这里 import，⛔ 不各写一份 —— SPEC §6.8 单一实现纪律。它零 import ⇒ `quay --help` 取清单不必付 `cli/serve` 那份加载成本）
- `packages/quay/src/cli/help.ts`（`server start/add/stop` 帮助条目）
- `packages/quay/src/serve.ts`（服务生命周期宿主：web 面的独立关停，⛔ 不杀 host 进程）
- `plugin/scripts/server-partial-stop-verify.ts` (new)（生产者：停 web + 差分 + fail-closed 组装 + 恢复 web）
- `plugin/scripts/capability-catalog.sh`（新脚本的六张表各一行声明）
- `packages/quay/test/server-partial-stop.test.mjs` (new)（四动词 + 幂等 + 部分停机语义 + 负控制）
- `packages/quay/test/cli.test.mjs`（**既有 verb-table 闸**：把阶段 B 的三个动词登记进它枚举的 `handlerSubs` —— 不登记则该闸正确地把它们判为 `extra` 漂移，全量套件变红）
- `packages/quay/test/server-status-web-control-same-pid.test.mjs`（AC-251 的兄弟测试：随 AC-254 的语义变更改写 —— carrier 退役从 `server.close()` 移到 `shutdownHost()`（web 面 close 现在是**正常的部分操作**，不再是宿主的终结），usage 断言随四动词更新；stage-A 那条「start/add/stop 不可达」的断言按 §8 判据 9 被替换）
- `plugin/test/server-partial-stop-verify.test.mjs` (new)（生产者的类型/fail-closed 正负控制）
- `tasks/gap-ac254-partial-stop-web-driver-round-record.md`（自身文件：勾 AC + 贴实跑证据）

## Acceptance Criteria

- [x] **AC1 载体上判据翻转**：逐字跑 `goals/AC-254-服务可独立起停-停-web-后-driver-的-round-心跳仍在推进-spec-阶段-b-6-9-不变式-2.md` 的 criterion ⇒ **exit 0**（立案当轮实测 exit 1：载体不存在）。贴出该命令的 exit code、载体 `.quay/unified-server-verification.jsonl` 的行数、以及那条 `ac="GOAL-017-AC-254"` 记录的原文。
- [x] **AC2 阶段 B 的 CLI 面在位且幂等**：`quay server start|add|stop|status` 四个动词都在动词表与帮助里（打印实际 `--help` 输出前 3 条命中，⛔ 不凭印象）；`start` 一个**已在跑**的服务 ⇒ exit 0 且该服务 pid **不变**（两读数并列，证明是 no-op 而非静默重启）；`stop` 一个**不在跑**的服务 ⇒ 取值与「刚停掉」可区分（贴两读数）；`add` 追加启动时已在跑的服务的 pid 与 round 心跳不受影响。
- [x] **AC3 部分停机不波及其余（不变式 2，本任务的加强形式）**：`quay server stop --only web` 前 `curl /health` = 200（`web_reachable_before=true`）∧ 停后 web 端口不可达 ∧ **host pid 不变**（`kill -0` 实测）∧ `control` 端口仍能拿到 JSON-RPC 形态响应 ⇒ 四读数并列贴出。⛔ 缺 `before=true` 则 `after=false` 是空转，不算达成。
- [x] **AC4 round 推进是同一 run 的直接量**：记录里 `driver_round_before`/`driver_round_after` 取自**同一 `run_id`** 的 `.quay/<kind>-round.jsonl` 末行，且 `after > before`；贴出两点读数的**行原文**（含 `run_id`/`round`/`ts`）。**负控制**：窗口内 round 未前进（或 after 取自另一 `run_id`）⇒ **零记录** + 与「没测成」可区分的取值。⚠️ 载体里 `round` 是字符串 ⇒ 写入前必须转换，且贴出「字符串直写 ⇒ 判据判不合格」的对照读数。
- [x] **AC5 读数不自报（硬规则 4b）**：`web_reachable_before/after` 由**独立 HTTP 探针**（对 `<web port>` 真发请求）得到，⛔ 不采信 `quay server status` 的自报；`driver_kinds_alive_after` 由 round 心跳新鲜度（直接量）得到，⛔ 不用 pid 文件存在性。**结构控制**：整体杀掉 host 进程（而非 `stop --only web`）⇒ 生产者**拒写**记录（control 不可达 / host pid 变了）⇒ 证明「部分停止」与「整体重启」可区分，两读数并列。
- [x] **AC6 零回退且不越界**：`node --test packages/quay/test/serve-*.test.mjs`、`plugin/test/start-drivers.test.mjs`、`plugin/test/driver-cli.test.mjs` ⇒ 全绿（贴各文件 `# pass`/`# fail` 计数）；`quay driver stop --kind X` 不杀在飞 worker 子进程的语义保持（由既有测试覆盖，⛔ 期间不得对生产 driver 实跑 `quay driver stop`）。
- [x] **AC7 生产载体真跑过（硬规则 4 推论三）**：记录写在生产 root `/home/yale/work/quay/.quay/unified-server-verification.jsonl`（⛔ 不是 worktree、⛔ 不是夹具进程），其 `ts` 晚于本任务实现落地时刻，且是在**统一 server 形态**（web 与 control 同 host pid，由 `quay server status --json` 的整数 pid 相等证实）上跑出来的。同时留档**web 已恢复**：`curl /health` = 200（⛔ 不把生产观察面留在停机态）。
- [ ] **AC8 全量套件绿 —— 外层 verification-round 验证**（本条的量产生在 fan-in / 外层 suite 轮，⛔ 不是 worker 自己的读数；scoped 门绿不等于全量绿）。

## Definition of Done

**AC-254 的 criterion 在生产载体上 exit 0，且那条记录是一次真运行、真部分停机、真差分的产物**：`quay server stop --only web` 是在**统一 server**（web 与 control 同 host 进程）上经 CLI 真执行的，停后 web 端口真不可达、**host 进程仍活**、`control` 仍可达；`driver_round_after > driver_round_before` 取自**同一 `run_id`** 的 round 载体末行，且 `driver_kinds_alive_after` 里的 kind 正是在窗口内推进过的那些（⛔ 不是「pid 文件还在」）。生产者对每一条读数都 fail-closed：读不出/不满足 ⇒ 零记录 + 可区分的未评估值，⛔ 不与合格同形。生产 web 在验证结束后已恢复（`/health` = 200）。

⛔ 以下不算达成：

- 只在 worktree 的 `.quay/` 里自证，而生产 root 的载体上没有记录；或记录由夹具/注入产生（硬规则 4 推论三）；
- 在**阶段 A 之前的 13 进程形态**上跑出来的记录 —— 分离进程下停 serve 结构上不可能影响 driver，那样的读数不能取假，不是测量（硬规则 4）；
- 跳过 `web_reachable_before=true`，用「本来就不可达」冒充「停掉后不可达」（空转）；
- 前后两点取**不同 `run_id`**（driver 被重启、round 重数）而声称观察到了推进；
- 把 `round` 以字符串写进记录（criterion 侧 `isinstance(b,int)` 恒假 ⇒ 必不合格）；
- 用「pid 文件存在」或 `server status` 的自报冒充 driver 存活/round 推进（硬规则 4b：被测对象自己产生、自己维护的量，不能单独用来判它）；
- `stop --only web` 的实现等同杀掉 host 进程（把同进程的 `control` 一并打死）——那是「波及其他服务」，正是 §6.9 排除的形态；
- 用宽松 glob（`.quay/*-driver*.pid`，实测 136）数进程/进记录；
- 只实现 `stop` 而把 `start`/`add` 留空（§6.9 的四个动词是同一能力的四个面），或把 `start` 一个已在跑的服务实现成静默重启（会打断在飞 worker）；
- 生产 web 留在停机态。

## Evidence

**AC1 — 载体上判据翻转**：逐字跑 `goals/AC-254-…md` 的 `criterion` 块（从该文件 frontmatter 原样解出 `python3 - <<'P' … P`，交 bash 执行，`cwd=/home/yale/work/quay`）⇒ **exit 0**（立案当轮实测 exit 1：载体不存在）。载体 `.quay/unified-server-verification.jsonl` **行数 = 3**。最新那条（本轮在**修复后**的代码上真跑，`at=2026-09-13T18:52:28.659Z` / `ts=2026-09-13T18:55:47.683Z`，宿主 pid 1323037）原文（节选关键字段，全文即载体末行）：

```json
{"ac":"GOAL-017-AC-254","stopped_service":"web","web_reachable_after":false,
 "at":"2026-09-13T18:52:28.659Z",
 "driver_round_before_by_kind":{"promotion":23,"worker":2554,"outer":2663,"quality":27,"meta":36,"goal":7},
 "driver_round_after_by_kind":{"promotion":28,"worker":2555,"outer":2665,"quality":33,"meta":42,"goal":9},
 "web_reachable_before":true,
 "driver_run_id_by_kind":{"promotion":"pm-prod-1788972469","worker":"wk-prod-1789139008","outer":"ot-prod-1789060079","quality":"qg-prod-1788972493","meta":"mt-prod-1788972492","goal":"gl-prod-1788972477"},
 "host_pid_before":1323037,"host_pid_after":1323037,"control_reachable_after":true,
 "stopped_exit":0,"stopped_stdout":"{\"action\":\"stop\",…\"outcome\":\"stopped\",\"detail\":\"face closed; host process untouched\"}",
 "ts":"2026-09-13T18:55:47.683Z","web_restored":true}
```

**AC2 — 阶段 B 的 CLI 面在位且幂等**（生产 root 实测，修复后宿主 pid 1323037）：

```
$ quay server --help | grep -E 'quay server (start|add|stop|status)'      # 前 4 条命中
  quay server start [--only <svc,...>] [--without <svc,...>] [--port <port>] [--host <host>] [--json] [--root <path>]
  quay server add   <svc,...> [--json] [--root <path>]
  quay server stop  --only <svc,...> [--json] [--root <path>]
  quay server status [--json] [--root <path>]
  服务清单：web, control, driver:promotion|worker|outer|quality|meta|goal

start --only web,control（两个都已在跑）⇒ exit 0, changed=false,
  web already-running pid=1323037 / control already-running pid=1323037   ← ⛔ pid 不变 = no-op，不是静默重启
add control（已在跑）          ⇒ changed=false, control already-running pid=1323037
stop --only web（第 1 次）     ⇒ changed=true,  web stopped         pid=1323037
stop --only web（第 2 次）     ⇒ changed=false, web already-stopped pid=1323037   ← 与「刚停掉」可区分（硬规则 3b）
```

**AC3 — 部分停机不波及其余（四读数并列）**：

```
① before  web_reachable_before=true   curl http://127.0.0.1:46353/health ⇒ 200
② 执行    quay server stop --only web  ⇒ changed=true, outcome=stopped, detail="face closed; host process untouched"
③ after   curl http://127.0.0.1:46353/health ⇒ 000（不可达——listener 真释放）
          kill -0 1323037 ⇒ ALIVE；carrier pid ⇒ 1323037（宿主 pid 前后不变）
④         control http://127.0.0.1:44191/ POST initialize ⇒ JSON-RPC 200
          {"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{"listChanged":true}},
           "serverInfo":{"name":"quay-server-control","version":"0.6.1"}},"jsonrpc":"2.0","id":1}
恢复      quay server start --only web ⇒ started；/health ⇒ 200
```

四条缺一不可：没有 ①，②的「不可达」是空转；没有「host pid 不变 + control 仍可达」，「部分停止」与「整体重启」在记录上无法区分。

**AC4 — round 推进是同一 run 的直接量**：六 kind 的 `driver_run_id_by_kind` 前后逐 kind 相同（记录内已列出），**且**与此刻盘上 `.quay/<kind>-round.jsonl` 末行的 `run_id` 逐字相符（同一 driver 寿命，不是「重启后 round 从 1 重数」）：

```
promotion  .quay/promotion-round.jsonl    run_id=pm-prod-1788972469  before=23 → after=28
worker     .quay/worker-round.jsonl       run_id=wk-prod-1789139008  before=2554 → after=2555
outer      .quay/outer-round.jsonl        run_id=ot-prod-1789060079  before=2663 → after=2665
quality    .quay/quality-round.jsonl      run_id=qg-prod-1788972493  before=27 → after=33
meta       .quay/meta-driver-round.jsonl  run_id=mt-prod-1788972492  before=36 → after=42
goal       .quay/goal-round.jsonl         run_id=gl-prod-1788972477  before=7  → after=9
（六条 after>before 全部成立；六值在记录里都是 JSON 整数，不是载体里的字符串）
```

**类型对照（可取假）**：把**同一份**生产记录复制成 `driver_round_after_by_kind` 全部写成字符串的副本，逐字跑同一 criterion ⇒ **exit 1**（`AC-254: no qualifying record (…)`）——证明「字符串直写」结构上必不合格，写入前的转换是承重的。

**AC5 — 读数不自报（硬规则 4b）**：`web_reachable_before/after` 由生产者自己的 `fetch` 对**端口**真发 `GET /health` 得到（⛔ 不读 `quay server status` 的自报；上面 AC3 的四读数也是同一朴素 `curl`）；`driver_kinds_alive_after` 由六个 round 载体的末行心跳（直接量）得到，⛔ 不是 pid 文件存在性。

**结构控制（部分停止 vs 整体停机 可区分）**——`--control kill-host`（在**临时** workspace 上跑，⛔ 不碰生产宿主）：

```
scratch host pid=2166027 web=38535 reachable_before=200
producer --control kill-host ⇒ exit=1  verdict=CONTROL-DOWN
  reason="the control face of the SAME host is not reachable after the partial stop —
          the stop took other services with it (§6.9 不变式 2)"
  record_written=false   carrier_lines_after=0（零记录）
  readings: host_pid_before=2166027 host_pid_after=2166027 web_reachable_after=false
            control_reachable_after=false
对照：scratch web reachable_after_kill=0（整个宿主没了）
⇒ 「stop --only web」（宿主 pid 不变、control 仍答、写出记录）与「杀宿主进程」（control 不可达、拒写）
   在记录上可分。
```

**AC6 — 零回退**（各文件实测计数）：

```
node --test packages/quay/test/serve-*.test.mjs   ⇒ tests 183  pass 182  fail 0  skipped 1   exit 0  (18.6s)
plugin/test/start-drivers.test.mjs + plugin/test/driver-cli.test.mjs ⇒ tests 19  pass 19  fail 0
packages/quay/test/server-partial-stop.test.mjs（新，6 条）+
packages/quay/test/server-status-web-control-same-pid.test.mjs +
plugin/test/server-partial-stop-verify.test.mjs（新，8 条）+
packages/quay/test/cli.test.mjs ⇒ tests 43  pass 43  fail 0
scoped 门 bash scripts/test.sh --for-task gap-ac254-… --allow-thin ⇒ 静态检查全 PASS
（无 STATIC_CHECK_FAILED）；suite tests 113  pass 113  fail 0；**exit 0**
```

`quay driver stop --kind X` 不杀在飞 worker 子进程的语义未改（`plugin/scripts/driver-runtime.ts` / `driver-shared.ts` 不在本任务 Touches，未被改动）；实现与验证期间**未对生产 driver 实跑过 `quay driver stop`**（只对 `web` 这一个服务做过停/起）。

**AC7 — 生产载体真跑过（硬规则 4 推论三）**：记录写在生产 root `/home/yale/work/quay/.quay/unified-server-verification.jsonl`（⛔ 不是 worktree、⛔ 不是夹具进程），`ts=2026-09-13T18:55:47.683Z` **晚于**本任务实现落地的全部提交（`db3a8c4f6` 16:30:13、`acc8e82a4` 16:34:07、`493051961` 修复 18:5x）。统一 server 形态由 `quay server status --json` 证实：`pid=1323037`，`web.pid == control.pid == 1323037`（两服务同宿主进程），且两条 liveness 都是**独立探针**读数（`http:GET /health`、`jsonrpc:initialize`）。**web 已恢复**：`curl http://127.0.0.1:46353/health ⇒ 200`；人观察面 `http://127.0.0.1:4173/health ⇒ 200` 全程未动。

**AC8** 留给外层 verification-round（本条的量产生在 fan-in / 全量 suite 轮，⛔ 不是 worker 自己的 scoped 读数；scoped 门 113/113 绿不等于全量绿）。

### 本轮发现并修复的缺陷（AC6 的 `serve-*.test.mjs` 咬出来的）

阶段 B 的服务宿主把「web 面 close」与「宿主自己的终结」之间**唯一那根绳**剪断了（AC-254 要的就是这个：`stop --only web` 不得波及其他服务）。但**两个方向关的是同一个 `http.Server`**，只满足一边就必然破坏另一边：

- **每次 close 都终结** ⇒ 部分停止会退役一个活宿主的 carrier 并打死同进程的 `control` —— 那正是 §6.9 不变式 2 排除的形态；
- **任何 close 都不终结** ⇒ control 的 listening socket 永不释放，事件循环不排空。实测：`packages/quay/test/serve.test.mjs`（**本分支未改动**，12 个 `server.close()` 调用点）把所有断言跑完、打印 `All QN-031 serve/action regression tests passed.`，然后**永久挂住** —— `node --test` 下 4 286 177 ms，`'Promise resolution is still pending but the event loop has already resolved'`。这正是本轮 scoped 门**卡死 71 分钟**的原因（对照：主检出跑 develop 的 `serve.ts`，同一文件 exit 0）。

修法：把「调用者的意图」说出来，而不是从动作里猜 —— `stopWebFace` 只在自己那次 close 的同步作用域内打标（`partialWebClose`），宿主的 `server.on("close")` 只对**未打标**的 close 退役 carrier + control。那正是 AC-254 之前 `--watch`/SIGINT/全部既有 in-process caller 依赖的契约。

**红对照**（把 `serve.ts` 换回修复前的提交版、同一命令重跑新测试）：31s 超时、stdout 已有 `CLOSED` 而进程仍活 ⇒ 测试红；装回修复 ⇒ 同测 exit 0（≈1s）。见提交 `493051961`。

### 续做轮（本轮）：anti-drift HARD FAIL 的收敛

上一轮 exited-not-landed 在 `step=anti-drift`：`ANTI-DRIFT HARD FAIL — 3 violation(s)`。三条全部是
**申报过窄**（`anti-drift-touches-check.ts` 的判词正是 "declaration was too narrow / dishonest"），
不是越界写入 —— 三个文件都是本任务为达成 AC2/AC6 所必需、且在 develop 上尚无对应改动（已核
`git show develop:<f>` 三者皆无本任务标记 ⇒ `git merge develop` 治不了，⛔ 不是救火改动）：

| 越界文件 | 为什么必需 |
|---|---|
| `packages/quay/src/cli/driver-vocab.ts` | 服务清单的**单一实现**（SPEC §6.8）。放在 `cli/server.ts` 会让 `quay --help` 付 `cli/serve` 的加载成本；放在这里零 import |
| `packages/quay/test/cli.test.mjs` | 既有 verb-table 闸把阶段 B 的三个动词判为 `extra` 漂移 ⇒ 必须登记，否则全量套件红 |
| `packages/quay/test/server-status-web-control-same-pid.test.mjs` | AC-251 的兄弟测试断言「carrier 随 `server.close()` 退役」与「usage 只有 status」——两者都被 AC-254 的语义**按设计**改变（§8 判据 9 明言 stage A 不得新增能力，stage B 落地后该断言必假） |

修法是**把 `## Touches` 扩到与事实相符**（追加上述三行），而不是回退必需的改动。⛔ 未改任何 AC 勾选状态
（仍 7/8；AC8 由 `fan-in-ac-completion-gate.ts` 判为 `pass-external`：全量套件绿的量产生在外层 verification-round）。

⚠️ 过程读数（承重，按 `worker-task-write-lands-on-main-not-worktree`）：`## Touches` 由 **fan-in 从 worktree 读**
（`anti-drift-touches-check.ts:157`），而 MCP `task_write` 落在主检出；`maskSelfOnlyBody` 只遮蔽 checkbox 与
`## Evidence` ⇒ **Touches 改动是 `must-propagate` ⇒ 写后 ff 进 develop ⇒ `git merge develop` 才把它带进 worktree**。
