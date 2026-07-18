# Charter M03-abi-eval — Provider-ABI VT surface + native/github conformance suite (Tier-A)

**Milestone id:** M-ABI-EVAL · **surface:** NEW chart-1 surface `Provider-ABI` (§4.1 chart
transition) · **type:** explore
**Source:** DIR-001 (human directive via `/quay-directive`, items 1-2), archived at
`experiments/quay-perpetual-stream/directives/archive/DIR-001-evaluation-blind-spot-provider-abi-and-outcome-based-methods.md`.
Supersedes the m3-attempt-3 selection of M03-discover (deferred, not discarded — see DIR-001's
resolution and `backlog.md`).
**Charter authored:** m3 (after M02-gates/m2 DONE and DIR-001 drain), 2026-07-18.
**Pinned Tier-B pointer:** `experiments/quay-perpetual-stream/inherited-core.md` @ this repo's
current HEAD at charter-authoring time (re-read only if that file's SHA changes mid-milestone).

## Value hypothesis (recorded BEFORE dispatch, §4.1/§6.2 — chart-1 transition)
- DIR-001's finding: VT's chart-0 surface set (CLI/MCP/Web UI/Packaging/Docs) has no term for the
  Provider/ABI surface — quay's own reason to exist ("provider-agnostic task board") — so no
  milestone selection can ever be driven by growth there. This is a **chart transition** (§4.1):
  add a `Provider-ABI` surface, weight **20** (comparable to Packaging/MCP — a structural product
  pillar, not a minor add-on), giving chart-1 Σ=120.
- Initial cov estimate for Provider-ABI: **0.30** — read+manifest+status-write+primitive-gate
  exist (`packages/quay-github/provider.yml`), but title/body/labels/parent-children write are
  `unimplemented`, compound-gate is ported-but-thin, and there is currently ZERO automated
  conformance/differential evidence that native and github stay behaviorally aligned (this
  milestone's own Done-when 2-3 will produce the FIRST such evidence, which is what turns this
  from a guess into a measured cov).
- Δv̂ this milestone: **NOT closing the capability gap** (title/body/labels write is out of scope —
  that is real feature work for a LATER milestone this one's matrix will make selectable). This
  milestone's Δv̂ is **the accuracy of the re-baseline itself**: replacing an unscored blind spot
  with a matrix-justified cov number, i.e. Δv̂ ≈ 0 direct capability delta, but the VT total moves
  from a 100-pt scale that can't see this surface to a 120-pt scale that can (chart-1 VT₀ =
  88.25 + 20·0.30 = **94.25**, conversion factor: chart-0 points carry over 1:1, chart-1 adds the
  new term — see `dashboard.md`).
- Realized-value signal at ABSORB: does the capability matrix + conformance suite produce at least
  one concrete, previously-invisible gap-list entry (proving the blind spot was real, not just
  argued), and does the resulting cov number survive a second look (stability, not just a first
  guess)?

## In-scope work (the ONLY work this milestone may do — no open-ended feature work)
1. **Capability matrix**: score `{read, write, gate, skill} × {status, title, body, labels,
   parent/children} × {native, github}` as a table (✅ full / 🟡 partial / ❌ unimplemented per
   cell), built from each Provider's actual `provider.yml` declarations + a live smoke-check per
   cell where a declared capability's real behavior is in doubt (do not trust the YAML label
   alone for `data.write`/`gate` cells — DIR-001's finding #3 says the YAML already under-claims
   in places worth spot-checking).
2. **Differential conformance suite**: a runnable test suite (new, under `packages/` in whichever
   location the existing test layout implies — follow current conventions, do not invent a new
   test framework) that runs the SAME spec/scenario set against both native and github providers
   and flags behavioral divergence. Minimum viable scope: task_list/task_get/task_write(status)/
   task_check across a primitive task and a compound (parent/children) task — the two shapes
   DESIGN.md's own gate logic already treats specially.
3. **VT re-baseline**: add the `Provider-ABI` surface row to `dashboard.md`'s VT table (chart-0→
   chart-1 transition), record the conversion factor, re-derive cov from the matrix+suite's actual
   findings (not the 0.30 placeholder above — that is a pre-dispatch estimate only, §4.1 requires
   the REALIZED number come from this milestone's own evidence).
4. **Gap logging**: every divergence or unimplemented cell the matrix/suite surfaces gets a
   gap-list entry (`experiments/quay-continuous-bootstrap/gap-list.md`, cross-referenced
   exp5-discovered / DIR-001), NOT silently fixed — this milestone measures, it does not close the
   write-completeness gap (that is real scope for a later milestone this one's output makes
   selectable).
5. Do NOT implement title/body/labels/parent-children write for the github Provider — explicitly
   out of scope (§ ceiling below); do NOT build items 3-6 of DIR-001 (outcome-based eval,
   adversarial/security eval, comparative benchmark, standing review cadence) — those are
   backlogged as separate candidates, not this charter's job.

## Binary Done-when (§3.4 — mandatory, freezes this milestone's V_instance shape)
1. `[ ]` Capability matrix committed (table form, `{read,write,gate,skill}×{status,title,body,
   labels,parent/children}×{native,github}`), each cell backed by either a `provider.yml` citation
   or a pasted live smoke-check transcript — not asserted from memory.
2. `[ ]` Differential conformance suite exists, is committed, and runs against BOTH providers —
   pasted raw test-run output (pass/fail per scenario per provider), not a summary.
3. `[ ]` At least the primitive-task and compound-task scenarios are covered by the suite
   (task_list/task_get/task_write-status/task_check on each shape, both providers = 8 cells
   minimum).
4. `[ ]` `dashboard.md` VT table shows the chart-0→chart-1 transition: Provider-ABI row added,
   weight 20, cov justified by THIS milestone's own matrix+suite findings (cite specific cells,
   not "looks reasonable"), conversion factor recorded, chart-1 VT total computed.
5. `[ ]` Every divergence/unimplemented-cell finding is logged as a gap-list entry (if truly zero
   beyond the known title/body/labels-write gap, that must be evidenced by the suite's actual
   output, not asserted).
6. `[ ]` Full existing test suite still passes (no regression) — pasted raw output.

Milestone is DONE when all six are met and stable ≥1 iteration (§3.2 condition 1). Terminate early
per §3.2 conditions 2-5 if they fire first (ΔV plateau K=2, ceiling, budget≈10 past with nothing
climbing, external HALT).

## HARD GATES (Tier-A, transcluded byte-for-byte from the pinned template — §3.1, DIR-009 defense)

Source: `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` §0, fenced HARD GATES block
(lines 100-131 at charter-authoring time). Transcluded verbatim below; only the worktree/branch
path is parameterized per this milestone:

```
HARD GATES — paste the literal command output into §2 of this iteration's report,
not a prose summary. A summary is not acceptable evidence for these four; the raw
output is the artifact. (This block exists because through iteration 3 the
"directives listed" check was satisfied by copying the prior report's sentence
forward, and DIR-005/DIR-006 went unseen for three iterations — see gap-list PR-001.)

[ ] ls -1 experiments/quay-perpetual-stream/directives/pending/  [PARAM: exp5 directive dir]
    → paste the raw file listing. Then give EACH file listed an explicit
      applied/deferred-with-reason/rejected DISPOSITION this iteration — not
      an acknowledgment. Naming the gap (e.g. "still open per PR-001") or
      restating that the mechanism is unreliable is NOT a disposition and
      does not satisfy this gate — each filename needs its own outcome
      stated in this iteration's own words, even if the outcome is
      "deferred, reason: X." If the listing shows more files than you have
      given a real disposition to, you have not completed this gate.
      (This sub-clause exists because iteration 4 satisfied the letter of
      the original gate by citing PR-001 itself as the reason DIR-005/
      DIR-006 remained unaddressed — technically an acknowledgment, but not
      a disposition, and the loophole this gate is meant to close.)
[ ] cat .manda/hub.addr && curl -s "$(cat .manda/hub.addr)/healthz"
    → paste both outputs.
[ ] curl -s http://localhost:4173/ -o /dev/null -w "%{http_code}\n"
    → paste the status code (G7 reachability).
[ ] git worktree add experiments/quay-perpetual-stream/milestones/M03-abi-eval/worktrees/iteration-N
    -b exp5-m03-iteration-N  [PARAM: exp5 milestone worktree path + branch name]
    → paste the "HEAD is now at <hash>" line. Creating the worktree is NOT the
      gate — WRITING THIS ITERATION'S CHANGES INTO IT is. All development/test
      edits this iteration must target paths UNDER worktrees/iteration-N/, not
      the shared tree at repo root. See the end-of-iteration isolation proof
      gate below; the two are one requirement checked at both ends.
```

Additional gates (unparameterized, copied unchanged from the same §0 block, applicable as-is):
- Git worktree isolation END-OF-ITERATION PROOF (paste `git -C .../worktrees/iteration-N status
  --short` showing this iteration's writes landed there, AND `git -C <repo root> status --short --
  packages/ experiments/` clean [PARAM: this milestone touches `packages/quay-github/`,
  `packages/quay-native/` (or wherever the new conformance suite lands per existing test-layout
  conventions), and `experiments/quay-perpetual-stream/{backlog,dashboard}.md` +
  `experiments/quay-continuous-bootstrap/gap-list.md`]).
- verification_coverage spot-check every iteration boundary.
- system_health regression check (no regression vs. exp1/exp2/exp3 inherited V-factor snapshots).
- All background dispatches (iteration/audit/simulated-user subagents) confirmed `run_in_background=true`.

**Gate-hash check (it0 systematic-explore, §4.4b) — MECHANIZED via M-GATES' script:**
```
$ experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh experiments/quay-perpetual-stream/charters/M03-abi-eval.md
```
Run this before dispatch and paste the result in the dashboard log (do not just assert PASS).

## Inner termination — five conditions (verbatim pointer, §3.2)
Applies unmodified: (1) Done-when complete & stable ≥1 iter · (2) ΔV<0.02 both layers K=2
consecutive & no new significant/blocking gap · (3) ceiling→redesign-OR-stop (compute at it0: is a
differential test suite against both live providers reachable in this sandbox? Yes — both
providers already run in-repo, no network/credential barrier beyond what M-DIST already proved
reachable for the github provider's own CI; no redesign trigger) · (4) budget≈10 backstop, past→
default HALT · (5) external HALT.

## it0 systematic-explore checks (§4.4 — run and record BEFORE first work, MECHANIZED per M-GATES)
a. **Ceiling/floor arithmetic** — this milestone cites no existing gap-list IDs as its in-scope
   target (it GENERATES them); the applicable ceiling question is "does a Provider-ABI conformance
   suite already exist?" — checked: `grep -ri "differential\|conformance" packages/*/test packages/*/src 2>/dev/null`
   at charter-authoring time found nothing matching this shape (only per-provider unit tests exist,
   none cross-provider). Not already done, not unreachable.
b. **Gate-hash/transclusion** — run `it0-gate-hash-check.sh` against this file per the block above;
   record actual PASS/FAIL output in the dashboard log before dispatch, not an assumption.
c. **Dogfooding evidence-gate** — Done-when clauses 1-3 explicitly require pasted matrix/test-run
   evidence, not prose; `it0-dogfood-evidence-gate.sh` can be run against this milestone's own
   iteration report once written, as a self-check.
d. **Domain-misfit audit-channel** — per `inherited-core.md`'s decision procedure: this milestone's
   domain (cross-provider behavioral conformance) has NO pre-existing audit channel — DIR-001's
   own finding #3 is precisely that this domain has been unaudited since exp2. Per the procedure,
   the audit channel and the verification mechanism should be the SAME thing here: the conformance
   suite itself, run in CI alongside the existing test suite, IS both the capability evidence
   source and its own standing audit channel going forward (mirrors M01-dist's CI-job≡audit-channel
   finding that `inherited-core.md` already generalized).

## Dispatcher
Run via `baime:iteration-executor`, one inner iteration at a time, non-blocking dispatch
(`run_in_background=true`), reading only this charter (Tier-A) + the pinned Tier-B pointer above.
Record each iteration under `experiments/quay-perpetual-stream/milestones/M03-abi-eval/iterations/`.
