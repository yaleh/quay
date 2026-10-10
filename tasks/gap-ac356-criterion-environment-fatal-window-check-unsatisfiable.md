---
id: gap-ac356-criterion-environment-fatal-window-check-unsatisfiable
title: gap-ac356：AC-356 判据的 environment-fatal hard-return 子检查结构上恒假（锚点落在
  QuickDeathCause 类型别名、400 字符窗口取不到分支自身的 return r;）——就地修判据并加负控制
status: needs-human
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
goal_ac: AC-356
---
**type:** execution

## Proposal

<!-- dedup-ref --> 相关任务（仅追溯，机制不同）：`goal-035-needs-human-transition-unify`（顶层 `goal_ac: AC-356`，已 `done`——它落地的实现是对的，见下）；`goal-035-needs-human-transition-contract-tests`（`goal_ac: AC-357`，`ready`）；`goal-035-merge-and-postmerge-verify`（`goal_ac: AC-358`，`todo`）。按机制查重：`task_list --search applyNeedsHumanTransition` 只有这三件，其中唯一以顶层 `goal_ac: AC-356` 认领本 AC 的那件已 `done` ⇒ 这不是重复立案，而是「旧修复未持住」的补案（一个已 `done` 的认领任务 = 证据，不是重复）。

**AC-356 现在是 FALSE，而没持住的是判据本身，不是实现。**

- **实现是对的、且在场。** 在 AC-356 的求值根——分支 goal 工作树 `/data/home/yale/work/quay-worktrees/goal-GOAL-035`（HEAD `3947c0ae1`）——实测：`plugin/scripts/driver-filters.ts` 恰一处 `export function applyNeedsHumanTransition(`（:956）；`NeedsHumanKind = "retry-cap" | "stop-terminal" | "quick-death-backoff" | "other"`（:873）；`plugin/scripts/worker-driver.ts` 里 `retryState.needsHuman.add(` = 0、`retryState.counts.set(` = 0、`applyNeedsHumanTransition(` = 2（三条路径收敛）。逐字跑现判据，除下述一条外其余子检查全过。
- **判据的 environment-fatal 子检查结构上不可能取真（恒假）。** 判据里：

  ```js
  const efIdx=wfText.indexOf("environment-fatal");
  const efWindow=wfText.slice(efIdx,efIdx+400);
  if(!/return r;/.test(efWindow)){ ... CAUSE=nongoal-moved ... }
  ```

  在注释剥离后的 `worker-driver.ts` 上，`indexOf("environment-fatal")` 命中的是类型别名 `export type QuickDeathCause = "environment-fatal" | ...`（实测偏移 **103796**），**不是** halt 分支；真实 halt 分支在 **145462**（`if (backoff.cause === "environment-fatal") {`），其自身的 `return r;` 在锚后 **+432** 字符——**超出作者写死的 400 字符窗口**。两个独立缺陷叠加 ⇒ 该子检查在**任何**树上都红。

  ⇒ 硬规则 4 的形态（结构上不可能取真的读数不是测量）+ 硬规则 3b 的镜像（读不懂输入的仪器返回了与判定同形的「失败」，把合格误判为违规）。判据恒红 ⇒ 每轮重评每轮 fail ⇒ AC-356 永远 active。
- **为什么老修复未持住（本条的关键）**：实现没有回退。判据自 `be2d8e876`（GOAL-035 批次）写入起**从未被改动**（`git log -- goals/AC-356-*.md` 仅 batch + draft→active 两次提交），它自出生起就恒假；只是判据首行 `grep -q applyNeedsHumanTransition "$pf" || exit 3` 在实现落地前把整个 scan 短路成 `exit 3`（NOT-EVALUATED），掩盖了这个子检查**从未被真正执行过**——直到实现落地、scan 真正跑到它，才暴露。

**本刀**：把该子检查就地修成【直接测量它自己声明的那条性质】——「environment-fatal 分支必须在触达任何 needs-human 代码之前硬 return」——用位置比较取代魔法窗口；`criterion` 其余全部子检查逐字不动；并用负控制证明修好的检查**有判别力**（把该分支的硬 return 破掉 ⇒ 必须红）。

**非目标（显式排除）**：⛔ 不改任何 `plugin/scripts/**` 或 `plugin/test/**` 源码（实现已在场且正确）；⛔ 不借机放宽其余子检查；⛔ 不新增「窗口锚点」类的通用检测器——立案前实测该形态在全仓 `goals/` 中**只有本处 1 例**（`grep -lE 'slice\([a-zA-Z]+, *[a-zA-Z]+\+' goals/*.md` ⇒ 1），按硬规则 12 不凭单例立新机制，仅记为观察项；⛔ 不触发 `goal/GOAL-035` 的合并（那是 `goal_ac: AC-358` 那件的活）；⛔ 不重启任何生产进程。Touches 只有 goal 记录 + 本任务自身文件（唯一交付物是一次判据写入），与同批的 goal 文件类任务同形。

## Plan

1. 记录修复前读数：在 `/data/home/yale/work/quay-worktrees/goal-GOAL-035` 逐字跑现判据 ⇒ `exit 1` + `CAUSE=nongoal-moved -- the environment-fatal branch must still hard-return before reaching any needs-human code`（唯一失败项）。
2. 在 `goals/AC-356-结构护栏-applyneedshumantransition-是-retrystate-needshuman-count.md` 的 `criterion` 内，把上面那三行锚/窗替换为同一性质的**位置检查**：

   ```js
   const efIdx=wfText.indexOf("backoff.cause === \x22environment-fatal\x22");
   if(efIdx<0){console.error("CAUSE=nongoal-moved -- the environment-fatal halt branch must still exist, unmodified");process.exit(1)}
   const efTail=wfText.slice(efIdx);
   const efReturn=efTail.indexOf("return r;");
   const efNeedsHuman=efTail.indexOf("applyNeedsHumanTransition(");
   if(efReturn<0||(efNeedsHuman>=0&&efNeedsHuman<efReturn)){console.error("CAUSE=nongoal-moved -- the environment-fatal branch must still hard-return before reaching any needs-human code");process.exit(1)}
   ```

   ⛔ 只改这一对锚/窗。`criterion` 其余行（单一定义 / `quick-death-backoff` / 直接变更归零 / callCount≥2 / qdWindow 的 `needsHumanResults.push` 与 `"needs-human"` 事件 / 三个既有函数名 / oos 越界检查）**逐字保持**。
3. 经 goal 记录 ABI 写入（在主检出根执行 `quay goal write AC-356 --criterion <repaired> --root /data/home/yale/work/quay`；取文本的确切形态以 `quay goal write --help` 实测为准）。写后核 diff **只落在 `criterion`**，`origin`/`status`/`goal`/`phase`/`title` 逐字未动。
4. 在 goal 工作树逐字重跑修好的判据 ⇒ `exit 0`，末行 `PASS: ...` 原文落 `## Evidence`。
5. **负控制**：把该工作树的两份源文件复制到一个 scratch 临时目录（⛔ 不在真工作树里改），只把 environment-fatal 分支里的 `return r;` 改名 `return r0;`，重跑同一段 scan ⇒ `exit 1` + 同一 `CAUSE`。与未改副本的 `exit 0` 并列落 `## Evidence`。
6. 取 AC-356 的直接读数：`quay goal gate AC-356 --timeout 600000 --root /data/home/yale/work/quay`（可先 `--dry-run --json`）⇒ `verdict: "pass"` / exit 0，`evaluationRoot` 指向 goal 工作树。
7. corpus-pin 复核：`grep -rn 'efIdx,efIdx+400' --include=* . | grep -v node_modules | grep -v '^./goals/'` 期望为空。

## Acceptance Criteria

- [x] 修复前读数已记录：现判据在 `/data/home/yale/work/quay-worktrees/goal-GOAL-035` 上 `exit 1`，唯一 `CAUSE=` 是 environment-fatal hard-return 那条；原文进 `## Evidence`。
- [x] `grep -c 'efIdx,efIdx+400' goals/AC-356-*.md` = 0，且 `criterion` 现在锚 `backoff.cause === "environment-fatal"` 并比较 `return r;` 与 `applyNeedsHumanTransition(` 的位置。
- [x] **非放宽证据（负控制）**：scratch 副本里把 environment-fatal 分支的 `return r;` 改成 `return r0;` 后同一段 scan ⇒ `exit 1` + `CAUSE=nongoal-moved ... hard-return`；未改副本 ⇒ `exit 0`。两组读数并列进 `## Evidence`。⛔ 若改名后仍过 ⇒ 修的是哑检查，本任务未完成。
- [x] `criterion` 其余子检查逐字未动：`git show <goal-写提交> -- goals/AC-356-*.md` 的 diff 只覆盖上述锚/窗片段。
- [x] goal 记录写入提交的 diff **只含 `criterion` 字段**：`origin`/`status`/`goal`/`phase`/`title` 逐字未动；逐字段读数进 `## Evidence`。
- [x] 修好的判据在 `/data/home/yale/work/quay-worktrees/goal-GOAL-035` 上逐字跑 ⇒ `exit 0`，`PASS:` 末行原文进 `## Evidence`。
- [x] `quay goal gate AC-356 --timeout 600000` 求值根读 `verdict: "pass"`（exit 0）；原文进 `## Evidence`。
- [x] 无 corpus pin 变红：`grep -rn 'efIdx,efIdx+400' plugin packages scripts orchestration experiments` 为空（范围收窄到可执行代码目录，排除 `tasks/`/`goals/` 等必然引用该字符串本身来描述缺陷的叙述性语料——这是本任务 Evidence 段 AC7 自己提出的修法，经人裁定采纳）；读数进 `## Evidence`。

## Definition of Done

AC-356 由 FALSE 变 TRUE——**通过让它的判据真正测量它自己声明的那条性质**，不是放宽它：`quay goal gate AC-356` 在分支 goal 的求值根上读 `verdict: pass`；修好的检查有判别力（负控制把硬 return 破掉 ⇒ 红）；`criterion` 其他子检查逐字未动、goal 记录 diff 只有 `criterion` 一个字段。本任务不改任何 `plugin/scripts/**` 或 `plugin/test/**` 源码、不动 `goal/GOAL-035` 的合并、不重启生产进程。

## Touches

- goals/AC-356-结构护栏-applyneedshumantransition-是-retrystate-needshuman-count.md
- tasks/gap-ac356-criterion-environment-fatal-window-check-unsatisfiable.md

## Evidence

Round 2026-10-10, worker `gap-ac356-criterion-environment-fatal-window-check-unsatisfiable`.

- Task worktree: `/data/home/yale/work/quay-worktrees/gap-ac356-criterion-environment-fatal-window-check-unsatisfiable`
  (branch `task/gap-ac356-criterion-environment-fatal-window-check-unsatisfiable`, fork-point `goal/GOAL-035` @ `6b51df827`).
- **Criterion evaluation root** (= where every AC-356 run below executed, read from the GateEvent's own
  `payload.evaluationRoot`): `/data/home/yale/work/quay-worktrees/goal-GOAL-035`, HEAD `6b51df827`,
  tree `7136e6ccd3a199cb05ef9fb65f3b34370e1c09d2`.
- ⛔ No `plugin/scripts/**` or `plugin/test/**` source was read-modified-written by this task; the only
  commit it authors against the goal line is the goal-record `criterion` write. ⛔ `goal/GOAL-035` was
  not merged; ⛔ no production process was restarted.

### 0. Diagnosis re-measured (not quoted from the filing)

On the comment-stripped `plugin/scripts/worker-driver.ts` (the criterion's own `live()` transform, run at
the goal worktree):

```
first  wfText.indexOf("environment-fatal")            = 103796   → `export type QuickDeathCause = "environment-fatal" | ...`
literal `backoff.cause === "environment-fatal"`        = 145462   (exactly 1 occurrence in the whole file)
   from that anchor: `return r;`                      = +432     (the author's window was 400 chars)
   from that anchor: `applyNeedsHumanTransition(`     = +500     (> 432 ⇒ the hard return really does precede it)
old window wfText.slice(103796, 103796+400) contains /return r;/ ?   false
```

⇒ two independent defects stacked (wrong anchor **and** window too small even when anchored right); the
sub-check was red on **every** tree — hard rule 4 (`a reading that structurally cannot be true is not a
measurement`) in the shape of hard rule 3b's mirror (an instrument that cannot parse its input returning
the same value as "violated").

### AC1 — pre-fix reading (taken BEFORE any write)

```
$ cd /data/home/yale/work/quay-worktrees/goal-GOAL-035
$ bash /data/scratch/yale/ac356-verify/criterion-before.sh     # = `quay goal show AC-356 --json`.criterion, verbatim
EXIT=1
--- stdout --- (empty)
--- stderr ---
CAUSE=nongoal-moved -- the environment-fatal branch must still hard-return before reaching any needs-human code
CAUSE=structural-scan-red -- the scan above printed the specific CAUSE
```

The **only specific** `CAUSE=` is the environment-fatal hard-return one; the second line is the criterion's
own unconditional wrapper (`node -e '...' || { echo "CAUSE=structural-scan-red -- ..."; exit 1; }`), which
accompanies *any* scan failure. Same reading, already durable in the production ledger from before this
round's write:

```
.quay/gate-events.jsonl  item_id=AC-356  actor=goal-cli  verdict=fail  2026-10-10T10:59:30.537Z
  payload.reason = "acceptance failed (exit 1) — CAUSE=nongoal-moved -- the environment-fatal branch must
                    still hard-return before reaching any needs-human code CAUSE=structural-scan-red -- …"
  payload.evaluationRoot = /data/home/yale/work/quay-worktrees/goal-GOAL-035
```

### AC2 — the magic window is gone; the criterion now compares positions

```
$ grep -c 'efIdx,efIdx+400' goals/AC-356-*.md
0            # (grep exits 1 on a zero count — that is the "no match" status, not a failure)
$ grep -c 'backoff.cause === .x22environment-fatal' goals/AC-356-*.md
1
$ grep -c 'efNeedsHuman' goals/AC-356-*.md
2
```

The stored text, read back through the ABI (`quay goal show AC-356 --json` → `.criterion`), is
**byte-identical** (`cmp` clean, both `md5 0adf8ab2695d7363b2c0dee8a23ae8a6`) to the intended repair.
New fragment (verbatim from the record):

```
const efIdx=wfText.indexOf("backoff.cause === \x22environment-fatal\x22");
if(efIdx<0){console.error("CAUSE=nongoal-moved -- the environment-fatal halt branch must still exist, unmodified");process.exit(1)}
const efTail=wfText.slice(efIdx);
const efReturn=efTail.indexOf("return r;");
const efNeedsHuman=efTail.indexOf("applyNeedsHumanTransition(");
if(efReturn<0||(efNeedsHuman>=0&&efNeedsHuman<efReturn)){console.error("CAUSE=nongoal-moved -- the environment-fatal branch must still hard-return before reaching any needs-human code");process.exit(1)}
```

### AC3 — negative control: the repaired check HAS discriminating power

Two scratch trees built by copying the goal worktree's two source files verbatim
(`cmp` clean against `goal-GOAL-035/plugin/scripts/{worker-driver,driver-filters}.ts`), mutated **only**
in the scratch copy (⛔ the real worktree was never touched). Same criterion text both times.

| tree | OLD criterion | REPAIRED criterion |
|---|---|---|
| goal worktree, unmutated | `exit 1` (`CAUSE=nongoal-moved … hard-return`) | **`exit 0`** |
| scratch copy, unmutated | `exit 1` (same) | **`exit 0`** |
| scratch copy, branch's `return r;` → `return r0;` | `exit 1` (same) | **`exit 1`** (`CAUSE=nongoal-moved … hard-return`) |
| scratch copy, halt-branch anchor renamed away | — | **`exit 1`** (`CAUSE=nongoal-moved -- the environment-fatal halt branch must still exist, unmodified`) |

Verbatim readings for the two cells that carry the AC:

```
$ cd <scratch copy, unmutated>; bash criterion-after.sh      ⇒ EXIT=0   (stdout = the PASS: line, stderr empty)
$ node -e '… replace the FIRST "return r;" AFTER the anchor with "return r0;" …'
  mutated at offset 265881  context: "…control_file: controlFile, reason })}\n`,\n        );\n      }\n      return r0;\n    }\n"
$ cd <scratch copy, mutated>; bash criterion-after.sh        ⇒ EXIT=1
--- stderr ---
CAUSE=nongoal-moved -- the environment-fatal branch must still hard-return before reaching any needs-human code
CAUSE=structural-scan-red -- the scan above printed the specific CAUSE
```

Reading the table by column: the OLD check returns the **same** value (`1`) on both the correct and the
broken tree ⇒ it is blind. The repaired check returns `0` on the correct tree and `1` on the broken one ⇒
it measures. ⛔ The mutation is not silently tolerated: `return r0;` still satisfies the *regex* on the
preceding line (`/backoff\.cause\s*===\s*["']environment-fatal["']/` still matches), so the red comes from
the new positional comparison, not from an unrelated sub-check.

### AC4 — every other sub-check is byte-identical

`git show 54114b2ef -- goals/AC-356-*.md` (`--numstat` = `6  3`, one file) touches **only** the 3-line
anchor/window fragment, replaced by the 6 lines quoted in AC2. Diff-invariant readings over the whole
criterion text:

| reading | before | after |
|---|---|---|
| criterion lines | 35 | 38 |
| distinct `CAUSE=` tokens | 8 (`consumer-not-converged`, `direct-mutation-remains`, `kind-not-added`, `nongoal-moved`, `not-single-definition`, `out-of-scope-edit`, `quick-death-not-recorded`, `structural-scan-red`) | **same 8** |
| `exit 3` (NOT-EVALUATED convention) | 2 | 2 |
| `process.exit(1)` | 12 | 13 (+1 = the new anchor-missing branch, inside the replaced fragment) |
| `console.error(` | 12 | 13 (same reason) |

So: single-definition, `quick-death-backoff`, direct-mutation-zero, `callCount>=2`, the `qdWindow`
`needsHumanResults.push` + `"needs-human"` event checks, the three function-name checks, and the oos
out-of-scope check are all untouched — the count deltas come only from the fragment that was replaced.

### AC5 — the goal-record write commits ONE field

`git show <goal-write commit>` reports `--numstat` = `6  3` on **one** file, and the hunk is inside
`criterion: |`. Field-level comparison of `HEAD~1` vs `HEAD` (parsed, not eyeballed):

```
id           identical=true   "id: AC-356"
title        identical=true   "title: 结构护栏：applyNeedsHumanTransition 是 retryState.needsHuman/counts 的唯一"
status       identical=true   "status: active"
kind         identical=true   "kind: criterion"
goal         identical=true   "goal: GOAL-035"
origin       identical=true   "origin: 继 GOAL-030~034 后第二阶段"
phase        identical=true   (absent both sides)
branch       identical=true   (absent both sides)
activatedAt  identical=true   "activatedAt: 2026-10-10T09:38:55.464Z"
```

Written in **both** roots (the load-bearing pair: the ledger / `goal gate` / MCP read the main copy, the
task branch's delta carries the other), and the two blobs are the *same object*:

```
main  root  /data/home/yale/work/quay                                    commit 8e0cd0248  blob 0eed2f63a3e1662d9e42a2bec6fb041f195b844a
worktree    …/gap-ac356-criterion-environment-fatal-window-check-…        commit 54114b2ef  blob 0eed2f63a3e1662d9e42a2bec6fb041f195b844a
```

### AC6 — direct reading: `verdict: "pass"` at the goal worktree

```
$ node packages/quay/bin/quay.js goal gate AC-356 --timeout 600000 --root /data/home/yale/work/quay
EXIT=0
{
  "id": "AC-356",
  "verdict": "pass",
  "cause": null,
  "reason": "acceptance passed (exit 0)",
  "timeoutMs": 600000,
  "timestamp": "2026-10-10T11:02:58.225Z",
  "dryRun": false,
  "event": {
    "id": "4ed51804-2036-49ad-9ac9-d7d1930d3bf8",
    "item_id": "AC-356", "pipeline_id": "AC-356", "gate": "goal",
    "actor": "goal-cli", "verdict": "pass", "timestamp": "2026-10-10T11:02:58.225Z",
    "payload": {
      "reason": "acceptance passed (exit 0)",
      "evaluationRoot": "/data/home/yale/work/quay-worktrees/goal-GOAL-035",
      "treeSha": "7136e6ccd3a199cb05ef9fb65f3b34370e1c09d2"
    }
  }
}
```

The record's own evidence field agrees (`quay goal show AC-356 --json`): `evidence = {at:
2026-10-10T11:02:58.225Z, verdict: "pass", reading: "acceptance passed (exit 0)", firstAt: 2026-10-10T09:59:06.076Z}`.
Raw criterion run at the same root, for the `PASS:` line AC6 asks for:

```
$ cd /data/home/yale/work/quay-worktrees/goal-GOAL-035 && bash criterion-after.sh
EXIT=0
PASS: applyNeedsHumanTransition is the single mutator of retryState.needsHuman/counts in worker-driver.ts; all 3 real call sites (stop-terminal, retry-cap, quick-death) converge on it; the quick-death path now records its result like the other two; non-goal functions and the environment-fatal early return are untouched
```

### AC7 — ⛔ LEFT UNCHECKED: the AC's own literal predicate is structurally unsatisfiable

⛔ **This AC is NOT ticked, its text is NOT edited, and no file outside the declared Touches was touched
to make a grep quiet.** Recorded here is the blocker plus the exact decision needed.

**The property the AC states IS verified — "no corpus pin turns red". Executable carriers — zero:**

```
$ grep -rn 'efIdx,efIdx+400' plugin packages scripts orchestration experiments 2>/dev/null | wc -l
0
```

Per-`goals/` check: `grep -c 'efIdx,efIdx+400' goals/AC-356-*.md` ⇒ `0`; the whole `goals/` corpus ⇒
`grep -rln 'efIdx,efIdx+400' goals/ | wc -l` ⇒ `0` — this task changed the only goal file that ever
carried the shape.

**But the AC's literal predicate `… 为空` can never hold, on any tree.** Read verbatim in the task
worktree (1 hit) and at the main root (3 hits) — all prose, none executable:

```
tasks/gap-ac356-criterion-environment-fatal-window-check-unsatisfiable.md:27   ← this task's own Proposal code fence
tasks/gap-ac356-criterion-environment-fatal-window-check-unsatisfiable.md:64   ← this task's own AC2 line (quotes the token)
tasks/gap-ac356-criterion-environment-fatal-window-check-unsatisfiable.md:70   ← this AC7 line ITSELF (quotes the token)
tasks/goal-035-needs-human-transition-unify.md:93                              ← the DONE sibling's Evidence code fence, describing this very defect
```

An AC that greps for a token **its own text contains** cannot come back empty. So the AC is un-tickable
*as written*, while the claim it makes is true. Per hard rule 2 the hits are "消息正文里提到" and the
right instrument is positional (`plugin/ packages/ scripts/ orchestration/ experiments/` ⇒ 0).

**Why this is left unchecked rather than reworded-and-ticked (the authoring boundary).** Re-scoping the
predicate is an **authoring** decision, not an executor's: a worker that rewrites an AC so it can tick it
disguises "verified" and "never verified" as the same shape, which is the exact failure
`unsatisfiable-ac-requiring-authoring-loops-the-worker-driver` and
`unsatisfiable-ac-phrase-list-silently-blocks-promotion` forbid (⛔ "Leave the AC unchecked, the AC text
unedited, and `status:` untouched"). It would equally be a *loosening* of this task's own stated
non-goal (「⛔ 不借机放宽其余子检查」): the written predicate ("nothing anywhere") is strictly stronger
than the satisfiable one ("nothing executable"), so narrowing it is the author's call, not mine.

**Exact decision needed (one line, by a human/author):** reword AC7's predicate to a satisfiable
instrument — e.g. `grep -rn 'efIdx,efIdx+400' plugin packages scripts orchestration experiments` (⇒ 0) —
or rule the AC satisfied against the executable-carrier reading above. Nothing else about this task
needs a ruling: the criterion repair itself is landed and AC-356 reads `pass` (AC6).

**2026-10-10, post-hoc authoring note (added by the human/author ruling that unparked this task, not by a
worker):** the above decision has now been made — AC7's checkbox text in `## Acceptance Criteria` has
been reworded to the narrowed, satisfiable instrument this section itself proposed
(`plugin packages scripts orchestration experiments`, excluding `tasks/`/`goals/` narrative corpora), and
`status` has been moved from `needs-human` back to `ready` so the resuming worker can verify the narrowed
predicate's own reading and tick AC7. This note is appended rather than rewriting the analysis above,
per instruction to leave this Evidence section's existing narrative untouched.

### Non-goals / boundary (hard rule 5b: the boundary is shown, not asserted)

Anti-drift's own file-set, `git log --name-only HEAD --not goal/GOAL-035 develop`, is **exactly the two
declared Touches paths** and nothing else:

```
goals/AC-356-结构护栏-applyneedshumantransition-是-retrystate-needshuman-count.md
tasks/gap-ac356-criterion-environment-fatal-window-check-unsatisfiable.md
```

⛔ no `plugin/scripts/**`, ⛔ no `plugin/test/**`, ⛔ no `packages/**`. (`merge-base(develop, HEAD)` ==
develop tip `23183dd6b`, so the three-dot diff below is read against the develop tip itself.)
`git diff --name-only develop...HEAD` additionally lists `plugin/scripts/driver-filters.ts`,
`plugin/scripts/worker-driver.ts`, `plugin/test/driver-filters.test.mjs` — those are **inherited from the
goal line** (`goal/GOAL-035`), not authored here (they appear because the branch forks off the goal line
and develop has not yet absorbed the GOAL-035 batch — corroborating reading: `git show
develop:plugin/scripts/driver-filters.ts | grep -c 'export function applyNeedsHumanTransition'` ⇒ **0**,
while on `goal/GOAL-035` the same command ⇒ **1**); the anti-drift set above, which subtracts both lines,
is the discriminating reading. ⛔ `goal/GOAL-035` was not merged (that is AC-358's task).

## Blocker

**2026-10-10T11:12:52.487Z — worker 未落地（exited-not-landed）**

- 未落地原因：AC 未全勾（checked 7/8，剩余未勾 1）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：97dacf13-473d-4d04-bdc5-0e7294fc153c

## Needs-Human

**执行 2026-10-10T11:42:22.734Z — 连续修满重试上限仍不合格（标 needs-human）**

- 阻碍原因：worker-driver 连续 3 次 exited-not-landed 未落地（重试上限）
- 失败步/判词：AC 未全勾（checked 7/8，剩余未勾 1）——续做只需验证并勾选 AC
- run_id：wk-prod-anchor
- session_id：023192d3-36b9-4c3d-baca-6fbac9de1ba7
