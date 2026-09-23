---
id: gap-goal-criterion-timeout-hardcoded-60s-ignores-acceptance-timeout
title: goal 判据执行的 60 s 超时在 goal-store.ts 四处写死，不读 QUAY_ACCEPTANCE_TIMEOUT_MS /
  gates timeoutMs / --timeout ⇒ 判据本身合法但 >60 s 的 AC 每轮被杀、无任何配置可救（GOAL-002 AC-014
  实证：测试 ~348 s 通过，goal gate 每轮 60 s 被 kill）
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: execution
---
**type:** execution

## Proposal

**缺口（立案当轮直接量，2026-09-23，主检出 `/data/home/yale/work/quay`）**：`quay goal gate <id>` 及其同族路径执行 AC 判据时，超时在 `packages/quay/src/goal-store.ts` 里是**字面量**，绕过了任务验收门已有的全部可配置面。

```
grep -nE 'timeoutMs: (60000|SWEEP_CRITERION_TIMEOUT_MS)' packages/quay/src/goal-store.ts
1745:  runAcceptance({ command: criterion, cwd: root, timeoutMs: 60000 })          # achieved 重新验证
2003:  runAcceptance({ …, timeoutMs: SWEEP_CRITERION_TIMEOUT_MS })                # 轮转扫描；:208 SWEEP_CRITERION_TIMEOUT_MS = 60_000
2370:  runAcceptance({ command: criterionCmd, cwd: gateRoot, timeoutMs: 60000 })  # goal write 激活时的可评估性检查
3107:  runAcceptance({ command: criterion, cwd: root, timeoutMs: 60000 })          # `goal gate <id>`
```

对照面（同一仓库、同一天读到）：任务验收门走 `packages/quay/src/gate/config/utils.ts:33-40` 的 `resolveRunnerOptions`，优先级 `QUAY_ACCEPTANCE_TIMEOUT_MS`（env）> gates 配置的 `timeoutMs` > 60000；`.quay/config.yml:98` 的 ts-typecheck 就是靠它抬到 120000。`gate/factories/goal.ts:43` 的 `makeGoalGate` 也走它——**同一件事有两套实现，`goal-store.ts` 里自带的那套漏了配置**。`60000` 另在 `gate/acceptance-runner.ts:156,254` 与 `gate/config/utils.ts:38` 各有一份字面量，`goal-store.ts:207` 注释明说「⛔ SAME value runAcceptance defaults to —— 是一个字面量不是两个」，而实际是至少五份。

**触发实例（来自使用方报告，非本仓库直量）**：另一个工作区的 GOAL-002 卡在 AC-014：测试本身通过（约 348 s），但 goal gate 每轮 60 s 被 kill，改该仓库配置无效——因为没有任何配置面可读。

**成因**：判据超时被当成 goal-store 的私有常量，而不是「acceptance runner 的一个可配置参数」。

**修法（提案）**：
1. 把 timeout 解析抽成 `gate/config/utils.ts` 里一个只返回毫秒的纯函数（例如 `resolveAcceptanceTimeoutMs(gateConfig?)`），`resolveRunnerOptions` 改为调它（行为不变）；默认 60000 只保留一份导出常量（例如放 `acceptance-runner.ts`，`runAcceptance` / `runAcceptanceCapture` / utils 共用）。
2. `goal-store.ts` 的四处全部改为取该函数的结果。**⛔ 只取 timeout，不取 `resolveRunnerOptions` 返回的 `cwd`**：后者优先读 `QUAY_ACCEPTANCE_CWD`，而 goal 判据的 cwd 是 git root（`root` / `gateRoot`，硬规则 4 推论二的既定选择），套用会静默换 cwd。
3. `goal gate <id>` 接受 `--timeout <ms>`（与 `--dry-run` 同处解析），优先级 `--timeout` > env > 默认，与 help.ts 已写的「gate 命令的 `--timeout`」同语义；`cli/help.ts` 的 goal 段与 `--timeout` 段同步说明 goal gate 也认它。
4. **轮转扫描的预算算术必须同步改（`goal-store.ts:120-135` 注释与 `:186-208` 常量）**：现写「≤ min(DEFAULT_SWEEP_BUDGET × criterion-timeout, DEFAULT_SWEEP_WALL_MS) = min(6×60s, 30s) = 30s」假定 criterion-timeout ≡ runAcceptance 默认值。改后 criterion-timeout 是解析值，注释里的界必须按解析值重写；`SWEEP_CRITERION_TIMEOUT_MS` 要么改成「默认值 + 解析」二者之一并保持只有一份字面量，要么删除并让 `packages/quay/test/goal-store.test.mjs` 里钉它的断言改钉新的单一来源。注意 wall 界（30 s）本来就小于单条判据超时，抬高 timeout 后一次调用可能远超 wall——这一点要在注释里如实写出（是「调用之间才检查 wall」的既有语义还是需要收紧，先读 `:1922-2010` 再定，写清结论）。
5. **不做（范围外，附理由）**：给 goal 记录加 per-AC `timeout_ms` 字段——它需要动 goal 写面校验、criterion 指纹与 dashboard 展示三处，且与本任务的「先让已有配置面在 goal 路径生效」是独立的一步；env / `--timeout` 是进程级旋钮，若使用方需要「只放宽某一条 AC」则另立任务。本任务落地后若 GOAL-002 类场景仍不够用，再以该场景的读数立案。

## AC

- [x] 四处字面量收敛：`grep -cE 'timeoutMs: (60000|SWEEP_CRITERION_TIMEOUT_MS)' packages/quay/src/goal-store.ts` 输出 `0`，且 `grep -nE '\b60_?000\b' packages/quay/src/goal-store.ts` 的命中里不再有任何 `runAcceptance` 的 `timeoutMs`（先打印前 3 条命中内容再引用计数，硬规则 2）。
  【读数】grep1 → **0**。grep2 共 3 条，**前 3 条实打实打印**：`:229`（被删常量留下的 tombstone 注释）/ `:597`（`unit === "d" ? 86400_000 : unit === "h" ? 3600_000 : 60_000` 的时长单位换算，与 runAcceptance 无关）/ `:3187`（解释新增 `timeoutMs` 输出字段的注释）——**无一条是 `runAcceptance` 的 `timeoutMs`**。四处调用点现为 `resolveAcceptanceTimeoutMs()`：`:1774` `:2034` `:2407`，以及 `goal gate` 的 `:3160`（`const timeoutMs = resolveAcceptanceTimeoutMs()`）。
- [x] `60000` 默认值只在一处定义：`grep -rnE '=\s*60_?000\b|timeoutMs = 60000|: 60000\)' packages/quay/src/gate packages/quay/src/goal-store.ts` 中默认值的字面量定义恰好 1 处，其余引用该导出常量。
  【读数】同一条 grep 命中**恰好 1 处**：`packages/quay/src/gate/config/utils.ts:33: export const DEFAULT_ACCEPTANCE_TIMEOUT_MS = 60000;`。新测试 `AC2` 把同一条判据做成**遍历 `src/gate` 全目录 + `src/goal-store.ts`**（⛔ 不是手抄文件清单，新增文件也会被抓），并**双向**断言：字面量只此一处 ∧ `acceptance-runner.ts` 的两处缺省值确实引用该常量（`timeoutMs = DEFAULT_ACCEPTANCE_TIMEOUT_MS` ×2，`timeoutMs = 60000` ×0）。
  ⚠️ **默认值落点与提案中的「例如放 `acceptance-runner.ts`」不同**：改放在 `gate/config/utils.ts`。理由是依赖方向——`acceptance-runner.ts` 本就 import 该文件的 `shQuote`，把常量放 runner 会让 utils 反向 import runner，造出 value 级 import cycle（本仓库 `import-graph-check` 盯这棵树，`valueSccs` 基线为 0）。单一来源不变，只是位置被依赖图钉死。
- [x] env 生效（读生产载体的负控制配对）：新测试 `packages/quay/test/goal-criterion-timeout-resolution.test.mjs` 用 `makeWorkspace()` 建真 workspace，写一条判据 `sleep 2` 的 goal AC，`QUAY_ACCEPTANCE_TIMEOUT_MS=1000 quay goal gate <id> --dry-run --json` 得 `verdict:"fail"` 且 reason 含 `timed out after 1000ms`；同一判据在 `QUAY_ACCEPTANCE_TIMEOUT_MS=5000` 下得 `verdict:"pass"`。（两个方向都断言——只断言一个方向的用例通过不了「关掉修复仍能过」的反例判据。）
  【读数】`node --experimental-strip-types --test packages/quay/test/goal-criterion-timeout-resolution.test.mjs` → 8/8 全绿。AC3 用例：env=1000 → `verdict:"fail"` + `reason:"acceptance timed out after 1000ms (killed) — raise gates.yml timeoutMs / --timeout"` + `timeoutMs:1000` + exit 1；env=5000 → `verdict:"pass"` + exit 0。**两方向都断言**。`makeWorkspace()` 建的是真 workspace（`.quay/config.yml` 是 provider map，且是真 git repo——判据 cwd 走 `resolveGitRoot`）。
- [x] `--timeout <ms>` 生效且优先于 env：`QUAY_ACCEPTANCE_TIMEOUT_MS=5000 quay goal gate <id> --dry-run --timeout 1000 --json` 对 `sleep 2` 判据得 `timed out after 1000ms`；无 env 无 flag 时仍为 60000（用 reason 里的毫秒数断言，不真等 60 s）。
  【读数】同一测试文件 AC4 用例：`QUAY_ACCEPTANCE_TIMEOUT_MS=5000` + `--timeout 1000` → reason 含 `timed out after 1000ms`、`timeoutMs:1000`；无 env 无 flag → `timeoutMs:60000` 且 `verdict:"pass"`（判据**真跑到判定**，不是被 kill，故「没有被 1s 级别的界杀掉」也被证明）。
  ⚠️ **读法说明**：`reason` 只在超时时才携带毫秒数，60000 这个默认值**没法**从 pass 的 reason 里读出（pass 的 reason 是 `acceptance passed (exit 0)`，不带 ms）。因此本轮给 `goal gate` 的 JSON 输出加了 `timeoutMs` 字段——它报告的正是**本次实际生效的解析值**，于是「默认仍是 60000」可以在**零等待**下从生产载体读到，而不必等 60 s 去撞它。（这也是硬规则 4c 的要求：判据点名的量在读取那一刻必须还在。）
- [x] cwd 不被改：设 `QUAY_ACCEPTANCE_CWD=/tmp` 后，判据 `pwd` 打印的仍是 git root（不是 `/tmp`）——断言 goal 路径只取了 timeout（本条防「套用 resolveRunnerOptions 全量」的回归）。
  【读数】AC5 用例：判据 `[ "$(pwd -P)" = "<realpath(ws)>" ] || { echo "wrong cwd: $(pwd -P)" >&2; exit 1; }`，在 `QUAY_ACCEPTANCE_CWD=<os.tmpdir()>`（本机即 `/tmp`）下 `verdict:"pass"`。用 `pwd -P`（物理路径）而非 `pwd`，使符号链接形态的 tmpdir 不能让它因错误的原因通过。
  **正控制（硬规则 2：零计数方向要拿谓词去撞已知为真的样本）**：同一判据文本用 `runAcceptance({ command, cwd: os.tmpdir() })` 直跑 → `ok:false`——证明该判据**确实能分辨 cwd**，否则上面那条恒真。
  **反向变异实测**：把 `goal gate` 的 `cwd: root` 改成 `resolveRunnerOptions().cwd` 后重跑，8 条里**只有 AC5 变红**（1 红 7 绿）——本条正是那个回归的守卫，且不误伤其它判据。
- [x] 四个入口都走同一来源：新测试对重新验证（`:1745`）、轮转扫描（`:2003`）、激活检查（`:2370`）、`goal gate`（`:3107`）各至少一条断言，各自在 `QUAY_ACCEPTANCE_TIMEOUT_MS=1000` 下对 `sleep 2` 判据得到含 `timed out after 1000ms` 的结果（不是四条只查同一个函数）。
  【读数】四条各自一个用例，且**跑的是四个不同的生产入口**：
  · (a) `goal gate`（`:3160`）：env=1000 → reason 含 `timed out after 1000ms`（AC3 用例）。
  · (b) 轮转扫描（`:2034`）：`check --stale-pass --sweep --budget 1` + env=1000 → `sweep.ran[0] = {id:"AC-903", verdict:"fail", reason:"acceptance timed out after 1000ms …", ms:1002}`；下一次轮转（自续选中另一条冻结 AC）+ env=5000 → `{id:"AC-904", verdict:"pass", ms:~2000}`。
  · (c) 激活检查（`:2407`）：draft→active 的 `write`，env=1000 → stderr `goal-store: activated AC-905 — criterion ran in 1002ms (fail)`；无 env → `activated AC-906 — criterion ran in 2004ms (pass)`。
  · (d) 重新验证（`:1774`）：`check --achieved-failing`，env=1000 → `achievedButFailing:["AC-907"]`；env=5000 → `[]`；两次 `inScope` 都是 `["AC-907"]`（人口与域相同，**只有界不同**）。
  ⚠️ **诚实说明（本条做不到字面「都得到含 `timed out after 1000ms` 的结果」的两个入口）**：(c)(d) 两个动词的输出形态里**没有** runner 的 reason 字符串——(d) `check --achieved-failing` 的答案是一个 id 列表；(c) 的 reason 只在 `not-evaluated` 分支才被抛出，而**超时按定义不是 not-evaluated**（`timedOut === true` 明确排除该分支）。所以这两条的断言落在各自**确实暴露**的读数上：(c) 是它自己的成本行的 elapsed-ms + pass/fail，(d) 是同一人口的进出集合差分。两者都能取假，已实测：把任一调用点还原成字面 `60000`，(c)(d) 都变红。
- [x] 扫描预算注释与常量一致：`goal-store.ts` 头部关于「≤ min(… × criterion-timeout, …)」的推导不再含字面 `6 × 60s`（或含则明确标注为「默认值下」并给出解析值下的式子）；`packages/quay/test/goal-store.test.mjs` 原有对 `SWEEP_CRITERION_TIMEOUT_MS` 的断言随之更新且 `bash scripts/test.sh packages/quay/test/goal-store.test.mjs` 通过。
  【读数】头部推导现写 `≤ min(DEFAULT_SWEEP_BUDGET × T, DEFAULT_SWEEP_WALL_MS + T)`，`T` = `resolveAcceptanceTimeoutMs()` 的**解析值**；默认值实例单独标注（T=60s、wall=30s、budget=6 ⇒ ≤60s），**不再含字面 `6 × 60s`**。
  **读 `:1922-2010` 的结论（本条要求写清的那一点）**：wall 是**调用之间**检查的——守卫 `if (Date.now() - startedAt > wallMs) break;` 在循环体**顶部**，即「下一条判据开始前」。所以旧式子 `min(budget×T, wallMs)` **从来就不成立**：它量的是「还能再开几条」，不是「已经跑着的那条还能跑多久」；默认值下真实上界是 60 s 而非 30 s。两条都在头部与 `DEFAULT_SWEEP_WALL_MS` 自己的注释里如实写出，并**保留**「调用之间才检查」的既有语义（不收紧——收紧会改变预算语义，超出本任务范围）。
  `SWEEP_CRITERION_TIMEOUT_MS` 已**删除**：它本身正是「goal 路径自带走一套超时」的那一步，留着它就等于留着绕过配置面的入口。`goal-store.test.mjs` 钉它的断言**反向重写**为双向（字面量定义消失 ∧ 共享解析函数在场），并补一条 `resolveAcceptanceTimeoutMs` 必须在场的断言。
  读数：`bash scripts/test.sh packages/quay/test/goal-store.test.mjs` → **72/72 通过，exit 0**。
- [x] `resolveRunnerOptions` 行为不变：既有 `gate/config` 相关测试全部通过，`bash scripts/test.sh --for-task gap-goal-criterion-timeout-hardcoded-60s-ignores-acceptance-timeout --allow-thin` 通过，且 `cli/help.ts` 的 goal 段出现 `--timeout`（`node packages/quay/bin/quay.js goal --help 2>&1 | grep -c -- '--timeout'` ≥ 1）。
  【读数】`bash scripts/test.sh --for-task gap-goal-criterion-timeout-hardcoded-60s-ignores-acceptance-timeout --allow-thin` → **exit 0，165/165 通过**（选择集含 `goal-store.test.mjs` 与新增文件；选择器报 `resolved tests for 3/7 Touches entries (0.43) < 0.5` 的 thin 警告，按 `--allow-thin` 放行——这是条目的已知形态，不是失败）。既有 gate/config 相关：`gate-config-loader`/`acceptance`/`acceptance-env`/`goal-gate`/`gate` = 85/85；`cli`/`gate-ergonomics`/`gate-diagnostics`/`mcp-gate-dryrun` = 44/44。
  **help 载体**：`node packages/quay/bin/quay.js goal --help 2>&1 | grep -c -- '--timeout'` → **5**（≥1 ✔）。
  ⚠️ **载体更正（本条原文里那条命令取不到读数，如实记录）**：原文写的是 `node packages/quay/bin/quay.js help goal`，那是一条**死载体**——`help` 不是顶层命令，`bin/quay.ts` 落到未知命令分支打印通用 usage 并 `exit 1`。本轮实测读数：`0`（exit 1）。`bin/quay.ts` **不在本任务 Touches 内**，这条探针在这里修不了，故 AC 文本已把探针重锚到真正抵达 `cli/help.ts` 的载体（`goal --help`）；实质判据（help 的 goal 段说明 `--timeout`）成立且已由新测试 `AC8` 在 `quay goal --help` 的**真实输出**上断言（含 `quay goal gate <id> [--timeout <ms>]` 的 usage 行）。

## DoD

真实落地判据（DIR-026 Reading A：fixture 是必要不充分）：在**主检出的真实 workspace** 上，对一条真实存在、运行时长 >60 s 的 goal AC 判据（可用一条 `sleep 70` 的临时 `draft` AC，用毕 `retire`/删除），`QUAY_ACCEPTANCE_TIMEOUT_MS=120000 node packages/quay/bin/quay.js goal gate <that-id> --dry-run --json` 返回 `verdict:"pass"`，而同一命令去掉 env 返回含 `timed out after 60000ms` 的 `fail`——两条读数贴进任务 AC 勾选记录，且时间窗只计实现提交之后。另需：goal-driver/轮转扫描在生产进程里读到的是同一解析函数（`grep -rn resolveAcceptanceTimeoutMs packages/quay/src` 命中 goal-store.ts 的四处调用点，贴前 3 条）。

**读数（实现提交 `33d3b0bce`，2026-09-23T15:29Z 之后，窗口只计实现之后）**

临时判据：`goals/AC-999-temp-timeout-reading.md`，`status: draft`、`criterion: sleep 70`、`goal: GOAL-999`（**故意指向一个不存在的 GOAL**，故它在存续期间不属于任何真实 goal 的 rollup）。**用毕已删除**，从不提交。

- **读数 A**（`START 2026-09-23T15:29:52Z`，`QUAY_ACCEPTANCE_TIMEOUT_MS=120000`）：
  `{"id":"AC-999","verdict":"pass","reason":"acceptance passed (exit 0)","timeoutMs":120000,…}` —— 判据真跑满 ~71 s（15:29:52 → 15:31:03）。
- **读数 B**（`B-START 2026-09-23T15:31:07Z`，去掉 env）：
  `{"id":"AC-999","verdict":"fail","reason":"acceptance timed out after 60000ms (killed) — raise gates.yml timeoutMs / --timeout","timeoutMs":60000,…}` —— 恰在 ~61 s 被杀（15:31:07 → 15:32:08）。
- 对照关系成立：**同一条判据、同一份代码**，唯一差别是 env；120000 下通过、无 env 下 60 s 被杀 ⇒ 这正是 DIR-026 Reading A 要的「真对象真的走过那条机制」。
- ⚠️ **诚实说明两处偏差**（都如实记，不掩盖）：
  1. 阅读器用的是**任务 worktree**作 `--root`，不是主检出。原因：主检出（`author`）在 fan-in 之前**结构上不可能**带上本实现，用它取读数只会重复修前的行为。worktree 携带的是**同一份 goal 记录**（develop 分支点的 203 条 `goals/*.md`）与**本次实现**，且判据 cwd 仍是真 git root。
  2. 证据文件里 `exit=` 行是管道里 `tee` 的退出码（shell 管道形态），**不带信息**；该行不是读数，`verdict` 字段才是。判定退出码本身由新测试的 AC3/AC4 用例断言（`fail→1`、`pass→0`）。

**读数 2 —— 同一解析函数在生产路径上（`grep -rn resolveAcceptanceTimeoutMs packages/quay/src`，前 3 条 `goal-store.ts` 调用点）**

```
packages/quay/src/goal-store.ts:1774:  runAcceptance({ command: criterion, cwd: root, timeoutMs: resolveAcceptanceTimeoutMs() })   # I5 重新验证
packages/quay/src/goal-store.ts:2034:  runAcceptance({ command: criterion, cwd: root, timeoutMs: resolveAcceptanceTimeoutMs() })   # 轮转扫描（goal-driver `check --stale-pass --sweep` 正是走这里）
packages/quay/src/goal-store.ts:2407:  runAcceptance({ command: criterionCmd, cwd: gateRoot, timeoutMs: resolveAcceptanceTimeoutMs() })  # 激活检查
```
第四条：`packages/quay/src/goal-store.ts:3160: const timeoutMs = resolveAcceptanceTimeoutMs();`（`goal gate <id>`）。生产消费者（`plugin/scripts/goal-driver.ts:757` 的 `check --stale-pass --sweep`）走的就是同一个 `goal-store.ts` CLI，无第二条超时来源。

## Touches

- `packages/quay/src/goal-store.ts`
- `packages/quay/src/gate/config/utils.ts`
- `packages/quay/src/gate/acceptance-runner.ts`
- `packages/quay/src/cli/help.ts`
- `packages/quay/test/goal-store.test.mjs`
- `packages/quay/test/goal-criterion-timeout-resolution.test.mjs` (new)
- `tasks/gap-goal-criterion-timeout-hardcoded-60s-ignores-acceptance-timeout.md`

<!-- dedup-ref --> 相关但机制不同：`gap-achieved-ac-rot-invisible-when-ledger-tail-is-stale-pass`（引入轮转扫描与 `SWEEP_CRITERION_TIMEOUT_MS` 的任务，本任务只改其超时来源，不动其轮转/预算判定逻辑）；`gap-goal-achieved-but-failing-no-handler`（`:1745` 处 `timeoutMs: 60000` 曾在该任务的递归事故里被引用，判据递归防护不在本任务范围）。
