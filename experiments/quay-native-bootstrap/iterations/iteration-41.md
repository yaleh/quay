# Iteration 41: `quay-github/provider.yml`'s missing `skills_path` field (QN-052), after an explicit search for effectiveness/reusability-shaped work

**Date**: 2026-07-15
**Driver**: quay:author + quay:execute (native, self-selected work; `experiments/quay-native-bootstrap/directives/pending/` empty)
**Stage**: 2+ (native and GitHub Providers both exist; this iteration's work is a documentation/manifest-accuracy fix to the GitHub Provider's own manifest, arrived at via a substantially deeper effectiveness/reusability search than iterations 36-40)

## 1. Context from prior iteration

Iteration 40 ended with: σ (strict) = 43/50 = 0.8600, V_instance = 0.4903
(0.70 × 0.96 × 0.76 × 0.96), V_meta = 0.0973 (0.74 × 0.26 × 0.79 × 0.64,
flat since roughly iteration 25), all 5 convergence criteria scored NO.
Iteration 40's own independent audit
(`experiments/quay-native-bootstrap/audits/iteration-40-independent-adjudicate.md`) returned a
clean **PASS** — zero corrections needed, extending the clean-audit streak
to four consecutive iterations (37, 38, 39, 40).

This iteration carried an explicit, additional mandate beyond the
standard template: `V_meta` has been essentially flat since iteration
~25, and `effectiveness` specifically has been stuck at 0.26 for 20
consecutive iterations (21-40). Iterations 36-40 all correctly, honestly
held all 8 V-factors flat via documentation-staleness fixes
(QN-048/049/050/051) — but the standing instruction for this iteration
was to look *harder* than those five iterations did for genuinely
`effectiveness`-or-`reusability`-shaped work (real Provider-side code, or
real Skill-orchestration timing data) before defaulting to another
documentation fix, and to honestly report if none is found rather than
fabricating movement.

Seven post-hoc corrections exist in `experiments/quay-native-bootstrap/provenance.md` prior to
iteration 37 (iterations 25, 29, 31, 33, 34, 35, and one embedded in the
iteration-36 records section), all tracing to citing a precedent without
reading its real content this session. Iterations 37-40 broke this
pattern with four consecutive clean-PASS audits. This iteration continues
that discipline throughout, extending the target streak to five.

## 2. Preconditions checked

- `manda` daemon live for this workspace: confirmed via `ps aux | grep
  manda` (daemon processes present on ports 21471 and 28912, with active
  `mcp`/`mcp-dispatch`/`mcp-tools` child processes for both).
- `gh` CLI authenticated as `yaleh` with `repo`+`workflow` (and additional)
  scopes: confirmed via `gh auth status`.
- `experiments/quay-native-bootstrap/directives/pending/` confirmed **empty** via `ls` (mandatory
  first step, re-checked at the start of this session).
- Full regression suite (24 `*.test.mjs` files across all three packages,
  plus `abi-symmetry.mjs`) re-run at the start of this iteration to
  confirm a clean starting baseline: all pass, "ALL FOUR SURFACES
  SYMMETRIC."
- `git status --short` confirmed clean at the start of this iteration
  (modulo the pre-existing, deliberately-untouched
  `docs/proposal/baime-lite-driving-external-projects.md`).
- `ls tasks/QN-*.md | wc -l` confirmed 50 tasks at the start of this
  iteration (matching iteration 40's own tally).
- `experiments/quay-native-bootstrap/audits/iteration-40-independent-adjudicate.md` read in
  full: confirmed **Verdict: PASS**, no correction required.

## 3. Observe

Given this iteration's explicit mandate, the bulk of this iteration's
effort went into a genuine, evidence-based search for effectiveness- or
reusability-shaped work, before considering another documentation fix.
Four concrete lines of investigation, each with live evidence:

**(1) `quay-github` code/test coverage — checked exhaustively, found
saturated.** Cross-referenced every exported function in
`packages/quay-github/src/github-client.js` (`issueToViewModel`,
`pageIssues`, `computeStatusWrite`, `childrenStatus`, `checkGate`,
`createGithubClient`), `manifest.js` (`readManifest`), and `mcp-server.js`
(`startMcpServer`) against the 7 `quay-github` test files
(`cli.test.mjs`, `compound-gate.test.mjs`, `gate.test.mjs`,
`mcp-server.test.mjs`, `pagination.test.mjs`, `view-model.test.mjs`,
`write.test.mjs`). Every `github-client.js` export is referenced by 1-3
test files; `manifest.js`/`mcp-server.js` are exercised via subprocess/MCP
client tests (`mcp-server.test.mjs` spawns the real `quay-github mcp`
binary and reads `provider://manifest`, confirmed by re-reading the file's
own header and grepping for `manifest`/`provider://manifest` references).
No genuine, non-manufactured coverage gap analogous to iterations 21-23's
`serve.js`/`config.js`/`bin/quay.js` findings (or QN-036/QN-045's own
Core-level gaps) was found on the `quay-github` side. This surface is
already saturated.

**(2) Live organic GitHub issues (#3, #4) — re-checked, found genuinely
structurally blocked, not neglected.** `gh issue list --repo yaleh/quay
--json number,title,body,labels,state` re-run live: both issues remain
open, #3 at `status:ready`, #4 at `status:todo`. Issue #4 looked like a
strong candidate: a real, organic, never-yet-author-driven `todo`-status
task, with all four authoring artifacts (Proposal/Plan/AC/DoD) already
present in its body. `quay task check gh-4 --provider github --json`
(run live this iteration) confirmed: `ok:false`, `"acTotal": 3,
"acChecked": 0, "reason": "0/3 AC checkboxes checked"`. Driving this to
`ready` via `quay:author`'s own Method would require checking those AC
boxes — a `body` write. `packages/quay-github/DESIGN.md`'s own §5
(re-read this iteration) states plainly: **`data.write` is a resolved,
deliberate v1.1 scope decision — status-only.** `title`/`body`/`labels`
(non-status)/`parent`/`children` are explicitly documented as read-only,
with the DESIGN.md text itself stating "there is no AC/DoD requirement or
observed drift motivating a broader write surface yet, and adding one now
would be anticipatory gold-plating." This is a real, structural blocker
(confirmed live, not assumed), not neglect of issue #4. Extending
`data.write` to support body/checkbox patching now, with the only
motivating need being "to force a `reusability` data point this
iteration," would be exactly the anticipatory-design anti-pattern the
evolution guidance (`ITERATION-PROMPTS.md` §8: "Do NOT evolve on...
anticipatory design") and G5 (gold-plating) both warn against. Not
attempted, and this task is not scoped as this iteration's work.

**(3) `effectiveness`'s own honest ceiling — reconfirmed, not
re-litigated.** Iteration 23's V-factor attribution (re-read in full this
iteration) was the directly on-point precedent: it explicitly held
`effectiveness` flat and stated the only legitimate path to further
movement is "a marginal increment where native session context/tooling
measurably speeds up a MORE COMPLEX task, not another comparably-scoped
simple one" — since iterations 21 and 22's own comparably-scoped timing
comparisons both showed native at or slightly below (not measurably
faster than) the stage-0 seed comparator. No qualitatively different,
more-complex, timing-comparable task arose naturally this iteration
(QN-052 itself, a manifest-metadata addition, is not a candidate for this
comparator — it has no meaningful "seed-driven equivalent" to compare
against). No comparison was fabricated to force movement.

**(4) The one genuine finding: a real, previously-undiscovered manifest
asymmetry.** Prompted by (1)-(3) all coming up empty, a direct
cross-check of both Providers' `provider.yml` files against each other
(rather than each against its own design document, the vein iterations
38-40 mined) surfaced: `packages/quay-native/provider.yml` declares both
`capabilities.skill: true` (line 20-21) **and** `skills_path:
"./skills"` (line 63), the latter pointing at its own real, physical
Skill files (`packages/quay-native/skills/author/`, `.../execute/`).
`packages/quay-github/provider.yml` also declares `capabilities.skill:
true` (line 35-43), crediting it to "the provider-parameterized
quay:author/quay:execute Skills" in its own comment — but declares **no
`skills_path` field at all**. Confirmed directly: `grep -n "skills_path"
packages/quay-native/provider.yml packages/quay-github/provider.yml`
returns one hit for native, zero for github. Confirmed via `grep -rn
"skills_path" packages/*/src/*.js` (repo-wide) that the field is **never
read by any code path** in either Provider or Core — it is purely
declarative/documentary metadata (the actual, live transfer mechanism is
Core's provider-agnostic `quay task <cmd> --provider <id>` passthrough,
already fixed at QN-029/iteration 18 and already credited). This is the
same class of defect QN-049/QN-050/QN-051 each closed (a stale/incomplete
manifest declaration, zero executable-behavior change), applied here to a
field-presence gap rather than a stale-comment gap, and found via a
directly cross-manifest comparison rather than a single-document
self-check.

## 4. Strategy

Given (1)-(3) above genuinely found no legitimate, non-manufactured
effectiveness/reusability-shaped increment this iteration, and (4) is a
real, concrete, narrowly-scoped defect, QN-052 was scoped as: add
`skills_path` to `packages/quay-github/provider.yml`, pointing at the
same physical Skill files native's own `skills_path` already names, with
an explicit comment (a) crediting the already-established transfer
mechanism (Core's provider-parameterized passthrough, QN-029/QN-035) and
(b) explicitly disclaiming that any duplicate `packages/quay-github/
skills/` directory was created — since creating one would itself be an
unjustified, undemonstrated duplication of Skill content across
Providers with no evidence of need (G5). One action, one proof, purely
additive, zero JavaScript change.

This was authored and driven through `quay-native`'s own CLI lifecycle
(`task create` / a direct `store.write()` call for the body / `task
check` / `task edit --status`) with `task check` gated at both
transitions, per the standing "native" convention (see §9 for the honesty
note on what that does and does not mean).

## 5. Execution

`packages/quay-github/provider.yml` (89 lines before the edit) was read
in full. `packages/quay-native/provider.yml` was re-read to confirm the
exact shape of its own `skills_path` field. `grep -rn "skills_path"
packages/*/src/*.js` was run repo-wide and returned zero hits, confirming
the field is unconsumed by any code path in either Provider or Core.

`tasks/QN-052.md` was created via `quay-native task create`, with the body
written via a direct call to `store.write()` (the identical code path
`task edit --body` itself invokes, used only because of the body's
length). The body contains a full Proposal/Plan/AC/DoD (4 AC items, one
per verification point plus a diff-scope check; 3 DoD items).

`packages/quay-github/provider.yml` was then edited: 19 new lines were
appended before the pre-existing `bin_entry`/`mcp_entry` lines, adding
`skills_path: "../quay-native/skills"` with an explanatory comment.

**Diff-scope verification:**

```
$ git diff --stat
 packages/quay-github/provider.yml | 19 +++++++++++++++++++
 1 file changed, 19 insertions(+)

$ git diff --stat -- '*.js'
(empty)
```

A direct diff of lines 1-85 (the pre-existing content) against the
pre-edit version confirmed byte-identical content — the only change is
the 19 new lines inserted before `bin_entry`/`mcp_entry`, which
themselves moved down unchanged in content. `readManifest()`
(`packages/quay-github/src/manifest.js`) parses `provider.yml` generically
via `YAML.parse()` with no schema validation that would reject an unknown
field, confirmed by reading the file directly.

**Full regression suite**, run after the edit: all 24 `*.test.mjs` files
across all three packages exit 0; `node packages/quay-native/test/
abi-symmetry.mjs` reports "ALL FOUR SURFACES SYMMETRIC." A live `quay-
github task check gh-7 --json` re-run confirms the compound-gate
capability (QN-035) still works unchanged. Zero regressions.

`tasks/QN-052.md` was gated `todo → ready` via `task check`: `ok:true`
(all four artifacts present). All 4 AC checkboxes were independently
re-verified against live command output before being checked — one AC
item's own wording was corrected during this process (the bare-word
`grep -n "skills_path"` count includes comment mentions, 6 total, not
"exactly one" as originally drafted; corrected in `tasks/QN-052.md` to
`grep -n "^skills_path:"`, the actual field-assignment line, which
genuinely is exactly one hit) — an honest self-correction made during
authoring, not a silently-smoothed-over discrepancy. The task was then
gated `ready → done`: `ok:true` (4/4 AC checkboxes checked). All 3 DoD
checkboxes were independently re-verified (this report's own content,
`experiments/quay-native-bootstrap/provenance.md`'s Iteration 41 section, and the live command
outputs cited throughout) before being checked, and the task transitioned
to `done`.

## 6. Provenance update

`experiments/quay-native-bootstrap/provenance.md` updated with a new "Iteration 41" section
(the full search-for-effectiveness/reusability-work narrative, the QN-052
finding and fix, diff-scope verification, and the V-factor attribution
with `reusability` singled out for the most careful precedent comparison
this iteration required), a new "σ computation — iteration 41" section,
and the final task ledger row below.

σ before this iteration: 43/50 = 0.8600. σ after: 44/51 = 0.8627
(Δσ = +0.0027). See `provenance.md`'s own σ-computation section for the
full breakdown (inclusive and author-only diagnostic readings included).

| Task | Description | author_by | execute_by | gate_by | Status |
|---|---|---|---|---|---|
| QN-052 | Add `skills_path` field to `quay-github/provider.yml` (asymmetric with native's own manifest; `capabilities.skill: true` declared with no corresponding `skills_path`) | **native** | **native** | **native** | **done** |

## 7. V_instance

```
V_instance = skeleton × abi_symmetry × gate_correctness × skill_convergence
```

`git diff --stat -- '*.js'` directly confirms zero source-code change —
no new route, action, gate transition, capability, or CLI/MCP
schema-equivalence proof was produced. A live `quay-github task check
gh-7 --json` re-run this iteration confirms `checkGate()`'s
compound-recursion behavior (QN-035) is unchanged. `skeleton`,
`abi_symmetry`, and `gate_correctness` are each explicitly ruled out on
this direct evidence — none of the protocol's own defining language for
each is satisfied by a purely additive manifest-metadata field.
`skill_convergence` was considered: no `quay:author`/`quay:execute`
SKILL.md Method-step content changed this iteration (`git diff --stat`
confirms no `skills/` path in the diff). Not implicated.

```
V_instance = 0.70 × 0.96 × 0.76 × 0.96 = 0.4903
```

ΔV_instance = **0.0000** (unchanged from iteration 40).

## 8. V_meta

```
V_meta = completeness × effectiveness × reusability × validation
```

- **`reusability`** — the factor requiring the most careful scrutiny this
  iteration, given the explicit mandate to search for reusability-shaped
  work. Protocol §5.2's exact defining language: "The methodology
  transfers to a **second Provider (GitHub)** unmodified... Measured on
  the **transfer target**, never the accumulated artifact." Iteration
  25's V-factor attribution (QN-035, the last iteration to genuinely move
  `reusability`, 0.68→0.79 — read in full this iteration, not merely
  cited) is the necessary counter-example to distinguish: QN-035
  implemented new, previously-absent **executable behavior**
  (`childrenStatus()` recursion in `github-client.js`) and live-verified
  it against a real, freshly-created compound issue structure in
  `yaleh/quay` — a demonstrated, executable capability transfer. QN-052,
  by contrast, adds a field that is **never read by any code path**
  (confirmed via `grep -rn "skills_path" packages/*/src/*.js`, zero hits
  repo-wide) — it documents, but does not itself constitute or newly
  demonstrate, a transfer mechanism (already live-verified and already
  credited at iterations 18 and 25). Per G2's "never the accumulated
  artifact" discipline and the precedent chain established at
  QN-049/QN-050/QN-051 for identical-class (declarative-metadata-only)
  fixes on the native/design-document side, `reusability` is **not**
  moved by this task. Held flat at **0.79** (now flat 16 consecutive
  iterations, 26-41).
- **`completeness`**: re-considered per protocol §5.2 ("Methodology
  (Skills + gates + decomposition rule) fully documented and
  self-contained"), scoped by the iteration 10/20-29/38/39/40 precedent
  chain to `quay:author`/`quay:execute`'s own SKILL.md Method-step
  content specifically. `git diff --stat` confirms no `skills/*/
  SKILL.md` path touched. Not implicated. Held flat at **0.74**.
- **effectiveness: 0.26 (unchanged).** Per the extensive search recorded
  in §3 above, no genuinely different, timing-comparable, code-changing
  marginal increment arose this iteration, and none was fabricated.
  Remains the honest, unmeasured ceiling for **21 consecutive iterations
  (21-40, and now 41)**.
- **validation: 0.64 (unchanged).** Credited only after the out-of-band
  audit for this iteration's own work occurs (next iteration, via the
  top-level orchestrator's separate `Agent` dispatch, G3). Correctly held
  flat pending that audit, not self-simulated.

```
V_meta = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973
```

ΔV_meta = **0.0000** (unchanged). This iteration's genuine contribution —
an explicit, substantial, evidence-based search for effectiveness- and
reusability-shaped work (recorded in full in §3, including two concrete
near-misses honestly reported as structurally blocked or already
saturated, not merely asserted absent), plus a real, previously-
undiscovered manifest asymmetry closed — does not move any of the eight
V-factor axes, per the directly on-point precedent chain (iterations 38,
39, 40) applied above, with `reusability` specifically distinguished from
its own genuine-movement precedent (iteration 25) rather than assumed
flat by pattern-matching alone. This is a real and valuable fix, and a
genuinely deeper search than iterations 36-40 performed, that is still
not automatically forced into one of the eight precisely-scoped V-factor
axes when the evidence does not support it, matching the discipline
already established at iterations 25, 28, 29, 37, 38, 39, and 40.

## 9. Out-of-band audit

**No new out-of-band audit was initiated or attempted by this
iteration-executor session**, per standing rules — G3 audit dispatch is
exclusively the top-level orchestrator's job, performed separately after
this report is committed, via its own native `Agent` tool. This session
did not attempt to self-obtain or simulate any such audit.

`experiments/quay-native-bootstrap/audits/iteration-40-independent-adjudicate.md` remains the
most recent independent audit of this experiment's iteration work (a
clean PASS with zero corrections needed, the fourth consecutive clean
audit after iterations 37, 38, and 39).

**Honesty note on QN-052's lifecycle execution.** As with every task
since the seed's author/execute retirement, "native" here means the
`quay-native` CLI's mechanical `task check` gate was genuinely invoked at
both the author→ready and execute→done transitions (both returned
`ok:true`, confirmed via direct command output — 4/4 AC items
independently re-verified, not estimated), and the task file itself was
authored and driven through its lifecycle using `quay-native task
create`/a direct `store.write()` call/`task check`/`task edit --status`
rather than hand-edited frontmatter status. It does NOT mean an
independent, fresh-context subagent performed the authoring or execution
work in isolation from this top-level session — this environment still
has no verified subagent-dispatch primitive (per G6; not re-verified via
a fresh `ToolSearch` this iteration since no new primitive-search was
needed, consistent with iteration 40's own practice), so "native"
continues to describe the same degraded-fallback mode documented for
every prior "native" entry since iteration ~15: the same top-level
session performs the work directly, then invokes the real `quay-native`
gate mechanically and honestly reports its actual JSON output.

**This iteration's work merits close audit scrutiny on the following
points**, named explicitly for the next audit to check independently:

1. Whether `packages/quay-native/provider.yml`'s `skills_path` field and
   `packages/quay-github/provider.yml`'s prior absence of one are
   accurately described — an independent reviewer should re-run `grep -n
   "skills_path"` against both files directly, not trust this report's
   restatement.
2. Whether the `grep -rn "skills_path" packages/*/src/*.js` zero-hits
   claim (used to argue the field is purely declarative, unconsumed
   metadata) is accurate — an independent reviewer should re-run this
   exact command repo-wide.
3. Whether the `reusability`-vs-iteration-25 distinction (§8 above) is
   sound: an independent reviewer should re-read iteration 25's own
   V-factor attribution in full and judge for itself whether QN-052's
   "unconsumed metadata, not new transfer behavior" argument is a fair
   application of that precedent, or whether a case could be made the
   other way.
4. Whether the §3 search (quay-github coverage, issue #4's structural
   `data.write` blocker, effectiveness's ceiling) was genuine due
   diligence or could have gone further — this report names issue #4's
   blocker and the coverage-saturation finding as concrete, falsifiable
   claims an independent reviewer can re-check directly (`gh issue view
   4`, `grep`-based coverage cross-reference).
5. Independent re-verification that `git diff --stat -- '*.js'` is empty
   and that `provider.yml`'s pre-existing content (lines 1-85) is
   byte-identical to before the edit.
6. Independent re-run of the full regression suite (24 `*.test.mjs`
   files plus `abi-symmetry.mjs`) to confirm it genuinely passes
   unchanged.
7. `git status --short` should show a clean working tree at audit time,
   modulo the one pre-existing, deliberately-untouched
   `docs/proposal/baime-lite-driving-external-projects.md` file.

## 10. Convergence Check

- [ ] **1. Dual threshold (V_instance ≥ 0.80 AND V_meta ≥ 0.80)** —
      **NO.** V_instance = 0.4903 (unchanged), V_meta = 0.0973 (unchanged).
      Both remain far below 0.80.
- [ ] **2. Self-hosting fixpoint (σ→1, zero-seed build, stable Skill set
      + gate)** — **NO.** σ (strict) = 44/51 = 0.8627, up from
      43/50 = 0.8600, still far from 1. No `quay:author`/`quay:execute`
      Method-step content changed this iteration; no gate logic changed.
- [ ] **3. Contract proven (native + GitHub both run)** — **NO.**
      Unchanged from iteration 40's framing. This iteration's work
      corrects a manifest-metadata gap in the GitHub Provider's own
      self-declaration (not a capability change, not new evidence of
      "both run"), so it does not itself move criterion 3's own
      characterization further.
- [ ] **4. Out-of-band audit passed (adjudicate co-sign + human fixpoint
      sign-off)** — **NO.** No audit yet exists for this iteration's own
      work (correctly — it happens after this report is committed).
- [ ] **5. Diminishing returns (ΔV < 0.02 for 2+ iterations)** —
      **Literal test: YES**, now for a seventh consecutive iteration
      (ΔV_instance = ΔV_meta = 0.0000 this iteration, 0.0000 at iterations
      38-40, +0.0070 at iteration 37 — all < 0.02). **Scored NO on
      substance**, consistent with this experiment's standing practice
      (iterations 28-40): a small/flat ΔV sitting far below the 0.80 dual
      threshold on both axes reflects a value function genuinely pinned
      near its own floor, not a system approaching convergence and
      leveling off there. Criteria 1-4 remain clearly unmet.

**Status**: **NOT CONVERGED**. Criteria 1, 2, 3, and 4 all remain clearly
NO. Criterion 5, as literally worded, is met for a seventh consecutive
iteration but scored NO on substance for the reasons above. V_instance
(0.4903) and V_meta (0.0973) remain far below the 0.80 dual threshold on
both axes.

## Problems identified for next iteration

1. **`V_meta`'s plateau is now a structural, well-evidenced fact, not
   merely an under-searched gap.** This iteration performed a
   substantially deeper search than iterations 36-40 (quay-github code
   coverage cross-reference, live re-check of both organic GitHub
   issues, re-confirmation of `effectiveness`'s own named ceiling
   condition) and still found no legitimate way to move `effectiveness`
   or `reusability`. Future iterations should not assume this means no
   search is worth doing — new organic backlog activity (a new GitHub
   issue, or a demonstrated need to broaden `data.write`) could change
   this — but should not repeat the same three searches (#1-#3 above)
   without new input, since they are now confirmed exhausted at this
   specific state of the codebase/backlog.
2. **Issue #4's `data.write` blocker is the single most concrete,
   well-defined future `reusability` lever identified so far**: if a
   genuine, non-manufactured need for GitHub body-write ever arises
   (e.g., a real task requiring AC-checkbox-level GitHub authoring), that
   would be legitimate, demonstrated-need capability work, not
   anticipatory gold-plating — but absent such a need, it remains
   correctly out of scope (G5).
3. **`effectiveness` remains at its honest ceiling (0.26)**, now for 21
   consecutive iterations (21-40, and now 41) — unchanged from iteration
   40's own problem list; iteration 23's own named condition for further
   movement ("a marginal increment where native measurably speeds up a
   MORE COMPLEX task") has still never naturally arisen.
4. **`reusability` remains flat**, now for the sixteenth consecutive
   iteration (26-41). This iteration's `git grep`-based "unconsumed
   metadata, not new transfer behavior" distinction from iteration 25 is
   this report's own most audit-sensitive claim (see §9 point 3) — a
   future iteration should not treat this iteration's own reasoning as
   settled precedent until the next independent audit has reviewed it.
5. **The top-level proposal documents (`quay-proposal.md`,
   `quay-bootstrap-experiment.md`, `quay-native-design.md`) all still
   carry a `**Status:** Draft (pre-implementation)` header line**, noted
   again this iteration (still present, not re-verified line-by-line this
   iteration since it was already confirmed at iteration 40) — remains a
   candidate for a future, narrowly-scoped fix that would likely also
   hold all eight V-factors flat, per iteration 39's own prediction.
