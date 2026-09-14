---
id: gap-complete-gateevent-coverage-has-a-residual-gap
title: complete GateEvent 修复后覆盖率仅 74–94%——仍有约两成落地不写该事件，且偏差与「那天完成得少」同形
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
## Finding

`gap-mechanical-fan-in-writes-no-complete-gateevent`（09-02 实现落地、09-04 翻 done）确实修好了
主路径。按天核对 `.quay/gate-events.jsonl` 的 `complete` 事件数 ÷ 同日 git `翻 … done` 落地数：
08-20 ~ 09-03 = 0%；09-04 起 74%–100%（09-07 = 53%、09-06 = 74%、09-09 = 76%、09-11 = 75%、
09-08 = 86%）。本条追这个残留。

### 结论一：74–94% 里的绝大部分是**分母伪影**，不是漏写

原读数的分母是 `翻 X done` **提交条数**。但**一次落地会留下 1..N 条**该提交：机械 fan-in 的 flip
发生在 ff **之前**（`worker-driver.ts:3900` flip → `:4690` ff），ff 失败 ⇒ `reset done→ready` 回滚重试
（`worker-driver.ts:3904-3920`）。实测 2026-09-07：89 条 flip 提交 / 47 个任务 = **1.89×**；单个任务
最多 **9 次** flip + 8 次 reset（`gap-goal-driver-draft-ac-invisible-yet-blocking`）。
按**落地**（每任务最后一次 status 转移到 done，且 tip 上 status=done）重算同一窗口：

```
$ node --experimental-strip-types plugin/scripts/gate-event-coverage-check.ts --root <主检出> --all
2026-09-04        28      24      4         0  100%
2026-09-05        16      16      0         0  100%
2026-09-06        38      36      0         2  95%   ← 真缺口（见结论二）
2026-09-07        47      47      0         0  100%
2026-09-08        63      62      0         1  98%   ← 真缺口（见结论三）
2026-09-09        54      54      0         0  100%
2026-09-10        45      44      0         1  98%   ← 真缺口（见结论三）
2026-09-11        33      33      0         0  100%
2026-09-12        21      20      0         1  95%   ← 真缺口（见结论三）
2026-09-13        45      45      0         0  100%
2026-09-14         6       6      0         0  100%
RED: 覆盖率低于阈值 95% 的非豁免日：2026-09-06=95%
```

**判别对照（硬规则 4 推论四——两者给出相反预测）**：若残留是「真漏写」，应有**随机任务完全没有事件**；
若是分母伪影，则「缺的」应**恰好**等于「被多次 flip 的任务」。读数：09-07 有 89-47 = 42 条**多余**提交、
**0 个**无事件任务 ⇒ 伪影假设胜。同向控制：全员 399 条 complete 事件里只有 **2 个**任务有 >1 条
（`gap-dashboard-fanin-timestamp-timeline-anchor`、`gap-dashboard-driver-status-card`）——事件基本是
「每次真落地一条」，而 commit 是「每次尝试一条」。

### 结论二（真缺口，已修）：语义兜底 fan-in 落地路径**全文零 GateEvent**

`plugin/workflows/fan-in-execute.js:849` 的 flip 块直接 `sed -i 's/^status: ready$/status: done/'` +
commit，**没有任何事件写入**。实测：该路径 2/2 落地零事件，而机械路径 386/388 有事件。

### 结论三（真缺口，**检测不修**）：Provider-ABI 直写 `status: done` 是 ABI 层设计内的旁路

`packages/quay/src/gate/lifecycle.ts:207/:275` 之外，还有一条**完全绕过 gate 引擎**的落地：直接
`task_write` 把 status 改成 done。窗口内 3 次：`gap-ac191-migrated-ac-production-evidence-at`（09-08）、
`gap-store-commit-propagation-log`（09-10）、`gap-goal-target-health-vs-dir131-boundary`（09-12，
且是 **todo→done 的非法边**）。**不修**的理由：Core 写的是 view-model，Provider ABI 必须 provider-agnostic
——让 provider 感知 gate 会把 gate 语义漏进每个后端。既有检测器 `stale-ready-audit.ts` 的
`bypassComplete` 覆盖它的**实时**窗口（≤6h）；本条的日覆盖率判据把它纳入**历史**读数。

## Touches

- `plugin/scripts/gate-event-coverage-check.ts`
- `plugin/scripts/checker-mutation-cases/gate-event-coverage-check.sh`
- `plugin/test/gate-event-coverage-check.test.mjs`
- `plugin/scripts/worker-driver.ts`
- `plugin/workflows/fan-in-execute.js`
- `plugin/scripts/runner-static-gate.ts`
- `plugin/scripts/capability-catalog.sh`
- `plugin/scripts/task-file-bypass-check.ts`
- `tasks/gap-complete-gateevent-coverage-has-a-residual-gap.md`

## Acceptance Criteria

- [x] 枚举**所有**会把任务翻 done 的路径（grep 命中数 + 前 3 条实际内容 + 文件:行号），逐条说明是否写 `complete` GateEvent —— 见下方「## AC1 路径枚举」。
- [x] 取一个具体的未写事件的落地实例（09-07/09-06）追出它走的是哪条路径，把结论写进任务体 —— 见「## Finding 结论一/二」。
- [ ] 补上遗漏路径后，连续 ≥3 天真实生产记录的覆盖率 ≥95%，读数与命令行贴进任务体（已知例外已列明）（待外部）
- [x] 覆盖率偏离可见：新增判据 `plugin/scripts/gate-event-coverage-check.ts`（登记进 `run_static_checks`，@static-tier change），修复前数据上报红 —— 见「## AC4 红线输出」。

## Definition of Done

覆盖率读数取自**生产载体**（`.quay/gate-events.jsonl` + `git log develop`），不接受 fixture；
把注入 seam 关掉后 AC 仍应成立。修复后必须经过 ≥3 天真实落地窗口再判完成
（硬规则 4 推论三：只在实现当轮验证等于没验证生产）。

**本条 DoD 当前未满足**：修复落地于 2026-09-14，其后**一个真实落地日都还没过** ⇒ AC3 留未勾。
这是 DoD 自己要求的（「修复后必须经过 ≥3 天」），不是遗漏。机制侧的验证已独立完成：
① 用 workflow 里**逐字**的 shell 块对着临时 root 真跑 ⇒ 事件落盘（`actor: quay-fan-in-workflow`）；
② 负控制：同一块对着**没有该 verb** 的 worker-driver 跑 ⇒ `unknown argument` ⇒ **不写事件**
（修复前该路径的结构必然是零事件，与 09-06 的实测一致）；
③ mutation case 与 7 条单测全绿（含「抹掉载体事件 ⇒ 必须报红」双向）。

⚠️ **AC3 的窗口不等于「修复被验证过」**——见文末「## 复核」②：被修的那条路径（#2）目前在生产上
**一次都还没跑过**，所以三日覆盖率全绿只能证明机械路径没退化。翻 AC3 前先读那一节。

## AC1 路径枚举

判定手法：`grep` 按**位置**（命令位/行首锚定），不是关键词扫注释与字符串（硬规则 2）。
命中数与前 3 条实际内容逐条贴出。

| # | 路径 | 位置 | 写 `complete`？ |
|---|---|---|---|
| 1 | 机械 fan-in flip（`patchStatusField(…, "done")`） | `plugin/scripts/worker-driver.ts:3900`、`:3915`（2 处）；写入点 `appendCompleteGateEvent` `:3951`，调用点 `:4704` | **是**（但**只在 ff 成功后**——flip 在 ff 前，回滚的那次不写，这是正确的） |
| 2 | 语义兜底 fan-in workflow flip | `plugin/workflows/fan-in-execute.js:849` `sed -i 's/^status: ready$/status: done/'` | **修复前否（2/2 零事件）；已修**：新增 `complete-gate-event-block`（`:908-922`），经 `worker-driver.ts --append-complete-gate-event` 调**同一个** `appendCompleteGateEvent`（⛔ 不手搓 JSON）；**写失败只告警、⛔ 不阻塞 landing**（见下方「## 一处我自己的判断」） |
| 3 | QENG 生命周期（`quay complete` / `quay promote`） | `packages/quay/src/gate/lifecycle.ts:207`（`runComplete`）、`:275`（`runCompleteLoop`），均 `client.taskWrite({status: TASK_STATUS.DONE, expectedStatus: READY})` + `mkLifecycleEvent({gate:"complete", verdict:"pass"})` | **是** |
| 4 | outer loop 完成 | `plugin/scripts/loop-complete-task.ts:70/:117` 转发 `runCompleteLoop` | **是**（与 #3 同源） |
| 5 | Provider-ABI 直写 `status: done`（MCP `task_write` / native `task edit`） | 不经过上述任何一处；窗口内 3 次（09-08 / 09-10 / 09-12） | **否 —— ABI 层设计内旁路**（理由见 Finding 结论三）；由本判据与 `stale-ready-audit.ts` 的 `bypassComplete` 检测 |
| 6 | 直接手改 `tasks/*.md` | 与 #5 同类；窗口内 `git log` 无该形态提交 | **否**（政策禁止；同上被检测） |

**互补读法（防「只修了被报出来的那一条」，硬规则 5b）**：上表按**写入点**枚举；再用**产物**兜底——
`git ls-tree develop tasks/` 的全部 2049 个 done 任务中，1652 个无 complete 事件，但其中绝大多数落在
机制不存在之前（载体最早 `complete` 事件 = 08-12，机械 fan-in 写侧 09-04 才上线）。所以全史差集不是
缺陷读数；**窗口内的差集才是**，即结论一/二/三。

## AC2 追因：09-07 的 53% 走了哪条路径

选 `gap-goal-driver-draft-ac-invisible-yet-blocking`（09-07 单日 flip **9 次**）：

```
$ git log develop --since="2026-09-07 00:00" --until="2026-09-07 23:59" \
    --date=iso-strict --pretty='%h %ad %s' -- tasks/gap-goal-driver-draft-ac-invisible-yet-blocking.md
9bc18d8eb 2026-09-07T09:31:38+00:00 tasks: 翻 … done（driver 机械 fan-in）
3b11c9142 2026-09-07T09:31:38+00:00 tasks: reset … done→ready（fan-in 收敛「done 未落地」中间态）
8187c21d2 2026-09-07T09:14:00+00:00 tasks: 翻 … done（driver 机械 fan-in）
58d3218fa 2026-09-07T09:14:00+00:00 tasks: reset … done→ready（…）
… （共 9 翻 / 8 reset）
```

该任务在载体里只有 **1 条** complete 事件（`2026-09-07T09:32:12.911Z`，`actor: quay-driver`）——
即**最后一次**真落地那一次。前 8 次 flip 各被一次 reset 回滚，因此**都不该**有事件。

⇒ **它走的是路径 #1，且行为正确**。09-07 的 53% 全部由「分母把 9 次尝试当成 9 次落地」造成。
真缺口的两条路径实例在 09-06（路径 #2，2 条）与 09-08/09-10/09-12（路径 #5，3 条）。

## AC4 判据与红线输出

新增 `plugin/scripts/gate-event-coverage-check.ts`，并把**同一个**判据接进静态门
（`plugin/scripts/runner-static-gate.ts` 的 `run_static_checks`，`@static-tier change`，
`--root main_root --days 1 --gate`；`@checker-count` 59→60）。接线选择都是承重的，不是缺省值：

- `--root main_root`：载体 `<root>/.quay/gate-events.jsonl` 是主检出 gitignored 运行态，
  一次性 verify worktree 里**不存在** ⇒ 指 `repo_root` 会让它每轮恒定 exit 3 NOT-EVALUATED，
  而「一个永远 NOT-EVALUATED 的检查器与一个恒绿的在记录上同形」正是上面
  `direct-to-develop-bypass-check` 注释点名的缺陷类。
- `--days 1`：AC4 的字面读法是**当日**覆盖率；3 天窗会把某一天的漏记变成持续 3 天、挡住无关任务的
  fan-in（本仓已记过这类「成本落在无关任务头上」的缺陷）。
- 三个状态：0 PASS / 1 RED / 2 usage / **3 NOT-EVALUATED**（无载体、git 不可读、窗口内零落地），
  run_checker 认 3 为第三态（不 fail-closed、不 abort 套件）。

**判据能取假（硬规则 4）**——修复前数据上的红线输出，命令行与逐字输出：

```
$ node --experimental-strip-types plugin/scripts/gate-event-coverage-check.ts --root <主检出> --all
gate-event-coverage-check — 窗口 2026-08-12 .. 2026-09-14，阈值 95%
bootstrap cutoff（载体中第一条 quay-driver complete 事件）: 2026-09-04T11:16:47.112Z
...
2026-09-06        38      36      0         2  95%
    UNCOVERED: gap-quay-init-closure-ratchet-manual-reanchor-recurs, gap-goal-driver-mechanical-ring
2026-09-08        63      62      0         1  98%
    UNCOVERED: gap-ac191-migrated-ac-production-evidence-at
2026-09-10        45      44      0         1  98%
    UNCOVERED: gap-store-commit-propagation-log
2026-09-12        21      20      0         1  95%
    UNCOVERED: gap-goal-target-health-vs-dir131-boundary
RED: 覆盖率低于阈值 95% 的非豁免日：2026-09-06=95%
$ echo $?
1
```

**已知例外（推导式，⛔ 不是手维护 id 白名单——白名单可以被加 id 静默放大）**：一次**未覆盖**落地，
其 flip 提交时刻**早于**载体中第一条 `actor:"quay-driver"` 的 complete 事件 ⇒ 判为 bootstrap 例外
（那一刻写侧在生产上尚未生效——代码已提交但在任务分支上、主检出的 driver 跑的还是旧代码）。
实测 cutoff = `2026-09-04T11:16:47.112Z`，把 09-04 的 2 条 bootstrap 落地
（`gap-test-file-snapshot-worktree-drops-realinstall`、`gap-mechanical-fan-in-writes-no-complete-gateevent`
——后者正是实现该机制的那个任务本身，它自己的落地跑的是修复前的 driver）排除；而 09-06 的
路径 #2 落地（17:47/20:18）与 09-08/09-10/09-12 的路径 #5 落地**都晚于 cutoff** ⇒ 仍报红。
例外集合每次运行**逐条打印**（可审计），且随历史增长只会变小。

**判据按状态转移取，不按提交信息取**（这是 AC1「枚举所有路径」的机械版）：`--root` 下扫
`git log -p -U0 -- tasks/`，看每条 (commit, file) 块的 `-status: X` / `+status: done`。
若按 `/^tasks: 翻 (\S+) done/` 提交信息扫，路径 #5 的 3 条落地**一条都看不见**——那条路线的提交信息是
`tasks: <id> task_write by cli:<pid>`。测试 `plugin/test/gate-event-coverage-check.test.mjs` 第 2 条
就是这条的对照（提交信息不含「翻 … done」但确实 ready→done ⇒ 必须入分母）。

单向性检查（防判据在修复后变成恒绿）：测试第 4 条与 mutation case 的第二向都断言
「晚于 cutoff 且无事件的落地**仍必须报红**」——B 向不通过时判据会静默退化成「无事件一律放过」。

## 一处我自己的判断（写失败是否阻塞 landing）

新块最初写成 `exit 1`（写失败 ⇒ 本 workflow 判红）。**改掉了**，理由三条：

1. 与机械路径**语义相反**：那边的 `appendCompleteGateEvent` 契约原文就是「best-effort：写失败返回
   `{ ok:false }`，不抛——fan-in 已 landed，**观测写不得阻塞主执行**」。同一个失败在两条路径上
   给出相反后果，是新的漂移源。
2. 硬规则 12：**要求一个新前置之前先给出它的发生率**。我没有「事件写失败」的发生率读数
   ⇒ 它不该成为一条阻塞前置——尤其只在兜底路径上阻塞。
3. 静默不是风险：漏记由**次日**的覆盖率判据报出（这正是 AC4 的判据存在的理由）。
   ⇒ 告警 + 可检测 = 该失败不可能与「一切正常」同形。

**双向复验**：verb 在 ⇒ 事件落盘、exit 0；写失败（模块不存在）⇒ `WARN` 打印、**exit 0**（landing 照常）。

## 接线代价：本任务自己撞出的四处红灯（全部已修）

新代码第一次跑本任务自己的门时引入四处红，**全部由本任务的 delta 造成**，逐条修正并复验：

- `tmp-leak-pairing-check` + `test-isolation-check` 的 AC5 单向棘轮：新测试 `makeRepo()` 调
  `fs.mkdtempSync` 未配对清理（`mkdtemp-no-cleanup`，对一个只准变短的清单是**新增违规**）。
  改为登记 + `after()` 统一 `rmSync`。
- `task-file-bypass-check`：新检查器有 2 处 `tasks/` 文件操作命中（`git log -p -- tasks/`、
  `git show <ref>:tasks/<id>.md`）。本检查器的**客体就是任务库的状态历史**（与 `packages/quay-native`
  同形），且**从不写任务文件** ⇒ 按该棘轮自己的机制做**有理由的登记**（ALLOWLIST + `expected: 2`），
  ⛔ 不是绕过它。顺带同步 `worker-driver.ts` 的 allowlist 计数 3→4（实测 4 处，`1530/1736/3059/3064`，
  全在 develop 上就已存在 —— 用 `git show develop:…| sed -n` 逐行核过，其中**没有一条**来自本任务）。
- `capability-catalog.test.mjs`：CADENCE 必须是五个枚举值之一（`每轮/每红窗/每里程碑/冷启动/按需`），
  我写了自由文本 ⇒ 改回 `每轮`。
- **`fan-in-execute.js` 是 JS 模板字符串**：我插入的说明块里带了反引号 ⇒ **提前终止模板串**
  （`SyntaxError: missing ) after argument list`），`fan-in-execute-paths.test.mjs` 8/93。改成无反引号
  写法后 **93/93**（该文件反引号数与 develop 相等）。⚠️ 这条是硬规则 3b 的教科书实例：这个缺陷的
  **第一版不是我发现的**，是套件报出来的——**给它写注释时我对「这段文本位于什么上下文里」完全没有检查**。

## 机制侧验证（修复的真实性，非 fixture 回声）

① **逐字真跑**：把 `fan-in-execute.js` 里新增的 shell 块原样取出，对着临时 root 跑：

```
$ worktree=<worktree> root=<tmp> task=TEST-probe-003 bash -euc '<该块的逐字内容>'
{"event":"complete-gate-event-appended","task":"TEST-probe-003","ok":true,"reason":null}
$ node -e '…读 <tmp>/.quay/gate-events.jsonl…'
event: complete pass quay-fan-in-workflow TEST-probe-003
```

② **负控制（证明修复前该路径结构上不可能写事件）**：同一块对着**没有该 verb** 的 worker-driver 跑 ⇒
`worker-driver: unknown argument: --append-complete-gate-event` ⇒ 走 WARN 分支 ⇒ **不写事件**
（即 09-06 那两条零事件落地是该路径的**结构性**结果，不是偶发写失败）。
方向二：写失败**不阻塞 landing**（exit 0）——与上节的三条理由一致。

③ **mutation case** `plugin/scripts/checker-mutation-cases/gate-event-coverage-check.sh`：真 git 仓 fixture，
baseline 绿 → 抹掉载体事件 ⇒ 必须红 → 写回 ⇒ 绿 → 再加一条晚于 cutoff 的无事件落地 ⇒ 仍必须红。
`bash <case>.sh <tmpdir>` exit 0；`checker-mutation-check --check-changed` 下 `MUTATION gate-event-coverage-check: pass`。

④ 单测 7/7 绿（含三态 exit 3、分母、状态转移、bootstrap 窄性、双向控制）。

## 复核：合并 develop 后的重锚与生产重读（2026-09-14）

### ① 行号重锚

`plugin/scripts/worker-driver.ts` 因 develop 的后续合并整体下移，Finding 与 AC1 表里的旧行号
**已就地更正**（上表内已是新值）。判定手法同 AC1：**位置锚定** grep + 命中内容逐条核对，⛔ 不是
按关键词扫（硬规则 2）。旧→新对照，每条都贴出命中内容：

| 旧引用 | 现状（命中内容核对） |
|---|---|
| `:3840` | `:3900` `const flipped = patchStatusField(split.frontmatterRaw, "done");` |
| `:3855` | `:3915` reset 后的第二次 flip（reset 块 `:3904-3920`） |
| `:3891` | `:3951` `export async function appendCompleteGateEvent(` |
| `:4626` | `:4704` `const gateEvent = await appendCompleteGateEvent(root, task);`（ff 调用在 `:4690`） |
| `:4611` / `:4617` | `:3900` flip / `:4690` ff |

**未变的引用**：`fan-in-execute.js:849`（sed flip，事件块 `:908-922`）、`lifecycle.ts:207/:275`、
`loop-complete-task.ts:70/:117`。

### ② 路径集合无新增；但**被修的路径在生产上一次都没跑过**（翻 AC3 前必读）

**集合完备性**：重跑位置锚定的全仓 sweep（三个谓词 `status: TASK_STATUS.DONE` / `status: "done"` /
`sed 's/^status: ready$/status: done/'`，排除 `dist/`、`vendor/`、测试夹具）⇒ 除 AC1 表内 6 条外
**无新写入点**，枚举仍完备。

**生产重读**：`2026-09-14` 由实现当轮的 `6/6` 长到 **`33/33 = 100%`**（0 条 UNCOVERED）。

⚠️ **但这条读数不能当作「修复被验证了」**，实测载体按 actor 拆开：

```
$ node -e '…读 .quay/gate-events.jsonl，按 gate=="complete" 的 actor 分组…'
total complete events: 426
{ outer: 9, 'quay-cli': 2, 'quay-driver': 415 }
--- quay-fan-in-workflow events (the FIXED semantic path) ---
（空）
```

⇒ **`actor:"quay-fan-in-workflow"` 的事件数为 0**。原因是那条路径**自修复落地以来一次都没落地过**
（该路径最后一次真落地是 09-06 的 2 条；09-14 的 33 条落地全部是机械路径 `quay-driver`）。
所以：

- 09-14 的 100% 只证明**机械路径没退化**——而机械路径是**另一个任务**（09-04）修的，不是本条的 delta；
- AC3 的三日窗口**可能在不跑一次路径 #2 的情况下全绿** ⇒ 那将是一个「恒真但什么也没验到」的读数
  （硬规则 4c 的第二种失败形态：空转，与「验过了」同形）。
- 因此本条的修复到 2026-09-14 为止，**只有机制侧证据（上面 ①②③④），没有生产证据**。
  这正是硬规则 4 推论三的形状（实现了、fixture 绿了、生产没跑过 ⇒ 与「没实现」同形），
  区别是本条**不**留下假绿：AC3 仍未勾，且此处明写生产证据缺席。

**已定的处置（⛔ 不新增阻塞前置）**：硬规则 12——要求一个新前置前先给它的发生率。路径 #2 的
**真落地**发生率实测为窗口内 2 次（均在 09-06），即数量级「约每 1–2 周一次」；把它写成 AC3 的
阻塞条件会让 AC3 无限期挂起。故记为**观察项 + 一条一命令可查的后续读数**，⛔ 不作为阻塞：

```
$ node -e '…filter(e=>e.gate=="complete" && e.actor==="quay-fan-in-workflow").length'
# ≥1 ⇒ 被修路径已在生产上跑过（事件由它在 ff 成功后自己写）；==0 ⇒ 仍只有机制侧证据
```

即：AC3 翻勾时，若上式为 0，则该绿**只能**支撑「机械路径无退化」，⛔ 不得写成「本条的修复已在
生产验证」。翻勾者请把上式读数一并贴进任务体。

### ③ 复核轮自己跑的三步（本轮的独立证据）

- **scoped 门绿**（driver fan-in 用的同一条命令）：
  `bash scripts/test.sh --for-task gap-complete-gateevent-coverage-has-a-residual-gap --allow-thin`
  ⇒ 退出码 0；其中新检查器在 selected 集内实跑
  （`run_checker "gate-event-coverage-check" … --root "${main_root}" --days 1 --gate` ⇒
  `PASS: 窗口内全部非豁免日覆盖率 ≥ 95%（最差 100%）`），
  `checker-mutation-check --check-changed` ⇒ `MUTATION gate-event-coverage-check: pass`
  （该 delta 的 3 个 checker 全部「注入缺陷 ⇒ 红、还原 ⇒ 绿」）。
- **正/负控制（对着当前树重跑，非引用上一轮）**：verb 在 ⇒
  `{"event":"complete-gate-event-appended","task":"TEST-probe-003","ok":true,"reason":null}`、exit 0，
  载体新增一条 `actor:"quay-fan-in-workflow"` 的 `complete pass` 记录；
  同一调用给一个不存在的 flag ⇒ exit 2、载体**行数不变**（不写）。
- **分支与 develop 对齐**：合并 develop 后无冲突、无未合并路径。

### ④ 上一轮 exited-not-landed 的真因：陈旧分支，⛔ 不是本任务的 delta

上一轮 suite 红于 `plugin/test/test-isolation-check.test.mjs:544` 的
`AC3/AC4 rehearsal: real repo reports the three known instances + the 6 remaining process.exit(1)s`
— `missing AC4 process.exit(1) file packages/quay-native/test/create-validation.test.mjs:`。

真因是**测试文件比 develop 旧一版**：develop 的 `a6ce55a8e` 修掉了 `create-validation` 的 R1+R4 并
按「棘轮只准变短」把该文件从清单里**移除**（6 → 5 条），而失败那次 suite 跑的是移除前的 6 条版本
（该版本要求 `create-validation.test.mjs:process-exit-1` 出现，而它已被修好 ⇒ 结构上必然红）。
本任务分支在 `828d046a3` 合并 develop 时已取到 5 条版本 ⇒ **本轮复跑不再复现**（上述 scoped 门已含
`test-isolation-check` 且全绿）。**与 delta 无关**——delta-relatedness 判 UNRELATED 是对的，
但当时的「按 UNRELATED 忽略」会漏掉真正的修法（merge develop），故此处记明。