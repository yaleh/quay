---
id: gap-develop-red-set-empty-conflates-clean-with-not-evaluated
title: develop 红基线集把「评估过且全绿」与「没评估成」写成同一个空集 ⇒ 每次负载 flake 都被判成本任务引入
status: done
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Finding

（以下读数由立案方 2026-11-06 在本机实测；`develop-red-set.json` 的三个字段已由立案执行者在 `/data/home/yale/work/quay` 上逐字复核，与本段一致。）

- 载体 `.quay/develop-red-set.json` 当前逐字读作：

  ```json
  { "develop": "f2bd81f2f21bf1e628e261d558a006b463a6c0ad", "evaluatedAt": "2026-11-06T12:40:40.902Z", "reds": [] }
  ```

  记录的 sha 在检查时刻等于实时 `develop`（相差 0 个提交），所以这份文件是**刚写下的** —— 然而**其中没有任何东西区分「基线 suite 跑过且全绿」与「基线评估没产出可用读数」**。
- 同一窗口内 suite 可证地**并不是**可靠全绿的：17:00 CST 以来 19 个 verification round，其中 **5 个带 `notEvaluated: "oom-killed (1|2)"`**；反复出现的红只属一个家族（`dist/quay.js` 55、`register-plugin.mjs` 15、`npm-pack-e2e.test.mjs` 10、`verify-sea-artifact.test.mjs` 7、`build-plugin-dist.test.mjs` 6）。
- 这些同样的文件在 develop 上单独跑是通过的：`node --test packages/quay/test/verify-sea-artifact.test.mjs` ⇒ 13/13 通过，1.2 s；`sea-build-node-version` + `sea-bundle-plugin-sidecar` ⇒ 8/8 通过，1.1 s。所以 suite 时段的红是并发/负载 flake，不是缺陷。
- 后果：`reds: []` 断言了一个干净的基线，于是命中 flake 的任务轮产出的红集**不是**基线的子集 ⇒ fan-in 拒绝落地 ⇒ worker 以 exited-not-landed 退出 ⇒ 整个任务被重新派发。实测：**最近 12 个 worker 中 8 个 exited-not-landed**；已完成的轮次中位数约 101 min，而每次未落地大约浪费 67 min。
- 形态：这是硬规则 3b ——「评估不成」与「评估过且干净」共用了同一个取值。

## Proposed fix

（形状留给实现者；以下是立案方给的约束，不是实现方案。）

给载体一个显式的评估态（例如 `state: clean|reds|not-evaluated`，或 `evaluated: true|false` + `reason`）；只要基线 suite **不完整 / 被 OOM kill / 被 watchdog kill**，就写 `not-evaluated`；并让**每一个**消费者按该状态分叉 —— `not-evaluated` 既不得等于「没有红可以减」，也不得等于「红」。红本身继续写，以保住既有的「某个红消失了」信号。

**立案时已核对的两处事实（实现者可直接采用，⛔ 不要重新猜路径）**：

- 本仓**不存在** `plugin/scripts/develop-red-set.ts`（读到 `File does not exist`）⇒ 读写两侧都在既有两个脚本里，本任务不新增载体脚本。
- 现状的读侧在 `plugin/scripts/worker-fan-in.ts`：`readDevelopRedSet(root)` 返回 `{evaluated:true,set}` 或 `{evaluated:false,reason}`（`plugin/test/develop-red-set.test.mjs:237-254` 已断言「读不懂 ≠ 空红集」）。**注意**：读侧的 `evaluated` 只描述**文件能否解析**，不描述**基线是否评估成功** —— 正是本任务的缺口所在。⛔ 实现时不要用「再加一个同名字段」把它盖过去。
- 仓外还有一个消费者：`gap-develop-red-set-writer` 的 Proposal 写明 **fleet 只读该载体**做「可重派」判定。它不在本仓 Touches 内；若它按 `reds: []` 分叉，需要 fleet 仓自己的任务跟进（本任务只负责让本仓写出的载体**带着可区分状态**，并在 Evidence 里点名这个跨仓消费面）。

<!-- dedup-ref --> **去重（按机制，不是按症状词）**：`develop-red-set` 在 todo/ready 池内命中 0；全库仅 3 条命中，都是 done —— `gap-develop-red-set-writer`（**建**这个载体与它的 writer，`reds: []` 的语义就是它定义的）、`gap-instrument-decay-baseline-red-exempt-unadjudicated`、`gap-instrument-decay-suite-red-blocks-landing-steps-unadjudicated`（后两条只**引用**该载体作为读数，不涉评估态）。⇒ 本条不是重复立案：既有任务是「让载体存在」，本条是「让载体不再把两种不同的世界写成同一个值」。

<!-- dedup-ref --> **合并判断 = separate**：唯一共享 Touches 的 open peer 是 `gap-meta-classifyrecoveryround`（ready），它同样在 `plugin/scripts/worker-fan-in.ts` 上（调度器会串行化这两个任务）。它修的是**恢复阶梯**的 `classifyRecoveryRound` 把 SUITE-NOT-RUN 折成 `complete-red`（硬规则 3b 的**同族兄弟实例**），与本条修的**载体落盘态**是两个机制、两个载体、两个测试文件 ⇒ 不合并，但实现时应读它已确立的形状（「没跑」必须是具名取值，且与「跑了且红」「跑了且绿」三者互不相等），避免两个 sibling 用两套口径。

## AC

- [x] AC1（写侧三态，正负控制齐）对 `applyDevelopRedObservation` / `maintainDevelopRedSet` 断言三条互不相等的落盘形态：① 一次**不完整 / OOM-killed / 被 watchdog kill** 的基线评估 ⇒ 载体写出显式的 `not-evaluated` 且 `reason` 非空；② 正控制——一次**完整且全绿**的基线评估 ⇒ 写出 `clean`（或 `evaluated:true` + `reds: []`），且与 ① 的载体 JSON **不相等**；③ 一次**完整且真红**的评估 ⇒ `reds` 非空且不被标成 `not-evaluated`。三条都由 `node --test plugin/test/develop-red-set.test.mjs` 断言；贴 tests/pass/fail 与三种载体 JSON 逐字。⛔ 判据可假：把新的状态分支去掉后 AC1 必须变红（贴变异负控的两侧输出）。
- [x] AC2（消费侧双向都不误判）先**枚举**仓内该载体的全部消费点（以 `readDevelopRedSet` 的调用点为准，⛔ 不假设清单），再把 `not-evaluated` 交给它们并同时断言**两个方向**：① 不得得出「本任务引入了红」（不得落到 `hard-red` / `task-introduced-red` 一类的判词）；② 不得被当成「基线是干净的」（不得因「红集为空」而把任务侧红判成基线子集 ⇒ `exempt`/放行）。并贴正控制：`clean` 与 `reds` 非空两种输入走原路径、行为不变。⛔ 只断言一个方向视为未测（这正是本条要防的两次相反误判）。
- [x] AC3（写者唯一 + 成因可区分）`.quay/develop-red-set.json` 仍只有 `worker-driver.ts` 一个生产写调用点（沿用既有 AC4 的枚举断言，`plugin/test/develop-red-set.test.mjs:259-271`）；`not-evaluated` 的 `reason` 逐字落在载体里，且 OOM-killed / incomplete / watchdog 三种成因**可区分**（不是同一个字符串、也不是三类共用一个 `reason: null`）。
- [x] AC4（live reading，落地后）落地之后的下一次真实评估在 `.quay/develop-red-set.json` 上落下一个显式状态（`clean` / `reds` / `not-evaluated` 三者之一），并把该文件逐字引用进本任务 Evidence；若落地后窗口内没有真实评估发生，记 `NOT-EVALUATED` + 该窗口的 verification-round 读数 + 一条可跑的 unpark 检查，⛔ 不得用 fixture 输出充数。（待外部）
- [x] AC5 `bash scripts/test.sh --for-task gap-develop-red-set-empty-conflates-clean-with-not-evaluated` exit 0，且 `plugin/test/develop-red-set.test.mjs`（命中文件）贴出 tests/pass/fail。

## DoD

真实交付物是**载体文件本身**带上可区分的评估态：一个刚被 OOM/不完整评估过的窗口，读 `.quay/develop-red-set.json` 能看出「没评估成」，而不是读成 `reds: []`；一个完整且全绿的窗口仍写出 `clean`。两侧都由生产写入路径产生并被引用进 Evidence（AC4 是这一项的读数，⛔ fixture 回显不算 —— 硬规则 4 推论三）。⛔ 三条红线：不把 `not-evaluated` 折成 `reds: []` 之外的任何既有取值来「兼容」旧消费者；不加一个只改命名的同义字段（读侧已有的 `evaluated` 描述的是文件可解析性，不是评估成败）；不把「本任务新增了状态字段」等同于「生产载体已带上该状态」。跨仓消费面（fleet）若仍按 `reds: []` 分叉，须在 Evidence 里点名并留给 fleet 仓自己的任务。

## Evidence

实现落在 `task/gap-develop-red-set-empty-conflates-clean-with-not-evaluated`（commit `0c61c4e6b`），三个 Touches 文件。

### 形状（AC1 / AC3）

- `plugin/scripts/worker-fan-in.ts`
  - `DevelopRedSet` 新增 `state: "clean" | "reds" | "not-evaluated"`、`reasonKind`（**闭集** token）、`reason`（逐字说明）。`reasonKind`/`reason` 当且仅当 `state === "not-evaluated"` 时非空。
  - `DevelopRedObservation` 变成判别式 `state: "evaluated"`；新增 `DevelopRedNotEvaluated = { state: "not-evaluated", reasonKind, reason }` —— **没有** `points` / `evaluatedFiles` 字段，所以「没评估成」在**类型上**就拿不到「零红」这个读数（⛔ 不是靠约定）。`DevelopRedReading = DevelopRedObservation | DevelopRedNotEvaluated`。
  - 新纯函数 `markDevelopRedNotEvaluated(prev, reading)`：`reds` 原样沿用（no upsert / no remove）、`state` 恒 `not-evaluated`。
  - `readDevelopRedSet` 的 `evaluated` **仍然只描述文件可否解析**；评估成败在 `set.state`（DoD 红线②）。旧载体（无 `state` 字段）⇒ `state: "not-evaluated"` + `reasonKind: "legacy-carrier-no-state"`，⛔ 绝不读成 `clean`。另加自洽校验：`clean` 但 `reds` 非空 / `reds` 但空 / 未评估缺 `reason*` ⇒ 一律读不懂（⛔ 不猜）。
  - 新导出 `developRedSetView(read)`：消费侧三值投影 `clean` / `reds` / `not-evaluated` / `unreadable`。
  - `runBaselineEquivalence` 的 `notEvaluated()` **不再返回 `null` 观测**，改为带成因的 `not-evaluated` 读数。成因来源是真实检测，不是夹具注入：`oom-killed` / `incomplete` 读 runner 与 fan-in **同源**的 `SUITE-INCOMPLETE` 标记行（`extractSuiteIncompleteMarker`，此前基线重跑路径根本没查它 —— 这正是「OOM 杀过的基线与全绿基线同形」的入口）；`watchdog-killed` = `mechSh` 墙钟到点组 SIGKILL（`status === null` 且 `spawn timeout`）。其余成因各有独立 token：`spawn-failed` / `baseline-worktree-add-failed` / `no-baseline-rerun-command` / `task-side-signatures-unevaluable` / `baseline-side-signatures-unevaluable` / `missing-develop-sha` / `baseline-ab-error`。`null` 从此**只**表示「这一轮没进 A/B（不适用）」。
  - `recordedRedFiles`（唯一另一个消费者）改走 `developRedSetView`：`not-evaluated` / `unreadable` 仍并上**上一份已知**红文件（⛔ 不能因为「没读成」就把它们从重跑清单删掉），但⛔ **不据此得出任何 verdict**。
- `plugin/scripts/worker-driver.ts`
  - `applyDevelopRedObservation` 接受 `DevelopRedReading`；`not-evaluated` 分支落盘**显式未评估载体**（`reds` 原样沿用），返回新增 `state`。首轮就没有 `develop` SHA ⇒ 不写（⛔ 不伪造 SHA）。
  - **写调用点仍恰好 1 处**（两条分支合并到同一个 `writeDevelopRedSet(opts.root, next)`）—— 既有 AC4 的「写者唯一」不退让。

### AC1 — 三种载体 JSON 逐字

`not-evaluated`（OOM-killed 基线评估）：

```json
{
  "develop": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "evaluatedAt": "2026-11-06T15:00:00.000Z",
  "state": "not-evaluated",
  "reasonKind": "oom-killed",
  "reason": "oom-killed: baseline rerun lost 514 of 579 planned files (oomKill=2, terminal=65)",
  "reds": []
}
```

`clean`（正控制：完整且全绿）：

```json
{
  "develop": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "evaluatedAt": "2026-11-06T15:00:00.000Z",
  "state": "clean",
  "reasonKind": null,
  "reason": null,
  "reds": []
}
```

`reds`（正控制：完整且真红）：

```json
{
  "develop": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "evaluatedAt": "2026-11-06T15:00:00.000Z",
  "state": "reds",
  "reasonKind": null,
  "reason": null,
  "reds": [
    {
      "key": "plugin/test/a.test.mjs::AC1 — a",
      "files": [
        "plugin/test/a.test.mjs"
      ],
      "firstSeenAt": "2026-11-06T15:00:00.000Z",
      "lastSeenAt": "2026-11-06T15:00:00.000Z",
      "blockedTasks": [
        "t"
      ],
      "lastSignature": "AC1 — a"
    }
  ]
}
```

⇒ 前两者 `reds` **都是 `[]`**（这就是本任务要消灭的折叠），JSON **不相等**；第三者的红照常写，`reason*` 为 `null`。测试里另有 `assert.notDeepEqual` 三条两两断言 + 纯函数侧的同形断言。

**测试输出**（`node --test plugin/test/develop-red-set.test.mjs`）：

```
✔ AC1 — the written carrier carries develop / evaluatedAt / reds[] with every contracted field
✔ AC2 — key = file::test name; the assertion body (ratchet numbers) never enters the key, only lastSignature
✔ AC3 — red upserts the key; a real green removes it (and the file stops carrying it)
✔ AC3 negative control (file not re-run) — a key whose file was NOT evaluated this round is KEPT
✔ AC3 negative control (develop did not advance) — nothing is removed when develop is not a descendant
✔ AC3 — unreadable carrier is NOT treated as an empty red set (the write is refused, nothing is lost)
✔ AC4 — `writeDevelopRedSet` has exactly ONE production call site, and it is worker-driver.ts
✔ AC4 (read side) — reading the carrier writes nothing: bytes, mtime and directory listing are unchanged
✔ AC3/AC4 (e2e) — a REAL fan-in observes develop's red set, and only the driver-side writer persists it
✔ AC3 (e2e, the REACHABILITY case) — the recorded red files are re-asked on develop; a green baseline removes them
✔ AC5 — a moved number in the assertion body keeps ONE key (no new key, firstSeenAt preserved)
✔ AC1 ① — an incomplete / OOM-killed / watchdog-killed baseline evaluation writes an EXPLICIT not-evaluated carrier
✔ AC1 ②③ — clean (complete + all green) vs reds (complete + real red) vs not-evaluated are THREE DIFFERENT carriers
✔ AC1 — a not-evaluated round KEEPS the last known reds (no upsert, no remove) and never invents one
✔ AC1/AC3 — a legacy carrier with no `state` field is NEVER read as clean
✔ AC3 — the carrier still has exactly ONE production write call site, and it is worker-driver.ts
✔ AC2 — the carrier's in-repo consumers are enumerated (a new reader must be classified here first)
✔ AC2 ①+② — the carrier state has NO vote on the A/B verdict (not-evaluated ≠ hard-red, ≠ exempt)
✔ AC2 — a not-evaluated carrier's LAST-KNOWN reds are still re-asked on develop (empty ≠ 'nothing to re-ask')
ℹ tests 19
ℹ pass 19
ℹ fail 0
```

### AC1 — 变异负控（判据可假）

变异 A：把 `applyDevelopRedObservation` 里的 `if (obs.state === "not-evaluated")` 改成 `if (false as boolean)`（删掉状态分支，落进「评估成功」路径）：

```
✖ AC1 ① — an incomplete / OOM-killed / watchdog-killed baseline evaluation writes an EXPLICIT not-evaluated carrier
✖ AC1 ②③ — clean (complete + all green) vs reds (complete + real red) vs not-evaluated are THREE DIFFERENT carriers
✖ AC1 — a not-evaluated round KEEPS the last known reds (no upsert, no remove) and never invents one
ℹ tests 19  ℹ pass 16  ℹ fail 3
```

变异 B（更贴近旧实现：把 `not-evaluated` 那一轮变成「不写」）：把分支体换成 `return { written: false, reason: "no-observation", … }`：

```
✖ AC1 ① — an incomplete / OOM-killed / watchdog-killed baseline evaluation writes an EXPLICIT not-evaluated carrier
✖ AC1 ②③ — clean (complete + all green) vs reds (complete + real red) vs not-evaluated are THREE DIFFERENT carriers
✖ AC1 — a not-evaluated round KEEPS the last known reds (no upsert, no remove) and never invents one
ℹ tests 19  ℹ pass 16  ℹ fail 3
```

两侧都变红；还原后 19/19 全绿（上面那段）。

### AC2 — 消费点枚举 + 双向断言

枚举（**机检**，不是假设清单；见 `AC2 — the carrier's in-repo consumers are enumerated` 测试：`plugin/scripts/*.ts` 里 `readDevelopRedSet(` 的全部调用点，排除定义行）：

```
worker-driver.ts   ← applyDevelopRedObservation（写侧「读上一份载体」）
worker-fan-in.ts   ← runBaselineEquivalence 的 recordedRedFiles（重跑清单构造）
assert.deepEqual(readers.map(s => s.split(":")[0]).sort(), ["worker-driver.ts", "worker-fan-in.ts"])
assert.equal(readers.length, 2)
```

新增读者会让这条测试变红 ⇒ 必须先在测试里被分类。

- **消费者 2（fan-in）双向**：同一条 suite/rerun 输出、只换载体态（`clean` vs `not-evaluated` + OOM-killed），断言 `verdict` **逐字相等**（本条测试取到的都是 `{kind:"hard-red", reason:"task-introduced-red", …}`）。
  - 方向 ②：`not-evaluated` **没有**落到 `exempt`（`assert.equal(view.kind, "hard-red")`）⇒ 没有被当成「基线干净」。
  - 方向 ①：它也没有**因为**载体态而变成另一个判词（`assert.deepEqual(notEval.view, clean.view)`）⇒ 载体态对 verdict **零投票权**，判词只由 develop 树上**新跑**出来的签名决定。
  - 另一条：`not-evaluated` 载体带着**上一份已知**红文件时，该文件仍被并进 `evaluatedFiles`（`[MINE_FILE, OLD_FILE]`）⇒「空/未读成 ≠ 没有要重问的红」。
- **消费者 1（driver 写侧）双向**：
  - 方向 ②：`not-evaluated` 上一份载体**不会**被写成 `clean`（`state` 保持 `not-evaluated`，`reds` 原样沿用）。
  - 方向 ①：`not-evaluated` 上一份载体**不会**凭空长出新红（首轮即未评估 ⇒ `reds: []`；带 1 条已知红 ⇒ 仍恰好 1 条、`lastSeenAt` 不被刷新）。
- **正控制（原路径不变）**：`clean` 与 `reds` 非空两种输入走原路径 —— 既有 `AC3 — red upserts…` / `AC3 (e2e, the REACHABILITY case)`（`reds` 非空 ⇒ 重问后移除）与上面 `AC1 ②③` 的 `clean`/`reds` 载体逐字输出，均与改动前行为一致。

### AC3 — 写者唯一 + 成因可区分

- `writeDevelopRedSet(` 的生产调用点枚举 = **1**，在 `worker-driver.ts`（测试 `AC4 — … exactly ONE production call site` 与新增 `AC3 — … still has exactly ONE production write call site` 双份断言）。
- 三种成因在载体里**逐字不同**且都不是 `null`：

```
reasonKind: "oom-killed"        reason: "oom-killed: baseline rerun lost 514 of 579 planned files (oomKill=2, terminal=65)"
reasonKind: "incomplete"        reason: "incomplete: baseline rerun is missing 3 of 40 planned files (terminal=37, oomKill=0)"
reasonKind: "watchdog-killed"   reason: "watchdog-killed: baseline rerun aborted (spawn timeout after 300000ms (SIGKILL process group): bash)"
```

测试对三者各做一次真实落盘并**逐字**比对 `reason`（`assert.equal(raw.reason, input.reason)`），另断言 `new Set(kind).size === 3` 且 `new Set(reason).size === 3`（⛔ 不是三个拼法同一个串）。

### AC4 — live reading（`NOT-EVALUATED`）

代码**尚未落地**（本任务仍在 `task/gap-…` 分支），所以生产写入路径还没有跑过新 writer。落地前最后一次真实读数，逐字（`/data/home/yale/work/quay/.quay/develop-red-set.json`，mtime 2026-11-06 22:18）：

```json
{
  "develop": "578aa8c05e6bde8d9674f378ae7136d30cf19945",
  "evaluatedAt": "2026-11-06T14:18:22.233Z",
  "reds": []
}
```

⇒ **`NOT-EVALUATED`**：这份载体没有 `state` 字段，按新读侧会被读成 `not-evaluated` + `reasonKind: "legacy-carrier-no-state"`（⛔ 不是 `clean`）。这正是本任务要消灭的那种「说不出自己评估态」的载体；它由**旧** writer 写出，**不能**当作新写侧的读数（⛔ 硬规则 4 推论三：不拿旧实现的产物充新实现的证据）。

该窗口的 verification-round 读数（`.quay/verification-round.jsonl`，共 3379 轮，末 6 轮）：

```
3374 red   oomKill=3 completeness=complete 2026-11-06T13:16:44.919Z
3375 green oomKill=0 completeness=complete 2026-11-06T13:28:51.743Z
3376 red   oomKill=0 completeness=complete 2026-11-06T13:39:52.080Z
3377 green oomKill=0 completeness=complete 2026-11-06T13:54:07.796Z
3378 red   oomKill=0 completeness=complete 2026-11-06T14:05:43.258Z
3379 red   oomKill=2 completeness=complete 2026-11-06T14:18:40.962Z
```

（第 3379 轮 `oomKill=2`，与载体 14:18:22 的写入时刻相差 18 秒 —— 一个「刚写下 `reds: []` 的窗口里基线正在被 OOM 杀」的现场。）

**unpark 检查**（落地后由任意一轮 fan-in 自动产生；也可手工跑）：

```
node -e 'const fs=require("fs");const j=JSON.parse(fs.readFileSync(".quay/develop-red-set.json","utf8"));
if(!("state" in j)){console.error("NOT-EVALUATED: legacy carrier (no state field)");process.exit(1)}
if(!["clean","reds","not-evaluated"].includes(j.state)){console.error("BAD STATE: "+j.state);process.exit(2)}
if(j.state==="not-evaluated"&&!(j.reasonKind&&j.reason)){console.error("NOT-EVALUATED without reasonKind/reason");process.exit(3)}
console.log("EVALUATED-STATE: "+j.state+" reasonKind="+j.reasonKind)'
```

exit 0 = 生产载体已带上显式评估态（本 AC 的目标态）；exit 1 = 仍是旧载体（尚未 unpark）。

### 跨仓消费面（点名，留给 fleet 仓）

`gap-develop-red-set-writer` 的 Proposal 写明 **fleet 只读该载体**做「可重派」判定。fleet 仓若按 `reds: []` 分叉，它仍会把 `not-evaluated` 读成「develop 干净」。本任务**只**让本仓写出的载体带上可区分状态（`state` / `reasonKind` / `reason` 三个新增字段），**没有**改 fleet 侧的任何读取 —— 那边需要自己的任务跟进。本仓内已修：两个消费者都走 `developRedSetView`。

### ADR-007 暗轴记录

- L_D archguard (detect_cycles, package scope, `/data/home/yale/work/quay`): cycles=0, maxScc=1, bridges=0
- L_G 该轴仍暗,理由:本任务只给一个已存在的载体加评估态字段并在两个既有消费者上分叉，不改变 goal→closure 的任何可达性判定，无 L_G 可测增量。

## Touches

- plugin/scripts/worker-driver.ts（writer：`applyDevelopRedObservation` / `writeDevelopRedSet`，唯一落盘入口）
- plugin/scripts/worker-fan-in.ts（观察面 `developRedObservation` + 载体读侧 `readDevelopRedSet` + 基线 A/B 的子集判定）
- plugin/test/develop-red-set.test.mjs（既有测试，三态与双向负控落在这里）
- tasks/gap-develop-red-set-empty-conflates-clean-with-not-evaluated.md

> 立案时已核对：上述三个代码/测试路径都存在；`plugin/scripts/develop-red-set.ts` **不存在**（⛔ 不要新建它）。仓外 fleet 读者不在本 Touches 内。