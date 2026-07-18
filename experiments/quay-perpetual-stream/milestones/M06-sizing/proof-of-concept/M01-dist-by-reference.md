# Charter M01-dist — Packaging: Node SEA / Bun single-file executables (Tier-A)

**POC note:** re-authoring of DONE `charters/M01-dist.md` demonstrating gate-hash-by-reference
(M06-sizing item 5). Not a dispatch target. Original file untouched.

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

## HARD GATES (Tier-A, cited BY REFERENCE — §3.1, DIR-009 defense; M06-sizing by-reference form)

Source: pinned HARD GATES block, `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines
100-131. Cited by hash instead of transcribed (literal text deliberately not duplicated here):

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

Verify: `experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference <this
file>` — PASS = hash still matches pinned source's current block (no drift); FAIL = re-derive
before dispatch.

**Charter thinness ≠ agent prompt thinness.** The dispatched `baime:iteration-executor` prompt
must still contain the LITERAL gate text in full (resolved from `GATE-HASH-REF` by the dispatcher
before constructing the prompt) — never only a hash, or this reintroduces DIR-009 dilution. Worked
example of the resulting agent-facing prompt: `M01-dist-dispatch-prompt-worked-example.md` (same dir).

## Inner termination — five conditions (verbatim pointer, §3.2)
Applies unmodified: (1) Done-when complete & stable ≥1 iter · (2) ΔV<0.02 both layers K=2
consecutive & no new significant/blocking gap · (3) ceiling→redesign-OR-stop · (4) budget≈10
backstop, past→default HALT · (5) external HALT.

## it0 systematic-explore checks (§4.4 — run and record BEFORE first work)
a. **Ceiling/floor arithmetic** — is Done-when clause 4 (no-Node verification) reachable in the
   actual CI/sandbox environment available? Check at it0.
b. **Gate-hash/transclusion** — verified above via `--by-reference` mode; re-run before dispatch to
   confirm the pinned source hasn't drifted since this reference was recorded.
c. **Dogfooding evidence-gate** — Done-when clauses 1–4 all require pasted command/CI output.
d. **Domain-misfit audit-channel** — a fresh shell (or CI job) with no local Node install, running
   the built executable directly.

## Dispatcher
Run via `baime:iteration-executor`, one inner iteration at a time, non-blocking dispatch
(`run_in_background=true`), reading only this charter (Tier-A) + the pinned Tier-B pointer above.
Record each iteration under `experiments/quay-perpetual-stream/milestones/M01-dist/iterations/`.
