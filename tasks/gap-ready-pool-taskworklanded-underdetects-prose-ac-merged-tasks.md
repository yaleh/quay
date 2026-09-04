---
id: gap-ready-pool-taskworklanded-underdetects-prose-ac-merged-tasks
title: "ready-pool notYetFlipped under-detects merged-not-flipped tasks whose AC is prose-heavy — web-board's work landed on master (0950b0b6) yet taskWorkLanded=false, so it stayed in the dispatchable pool and got a THIRD dispatch; fix: add a landed signal independent of AC symbol extraction (e.g. git-history of declared specific Touches), with negative controls"
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra: {}
---
**type:** execution

## Proposal

**ready-pool 的 `notYetFlipped` 排除对 prose-heavy AC 的 merged-not-flipped 任务欠检测——已落地任务留在派发池、被重复派发。**

**证据（2026-08-05 17:0xZ 实测）**：web-board 任务实现已落地 master（`0950b0b6`/`fb1fd520`，12:0xZ merge，
`/board` 三列 via REUSE-drift-checker 子进程，8/8 AC 勾、4 Touches 文件全中），status 仍 `ready`（待外层
closure）。但 `taskWorkLanded()` 返回 **false**——对比同形任务 upgrade-channel（merged、AC 全勾、ready）
返回 **true** 且被 `notYetFlipped` 正确排除。结果是 web-board 留在派发池，本会话已**第三次派发它**
（前两次：09:2xZ phantom 误判重派 + 本次重派；agent 每次靠任务体证据自我纠偏不重实现，但浪费一轮）。

**根因**：`taskWorkLanded = symbolResolved(AC symbols ≥0.6 resolve) OR touchLanded((new) touches landed)`。
web-board 的 AC 段是 prose 叙述（四问回答/负控制/复用论证），可解析代码标识符少 → symbolResolved=false；
其 Touches 全是**既有具体路径**（`packages/quay/src/observation.ts` 等），无 `(new)` 标注 → touchLanded
也 false。两条信号都依赖 AC 段的**符号形态**，prose 形态的 AC 就漏。

**选定机制方向**：给 taskWorkLanded 加第三条 landed 信号——**git-history of declared specific Touches**：
对任务 Touches 中**具体路径（非 glob、非 `(new)`）**，若任一文件被 master 可达提交修改过 ⇒ landed。
对 web-board，`packages/quay/src/observation.ts`/`serve-handlers.ts`/`serve-board.test.mjs` 均被
fb1fd520 修改 ⇒ 检出。**负控制（防 overshoot 方向重演，prior gap：
gap-ready-pool-check-taskworklanded-overshoot-excludes-existing-file-tasks）**：
① 具体路径被**其它任务**顺带修改 ⇒ 不误排（需要把「该文件的修改是否源于本任务」钉住——用提交 message
含任务 id，或本任务合并 commit 的 Touches 一致性，二选一）；② glob / `(new)` 触摸不参与此信号；
③ 一个从未派发、touch 文件恰好被别的工作动过的 todo 任务**不被**判 landed。

**为什么重要**：`notYetFlipped` 是池正确性的排除器——它漏判，落地任务留在池里被反复重派，每一轮都是
浪费（agent 自我纠偏不重实现，但 0 产出一轮）。池 27/12 不缺候选，但重派是明确的机制缺陷。

### 选定机制

1. taskWorkLanded 加第三条信号：git-history of declared specific Touches（具体路径被 master 可达提交修改）
2. 钉住「修改源于本任务」：合并 commit 的 Touches 一致性，或提交 message 含任务 id（防顺带误排）
3. 负控制测试：web-board 判 landed（排除）；upgrade-channel 仍判 landed（回归）；未派发 todo 不判
4. prose-heavy AC 任务（如 web-board）是主要受益类；符号解析路径保持不动（不破坏既有判定）

## Acceptance Criteria

- [x] AC1: `taskWorkLanded(web-board)` 从 false → true（git-history 信号检出，`0950b0b6`/`fb1fd520` 修改了 Touches 具体路径）
      —— 实测 `node --experimental-strip-types plugin/scripts/task-status-drift-check.ts --check gap-web-board-needs-an-inconsistency-verdict-it-does-not-have` → `landed=true`
      （before: false；after: true）。merge 0950b0b6 的 message "merge web-board: …" 引用 2 段 kernel "web-board"
      （全 store 唯一），且该 merge 修改了 observation.ts/serve-handlers.ts/serve-board.test.mjs（web-board 的
      specific code-root Touches）⇒ git-history 信号检出。
- [x] AC2: `taskWorkLanded(upgrade-channel)` 仍 true（回归不破——既有符号解析信号不变）
      —— 实测 `--check gap-upgrade-channel-cant-sync-build-artifacts-dist-stale` → `landed=true`
      （before: true；after: true，backward-compat 保持；符号解析信号未动）。
- [x] AC3: ready-pool 排除 web-board（`not-yet-flipped`），三派风险消除
      —— `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$(pwd)"` 的
      excluded 含 `gap-web-board-needs-an-inconsistency-verdict-it-does-not-have` 与
      `gap-measure-claude-p-headless-third-party-roundtrip-and-exit-semantics`（均 reason not-yet-flipped）；
      pool 12/12。
- [x] AC4: 负控制——一个从未派发的 todo 任务（Touches 具体路径被别的任务顺带改过）不判 landed；glob/`(new)` 触摸不参与 git-history 信号
      —— fixture 测试（task-status-drift-check.test.mjs git-history 组）：
      ① 无关任务 merge 修改 touch 路径 ⇒ 不判 landed；② 共享短 kernel（cold-start/red-window 类）⇒ 不误排；
      ③ glob/`(new)` 不参与；④ 既有文件被无关提交顺带改 ⇒ 不判（overshoot 不重演）。真实 store 抽查：
      `gap-cold-start-gate-should-be-derived-laydown-set-green-not-whole-suite` 与
      `gap-red-window-dispatch-stop-should-be-shared-gate-conditional` 均未被 git-history 误排（仍可派发）。
- [x] AC5: 测试用 `node:test` + `// @test-group`（沿用 ready-pool-check 自身测试组 governance）
      —— 新测试加进既有 `plugin/test/ready-pool-check.test.mjs` + `plugin/test/task-status-drift-check.test.mjs`
      （均 node:test + 首行 `// @test-group governance`）；task 文件里写的 "engine" 与
      「沿用 ready-pool-check 自身测试组」（governance）冲突，按自身测试组处理。

## Definition of Done

- [ ] AC1–AC5 全部勾上；AC1/AC3 实跑输出贴任务体
- [ ] 信号落地实跑：web-board 判 landed（排除）、upgrade-channel 仍 landed（回归）、未派发 todo 不判（负控制）
- [ ] ready-pool 排除 web-board/measure-claude-p（此前三/四派的池污染消失）
- [ ] 全量套件绿（fail 0 且 cancelled 0 且 FULL-SUITE-EXIT=0）

## Touches

- tasks/gap-ready-pool-taskworklanded-underdetects-prose-ac-merged-tasks.md（自身文件：勾 AC + 贴 invoke 证据授权）

- plugin/scripts/ready-pool-check.ts（notYetFlipped 消费端——不排除时池含落地任务）
- plugin/scripts/task-status-drift-check.ts（taskWorkLanded 加 git-history 信号）
- plugin/test/ready-pool-check.test.mjs（AC1-AC4 测试）
- plugin/test/task-status-drift-check.test.mjs（taskWorkLanded 信号回归）
- tasks/gap-ready-pool-check-counts-merged-not-flipped-tasks-in-the-pool.md（交叉标注：prior gap 反向）

## Contract

measure   landed_signals = `node --experimental-strip-types plugin/scripts/task-status-drift-check.ts --check web-board`（或等价 CLI）stdout 的 landed=true/false
band      landed_signals = web-board true 且 upgrade-channel true（AC1+AC2 同跑）
invoke    `node --experimental-strip-types plugin/scripts/ready-pool-check.ts --root "$(pwd)"` 的 excluded 含 web-board
control   未派发 todo（Touches 被顺带改）⇒ 不判 landed（AC4 负控制）
resume    信号与负控制分步提交，任一步完成即写盘

## Execution record

invoke 证据（scoped，`bash scripts/test.sh --for-task gap-ready-pool-taskworklanded-underdetects-prose-ac-merged-tasks --allow-thin`，2026-08-05）：

```
PASS: every test file uses node:test or is a listed legacy exemption; exemption list is at/below the ratchet ceiling and did not grow; new files declare @test-group.
PASS: all 44 violation(s) are baselined in plugin/test-isolation-violations.txt; the list can only get SHORTER (no additions, no growth, no stale entries).
strict-subset mode (scoped static-check tier) — a violation on a scanned task FAILS this run (exit 1); unrelated tasks are not scanned
✔ ready pool excludes a prose-heavy merged task via git-history (AC1/AC3)
✔ git-history: a merge referencing the task's short kernel that modified a specific Touches path ⇒ landed (AC1)
✔ git-history: AC2 regression — a symbol-resolvable merged task stays landed (existing signals unchanged)
✔ git-history: a commit about a DIFFERENT task that touched the Touches path does NOT fire (AC4 negative)
✔ git-history: a SHARED short kernel (sibling collision) does NOT fire (AC4 — cold-start/red-window class)
✔ git-history: glob and (new) Touches do NOT participate (AC4)
✔ git-history: an existing-file touch coincidentally modified by other work does NOT fire (prior overshoot gap NOT re-opened)
✔ taskIdTokens: full id, stripped id, and ≥2-segment prefixes of both
✔ wordMatch: delimited word only — never embedded in a larger hyphenated token
✔ messageReferencesTask: full id any commit · long prefix any commit · short prefix merge+unique
✔ taskIdFromTouches: the self-file tasks/<id>.md carries the id
✔ CLI --check <task-id>: prints landed=true/false (Contract landed_signals measure)
ℹ tests 66  ℹ pass 65  ℹ fail 0  ℹ cancelled 0  （skip 1 = QUAY_TEST_REAL_STORE opt-in）
```

taskWorkLanded before/after（真实 store，同一 worktree）：

| task | before | after | 检出信号 |
|---|---|---|---|
| gap-web-board-needs-an-inconsistency-verdict-it-does-not-have | false | **true** | git-history（merge 0950b0b6 "merge web-board: …" 修改 Touches 具体路径） |
| gap-upgrade-channel-cant-sync-build-artifacts-dist-stale | true | **true** | 符号解析（backward-compat 不破） |
| gap-measure-claude-p-headless-third-party-roundtrip-and-exit-semantics | false | **true** | git-history（4412f7a4 message 含 full-id 前缀，改 RESEARCH 回写文件） |
| gap-ready-pool-floor-scales-with-cap-and-promotion-ranks-touch-disjointness | false | **true** | git-history（fan-in 5ace1071 "gap-ready-pool-floor" 前缀，改 ready-pool-check.ts） |

真实 store 抽查（git-history 新增 landed 的 14 个 ready 任务全部核实已落地；防误排抽查）：
- 未误排：`gap-cold-start-gate-should-be-derived-laydown-set-green-not-whole-suite`、`gap-red-window-dispatch-stop-should-be-shared-gate-conditional`
  （共享短 kernel "cold-start"/"red-window" 被 sibling merge 提及 ⇒ collision-aware 规则拒绝，两者仍可派发）。

## Dispatch review

reviewer: outer
at: 2026-08-05
changed: 外层 2026-08-05 派发本 ready 任务（缺陷：ready-pool 的 notYetFlipped 对 prose-heavy AC 的 merged-not-flipped 任务欠检测，web-board 三派）。实施方向为 taskWorkLanded 加第三条 git-history landed 信号，负控制防 overshoot 重演。
