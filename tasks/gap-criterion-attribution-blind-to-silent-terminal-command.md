---
id: gap-criterion-attribution-blind-to-silent-terminal-command
title: AC-241 台账回归：归因棘轮对「判据没有 exit 语句、退出码由行尾静默命令继承」的形态结构上盲 ⇒ AC-172
  以裸失败进入在域集（同类共 14 条）
status: ready
labels:
  - gap
  - defect
  - mechanism
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-241
---
## Finding

**回归（生产台账，逐字读数）** —— GOAL-009 的常设不变式 **AC-241**（`long-term: true`，2026-09-11T13:55:25.575Z 已 achieved）在 **2026-09-12T01:45:38.050Z 转红**，截至本次立案轮（02:06:15.881Z）**连续 8 轮为 fail**：

```
2026-09-12T01:42:49.709Z  item_id=AC-241  verdict=pass   ← 最后一次绿（当时 AC-172 的尾事件是 2026-09-09T03:44:36.208Z 的 pass）
2026-09-12T01:44:16.051Z  item_id=AC-172  verdict=fail
  reason="acceptance failed (exit 1) — criterion wrote no output to stderr/stdout"
2026-09-12T01:45:38.050Z  item_id=AC-241  verdict=fail
  reason="acceptance failed (exit 1) — unattributable failing goal AC(s): AC-172: acceptance failed (exit 1) — criterion wrote no output to stderr/stdout"
（其后 01:54:10 / 01:56:07 / 01:57:58 / 01:59:52 / 02:01:46 / 02:04:11 / 02:06:15 七轮同形）
```

AC-241 的判据读 `.quay/gate-events.jsonl`：每条 AC 的**最近一次** goal-gate fail，其 `payload.reason` 不得是空因模板。此刻它点名的 **AC-172**（GOAL-001 名下判据，status=achieved ⇒ 在 I5 复验域内，每轮被 goal-driver 真跑）的判据正文是：

```
node packages/quay/src/goal-store.ts list --status draft | grep -q '"id": "GOAL-'
```

**判据本身此刻为假**（真值回归，与归因是两个问题）：`node packages/quay/src/goal-store.ts list --status draft` 实测返回 `[]`（当前 119 条 goal 中无一条 `status: draft`；AC-172 的上一次 pass 停在 2026-09-09T03:44:36.208Z，之后由 pass 翻 fail）。它的失败出口是**行尾的 `grep -q`**——`grep -q` 命中与否都零输出 ⇒ 失败时整条判据对 stderr/stdout 一字不写。

**本次立案轮的真 runner 读数**（`packages/quay/src/gate/acceptance-runner.ts` 的 `runAcceptance`，cwd=主检出，timeoutMs=30000，命令 = AC-172 判据逐字原文）：

```json
{ "ok": false, "reason": "acceptance failed (exit 1) — criterion wrote no output to stderr/stdout" }
```

**为什么早先的修复没有守住（是机制形态，不是「没做」）** —— 两次同形任务都落了地、都自陈覆盖了一类形态，而**这一类的判据在检测器眼里根本不存在**：

- `gap-goal-criteria-bare-failing-exit-unattributable`（done，2026-09-11）造了检测器 `plugin/scripts/criterion-failure-attribution-check.ts` 与只许降不许升的棘轮（baseline `count=32`，`docs/analysis/criterion-failure-attribution.baseline.json`，`generatedAt=2026-09-11T12:02:01.417Z`）。它的判定是**按行找 FAILURE-EXIT 行**：`FAILURE_EXIT_RE`（`exit 1` / `sys.exit(1)` 直接形态）。
- `gap-criterion-attribution-ratchet-blind-to-trailing-computed-exit`（done，2026-09-12）补了 `hasTrailingComputedFailureExit`——`exit(...)` 调用**参数尾部**为 `else <非零>` 的形态。

**AC-172 没有 exit 语句**：它的退出码不是任何 `exit` 写出来的，而是 shell 把**行尾命令**的退出码当作整条判据的退出码继承下来的。⇒ `hasFailureExit()` 对它**每一行都为 false** ⇒ 它从不进入枚举 ⇒ **从未进过 baseline**（实测：baseline 32 条 entries 中不含 AC-172，也不含本类任何一条）。

**这不是「已记录的限制」，是静默通过** —— 棘轮此刻的真实读数（本次立案轮，`--json`）：

```
{"inDomain":97,"bareAcs":31,"bareLines":54,...,"baseline":32,"delta":-1,"status":"pass","ok":true, ...}
```

**棘轮读 31 ≤ 32、`status=pass`、exit 0，而它所保护的 AC-241 正在红。** 它就是硬规则 3b 的形态：**「我读不懂这个形态」与「这条判据干净」共用同一份输出**。

**双向对照（同一条夹具，`--goals-dir` seam，本次立案轮实测）**：

| 注入 `goals/` 的夹具 | 当前 develop 版检测器 | 修复后应得 |
|---|---|---|
| `AC-990`：criterion 逐字同 AC-172 形态（`… list --status draft \| grep -q '"id": "GOAL-'`），单独注入、baseline=0 | `bareAcs=0`、`status=pass`、`exit=0`、`AC-990 ∉ ids`（**盲区实测**） | `bareAcs=1 > 0`、`added=["AC-990"]`、`exit=1` |
| `AC-991`：`printf 'x' >/dev/null; exit 1`（显式裸 exit，对照） | `bareAcs=1`、`added=["AC-991"]`、`exit=1` | 不变 |
| `AC-991`：`echo CAUSE-TOKEN >&2; exit 1`（有归因，反向控制） | 不计入（`ATTRIBUTION_RE` 命中 `>&2`） | 不变 |

⇒ 时序闭合：baseline 2026-09-11T12:02 锚定 32（不含本类）→ 2026-09-12T01:44 AC-172 翻红 → 01:44:16 它把一个不可归因的 fail 写进生产台账 → 01:45:38 AC-241 转红。**棘轮从 31 到 31，一步没动。**

**5b 同类枚举（机械，⛔ 非抽样）** —— 把「**无显式非零 exit 语句** ∧ **行尾命令在失败时静默**（`grep`/`test`/`[`，或整条重定向到 `/dev/null`）」跑在 `goals/` 全量在域判据（status ∈ {active, achieved}，97 条）上，实测 **14 条**：

```
AC-156, AC-170, AC-171, AC-172, AC-173, AC-174, AC-175, AC-176,
AC-178, AC-195, AC-197, AC-208, AC-225, AC-228
```

⚠️ **过报方向要如实写进注释**（沿用本检测器既有做法）：其中 12 条是**行尾静默**（`… | grep -q …` / `test "$(…)" -ge N` / `> /dev/null 2>&1`），另 2 条（AC-225 `test -f … && node --test …`、AC-228 `grep -q … && node --test …`）的**静默分支在 `&&` 左侧**、行尾命令 `node --test` 失败时是有输出的 ⇒ 它们的 `&&` 左支一旦为假，同样零输出退出 1（AC-228 在台账里的 fail reason 确实可归因，因为那条失败来自右支）。**两个方向都要保留：过报要写明条数，⛔ 不得靠放宽 `ATTRIBUTION_RE`（把 `print`/`echo` 也算归因）制造假阴性。**

### 修法（用现成机制，⛔ 不新建并行机制）

1. **止血：AC-172 的失败出口写成因，真值逐字不变** —— 判据语义必须仍是「存在 draft GOAL 记录 ⇒ 0，否则非 0」，**只补失败分支的 stderr 成因**。读数：同载体（`node packages/quay/src/goal-store.ts list --status draft` 的输出，此刻为 `[]`）改前/改后退出码相同（1→1）；用真 runner 干跑改后判据**原文** ⇒ `reason` 携带该成因、**不再是**空因模板。
2. **补棘轮盲区：检测器的失败出口判定扩到「隐式退出」类** —— 当判据**没有任何显式非零 exit 语句**时，它的失败出口就是**行尾命令自身的退出码**；检测器必须分类该行尾命令，把**失败时静默**的形态（`grep`（含 `-q`）/ `test` / `[` / 整条重定向 `/dev/null`，以及 `&&` 左侧的同类静默分支）判为失败出口。**按位置判**（行尾 / 该静默命令所在行），⛔ 不是全文关键词扫描；⛔ **不动 `ATTRIBUTION_RE`**；三态（PASS / FAIL / NOT-EVALUATED）必须保持互异。
3. **同类一次修完（5b）** —— 上述 14 条逐条补**互不相同**的 stderr 成因，**逐条给「同载体改前/改后退出码相同」的读数**（14 条全给，⛔ 抽样不算）；⛔ 只改诊断输出，不改任何判定分支。
4. **计数修回基线，⛔ 不抬基线** —— 收紧检测器必然让 live 计数由 31 升到 31+14=45；唯一合法出路是把这 14 条**修掉**（计数回落 ≤32），⛔ **不是** `--capture` 把 baseline 写高（那恰是本 DoD 禁止的「放宽检测器」）。
5. **同步既有读者** —— `plugin/test/criterion-failure-attribution-check.test.mjs` 增正/负控制；`plugin/scripts/checker-mutation-cases/criterion-failure-attribution-check.sh` 四态仍互异；`plugin/scripts/runner-static-gate.ts:654-655` 的 `@static-object` 登记与 `--root` 调用一字不动。
6. **⛔ 三条不许做的** ——
   - ⛔ **不改 `acceptance-runner.ts` 的空因模板文案**：AC-243（achieved, `long-term: true`）把它的常量 `T` 与 runner 实测文本钉成逐字一致；改 runner 文案会让 AC-243 转红，**这是设计如此**（AC-243 的 expect 明写「二者已漂移……AC-241 退化为恒绿，须修 AC-241」）。
   - ⛔ **不改 AC-241 判据文件本身**（判据与 runner 的耦合由 AC-243 守）。
   - ⛔ **不以「恢复 draft GOAL 载体让 AC-172 重新 pass」的方式翻绿 AC-241** —— 那是把失败对象移除、盲区原地不动；AC-241 的绿必须来自**失败被判据自己写成因**。（draft 载体该不该存在是 AC-172 自身的真值问题，归 AC-242 一族，本条不碰。）

<!-- dedup-ref --> **与既有任务的关系（仅追溯）**：`gap-goal-criteria-bare-failing-exit-unattributable`（done，`goal_ac: AC-241`）造了检测器与棘轮；`gap-criterion-attribution-ratchet-blind-to-trailing-computed-exit`（done，`goal_ac: AC-241`）补了「`exit(...)` 参数尾部 `else <非零>`」形态；`gap-meta-withfailureoutput`（done）修的是 AC-241 判据自身的自引用假阳性。本条补的是**第三种、也是检测器从头到尾看不见的那种**形态——**判据根本没有 exit 语句**，退出码由行尾静默命令继承。三条互不重复。本条**不改** AC-241 判据文件本身。

### 落地时要如实报告的两处偏差（2026-09-12，实测）

- **本任务立案后、开工前，兄弟任务 `gap-achieved-ac-rot-invisible-when-ledger-tail-is-stale-pass` 的 AC5 已把 AC-172 改判**（`17cffe7e9`，02:15Z）：AC-172 的判据由「本仓 `list --status draft` 有 GOAL- 记录」收敛为「自持 tempdir root 下 draft 可用 ∧ 默认不激活」，**每个失败分支都写成因**。⇒ 本任务 AC1 的**对象状态**已由它满足（本次实测复核），本任务不再重复改该文件；同时 AC1 里「同一载体改前/改后退出码相同（1→1）」这一条**读数不可复现**——判据已不再读那个载体。
- **5b 枚举实测为 13 条**（非立案时写的 14 条）：AC-172 / AC-228 已由上述兄弟任务与 `17cffe7e9` 修掉（两者此后带显式 `exit 1`，不再属本类），而本类的机械枚举**另发现 1 条立案清单漏掉的 AC-177**（`test -s … && test "$(grep -c …)" -ge 3`，同为 `&&` 左侧静默分支）。故本次实际修 **13 条**：AC-156/170/171/173/174/175/176/**177**/178/195/197/208/225。AC-177 已补进 `## Touches`。

## AC

- [x] **AC1 止血：AC-172 的失败出口写成因，语义逐字不变** —— `goals/AC-172-draft-status-real-carrier.md` 的 criterion 保留「存在 draft GOAL 记录 ⇒ exit 0」的判定，仅补一句 stderr 成因。读数：同一载体（`node packages/quay/src/goal-store.ts list --status draft` 的输出）改前/改后退出码相同（实测 1→1）；用真 runner 干跑改后 criterion **原文**（`m.runAcceptance({command:<原文>, cwd:".", timeoutMs:30000})`）⇒ `reason` 逐字包含该成因、**不再是** `criterion wrote no output to stderr/stdout`。
  - ✅ **对象状态已满足，但由兄弟任务落的地**（见上「落地时要如实报告的两处偏差」）。本次实测（真 runner）：(a) 改判前形态逐字、生产 root ⇒ `code=1` + `reason="acceptance failed (exit 1) — criterion wrote no output to stderr/stdout"`（**损坏实测**）；(b) 现行 criterion、生产 root ⇒ `code=0`（「有 draft ⇒ 0」判定保留）；(c) 现行 criterion、红载体（store 不可用）⇒ `code=1` + `reason` 逐字携带 `CAUSE=write-failed — 不传 --status 的写入失败…`、**不含**空因模板。⛔ 子读数「同一载体改前/改后 1→1」不可复现：判据已不读该载体（AC-172 被改判为自持 root）。

- [x] **AC2 棘轮盲区关闭 + 双向对照（能取假）** ——
  · 修复前（`git show develop:plugin/scripts/criterion-failure-attribution-check.ts` 落一份）：单独注入 AC-172 同形夹具 ⇒ `bareAcs=0`、`status=pass`、`exit=0`、夹具 id 不在 `ids`（**盲区实测**）；
  · 修复后：同一次注入 ⇒ `bareAcs = baseline+1`、`added=[夹具id]`、`exit=1`；移除 ⇒ 回落、`exit=0`；
  · 负控制同批给：`node --test <file>` 行尾（失败时有输出）、`grep -q X || { echo cause >&2; exit 1; }`（有归因分支）、值位引号串（`command:"… exit 1"`）三类**都不新增命中**；
  · `--goals-dir` 不可读仍 `exit=3`（三态互异）。
  - ✅ **实测（同一夹具、同一 baseline=0，全部经 CLI）**：把 develop 版检测器换回跑同一夹具 ⇒ `{"bareAcs":0,"ids":[],"status":"pass","ok":true}` / `exit=0`（**盲区**）；换回修复版 ⇒ `{"bareAcs":1,"ids":["AC-990"],"added":["AC-990"],"status":"fail"}` / `exit=1`；换回后 `diff` 与保存的修复版**逐字节相同**。三条负控制同批注入 ⇒ `bareAcs=0`、`ids=[]`、`exit=0`。`--goals-dir /nonexistent-goals-dir` ⇒ `exit=3` + `NOT-EVALUATED` 到 stderr。移除夹具后若该 root 只剩零条在域判据则 `exit=3`（三态语义，非 0）；在 CLI 单测里保留一条对照判据时 ⇒ 回落 `exit=0`（两种读数都给）。

- [x] **AC3 同类归零（5b 枚举的 14 条）** —— widened 检测器下 `--json`：`bareAcs ≤ baseline 32` **且** `ids` 不含 `AC-156/170/171/172/173/174/175/176/178/195/197/208/225/228`。逐条给「改前/改后同载体退出码相同」的读数（14 条全给，⛔ 抽样不算）；AC-225/AC-228 的静默分支（`&&` 左侧）须保留逐字打印在注释里的过报条数。
  - ✅ **实测**：`bareAcs=31 ≤ baseline 32`（`delta=-1`、`status=pass`）；14 个点名 id **无一**在 `ids` 中（交集为空）。13 条逐条**红路**读数（symlink 农场载体 + 单点扰动，⛔ 非抽样、13/13 全给）：PRE 全为 `exit 1` 且 reason 为空因模板、POST 全为 `exit 1` 且 reason 携带 `CAUSE=`，**13/13 退出码相同**；另在**绿灯载体**上 13/13 PRE=POST=0（语义未变）。⛔ 未抬 baseline（仍 32）；⛔ 未放宽 `ATTRIBUTION_RE`。
  - ⚠️ **过报条数（逐字打印在检测器注释里）**：13 条中 **5 条**（AC-156/173/175/177/225）的静默分支在 `&&` 左侧——立案时写的「2 条」取自另一份 14 条清单，实测更正为 5；`grep -c` 子类实测 **0** 条（95 条在域判据中无一条被标记段的命令词是 `grep -c`；AC-171/177 的 `grep -c` 都在 `$( )` 内，被标记段是外层 `test`）。

- [x] **AC4 三态与接线不退化** —— `node --experimental-strip-types --test plugin/test/criterion-failure-attribution-check.test.mjs` 全绿（含新增隐式退出正/负控制）；`bash plugin/scripts/checker-mutation-cases/criterion-failure-attribution-check.sh` RC=0（四态互异）；`plugin/scripts/runner-static-gate.ts` 对该检查器的 `--root` 调用与 `@static-object` 登记未改；`docs/analysis/criterion-failure-attribution.baseline.json` 的 `count` **仍为 32**（⛔ 未抬高）。
  - ✅ **实测**：单测 `tests 28 / pass 28 / fail 0`；mutation case `RC=0`（并新增 B3 相位：隐式退出形态必须让棘轮咬住，与 B2 同构——否则退回盲区时整个 case 仍绿）；`git diff develop -- plugin/scripts/runner-static-gate.ts` **空**；baseline `count=32` 未动。

- [x] **AC5 runner 文案与 AC-243 未被扰动** —— `goals/AC-241-*.md` 与 `packages/quay/src/gate/acceptance-runner.ts` 的 diff 为空（`git diff --stat` 两者均无改动）；AC-243 判据原文干跑 ⇒ `exit 0`（其常量 `T` 与 runner 实测文本仍逐字一致）。
  - ✅ **实测**：`git diff --stat develop -- "goals/AC-241-*" packages/quay/src/gate/acceptance-runner.ts` **空**；AC-243 判据原文经真 runner ⇒ `ok=true code=0 reason="acceptance passed (exit 0)"`。

- [ ] **AC6 生产台账翻绿（待外部）** —— 生产 root（主检出）`.quay/gate-events.jsonl` 中 AC-241 的尾事件 `verdict=pass`、`reason="acceptance passed (exit 0)"`，**且此刻 AC-172 的尾事件仍为 `verdict=fail` 而其 `payload.reason` 携带它自己写出的成因**（即绿来自归因、不是来自失败对象消失）；由常驻 goal-driver 在本次落地后的轮次写出。⛔ 不得以 worktree 读数替代本条的**生产**读数。（待外部）
  - ⚠️ **本条只满足一半，另一半的判据前提已被外部落地取代（⛔ 故不勾）**。第一半 **已满足并有生产读数**：`.quay/gate-events.jsonl` 中 AC-241 尾事件 = `2026-09-12T02:41:42.509Z verdict=pass reason="acceptance passed (exit 0)"`（`actor=goal-cli`）—— 同一读数下主检出直接干跑 AC-241 判据亦 `code=0`。第二半**为假且不可满足**：AC-172 的尾事件是 `2026-09-12T02:30:12.944Z verdict=pass`（兄弟任务改判后它已为真），故这次的绿**不是**「绿来自归因」，而是「失败对象被移除」——正是本任务 ⛔ 点名不算达成的那种。本任务能给的补救是：把**同类剩余 13 条**的失败出口全部写成因，使今后任何一条翻假都写因，从而 AC-241 的绿不再依赖「恰好没有判据为假」。⛔ 未以任何形式构造 AC-172 的失败来凑这一半。

## DoD

- AC-241 的**生产台账**尾事件 `exit 0`，且同一读数里 AC-172 仍是 fail-with-cause（直接量；⛔ 分支上的代码状态不是本条的判据）；
  - ⚠️ 前半 ✅（AC-241 尾事件 pass，见 AC6）；后半 ❌ **前提已被外部取代**（AC-172 尾事件 pass，由 `17cffe7e9` 改判）。**故本 DoD 未整体达成**，见 AC6 的处置说明。
- 棘轮盲区由**同一条夹具的双向对照**证明关闭（修复前注入仍绿 / 修复后注入必红），⛔ 不是「改完再宣称」；
  - ✅ 实测双向（见 AC2），且换回/换回的检测器文件 `diff` 逐字节相同。
- 14 条同类判据的失败出口携带成因且**语义逐字不变**（同载体前后退出码相同；⛔ 「加了 stderr 就算」不算）；
  - ✅ 实测 13 条（立案清单里 AC-172/AC-228 已由兄弟任务修掉；机械枚举另补出 AC-177）红灯 13/13 退出码相同且 POST 携带成因、绿灯 13/13 PRE=POST=0。
- ⛔ 抬基线（32→45）不算达成；⛔ 放宽 `ATTRIBUTION_RE` 制造假阴性不算达成；⛔ 改 runner 空因文案 / 改 AC-241 判据文件不算达成；⛔ 以恢复 draft 载体让 AC-172 重新 pass 的方式翻绿不算达成。
  - ✅ 四条禁令均未触碰：baseline 仍 32；`ATTRIBUTION_RE` 逐字未改；runner 与 `goals/AC-241-*.md` diff 为空；未构造/恢复任何 draft 载体。

## Touches

- `plugin/scripts/criterion-failure-attribution-check.ts`
- `plugin/test/criterion-failure-attribution-check.test.mjs`
- `plugin/scripts/checker-mutation-cases/criterion-failure-attribution-check.sh`
- `docs/analysis/criterion-failure-attribution.baseline.json`
- `goals/AC-156-bare-filename-scan.md`
- `goals/AC-170-goal-id-vocabulary-migration.md`
- `goals/AC-171-migrate-live-phases-into-store.md`
- `goals/AC-172-draft-status-real-carrier.md`
- `goals/AC-173-revoke-prose-authority.md`
- `goals/AC-174-hard-cap-replaces-singleton.md`
- `goals/AC-175-staleness-three-state-and-divergence.md`
- `goals/AC-176-abi-encapsulation.md`
- `goals/AC-177-goal-driver-production-records.md`
- `goals/AC-178-task-goal-linkage.md`
- `goals/AC-195-store-git-commit-0-store-commit-ts.md`
- `goals/AC-197-kind-tasks-goals-meta-adr-docs-managed-commitstorewrite-5.md`
- `goals/AC-208-存量-goal-的退出条件齐备-非-superseded-retired-的-goal-全部有可读的业务目标.md`
- `goals/AC-225-a域枚举归零-kernel-sibling-解析违例-0-处-完整性由机械枚举证明而非手工清单-goal-012-退出条.md`
- `goals/AC-228-一致性夹具接入常规套件且沿三轴不像本仓库-含双向负控制-goal-012-退出条件③.md`
- `tasks/gap-criterion-attribution-blind-to-silent-terminal-command.md`
