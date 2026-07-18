# Charter M26-adversarial-eval — DIR-001 item 4: adversarial/negative-path + security evaluation (Tier-A)

**Milestone id:** M26-adversarial-eval · **surface:** cross-cutting (Provider ABI, both providers,
MCP servers, `packages/quay/src/serve.js`, task-frontmatter parsing) · **type:** explore
**Source:** `tasks/exp5-M-ADVERSARIAL-EVAL.md` (SELECTed m26, `milestone:M26-adversarial-eval`) —
implements DIR-001 item 4. Full source: `directives/archive/DIR-001-evaluation-blind-spot-
provider-abi-and-outcome-based-methods.md` (status `applied (partial)`; items 3-6, including this
one, were explicitly BACKLOGGED at DIR-001's own m3 resolution, not applied then — this milestone
applies item 4 only; items 3, 5, 6 remain separate backlog rows, `M-OUTCOME-EVAL`/
`M-COMPETITIVE-BENCH`/`M-HUMAN-REVIEW-CADENCE`).
**Charter authored:** m25→m26 boundary, 2026-07-18.

## Value hypothesis
- Value type (per `inherited-core.md`'s value-typed SELECT ledger): **governance-integrity**
  (primary — closes a named, standing blind spot in the evaluation instrument itself: DIR-001's
  Finding states adversarial/negative-path/security review was "un-evaluated entirely." This
  milestone institutionalizes that review as a recurring, evidence-gated audit + regression-test
  surface, not a one-off narrative claim). This is NOT capability-growth: it does not add new
  Provider-ABI surface, new fields, or new product capability — it audits and hardens what already
  exists (the ABI contract, both providers' write paths, token handling, the existing `?from=`
  open-redirect guard, frontmatter/MCP-input parsing) and converts any real findings into
  regression tests + logged fixes.
- Δv̂: **zero VT points** (method-infra/eval-surface work, no VT chart cell — mirrors M13/
  M21-M25's zero-VT precedent for DIR-001-sourced eval-infra milestones; M03-abi-eval and
  M12-abi-parent-write are the only DIR-001-lineage milestones that DID score VT, because they added/
  filled Provider-ABI chart-1 capability — this milestone does the opposite kind of work,
  auditing existing capability for safety, not growing it). State this explicitly at ABSORB.
- Metric `Y`: none (no VT chart move). Success is the Done-when list below: an audit inventory
  against the ABI/both providers/MCP servers/`serve.js`, targeted fault-injection tests added for
  real gaps found, and a written audit report that honestly states whether any real bugs were
  found — manufacturing severity to justify the milestone's existence is explicitly disallowed
  (see "Explicitly OUT of scope" below).

## Source (DIR-001 item 4, quoted verbatim)
From DIR-001's "Requested action" section, item 4:
> **Adversarial / negative-path + security evaluation**: explicit fault injection and a
> token-handling / open-redirect / injection review.

DIR-001's Finding (context, also quoted) named the un-evaluated surface directly: "adversarial /
negative paths (bad config, API rate-limit, network failure, concurrent write, malformed
frontmatter, large backlog), security (token handling, open-redirect)."

## Current-state note (re-verified at charter-authoring time, not assumed from DIR-001's 2026-07-18
## Finding text)
DIR-001's Finding #3 (`packages/quay-github/provider.yml` declares "title/body/labels/parent/
children" writes `unimplemented`) is **stale** as of this charter: `M09-gh-write` (2026-07-18)
closed status/title/body/labels write, and `M12-abi-parent-write` (2026-07-18) closed parent/
children write — Provider-ABI cov reached **13/13 = 1.0000** at M12's ABSORB (`dashboard.md`
line 189, "gate 1.00 and skill 1.00 unchanged... write 0.20→0.80" at M09, then closed to full at
M12). **`packages/quay-github/provider.yml`'s own header comment still reads "title/body/labels/
parent/children remain unimplemented"** (lines 24-26) — this is itself a stale-documentation
finding the audit inventory (in-scope item 1 below) should log and correct, not a reason to treat
DIR-001's original write-completeness concern as still open. This milestone's actual scope is
adversarial/negative-path/security review of the NOW-complete write surface, not filling remaining
write gaps (there are none left per the capability matrix).

## In-scope work
1. **Inventory/audit pass.** Systematically walk: the Provider-ABI contract (wherever it's
   pinned — `packages/quay/DESIGN.md`, `packages/quay/test/provider-abi-conformance.test.mjs`,
   `packages/quay-native/test/abi-symmetry.mjs`, both providers' `gate-gameability.test.mjs`),
   both providers' write paths (`packages/quay-native/src/store.js`, `packages/quay-github/src/
   github-client.js`), both MCP servers (`packages/quay/src/mcp-server.js`, `packages/quay-native/
   src/mcp-server.js`, `packages/quay-github/src/mcp-server.js`), and `packages/quay/src/serve.js`
   (Web UI). For each, identify concrete adversarial/negative-path test gaps against what the
   EXISTING test suite already covers (do not assume gaps — check first; the existing suite may
   already cover more of this than DIR-001's blind-spot Finding assumed, since that Finding was
   about the simulated-user's discovery channel, not the whole test suite's actual content).
   Produce a written gap inventory (which of the 6 DIR-001-named categories — bad config,
   rate-limit, network failure, concurrent write, malformed frontmatter, large backlog, token
   handling, open-redirect, injection — are and are not covered today, with file:line citations).
2. **Token-handling review.** Trace how GitHub tokens/credentials are read (env var, `gh` CLI
   delegation, or direct) through `packages/quay-github/src/github-client.js` and its MCP/CLI
   entry points; confirm no code path logs, echoes, or interpolates a raw token into an error
   message, console output, or task/issue body. If a real leak path is found, fix it and add a
   regression test.
3. **Open-redirect regression/extension check.** The `?from=` guard (closed at SH-002/UQ-009 per
   `experiments/quay-continuous-bootstrap/gap-list.md`, tightened to `startsWith("/") &&
   !startsWith("//")`) already has a passing test. This milestone re-verifies it still holds against
   `packages/quay/src/serve.js`'s CURRENT code (not assumed unchanged), and extends coverage to any
   additional bypass variants not in the original test (e.g. backslash-prefixed, `\t`/control-char
   prefixed, or scheme-relative variants) if the audit inventory (item 1) finds the existing test
   doesn't already cover them. This is a regression/extension check, not a from-scratch build.
4. **Injection review.** Task frontmatter parsing (`packages/quay-native/src/store.js`'s `YAML.parse`
   usage — confirm it is the safe `yaml` package, not a code-eval path), MCP tool input handling
   (both servers' argument validation), and any shell-out/template-interpolation surface (e.g.
   `packages/quay-github`'s `gh` CLI invocation, if any — confirm arguments are passed as an argv
   array, not shell-interpolated string concatenation). Log findings; fix and test any real
   vulnerability found.
5. **Targeted fault-injection tests for the highest-risk gaps found in items 1-4.** Do not attempt
   blanket fault-injection across every surface — prioritize by what the inventory (item 1) actually
   flags as uncovered AND plausible (bad config, malformed frontmatter, concurrent writes, and
   simulated API rate-limit/network-failure responses against `quay-github` are the DIR-001-named
   categories most likely to be genuinely thin, per the audit's own findings — confirm or refute
   with evidence, don't assume). Each added test must assert SAFE degradation (clear error, no
   crash, no corrupted task-store state), matching DIR-001's own "should degrade safely... not crash
   or corrupt state" framing.
6. **Written audit report** (`experiments/quay-perpetual-stream/milestones/M26-adversarial-eval/
   audit-report.md` or equivalent), logging: what was checked, what was and wasn't already covered,
   any REAL bugs found (gap-list-style entries: id, description, where found, fix commit/test), and
   an explicit honest statement if NO bugs were found in a given category — severity must not be
   manufactured to justify the milestone; a category coming back clean is a valid, reportable
   outcome.
7. **Fix the `provider.yml` stale-comment finding** (see "Current-state note" above) as part of the
   audit report's logged findings, since it was discovered during charter authoring itself — small,
   concrete, in-scope correction, not a broader `provider.yml` rewrite.

## Explicitly OUT of scope this milestone
- **No new Provider-ABI surface addition.** Write completeness is already 13/13=1.0000 as of M12;
  this milestone does not add fields, capabilities, or providers — it audits/hardens existing ones.
- **No auth/SSO rework.** Token-handling review (item 2) is a LEAK-path audit of existing
  credential flow, not a redesign of how credentials are obtained or stored.
- **No live rate-limiting or network-failure testing against the real GitHub API.** Fault injection
  (item 5) for rate-limit/network-failure categories uses mocked/fake responses (the existing
  `packages/quay-github/test/fixtures/fake-gh.mjs` pattern or equivalent), never a live call
  designed to actually trip GitHub's real rate limiter — that is DIR-001 item 3/5's territory
  (outcome-based eval / competitive benchmark), not this milestone's.
- **No work toward DIR-001 items 3, 5, or 6** (`M-OUTCOME-EVAL`, `M-COMPETITIVE-BENCH`,
  `M-HUMAN-REVIEW-CADENCE`) — each is its own separate backlog row, not folded in here.
- **No touching DIR-017 Steps 2-3** — unrelated directive, still `pending` behind its own
  human-verification gate (per M25's ABSORB note); this milestone does not reference or advance it.
- **No retroactive gap-list backfill beyond what THIS audit itself finds.** This milestone does not
  re-audit or re-score any past milestone's already-closed gaps; it only logs NEW findings from its
  own item-1 inventory pass and item-5 fault-injection tests.
- **No general security-posture rewrite.** This is a first-pass audit + fix concrete found issues +
  institutionalize as regression tests — not a redesign of the ABI's trust model, not a new
  auth/permissions layer, not a threat-modeling framework deliverable.

## Line budget: small-milestone norm (no ceiling-expansion regime) — plan below satisfies the
## line-budget gate's phase/stage-plan convention anyway, for dogfooding-evidence clarity
This milestone's in-scope list (7 top-level items above) is at the small-milestone norm's
item-count proxy threshold, not plausibly over it — no `Line budget: <N>` declaration over 2000 is
warranted and the ceiling-expansion regime is NOT invoked (unlike M18/M24/M25). A lightweight
phase breakdown is given below purely to sequence the work (audit before fix before test before
report), not because the scope requires phase/stage decomposition:

- **Phase A — Audit** (items 1-4): inventory pass, token-handling review, open-redirect
  regression/extension check, injection review. Produces the gap inventory and any findings.
- **Phase B — Harden** (items 5, 7): targeted fault-injection tests for the highest-risk gaps found
  in Phase A; fix the `provider.yml` stale-comment finding (and any other real bug Phase A
  surfaced) with a paired regression test per fix.
- **Phase C — Report** (item 6): write the audit report; run full test suite; closing evidence.

**Plan-time line-budget gate result (run at charter-authoring time, real output):**
```
$ experiments/quay-perpetual-stream/scripts/it0-ceiling-line-budget-check.sh experiments/quay-perpetual-stream/charters/M26-adversarial-eval.md
PASS: experiments/quay-perpetual-stream/charters/M26-adversarial-eval.md — scope within the small-milestone norm (no declared line budget > 2000, in-scope item count at or under threshold 8). No phase/stage plan required.
```
No `Line budget: <N>` declaration over 2000 is present, and the "In-scope work" section's top-level
numbered-item count (7) is at/under the script's default threshold (8), so the script's coarse
proxy does not flag this charter as requiring a phase/stage plan; a lightweight sequencing plan
(Phase A/B/C above) is included anyway for dogfooding-evidence-gate clarity, not because the gate
required it.

## Binary Done-when (§3.4 — mandatory, freezes this milestone's shape)
1. `[ ]` Audit inventory produced (Phase A / item 1) covering the ABI contract, both providers'
   write paths, both MCP servers, and `serve.js`, citing file:line for each of the 8-9
   DIR-001-named categories (bad config, rate-limit, network failure, concurrent write, malformed
   frontmatter, large backlog, token handling, open-redirect, injection) — stating covered/
   uncovered per category with evidence, not assumed.
2. `[ ]` Token-handling review completed (item 2) — pasted trace of the token read/use path;
   either confirmed no leak path exists (with evidence: grepped log/error/output call sites), or a
   real leak found and fixed with a regression test.
3. `[ ]` Open-redirect guard re-verified against `serve.js`'s CURRENT code (item 3) — pasted
   test-run evidence; any new bypass-variant coverage added is pasted as a passing test diff.
4. `[ ]` Injection review completed (item 4) — frontmatter YAML parsing confirmed safe (not
   code-eval), MCP input validation reviewed, any shell-out call sites confirmed argv-array (not
   string-interpolated) — pasted evidence for each; any real finding fixed + tested.
5. `[ ]` At least the highest-risk gaps identified in Phase A have targeted fault-injection tests
   added (item 5), each asserting safe degradation (clear error, no crash, no corrupted
   task-store state) — pasted test diff + passing run output.
6. `[ ]` `provider.yml`'s stale "title/body/labels/parent/children remain unimplemented" comment
   (item 7) corrected to reflect the actual M12-confirmed write-complete state — pasted diff.
7. `[ ]` Written audit report exists (item 6) at `experiments/quay-perpetual-stream/milestones/
   M26-adversarial-eval/audit-report.md`, logging every finding (or explicitly stating none found,
   per category) in gap-list-style entries (id, description, where found, fix commit/test or "no
   fix needed, none found").
8. `[ ]` Every REAL bug found during the audit is logged as a new gap-list-style finding with a
   paper trail (report entry + regression test + fix commit) — not silently fixed with no record.
9. `[ ]` Full existing test suite passes post-change (no regressions from any fix or new test
   added) — pasted raw output.
10. `[ ]` `git diff --stat` against the pre-charter base commit shows only the expected files
    touched (test files, `provider.yml`, any real-bug-fix source files, the audit report) — no
    unrelated product code.

Milestone is DONE when all ten are met and stable ≥1 iteration (§3.2 condition 1). Terminate early
per §3.2 conditions 2-5 if they fire first. Real independent-re-derivation material for iteration-1:
whether the Phase A inventory (item 1) is actually complete against the current code (not stale
citations), whether the token-handling/injection reviews (items 2, 4) are genuinely traced end to
end or merely asserted, whether the fault-injection tests (item 5) actually exercise the claimed
failure mode (not a trivially-passing stub), and — given this milestone's explicit "do not
manufacture severity" instruction — whether iteration-0's reported findings (or lack thereof) hold
up under independent, skeptical re-derivation rather than being taken at face value.

## HARD GATES (Tier-A, cited BY REFERENCE — §3.1, DIR-009 defense; M06-sizing by-reference form)

Source: pinned HARD GATES block, `experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md` lines
100-131. Cited by hash instead of transcribed (literal text deliberately not duplicated here):

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93 (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131)

Verify: `experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference <this
file>` — PASS = hash still matches pinned source's current block (no drift); FAIL = re-derive
before dispatch. Run at charter-authoring time, directly against this file:
```
$ experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference experiments/quay-perpetual-stream/charters/M26-adversarial-eval.md
PASS: experiments/quay-perpetual-stream/charters/M26-adversarial-eval.md GATE-HASH-REF (5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93) matches current pinned source (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131) sha256.
```
(Confirms the hash is unchanged since M25's own citation of the same pinned block — no drift; re-run
once more immediately before dispatch as standard practice.)

**Charter thinness ≠ agent prompt thinness.** The dispatched `baime:iteration-executor` prompt
must still contain the LITERAL gate text in full (resolved from `GATE-HASH-REF` by the dispatcher
before constructing the prompt) — never only a hash, or this reintroduces DIR-009 dilution.

## Inner termination — five conditions (verbatim pointer, §3.2)
Applies unmodified: (1) Done-when complete & stable ≥1 iter · (2) ΔV<0.02 both layers K=2
consecutive · (3) ceiling→redesign-OR-stop · (4) budget≈10 backstop, past→default HALT ·
(5) external HALT.

## it0 systematic-explore checks (§4.4 — run and record BEFORE first work)
a. **Ceiling/floor arithmetic** — N/A this milestone (DIR-001/task-store-sourced, not a
   `gap-list.md` gap id — same confirmed limitation as M13/M21-M25). DIR-001 item 4's text and
   `tasks/exp5-M-ADVERSARIAL-EVAL.md` are the direct sources, both confirmed present at
   charter-authoring time.
b. **Gate-hash/transclusion** — verified above via `--by-reference` mode; re-run before dispatch.
c. **Dogfooding evidence-gate** — every Done-when clause requires pasted output evidence (audit
   citations, trace transcripts, test diffs + passing run output, `git diff --stat`, the audit
   report file itself) — no clause is narrative-only.
d. **Domain-misfit audit-channel** — this milestone audits/tests existing code paths (ABI contract,
   both providers, both MCP servers, `serve.js`); the audit channel is direct code inspection +
   the full test suite's own pass/fail output, mechanically independent of any self-report — same
   class as M02/M05/M21/M24/M25's own script/test-based audit channels, no domain-misfit risk.
e. **Plan-time line-budget gate** — this charter declares the small-milestone-norm regime
   explicitly (see "Line budget" section above); result: **PASS** (7 top-level in-scope items, at/
   under the script's default 8-item threshold; no `Line budget: <N>` over 2000 declared) — full
   command + PASS reasoning documented in that section above.

## Adversarial-audit gate — evaluate at ABSORB (state explicitly, not here)
Per `inherited-core.md`'s Adversarial-audit cadence rule: condition (a) requires a
capability-growth-typed milestone with a NONZERO realized VT Δv — this milestone is typed
governance-integrity with Δv̂=0 by design (no VT chart cell, no capability-growth primary type), so
condition (a) does not apply regardless of outcome UNLESS the realized Δv turns out nonzero at
ABSORB (re-check then, not assumed here — it should not, since this milestone adds no ABI surface).
Condition (b) requires iteration-0 to recommend skipping iteration-1 — not authorized; both
iterations run regardless. Do not pre-judge which condition (if either) fires — state plainly at
ABSORB, per the documented-no-op discipline.

## V_meta consolidation-lag gate — evaluate at ABSORB (state explicitly, not here)
Check every `v-meta-ledger.md` row with status `confirmed`-but-not-`consolidated` against the K=2
alarm threshold at ABSORB time. Do not pre-judge the outcome here — this is now itself one of the
DoD clauses `it0-dod-check.{sh,mjs}` mechanically checks was dispositioned (see "Note for ABSORB"
below); state the check's real outcome in the ABSORB log entry.

## Design-only-milestone impl-row gate — evaluate at ABSORB (state explicitly, not here)
This milestone is not obviously design-only (it ships tests, fixes, and a written report, not a
design doc with a future-implementer checklist) — but do not pre-judge this at charter-authoring
time. Run `it0-impl-row-check.sh M26-adversarial-eval backlog.md` at ABSORB and paste the real
output as part of the closing evidence, per the standing gate's own invocation convention.

## DoD meta-enforcer gate — evaluate at ABSORB (state explicitly, not here)
Per DIR-017/M25, `scripts/it0-dod-check.sh` must run against this milestone's charter + backlog row
+ ABSORB-entry text before `milestone_counter++` may execute (HARD BLOCK, same shape as the other
three gates above). Do not pre-judge PASS/FAIL here.

## Note for ABSORB
1. **This is the DoD meta-enforcer's second-ever real (non-fixture, non-self-referential) test.**
   Per cp-25.md's own flagged item and M25's ABSORB entry (the FIRST real test was M25's own
   self-check against its own charter — necessarily self-referential, since M25 built the checker),
   this milestone's ABSORB is the first time the checker is run against a charter/backlog-row/
   ABSORB-text it did NOT itself produce. State EXPLICITLY in the m26 ABSORB entry whether
   `it0-dod-check.sh` generalized cleanly to this real, independently-authored milestone, or
   whether it needed adjustment (and if so, exactly what broke and why) — this is load-bearing
   evidence for whether DIR-017 Step 1's mechanism is genuinely operative outside its own
   self-referential build context, which is precisely the "designed-not-wired" risk DIR-017 exists
   to catch. Do not gloss over friction here even if the gate ultimately PASSes.
2. **Any REAL bug found during the audit must be logged as a new gap-list-style finding with a
   paper trail** (per Done-when clause 8) — a leak, injection vulnerability, or crash/corruption
   path fixed silently, with no report entry and no regression test, is itself a DoD violation in
   spirit (undocumented change to security-relevant code) even if no existing gate's mechanical
   check catches it directly. State in the ABSORB entry how many real findings (if any) were logged,
   and confirm each has a paired fix + test, per Done-when clause 8's own text.

## Dispatcher notes
Standard 2-iteration pattern: iteration-0 (build) + iteration-1 (fresh worktree, independent
re-derivation, NOT reading iteration-0's report/materials). **Both worktrees created off
`exp5-outer-driver` HEAD, not `master`** — per the M23-outer-driver-isolation discipline standing
(DIR-018): at DRAIN (before this milestone's SELECT), `master` was already merged into
`exp5-outer-driver`; both iteration worktrees for M26 branch from that current `exp5-outer-driver`
HEAD. Worktree/branch paths: `milestones/M26-adversarial-eval/worktrees/iteration-{0,1}`, branches
`exp5-m26-iteration-{0,1}`. Merge iteration-0/iteration-1 results into `exp5-outer-driver` first
(per-file conflict resolution, reconciliation notes per DIR-018 item 3's no-silent-drop discipline);
only THEN merge `exp5-outer-driver` → `master` as the single ABSORB publish commit (`git checkout
master && git merge --no-ff exp5-outer-driver`), sequenced after the adversarial-audit gate, V_meta
consolidation-lag gate, design-only-milestone impl-row gate, AND the DoD meta-enforcer gate all
clear. iteration-0 executes the full Phase A/B/C sequence in one pass (audit → harden → report — a
single coherent build+verify pass, not three separate BAIME iterations).

**iteration-1 skepticism instruction (explicit, not optional):** given this milestone's own
Done-when clause 8 and "no manufactured severity" instruction, iteration-1 must NOT simply read
iteration-0's audit report and rubber-stamp its findings (or its "nothing found" conclusions).
iteration-1 independently re-derives the Phase A inventory from the actual current code (not from
iteration-0's report text), independently re-checks the token-handling/open-redirect/injection
review items, and independently probes for fault-injection gaps — genuinely trying to find
something iteration-0 missed OR to identify a claimed "finding" that doesn't actually hold up
(over-claimed severity or a fix that doesn't actually close the gap it claims to). This mirrors
M25's own iteration-1 self-referential-skepticism instruction (checking whether fixtures were
rigged to trivially pass), applied here to an audit-report context: the risk is not a rigged
fixture, it is an audit that either misses a real issue or inflates/deflates severity relative to
what independent re-derivation would find.
