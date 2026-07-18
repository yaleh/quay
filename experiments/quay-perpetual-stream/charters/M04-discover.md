# Charter M04-discover — Standing simulated-user discovery pass on the live product (Tier-A)

**Milestone id:** M04-discover (authored at m3 as "M03-discover", renumbered to m4 when DIR-001
superseded it for the m3 slot — see `backlog.md`/`dashboard.md` m3 log; only the id/paths below are
renumbered, scope and rationale are unchanged from authoring) · **surface:** cross-cutting
(CLI/MCP/Web UI/Docs) · **type:** exploit
**Source:** protocol §4.4 discovery-engine portfolio, exploit channel (standing simulated-user /
persona review) — originally dispatched because m3's carried-by-reference backlog picks (M-DOCS,
M-DIRTASK) were BOTH rejected at it0 as stale (see `backlog.md` "Backlog exhaustion finding",
`dashboard.md` m3 log), then deferred one slot when DIR-001 (Provider-ABI blind spot) took the m3
slot instead. This is NOT a product-value milestone in the usual sense — it produces fresh gap-list
entries and a live re-score of VT surface coverage (now including the Provider-ABI surface
M03-abi-eval/m3 just added), which becomes the input to m5's SELECT.
**Charter authored:** m3 (after M-GATES/m2 DONE and two m3 rejections), 2026-07-18. **Dispatched:**
m4 (after M-ABI-EVAL/m3 DONE), 2026-07-18 — renumbered from M03- to M04- prefix for worktree/branch
paths only, to avoid colliding with M-ABI-EVAL's already-used `exp5-m03-iteration-*` branches.
**Pinned Tier-B pointer:** `experiments/quay-perpetual-stream/inherited-core.md` @ this repo's
current HEAD at charter-authoring time (re-read only if that file's SHA changes mid-milestone).

## Value hypothesis (recorded BEFORE dispatch, §4.1/§6.2)
- Per offline-replay (`RESULTS.md` §B1/§4.4), the exploit channel is a **polish engine, not a
  structural-discovery engine** (6/7 polish, 0/7 structural in the historical corpus) — this
  milestone's expected Δv̂ is therefore explicitly LOW and framed as **discovery value**, not
  direct VT points: `Δv̂_direct ≈ 0` to `+1` (minor polish fixes bundled if trivial), but the real
  target metric `Y` is: (a) a live re-scored cov estimate for each of the 5 chart-0 surfaces,
  replacing the bootstrap's "initial, soft" placeholder values with evidence, and (b) N newly-logged
  gap-list entries that seed m4+'s backlog (expected N≥1 given M-DIST added an entirely unreviewed
  SEA/CI surface).
- This is an explicit, pre-declared LOW-value-hypothesis milestone — do not let its low Δv̂ read as
  a charter defect; its role is restocking the backlog, which the backlog-exhaustion finding shows
  is now the actual bottleneck, not any single surface's coverage.

## In-scope work (the ONLY work this milestone may do — no open-ended feature work)
1. **CLI persona pass** — a returning-user persona exercises the CLI end-to-end, INCLUDING the new
   M-DIST-delivered SEA executable path (download-or-build the SEA binary, run `--help`/`task
   list`/`mcp`/`serve` as a *separate* check from the `.tgz`/npm-installed path already covered by
   exp4's personas — this is the specific unreviewed surface M-DIST added).
2. **MCP persona pass** — an AI-agent persona exercises `task_list`/`task_get`/`task_write`/
   `task_check` via a live MCP client connection.
3. **Web UI persona pass** — exercise list/detail/filter/search/action flows in a real browser
   (dual-viewport per `inherited-core.md`'s webui-bootstrap delta), holistic visual review per §0c.
4. **Docs persona pass** — a new-contributor persona reads README/CLI --help/package docs
   end-to-end, specifically checking whether the new SEA/release artifacts are documented (a real
   candidate gap: does the README explain the SEA executables M-DIST just shipped?).
5. **Re-score VT**: for each of the 5 chart-0 surfaces, replace `dashboard.md`'s current cov
   estimate with a value justified by THIS milestone's own persona findings (cite specific
   findings, not "looks fine") — record old vs. new cov + the delta's justification.
6. Log every new finding as a gap-list entry (in `experiments/quay-continuous-bootstrap/gap-list.md`,
   the established location, cross-referenced as exp5-discovered) with severity, NOT silently fixed
   in-milestone unless trivial (a persona-discovery milestone's job is to FIND and TRIAGE, not
   necessarily to fix — genuinely trivial 1-line fixes found along the way may be closed inline,
   anything requiring real design/effort gets logged as a new backlog candidate for m4+ SELECT,
   consistent with "raw polish gaps are NOT standalone milestones" per `backlog.md` line 4).

## Binary Done-when (§3.4 — mandatory, freezes this milestone's V_instance shape)
1. `[ ]` All 4 persona passes (CLI incl. SEA path, MCP, Web UI, Docs) completed with a pasted
   transcript/evidence per pass — not a summary claim.
2. `[ ]` `dashboard.md`'s VT table has a live-rescored cov value for all 5 chart-0 surfaces, each
   with a 1-line justification citing this milestone's own findings.
3. `[ ]` At least 1 new gap-list entry is logged from a REAL finding (if truly zero findings across
   all 4 personas, that itself is a valid Done-when-met outcome, but must be evidenced — e.g. "SEA
   binary --help output byte-identical to .tgz path, no gap" — not asserted without the comparison
   shown).
4. `[ ]` `backlog.md` gains any new milestone-sized candidate(s) surfaced by significant/blocking
   findings (if any) — sized and Δv̂-estimated like the existing rows, ready for m4's SELECT to pick
   up directly (no re-discovery needed).
5. `[ ]` Full existing test suite still passes (no regression) — pasted raw output.

Milestone is DONE when all five are met and stable ≥1 iteration (§3.2 condition 1). Terminate early
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
[ ] git worktree add experiments/quay-perpetual-stream/milestones/M04-discover/worktrees/iteration-N
    -b exp5-m04-iteration-N  [PARAM: exp5 milestone worktree path + branch name]
    → paste the "HEAD is now at <hash>" line. Creating the worktree is NOT the
      gate — WRITING THIS ITERATION'S CHANGES INTO IT is. All development/test
      edits this iteration must target paths UNDER worktrees/iteration-N/, not
      the shared tree at repo root. See the end-of-iteration isolation proof
      gate below; the two are one requirement checked at both ends.
```

Additional gates (unparameterized, copied unchanged from the same §0 block, applicable as-is):
- Git worktree isolation END-OF-ITERATION PROOF (paste `git -C .../worktrees/iteration-N status
  --short` showing this iteration's writes landed there, AND `git -C <repo root> status --short --
  experiments/` clean [PARAM: this milestone primarily edits `experiments/quay-continuous-bootstrap/
  gap-list.md`, `experiments/quay-perpetual-stream/{backlog,dashboard}.md`, and possibly trivial
  1-line `packages/` fixes — isolation-proof covers whichever paths this iteration actually
  touches]).
- verification_coverage spot-check every iteration boundary.
- system_health regression check (no regression vs. exp1/exp2/exp3 inherited V-factor snapshots).
- All background dispatches (iteration/audit/simulated-user subagents) confirmed `run_in_background=true`.

**Gate-hash check (it0 systematic-explore, §4.4b) — MECHANIZED this time via M-GATES' own script:**
```
$ experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh experiments/quay-perpetual-stream/charters/M04-discover.md
```
Run this before dispatch and paste the result in the dashboard log (do not just assert PASS).

## Inner termination — five conditions (verbatim pointer, §3.2)
Applies unmodified: (1) Done-when complete & stable ≥1 iter · (2) ΔV<0.02 both layers K=2
consecutive & no new significant/blocking gap · (3) ceiling→redesign-OR-stop (compute at it0: is
"live browser + live MCP client + live CLI" access reachable in this sandbox? Yes — confirmed by
every prior milestone's HARD GATES G7 check; no redesign trigger) · (4) budget≈10 backstop, past→
default HALT · (5) external HALT.

## it0 systematic-explore checks (§4.4 — run and record BEFORE first work, MECHANIZED per M-GATES)
a. **Ceiling/floor arithmetic** — `it0-ceiling-check.sh` run against this charter's own in-scope
   items: N/A (this milestone cites no existing gap-list IDs as its scope — it GENERATES them —
   so the ceiling check's "is the target already closed" question doesn't apply the same way; the
   applicable check is simply: has this exact discovery pass been run before on the POST-M-DIST
   product? No — confirmed, M-DIST's SEA/CI surfaces are new since exp4's last persona review.
b. **Gate-hash/transclusion** — run `it0-gate-hash-check.sh` against this file per the block above;
   record actual PASS/FAIL output in the dashboard log before dispatch, not an assumption.
c. **Dogfooding evidence-gate** — Done-when clauses 1-3 explicitly require pasted transcripts, not
   prose ("looks fine"); `it0-dogfood-evidence-gate.sh` can be run against this milestone's own
   iteration report once written, as a self-check.
d. **Domain-misfit audit-channel** — per `inherited-core.md`'s newly-added decision procedure
   (M-GATES output): this milestone's domain IS the audit channel itself (persona review is the
   established, already-proven mechanism from exp3/exp4 — no new domain-misfit risk here; this
   milestone reuses an existing, well-proven mechanism rather than introducing a new one).

## Dispatcher
Run via `baime:iteration-executor`, one inner iteration at a time, non-blocking dispatch
(`run_in_background=true`), reading only this charter (Tier-A) + the pinned Tier-B pointer above.
Record each iteration under `experiments/quay-perpetual-stream/milestones/M04-discover/iterations/`.
