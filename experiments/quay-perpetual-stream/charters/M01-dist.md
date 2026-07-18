# Charter M01-dist — Packaging: Node SEA / Bun single-file executables (Tier-A)

**Milestone id:** M01-dist · **surface:** Packaging/Distribution (weight 20) · **type:** explore
**Source:** DIR-004 (REOPENED, URGENT — carried by reference from exp4;
`experiments/quay-continuous-bootstrap/directives/archive/DIR-004-node-sea-bun-compile-release-artifacts.md`)
**Charter authored:** m0 bootstrap session, chart-0.
**Pinned Tier-B pointer:** `experiments/quay-perpetual-stream/inherited-core.md` @ this repo's current
HEAD at charter-authoring time (re-read only if that file's SHA changes mid-milestone).

## Value hypothesis (recorded BEFORE dispatch, §4.1/§6.2)
- Packaging/Distribution coverage today: `cov_0 = 0.55` (VT₀ bootstrap scoring — the existing
  `npm pack` .tgz + GitHub Actions build/publish/verify loop from exp4 DIR-004's first resolution
  is real and CI-verified, but the *original* ask — a single-file executable requiring no
  separately-installed Node.js runtime — was explicitly never delivered; see DIR-004 "Prior partial
  resolution" note: "Requesting action item 2 ... NOT implemented this iteration").
- Target: `cov_1 ≈ 0.85` (Δcov = 0.30) → **Δv̂ = weight(20) × 0.30 = +6.0 chart-0 points**.
- Metric `Y` that will measure realized Δv: binary Done-when completion (below), each clause
  independently checkable from pasted command/CI output — no subjective judgment.

## In-scope gap subset (the ONLY gaps this milestone may work; no gap-list-wide sweep)
- **DIR-004 remaining scope** (verbatim requested-action items 2 and 4 from the archived directive,
  the parts iteration 15 explicitly left undone):
  1. Add a build step producing **single-file executables** for at least Linux, macOS, and Windows,
     using **Node SEA or Bun compile** (pick whichever actually works cleanly for this dependency
     set — `packages/quay` has exactly two pure-JS deps, `@modelcontextprotocol/sdk` and `yaml`, no
     native bindings — record which was chosen and why, including blockers hit with the other
     option; iteration 15's blocker was "esbuild not available" for SEA bundling — re-verify this is
     still true before ruling SEA out, or install esbuild as a devDependency if that's the clean
     fix).
  2. Extend `.github/workflows/release.yml` (or add a sibling workflow) to build these executables
     per-platform on the existing tag trigger and publish them as GitHub Release assets alongside
     the existing `.tgz`.
  3. **Verify the produced executable actually runs** the CLI and `serve` subcommands **without a
     separately-installed Node.js runtime present**, on at least one platform, with pasted evidence
     (not "the build succeeded") — this is the one item iteration 9/15 never satisfied.
- **Every OPEN blocking gap in exp4's gap-list.md, verbatim** (checked at charter-authoring time —
  re-check at milestone it0 in case the list moved): grep confirmed **zero** OPEN entries with
  severity `blocking` as of chart-0 bootstrap. If it0 finds a blocking gap that post-dates this
  charter, STOP and re-author (do not silently absorb it into this milestone's scope).

## Binary Done-when (§3.4 — mandatory, freezes this milestone's V_instance shape)
1. `[ ]` A single-file executable is produced via Node SEA **or** Bun compile for at least Linux,
   macOS, and Windows — build step exists and is invoked from CI (not local-only).
2. `[ ]` `.github/workflows/release.yml` (or a named sibling workflow) builds AND publishes these
   executables to GitHub Releases on the existing tag trigger, alongside the existing `.tgz`.
3. `[ ]` The workflow has **actually run on GitHub** for a real tag push — run URL recorded (not a
   local dry run; DIR-004's own reopen history shows a file existing ≠ it having executed).
4. `[ ]` At least one platform's downloaded executable is verified to run `quay --help`/CLI command
   and `quay serve` **with no separately-installed Node.js on PATH for that verification shell** —
   pasted command output as evidence.
5. `[ ]` Full existing test suite still passes (no regression) — pasted raw output, not a summary.
6. `[ ]` `V_instance capability_breadth` credit recorded + gap-list updated (new gap-list entry
   documenting this closes the SEA/Bun half of DIR-004, cross-referenced to the archived directive).

Milestone is DONE when all six are met and stable ≥1 iteration (§3.2 condition 1). Terminate early
per §3.2 conditions 2–5 if they fire first (ΔV plateau K=2, ceiling, budget≈10 past with nothing
climbing, external HALT).

## HARD GATES (Tier-A, transcluded byte-for-byte from the pinned template — §3.1, DIR-009 defense)

Source: `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` §0, fenced HARD GATES block
(lines 101–131 at charter-authoring time). Transcluded verbatim below; only the worktree/branch
path is parameterized per this milestone (substitution called out inline, not a paraphrase of gate
substance — every checklist item's wording is copied unchanged):

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
[ ] git worktree add experiments/quay-perpetual-stream/milestones/M01-dist/worktrees/iteration-N
    -b exp5-m01-iteration-N  [PARAM: exp5 milestone worktree path + branch name]
    → paste the "HEAD is now at <hash>" line. Creating the worktree is NOT the
      gate — WRITING THIS ITERATION'S CHANGES INTO IT is. All development/test
      edits this iteration must target paths UNDER worktrees/iteration-N/, not
      the shared tree at repo root. See the end-of-iteration isolation proof
      gate below; the two are one requirement checked at both ends.
```

Additional gates (unparameterized, copied unchanged from the same §0 block, applicable as-is):
- Git worktree isolation END-OF-ITERATION PROOF (paste `git -C .../worktrees/iteration-N status
  --short` showing this iteration's writes landed there, AND `git -C <repo root> status --short --
  packages/` clean).
- verification_coverage spot-check every iteration boundary.
- system_health regression check (no regression vs. exp1/exp2/exp3 inherited V-factor snapshots).
- All background dispatches (iteration/audit/simulated-user subagents) confirmed `run_in_background=true`.

**Gate-hash check (it0 systematic-explore, §4.4b):** the fenced block above must literal-match
`experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines 101–131 except the two lines
tagged `[PARAM: ...]` (worktree/branch path substitution only — substance and all warning prose
unchanged). Any other divergence FAILS this gate and blocks dispatch.

## Inner termination — five conditions (verbatim pointer, §3.2)
Applies unmodified: (1) Done-when complete & stable ≥1 iter · (2) ΔV<0.02 both layers K=2
consecutive & no new significant/blocking gap · (3) ceiling→redesign-OR-stop (compute at it0: is
"executable runs with no Node on PATH" arithmetically unreachable given the sandboxed CI runner
environment? If GitHub Actions runners cannot produce a Node-free verification shell, this is a
redesign trigger, not a silent stop) · (4) budget≈10 backstop, past→default HALT · (5) external HALT.

## it0 systematic-explore checks (§4.4 — run and record BEFORE first work)
a. **Ceiling/floor arithmetic** — is Done-when clause 4 (no-Node verification) reachable in the
   actual CI/sandbox environment available? Check at it0; if not, this IS the redesign trigger for
   condition 3 above — do not discover this at it8.
b. **Gate-hash/transclusion** — confirmed above; re-verify the source file hasn't changed since
   charter authoring (diff its current lines 101–131 against this charter's block).
c. **Dogfooding evidence-gate** — Done-when clauses 1–4 all require pasted command/CI output, not
   prose. Confirm the milestone's own iteration report template enforces this (inherit exp4's
   raw-output-bar convention).
d. **Domain-misfit audit-channel** — Packaging is a domain the inherited simulated-user methodology
   (browser-driven Web UI review) does NOT cover. This milestone's independent audit channel is: a
   fresh shell (or CI job) with no local Node install, running the built executable directly. Record
   this explicitly as the G3-equivalent out-of-band check for this milestone before dispatch.

## Dispatcher
Run via `baime:iteration-executor`, one inner iteration at a time, non-blocking dispatch
(`run_in_background=true`), reading only this charter (Tier-A) + the pinned Tier-B pointer above.
Record each iteration under `experiments/quay-perpetual-stream/milestones/M01-dist/iterations/`.
