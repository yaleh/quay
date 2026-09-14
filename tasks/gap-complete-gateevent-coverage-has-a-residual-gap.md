---
id: gap-complete-gateevent-coverage-has-a-residual-gap
title: complete GateEvent 修复后覆盖率仅 74–94%——仍有约两成落地不写该事件，且偏差与「那天完成得少」同形
status: ready
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
发生在 ff **之前**（`worker-driver.ts:4611` flip → `:4617` ff），ff 失败 ⇒ `reset done→ready` 回滚重试
（`worker-driver.ts:3844-3857`）。实测 2026-09-07：89 条 flip 提交 / 47 个任务 = **1.89×**；单个任务
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
② 负控制：同一块对着**没有该 verb** 的 worker-driver 跑 ⇒ `unknown argument` ⇒ FATAL exit 1
（即修复前该路径的结构必然是零事件，与 09-06 的实测一致）；
③ mutation case 与 7 条单测全绿（含「抹掉载体事件 ⇒ 必须报红」双向）。

## AC1 路径枚举

判定手法：`grep` 按**位置**（命令位/行首锚定），不是关键词扫注释与字符串（硬规则 2）。
命中数与前 3 条实际内容逐条贴出。

| # | 路径 | 位置 | 写 `complete`？ |
|---|---|---|---|
| 1 | 机械 fan-in flip（`patchStatusField(…, "done")`） | `plugin/scripts/worker-driver.ts:3840`、`:3855`（2 处）；写入点 `appendCompleteGateEvent` `:3891`，调用点 `:4626` | **是**（但**只在 ff 成功后**——flip 在 ff 前，回滚的那次不写，这是正确的） |
| 2 | 语义兜底 fan-in workflow flip | `plugin/workflows/fan-in-execute.js:849` `sed -i 's/^status: ready$/status: done/'`（该文件内 `status: ready$/status: done` 命中 2 条：1 条是 `:849` 本身，1 条是 `:908` 我新加的说明注释） | **修复前否（2/2 零事件）；已修**：新增 `complete-gate-event-block`（`:906-915`）经 `worker-driver.ts --append-complete-gate-event` 调**同一个** `appendCompleteGateEvent`（⛔ 不手搓 JSON） |
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

## 机制侧验证（修复的真实性，非 fixture 回声）

① **逐字真跑**：把 `fan-in-execute.js` 里新增的 shell 块原样取出，对着临时 root 跑：

```
$ worktree=<worktree> root=<tmp> task=TEST-probe-002 bash -euc '<该块的逐字内容>'
{"event":"complete-gate-event-appended","task":"TEST-probe-002","ok":true,"reason":null}
$ node -e '…读 <tmp>/.quay/gate-events.jsonl…'
event: complete pass quay-fan-in-workflow TEST-probe-002 ready->done
```

② **负控制（证明修复前该路径结构上不可能写事件）**：同一块对着**没有该 verb** 的 worker-driver 跑 ⇒
`worker-driver: unknown argument: --append-complete-gate-event` ⇒ `FATAL: complete GateEvent 补写失败`
⇒ exit 1。也就是说 09-06 那两条零事件落地是该路径的**结构性**结果，不是偶发写失败。

③ **mutation case** `plugin/scripts/checker-mutation-cases/gate-event-coverage-check.sh`：真 git 仓 fixture，
baseline 绿 → 抹掉载体事件 ⇒ 必须红 → 写回 ⇒ 绿 → 再加一条晚于 cutoff 的无事件落地 ⇒ 仍必须红。
`bash <case>.sh <tmpdir>` exit 0。
