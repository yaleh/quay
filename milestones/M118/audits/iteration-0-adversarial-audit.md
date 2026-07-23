# M118 iteration-0 — adversarial acceptance audit

**Audit session id:** a579738f05c371226
**Orchestrator session id:** 145cc0be-0e0e-4eb4-a1aa-9d47637114c0

**Note (orchestrator-authored, per inherited-core.md's Adversarial-audit role item 5):** the line
above was written by the ORCHESTRATOR, using the `Agent` tool's own returned dispatch id
(`a579738f05c371226`), recorded in `/tmp/m118-dispatch-record.txt` at dispatch time — not
self-reported by the subagent. This artifact and the task write-back it describes were produced in
the subagent's own isolated worktree (its sandbox declined a direct write to the shared checkout)
and landed into the main tree by the orchestrator afterward, content unchanged.

**Milestone:** M118 — `exp5-M-ARCH-AUDIT-POST-DIR058-EXPLORE` (post-DIR-058 archguard sweep, FILE-ONLY explore)
**Auditor stance:** independent, fresh-context, REFUTE-FIRST. No prior context beyond what is cited below.
**Audit date:** 2026-07-23
**Base commit audited:** `master` HEAD `d9a8483` (M118's own work commit; `master` had already advanced past
the charter's dispatch pin of `0c32db0` by the time this audit ran — `e98bde5` SELECT + `d9a8483` ABSORB-work
are both on `master`).

## Sources read

1. Charter: `experiments/quay-perpetual-stream/charters/M118-arch-audit-post-dir058-explore.md`
2. Iteration report (claims under audit): `milestones/M118/iterations/iteration-0.md`
3. Live task `exp5-M-ARCH-AUDIT-POST-DIR058-EXPLORE` (via `git show d9a8483:tasks/...` — equivalent to
   `task get --json` for a committed task file)
4. `tasks/PROBE-M98-001.md` and `tasks/exp5-M-ARCH-AUDIT-M98-EXPLORE.md`, both pre- and post-M118 versions
   (`git show 0c32db0:...` vs `git show d9a8483:...`)
5. Git history: `git log --oneline`, `git show --stat` on `e98bde5` and `d9a8483`, `git diff --stat 0c32db0 d9a8483`
6. Fresh, independently-run archguard MCP tool calls (see below) — I had live tool access.

## Environment note

My agent sandbox is isolated to its own worktree
(`/home/yale/work/quay/.claude/worktrees/agent-a579738f05c371226`), which was **not** at `master` HEAD when
I started (`ad49578`, an M117-era commit) — the shared checkout had already advanced to `d9a8483` before my
audit began, because `git worktree`/refs are shared across worktrees in this repo even though working trees
are not. I confirmed `git diff --quiet ad49578 d9a8483 -- packages/` returns clean (byte-identical `packages/`
tree between my worktree's checkout and master's actual tip), so I ran all archguard analysis directly against
my own worktree's `packages/` — this is provably equivalent to running against master HEAD's code, since no
commit between `ad49578` and `d9a8483` touched `packages/` at all (confirmed by the same diff). For git-history
inspection of files not present in my own working tree (the M118 charter/task files, only added by commits
after my worktree's HEAD), I read them via `git show <sha>:<path>` — the objects are shared repo-wide even
though the working tree isn't — and, for one command (`it0-dod-check.ts`, which requires files to exist on disk,
not just in git objects) via a disposable `git worktree add --detach` pointed at `d9a8483` in my scratch
directory (not the shared checkout), removed afterward.

## AC-by-AC / claim-by-claim re-verification

### AC1 — fresh archguard baseline (entities=144, relations=201)

**Independently re-ran**, not just re-read: `archguard_analyze({sources:["packages"], noCache:true})` then
`archguard_summary({scope:"packages", outputScope:"method"})`, twice. Both runs:

```
entityCount: 144
relationCount: 201
totalPackageCount: 11
relationCountByType: { dependency: 130, composition: 10, inheritance: 2 }
```

Exact match to the report's pasted numbers. Also cross-checked against M117's own ABSORB commit message
(`c79b617`, not authored by this milestone, pre-existing git history), which independently states
"entities=144/relations=201 (packages/ scope, vs M113's 121/156 baseline)... 0 cycles" — so the "identical to
M117's preliminary reading" claim is corroborated from a source outside this milestone's own report, not just
self-consistent within it. **AC1 HOLDS.**

### AC2 — god-package / god-function metrics, full scope

Confirmed the report's claim that `archguard_detect_god_packages` is inapplicable to this TS project — I
independently triggered the same "No Atlas data found... requires a Go project" error, and additionally hit the
same error on `archguard_get_package_fanin`/`archguard_get_package_fanout` (tools the report didn't try but
that would have been the natural fallback — confirms the limitation is systemic to the Atlas-only tool family,
not a one-off).

Re-ran `topByOutDegree`: `startServer=7` reproduced exactly, both runs. Independently confirmed this is the
same, already-`done`/WONTFIX `ARCH-M93-003` finding by reading `packages/quay/src/serve.ts` directly (101
lines total, `startServer` at line 36 with the same 6 named single-purpose imports the report describes) —
nothing about its shape has changed.

Ran `archguard_get_dependencies(name:"startMcpServer", depth:1, queryFormat:"edge-list")` myself and isolated
the edges specific to `quay/src/mcp-server.ts.startMcpServer` (the query is by bare name and returns all 4
packages' `startMcpServer` functions' edges together — I filtered to the `quay/src` one, which is the one
`PROBE-M98-001` is about): exactly 3 outgoing edges —
`quay/src/config.ts.loadConfig`, `quay/src/mcp-handlers.ts.ConnectedProvider`,
`quay/src/mcp-handlers.ts.registerAllHandlers`. This is an **independent re-derivation**, not a re-statement of
the report's own claim — same method the task-answer-question mode of the reproduction-file task calls for.
Also verified commit `7461215` (cited as the fix landing) exists in git history with subject "PROBE-M98-001:
add registerAllHandlers facade; reduce startMcpServer outDegree 7→3" — matches.

**One discrepancy found, not present in the original report:** my own `topByOutDegree` top-10 (both runs,
deterministic — re-ran twice, identical both times) contains a **10th row the report's 9-row table omits**:
`GatesConfig`, outDegree=5 (`quay/src/gate/factories/loader.ts`), sitting between `makeIt0Gate` and
`registerLifecycleHandlers` in rank order. I investigated via `archguard_get_file_entities` on that file:
`GatesConfig` is an `interface` (a discriminated union of 5 per-gate-type config member interfaces —
`CoverageFloorEntry`, `FixedEntry`, `It0Entry`, `RedGreenEntry`, `TestPassEntry`), not a function. Its outDegree
comes from 5 composition edges to those member types, which is structurally unremarkable for a config-shape
union type, not a "god function." So the *substance* of AC2 ("any new finding beyond what M93/M98/M108/M113
already found is filed" — none was, correctly) is not undermined: no god-function finding was missed. But the
report presents its 9-row table as "topByOutDegree (full packages/ scope)" verbatim, without disclosing that a
10th, real, tied entry was dropped or why — this is an evidence-fidelity gap (silently filtered, not silently
fabricated) worth flagging as a non-blocking **CONCERN**.

`startMcpServer` genuinely does not appear anywhere in the top-10 outDegree list any more (its own outDegree=3
is well below the top-10 floor of 4) — matches the report's claim.

**AC2 substantively HOLDS; one non-blocking evidence-fidelity CONCERN noted above.**

### AC3 — cycle detection, full scope

Ran `archguard_detect_cycles` at both `outputScope:"package"` and `outputScope:"class"`: `[]` both times (the
report only shows the package-level run; I additionally checked class-level as a stronger negative-result
check). **AC3 HOLDS.**

### AC4/AC5 — new findings / FILE-ONLY

No new findings were filed, correctly — I could not construct one either (see "adversarial attempt" below).
FILE-ONLY: see dedicated section below; independently confirmed via my own `git diff --stat`.

## FILE-ONLY verification (independent)

```
git log --oneline 0c32db0..d9a8483
  d9a8483 M118: post-DIR-058 full-scope archguard sweep (FILE-ONLY) — no new findings, 2 stale statuses fixed
  e98bde5 SELECT M118: exp5-M-ARCH-AUDIT-POST-DIR058-EXPLORE (mandatory explore, ≥1/5 rule)

git diff --stat 0c32db0 d9a8483
  experiments/.../charters/M118-arch-audit-post-dir058-explore.md | 58 +
  milestones/M118/iterations/iteration-0.md                       | 103 +
  tasks/PROBE-M98-001.md                                          | 13 (+11/-2 net; 11 added, 2 changed)
  tasks/exp5-DEFECT-CLAUSE8-HYPHEN-LABEL-MISMATCH.md              | 6 +
  tasks/exp5-M-ARCH-AUDIT-M98-EXPLORE.md                          | 12 +
  tasks/exp5-M-ARCH-AUDIT-POST-DIR058-EXPLORE.md                  | 66 +
  6 files changed, 255 insertions(+), 3 deletions(-)
```

Zero touches to `packages/`, `plugin/`, or `experiments/quay-perpetual-stream/scripts/` across both commits.
**FILE-ONLY claim independently CONFIRMED, no scope creep found.**

## Adversarial attempt to find a missed architectural issue

I tried to break the "no new findings" claim rather than just accept it:
- Checked the two largest non-`quay/src` packages (`quay/src/gate`, 63 entities; `quay/src/gate/factories`,
  21 entities) via `archguard_get_package_stats` for anything alarming — nothing beyond the already-tracked
  outDegree items above.
- Re-ran cycle detection at both package and class granularity — both empty.
- Looked for a stray/leftover file that might indicate drift: found `quay/src/ts-demo/word-count.ts`, a
  pre-existing (not created this milestone) ADR-012-era demonstrator module, explicitly labeled in its own
  header comment as a deliberate non-product proof artifact — not a regression, not in scope for this
  milestone, correctly not flagged.
- Confirmed `packages/quay-backlog/src` (previously entirely dark, per the charter's own stated motivation
  for this milestone) now shows entityCount=4, matching the report's claim that quay-backlog is newly visible;
  all 4 `bin/*` directories show entityCount=0 (thin launcher files) — also matches.

**I did not find a god-file, an undetected cycle, or a structural regression the report should have caught
and didn't.**

## Judging the PROBE-M98-001 / exp5-M-ARCH-AUDIT-M98-EXPLORE status flip

Read both tasks' complete pre-M118 bodies via `git show 0c32db0:tasks/PROBE-M98-001.md` and
`git show 0c32db0:tasks/exp5-M-ARCH-AUDIT-M98-EXPLORE.md` in full (not just the AC/DoD checkbox lines).

- `PROBE-M98-001`'s pre-existing DoD (already `[x]`, already committed well before M118, from the actual M99
  fix landing) is not a vague assertion — it names the exact outDegree value (3), the exact 3 dependency names,
  a test-run count (33 PASS/0 FAIL), a named prior audit id and verdict, and a landing commit hash (`7461215`).
  I independently reproduced the outDegree=3 claim edge-for-edge myself (see AC2 above) and confirmed the
  commit exists with a matching subject line. This is a genuine, re-verifiable finding, not a rubber-stamped
  checklist.
- `exp5-M-ARCH-AUDIT-M98-EXPLORE`'s pre-existing AC/DoD (also already `[x]`) similarly cites concrete
  M97-era evidence (decomposition from 808→187/672 lines, specific outDegree deltas) rather than vague prose.
- Both tasks had been flagged as stale (`status: todo` despite ticked boxes) across three consecutive prior
  milestones' own SELECT "not selected" notes (M115, M116, M117) — this is a paper trail of the same
  observation being made independently three times before M118 acted on it, not an ad-hoc decision invented
  for this pass.
- The M118 status-flip rationale ("outDegree=3, matches the task's own DoD claim exactly") is, on my own
  independent re-derivation, **true and sufficient** — not papering over anything. It is exactly what a
  competent administrative-correction pass should do: re-verify the live claim before trusting a stale
  checklist, rather than blindly flipping status because boxes were ticked.

**Verdict on this sub-question: the status flip is justified, not a rubber stamp.**

## This milestone's own task bookkeeping (the specific gap flagged in the audit brief)

Read `exp5-M-ARCH-AUDIT-POST-DIR058-EXPLORE`'s live body as of `d9a8483` (this milestone's own work commit):
`status: todo`, all 5 AC boxes `[ ]`, all 4 DoD boxes `[ ]`, **no `## Resolution` section** — despite the
iteration-0 report's own closing line claiming "DONE. All 5 AC + 4 DoD items satisfied with pasted evidence
above." This is exactly the same class of gap this repo's own history records at M116 and M117 (per M117's own
ABSORB commit message, verbatim: "caught the same task-bookkeeping gap class as M116... corrected it itself per
DIR-020"). Per this repo's DIR-020 discipline ("the audit is the ONLY writer that ticks boxes"), I performed the
write-back myself in this same pass (see "Write-back performed" below) rather than merely flagging it.

I compared this to the direct methodology precedent for this exact milestone shape,
`exp5-M-ARCH-AUDIT-POST-FULL-TS` (M113) — its task file (read via the disposable `d9a8483`-pinned worktree)
already has all AC/DoD boxes ticked, `status: done`, and a `## Resolution` section pasting its own archguard
comparison table and findings assessment. My write-back to this milestone's task follows that same established
shape.

## Verdict

**NO REFUTATION FOUND** on the substance of any of this milestone's Done-when claims. I specifically tried to
break: the entity/relation counts (re-ran the tool myself, twice, byte-identical to the report and to an
independent M117-era source); the `startMcpServer` outDegree=3 claim (re-derived the edge list myself instead
of trusting the report's transcription); the FILE-ONLY claim (ran my own `git diff --stat`, not a re-read of
the report's assertion); the "no new findings" claim (actively hunted for a god-file/cycle/regression the
report might have missed, and could not find one); and the PROBE-M98-001/exp5-M-ARCH-AUDIT-M98-EXPLORE status
flip (read both tasks' full pre-existing evidence, not just their checkbox state, and independently
re-confirmed the underlying claim). All held up.

**One non-blocking CONCERN:** the AC2 `topByOutDegree` evidence table silently drops a real, deterministic,
tied top-10 entry (`GatesConfig`, an interface, outDegree=5) without disclosing the filter — substantively
harmless (it is not a function, so its absence from a "god-function" list is defensible) but an evidence-
fidelity gap worth naming so the pattern of "paste a subset of tool output as if it were the whole output" gets
corrected in future audits/reports.

## Write-back performed

`exp5-M-ARCH-AUDIT-POST-DIR058-EXPLORE`'s own AC/DoD boxes were found unticked with no Resolution section (see
above) — the same gap class as M116/M117. Per DIR-020, I performed the write-back myself: ticked all 5 AC and
4 DoD boxes (each corresponds to a claim I personally, independently re-verified above), set `status: done`,
and appended a `## Resolution` section citing my own fresh verification evidence (not a restatement of the
iteration-0 report).

**Landing note:** my agent sandbox refused direct writes to the shared checkout
(`/home/yale/work/quay/tasks/exp5-M-ARCH-AUDIT-POST-DIR058-EXPLORE.md` and
`/home/yale/work/quay/milestones/M118/audits/iteration-0-adversarial-audit.md` both errored with "isolated in
the worktree... edit the worktree copy instead"). Both the updated task file and this audit report were
therefore written to the equivalent paths in my own worktree
(`/home/yale/work/quay/.claude/worktrees/agent-a579738f05c371226/tasks/exp5-M-ARCH-AUDIT-POST-DIR058-EXPLORE.md`
and
`/home/yale/work/quay/.claude/worktrees/agent-a579738f05c371226/milestones/M118/audits/iteration-0-adversarial-audit.md`)
— the orchestrator will need to land these into the shared tree.
