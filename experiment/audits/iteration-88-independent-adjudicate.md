# Iteration 88 — independent G3 out-of-band audit

**Auditor**: independent G3 guardrail agent, out-of-band, dispatched directly by
the top-level orchestrator's own native Agent tool (never manda, per this
experiment's permanent DIR-016 rule). Zero prior context beyond the audit
dispatch prompt — every claim below was re-derived fresh from primary sources:
`docs/proposal/quay-bootstrap-experiment.md`, `docs/proposal/quay-native-
design.md` §6, `experiment/iterations/iteration-88.md`, `experiment/
iterations/iteration-87.md`, `experiment/audits/iteration-87-independent-
adjudicate.md`, `experiment/provenance.md`, `tasks/QN-074.md`, `git show
e307882` (full diff and stat), `git log`, direct greps across every
`*.test.mjs` file in the repo, direct reads of `packages/quay-native/bin/
quay-native.js` and `packages/quay-native/src/mcp-server.js`, a direct
reproduction of the full regression suite and `abi-symmetry.mjs`, this
audit's own first-party adversarial break/restore of the CLI's
`--expect-status` wiring, direct reads of `tasks/QN-021.md` and `experiment/
iterations/iteration-8.md`, and direct reads of `experiment/iterations/
iteration-61.md`, `iteration-79.md`, `iteration-80.md` and their own audits
for the cited precedent.

**Subject**: commit `e307882` ("Iteration 88: QN-074 closes a genuine
abi_symmetry gap (task_write CAS-conflict shape); skill_convergence checked,
no fresh material found").

**Verdict: PASS.**

Every concrete, checkable claim in iteration 88's report was independently
re-verified and found accurate: the arithmetic, the zero-production-diff
claim, the "no prior CLI-vs-MCP CAS-shape test" claim (confirmed by
independent grep, with one detail — a closely-adjacent MCP-only CAS test —
worth surfacing explicitly, see (a.4) below, though it does not undermine the
report's specific claim), the adversarial break/restore (independently
reproduced, byte-identical outcome), and the `skill_convergence` backlog
claim (independently confirmed: exactly QN-017/020/021/022 are the only
non-done tasks, and QN-021 is genuinely structurally unsatisfiable by
design). The precedent citations (iteration 61's reverted `completeness`
credit; iterations 79/80's "analytically distinct, no credit" reasoning for
manda-trial work) are genuine and were independently read and confirmed, not
merely trusted. The iteration correctly refrained from declaring convergence
and correctly surfaced the decision for orchestrator/human sign-off.

---

## (a) Independent re-verification of every concrete factual claim

### (a.1) σ / V_instance / V_meta arithmetic

```
$ ls tasks/QN-*.md | wc -l                          -> 73  (was 72)
$ grep -h "^status:" tasks/QN-*.md | sort | uniq -c  -> 69 done, 3 needs-human, 1 todo
$ python3 -c "print(62/73)"                          -> 0.8493150684931506
$ python3 -c "print(0.85*0.97*0.76*0.96)"             -> 0.6015552000000001
$ python3 -c "print(0.74*0.26*0.79*0.64)"             -> 0.09727744000000002
```

**Confirmed exactly**: σ_strict = 62/73 = 0.8493 (down from 62/72 = 0.8611),
V_instance = 0.85 × 0.97 × 0.76 × 0.96 = 0.6016 (up from 0.5954), V_meta =
0.0973 (unchanged). QN-074's provenance triple is `{author_by: seed,
execute_by: seed, gate_by: seed}` (confirmed in both `tasks/QN-074.md`'s
frontmatter region and `provenance.md`'s new table row) — correctly adding 1
to the denominator without adding to the native-qualifying numerator (62,
unchanged). This is honest, mechanical denominator growth, the same shape as
iterations 76/86/87's own σ movement.

Cross-checked V_meta's flatness independently across a wider window than the
report itself quoted:

```
$ grep -n "V_meta = " experiment/iterations/iteration-8{3,4,5,6,7,8}.md
```

confirms V_meta = 0.0973 stated identically across iterations 83, 84, 85, 86,
87, and 88 — **six** consecutive iterations flat, an order of magnitude below
the 0.80 dual threshold.

Also independently re-derived the full V_instance/σ trajectory across
iterations 85-88 to confirm internal consistency (not just the single-step
delta the report quotes):

```
iter 85: V_instance = 0.83×0.96×0.76×0.96 = 0.5813  σ_strict = 62/70 = 0.8857
iter 86: V_instance = 0.84×0.96×0.76×0.96 = 0.5883  σ_strict = 62/71 = 0.8732
iter 87: V_instance = 0.85×0.96×0.76×0.96 = 0.5954  σ_strict = 62/72 = 0.8611
iter 88: V_instance = 0.85×0.97×0.76×0.96 = 0.6016  σ_strict = 62/73 = 0.8493
```

Fully consistent, monotonic factor-by-factor: `skeleton` moved at 86 and 87
(0.83→0.84→0.85), `abi_symmetry` moved only at 88 (0.96→0.97), `gate_
correctness` and `skill_convergence` held flat throughout. No arithmetic
error found anywhere in this chain.

### (a.2) `tasks/QN-074.md` — verify its own claims/status

Read the task file directly. `status: done`, all AC/DoD checkboxes `[x]`.
Cross-checked each AC item against the actual diff (below) and found every
one genuinely satisfied: a new 5th check block exists in `abi-symmetry.mjs`
forcing a CAS conflict on both the CLI and MCP surfaces, asserting schema
*and* value equivalence (not just "both are errors"), asserting each
surface's own idiomatic error-signaling channel, and the DoD's "zero
production-source diff" and "regression suite unaffected" claims both hold.
No live `gh api` call anywhere in the new content (correctly native-only,
confirmed — CAS/`expectedStatus` does not exist on the GitHub Provider).

### (a.3) Zero production-source diff

```
$ git show e307882 --stat
 experiment/iterations/iteration-88.md      | 502 +++++++++++++++++++++++++++
 experiment/provenance.md                   | 103 ++++++
 packages/quay-native/test/abi-symmetry.mjs |  54 ++++
 tasks/QN-074.md                            | 112 +++++++
 4 files changed, 771 insertions(+)

$ git diff --stat 8f0d5d7 e307882 -- 'packages/*/src/*.js'
(no output)
```

**Confirmed exactly as claimed**: 4 files touched, all test/doc/task-file.
Zero files under `packages/*/src/` appear in the diff. This is test-coverage-
only, matching the report's and QN-074's own claim.

### (a.4) The real test diff — read directly, not the report's description

Read `git show e307882 -- packages/quay-native/test/abi-symmetry.mjs` in
full. The new 5th check block is exactly as described: seeds `T-5`/`T-6`
(both status `ready`), forces a CAS conflict on each surface with a
deliberately mismatched `expectedStatus: "todo"`, and asserts:

- key-set equality (`JSON.stringify(keysOf(cli)) === JSON.stringify(keysOf(mcpResult))`)
- `error === "ConflictError"` on both sides
- `expectedStatus`/`actualStatus` value equality across both sides
- both surfaces' own idiomatic error-signaling channel (CLI: non-zero exit +
  parsed `e.stdout` JSON body; MCP: `isError === true`)

This matches the report's description precisely, including the exact result
values quoted in the report (`cliExpectedStatus: "todo"`,
`cliActualStatus: "ready"`, `match: true`), independently reproduced below.

**Independent grep, performed fresh, not trusting the report's own grep
output:**

```
$ grep -rn "expect-status" packages/*/test/
packages/quay-native/test/abi-symmetry.mjs:8:  (new comment, this iteration)
packages/quay-native/test/abi-symmetry.mjs:195: (new check block, this iteration)
packages/quay-native/test/abi-symmetry.mjs:215: (new check block, this iteration)

$ grep -rln "expectedStatus" packages/*/test/*.test.mjs
packages/quay-native/test/cas-write.test.mjs
packages/quay/test/mcp-server.test.mjs

$ grep -rln "ConflictError" packages/*/test/*.test.mjs
packages/quay-native/test/cas-write.test.mjs
```

**One detail the report's own grep summary did not surface, worth recording
explicitly for the record (does not change the verdict):** `packages/quay/
test/mcp-server.test.mjs` (QN-043, Core's own MCP passthrough regression
test) already exercises `expectedStatus`/`ConflictError` — but read closely
(lines ~272-300), this is exclusively through Core's `quay mcp` aggregation
path's own MCP client call (`core.callTool({name: "task_write", ...
expectedStatus...})`); the file's only use of a CLI subprocess
(`execFileSync`) is for unrelated `task create` fixture setup at lines
~160-164, never for `task edit --expect-status`. So this file is a genuine,
pre-existing **MCP-only** CAS-conflict test through a second transport layer
(Core's own aggregating MCP server, distinct from quay-native's own MCP
server) — it strengthens confidence that the CAS *behavior* itself was
already well-tested on the MCP side, but it does not touch the CLI at all
and does not compare CLI-vs-MCP shapes, so it does not contradict the
report's specific, narrower claim ("zero test anywhere exercises the CLI's
`--expect-status` flag... zero test asserts the CLI's and MCP's conflict-
error shape are the same schema"). The report's claim, read literally, holds
exactly as stated. A more complete report would have named this adjacent
file to show its search was aware of it and distinguished it explicitly,
rather than leaving an auditor to find it independently — a minor
completeness gap in the report's own write-up, not a factual error.

### (a.5) Reproducing the fix and the regression suite

```
$ node packages/quay-native/test/abi-symmetry.mjs | tail -20
...
"task_write_cas_conflict_shape": {
  "cliKeys": ["actualStatus","error","expectedStatus","id","message"],
  "mcpKeys": ["actualStatus","error","expectedStatus","id","message"],
  "cliIsError": true, "mcpIsError": true,
  "cliExpectedStatus": "todo", "mcpExpectedStatus": "todo",
  "cliActualStatus": "ready", "mcpActualStatus": "ready",
  "match": true
}
ALL FOUR SURFACES SYMMETRIC

$ node --test packages/*/test/*.test.mjs 2>&1 | tail -8
ℹ tests 28
ℹ pass 28
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Both reproduced exactly as claimed.

### (a.6) This audit's own first-party adversarial break/restore

Independently located the CLI's CAS wiring in `packages/quay-native/bin/
quay-native.js` line 134 and disabled it:

```
- if (flags["expect-status"] !== undefined) patch.expectedStatus = flags["expect-status"];
+ if (false && flags["expect-status"] !== undefined) patch.expectedStatus = flags["expect-status"];
```

```
$ timeout 20 node packages/quay-native/test/abi-symmetry.mjs
EXIT CODE: 124
quay-native mcp: serving tasks from /tmp/quay-abi-DFYI7D
Error: expected CLI CAS conflict to exit non-zero, but it succeeded
    at main (file:///home/yale/work/quay/packages/quay-native/test/abi-symmetry.mjs:216:13)
```

Matches the report's own adversarial-verification log precisely, including
the exit-124/timeout artifact the report itself flagged and explained (the
script's unhandled-rejection cleanup path after throwing, not a masked
failure — independently confirmed: the failure message is printed clearly
*before* the hang).

```
$ cp /tmp/quay-native.js.audit-bak packages/quay-native/bin/quay-native.js
$ diff /tmp/quay-native.js.audit-bak packages/quay-native/bin/quay-native.js && echo IDENTICAL
IDENTICAL
$ git status --short
(clean)
$ node packages/quay-native/test/abi-symmetry.mjs | tail -3
ALL FOUR SURFACES SYMMETRIC
$ node --test packages/*/test/*.test.mjs 2>&1 | tail -8
ℹ tests 28
ℹ pass 28
ℹ fail 0
```

Repository restored byte-identical; full regression suite green; the new
check has real teeth — it is not tautological, and it independently
detects exactly the class of regression the report claims it detects.

### (a.7) Is the finding genuinely meaningful, or superficial?

Read both serialization sites side by side: the CLI's catch block
(`quay-native.js` ~line 147: `{error: "ConflictError", message, id,
expectedStatus, actualStatus}`) and the MCP server's catch block
(`mcp-server.js` ~lines 116-124: `structuredContent: {error: "ConflictError",
message, id, expectedStatus, actualStatus}`) are two **independently
hand-written** object literals with no shared serialization function between
them. This is exactly the class of code that silently drifts over time (a
future edit adding/renaming/reordering a field on one side without the
other) with no compiler or schema to catch it — the design doc's own
literal words ("same schema... CLI is the golden test harness") make this
gap a genuine violation of a stated invariant, not a hypothetical one. The
finding is real, not superficial: it closes exactly the kind of drift-prone,
hand-duplicated error-shape surface that a "symmetric ABI" claim is supposed
to guarantee, and the adversarial test proves the check has real
discriminating power (not just checking both sides produce *an* error, but
that the CLI's CAS logic actually fires at all).

---

## (b) Genuine meaningfulness assessment

**Genuinely meaningful, not superficial.** The gap was real (82 iterations
of zero coverage on an already-shipped, hand-duplicated error-serialization
surface), the fix directly targets the stated design invariant (§6's "same
schema" requirement, applied here to an error path rather than only the
happy path already covered by checks 1-4), and the adversarial verification
demonstrates the new check has actual teeth — it would catch a real class of
regression (CLI CAS wiring silently disabled or the two error shapes drifting
apart), not merely restate something already guaranteed by the code's
structure. The one imperfection is a write-up completeness gap, not a
substance gap: the report does not mention the adjacent, pre-existing
MCP-only CAS test in `mcp-server.test.mjs` (QN-043), which would have made
the "genuinely zero coverage" framing more precise (zero coverage
specifically of the *CLI* side and of *cross-surface* shape equivalence, not
zero coverage of CAS behavior in general, which was already decently tested
on the MCP side). This does not undermine the claim as stated, but a more
thorough report would have surfaced it proactively.

## (c) Refrained from unilateral convergence declaration?

Confirmed. `iteration-88.md`'s own header states "Status: complete, NOT
CONVERGED"; §11 explicitly states convergence is not satisfied under any
reading and explicitly defers: "No unilateral wind-down or convergence
declaration is taken by this iteration; the decision remains for
orchestrator/human sign-off, per iterations 85-87's own precedent." This is
correct practice, consistent with the experiment's standing discipline.

## (d) Whole-experiment convergence assessment (final audit before pause)

This is the third consecutive genuine V_instance movement (86, 87, 88), each
independently audited and confirmed accurate. Stepping back across all three
and the wider history:

**Layer 1 (V_instance, currently 0.6016, dual threshold 0.80):**

- `gate_correctness` (0.76) has been flat and independently confirmed
  ceilinged since iteration 20 — 68+ iterations with no credible fresh
  search producing a finding. This factor shows the strongest evidence of a
  genuine architectural ceiling in this experiment.
- `skeleton` (0.85) had two genuine movements (86, 87) after 8 flat
  iterations (78-85), and iteration 87's own exhaustive branch-by-branch
  enumeration (independently re-verified by iteration 87's own audit)
  demonstrated the specific check()/checkGate() discovery vein that
  produced every `skeleton` movement since iteration 55 is now genuinely
  exhausted — a narrower, well-scoped, well-evidenced claim.
- `abi_symmetry` (now 0.97) just had its first genuinely rigorous fresh
  search since iteration 35 (52+ iterations flat), and it immediately
  surfaced a real, previously-uncovered gap on the first attempt. This is
  the single most important new information this iteration adds to the
  whole-experiment picture: it is direct, independently-verified evidence
  against the hypothesis that V_instance overall is running out of runway.
  A factor being old and flat is not itself evidence of exhaustion if no
  rigorous fresh search has actually been performed — exactly the lesson
  iteration 88's own Reflection draws, and this audit's independent
  re-verification supports it.
- `skill_convergence` (0.96) remains genuinely never-moved in 88 iterations,
  but this iteration's negative result has a specific, articulable,
  independently-confirmed cause (the backlog is structurally exhausted of
  fresh non-adversarial `todo` material — confirmed directly against the
  live task files, not assumed) rather than a demonstrated ceiling on the
  factor itself. This means `skill_convergence`'s "flatness" is currently a
  fact about backlog *supply*, not a fact about the Skills' own headroom —
  an important distinction for whoever resumes this experiment: a fresh,
  genuine feature-authoring task (not manufactured) would be a legitimate,
  non-adversarial way to test this factor further, something this
  experiment has not had the opportunity to do in a long time.

Net effect: **the case that V_instance as a whole is near a ceiling is
weaker after iteration 88 than after iteration 87**, not stronger. Two of
the four factors (`skeleton`, `gate_correctness`) show real evidence of
local exhaustion on their specific discovery veins; one (`abi_symmetry`)
just demonstrated fresh headroom on first rigorous attempt; one
(`skill_convergence`) remains an open, supply-constrained question rather
than a settled ceiling. This is a genuinely mixed, evidence-based picture,
not a uniform "everything is exhausted" one — and it should not be
mistaken for one by whoever resumes.

**Layer 2 (V_meta, currently 0.0973, dual threshold 0.80):** flat for six
consecutive iterations (83-88), independently confirmed, an order of
magnitude below threshold. All three of iterations 86-88's movements were
pure instance-layer test-coverage work with zero methodology/Skill-content
change — none touched `completeness`, `effectiveness`, `reusability`, or
`validation`. Under a strict dual-threshold reading, or any reading that
takes V_meta seriously as a joint requirement (§7's stated dual criterion,
not merely the "Practical Convergence" informal framing this experiment has
also used since iteration 12/16), **the experiment is not remotely close to
convergence**, and has not been for a long time. The V_instance-side
movements of the last three iterations, while genuine, do not address this
gap in any way, and there is no evidence in the last six iterations of any
attempted methodology-layer work at all (a legitimate scoping choice each
iteration made explicitly, but one that means V_meta's flatness reflects
absence of attempted work more than a demonstrated ceiling — a materially
different situation from `gate_correctness`'s, which has had genuine
attempts fail to move it).

**Overall assessment for whoever resumes after this pause**: the
experiment has NOT converged and should not be treated as near convergence
under either the strict dual-threshold criterion or a "diminishing returns
on V_instance" criterion (V_instance has genuinely moved 3 iterations
running, and this iteration's own evidence suggests remaining V_instance
headroom, at minimum in `abi_symmetry`'s two explicitly-flagged, unexplored
leads — filter-value equivalence and error-reporting-mode reconciliation for
`task_get`/`task_check` — and possibly in `skill_convergence` if a genuine
new feature-authoring opportunity arises). The clearest, most actionable
open question for the next session is **not** "is V_instance exhausted"
(the honest answer, based on three iterations of real evidence, is "no, not
yet, though two of four factors show local exhaustion on their specific
discovery veins") but rather **whether this experiment should begin
investing in V_meta-layer work at all**, since V_meta has been completely
untouched for six iterations and is an order of magnitude below threshold —
if the human's intent in pausing is to reconsider the experiment's overall
shape, this is the single most important structural fact to carry forward:
continued V_instance-only iterating, however genuine each individual finding
is, cannot by itself move this experiment toward the stated dual-threshold
convergence criterion.

## (e) Verdict

**PASS.**

All concrete, checkable claims in iteration 88's report were independently
re-verified and found accurate: the σ/V_instance/V_meta arithmetic (and its
consistency across the full 85-88 trajectory), the zero-production-diff
claim, the CLI-vs-MCP CAS-shape "never tested" claim (confirmed exactly as
stated, with one adjacent pre-existing MCP-only CAS test surfaced by this
audit that the report's own write-up should have named but whose omission
does not make the report's stated claim inaccurate), the adversarial
break/restore (independently reproduced with an identical failure mode and
byte-identical restore), and the `skill_convergence` backlog claim
(independently confirmed against the live task files: exactly QN-017/020/
021/022 are non-done, and QN-021 is genuinely, deliberately structurally
unsatisfiable, already fully driven at iteration 8). The precedent citations
for scoping the manda-dispatch staleness observation out of
`skill_convergence`/`completeness` credit (iteration 61's reverted credit;
iterations 79/80's "analytically distinct" reasoning) were independently
read in full and confirmed genuine, not fabricated or misapplied. The
iteration correctly refrained from declaring convergence.

**Recommended post-hoc correction (does not affect this PASS verdict, and
does not require touching iteration-88.md/provenance.md per this audit's own
scope restriction)**: a future iteration's report-writing practice should
explicitly name and distinguish `packages/quay/test/mcp-server.test.mjs`'s
own pre-existing MCP-only CAS-conflict coverage (QN-043) when making
"zero coverage" claims about a related surface, to make the precise scope
of "what was and wasn't already covered" fully legible to an auditor without
requiring independent re-discovery. This is a documentation-quality
observation, not a substantive error, and does not change this iteration's
verdict or its σ/V arithmetic.

## Artifacts reviewed

- `docs/proposal/quay-bootstrap-experiment.md`, `docs/proposal/quay-native-
  design.md` §6
- `experiment/iterations/iteration-88.md`, `iteration-87.md`, `iteration-8.md`,
  `iteration-61.md`, `iteration-79.md`, `iteration-80.md`
- `experiment/audits/iteration-87-independent-adjudicate.md`, `iteration-61-
  independent-adjudicate.md`, `iteration-79-independent-adjudicate.md`,
  `iteration-80-independent-adjudicate.md`
- `experiment/provenance.md` (new iteration-88 entries)
- `tasks/QN-074.md`, `tasks/QN-021.md`
- `git show e307882` (full diff and `--stat`)
- `packages/quay-native/test/abi-symmetry.mjs`, `packages/quay-native/bin/
  quay-native.js`, `packages/quay-native/src/mcp-server.js`,
  `packages/quay-native/test/cas-write.test.mjs`, `packages/quay/test/
  mcp-server.test.mjs`
- Full regression suite (`node --test packages/*/test/*.test.mjs`) and
  `abi-symmetry.mjs`, reproduced directly
- This audit's own first-party adversarial break/restore of `quay-
  native.js`'s `--expect-status` wiring
