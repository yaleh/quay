# Iteration 66 — Independent Out-of-Band Audit (G3)

**Auditor:** independent session, fresh context (no prior iteration-66 context carried in). All commands in this report were personally re-run against the working tree at commit `872b1b8` ("Iteration 66: close Core-layer taskCheck() passthrough test gap (QN-069)").

**Scope:** `experiment/iterations/iteration-66.md` and the corresponding `experiment/provenance.md` update, per the 10-point audit checklist in the dispatch, cross-checked against `docs/proposal/quay-bootstrap-experiment.md` §5.1/§5.2 and the QN-068/iteration-64 precedent.

**Verdict: PASS**

---

## 1. Diff matches claims

```
$ git show 872b1b8 --stat
 experiment/iterations/iteration-66.md  | 456 +++++++++++++++++++++++++++++++++
 experiment/provenance.md               | 150 +++++++++++
 packages/quay/test/task-check.test.mjs |  43 +++-
 tasks/QN-069.md                        | 144 +++++++++++
 4 files changed, 792 insertions(+), 1 deletion(-)
```

Confirmed: `tasks/QN-069.md` newly created; `packages/quay/test/task-check.test.mjs` modified (43 lines, test-only); no file under any `packages/*/src/` touched. Read the actual diff to `task-check.test.mjs` (not just the stat): it adds two genuinely new assertion blocks after the existing PASS-1/FAIL-1 cases —

- A task hand-edited on disk from `status: todo` to `status: needs-human`, then `client.taskCheck("NH-1")` asserted to return exactly `{gate:"none", ok:false, reason:"soft stop; human action required"}`.
- A second task hand-edited to `status: bogus-status-value`, then `client.taskCheck("BAD-1")` asserted to return exactly `{gate:"unknown", ok:false, reason:"unrecognized status bogus-status-value"}`.

Both assertions call `client.taskCheck(id)` — i.e. `packages/quay/src/provider-client.js#taskCheck()` — which round-trips over a real stdio MCP connection (`connectProvider` → `StdioClientTransport` → `client.callTool({name:"task_check",...})`), not a direct function call into `store.js`. This is a genuinely different code path from QN-068's tests (see §2).

## 2. "Genuinely new angle" vs. QN-068 — verified, not a disguised re-do

Read `tasks/QN-068.md` and `tasks/QN-069.md` in full, and the actual test diffs from both commits.

```
$ git show bd7f047 --stat
 packages/quay-github/test/gate.test.mjs            |  31 +
 packages/quay-native/test/gate-correctness.test.mjs|  52 ++
 ... (plus iteration-64.md, provenance.md, QN-068.md)

$ git show bd7f047 --stat | grep -E "packages/(quay|quay-native|quay-github)/src"
(no output — zero src/ files touched by QN-068)
```

QN-068's new test cases (`gate-correctness.test.mjs`, `gate.test.mjs`) call `store.check(id)` and `checkGate(task)` **directly** — plain function calls against in-process objects, no MCP transport, no Core package involved at all. QN-069's new test cases call `client.taskCheck(id)` on a `connectProvider()`-returned client, which is Core's `packages/quay/src/provider-client.js` — a `callTool()` round-trip over `StdioClientTransport` to a real `quay-native mcp` child process, then unwraps `r.structuredContent`.

These are verifiably different code paths:
- QN-068 exercises `store.js#check()`'s status-dispatch `if/else if` chain directly.
- QN-069 exercises that same chain **plus** the MCP protocol serialization/deserialization, `structuredContent` unwrapping, and Core's own `taskCheck()` wrapper — none of which QN-068's tests touch or could regression-protect. A hypothetical future bug in `provider-client.js#taskCheck()` (e.g., accidentally special-casing `ok:false`, or dropping the `gate` field before returning) would not be caught by any QN-068 test, only by QN-069's.

Also independently confirmed the specific factual claim in both task files — that `mcp-server.test.mjs` line 288's use of the literal `"needs-human"` never calls `task_check`:

```
$ sed -n '275,300p' packages/quay/test/mcp-server.test.mjs
```
shows `"needs-human"` used only as an arbitrary `status` value in a `task_write` CAS-conflict test (`expectedStatus: "ready"` mismatch check); no `task_check`/`taskCheck()` call appears in that block. Claim confirmed accurate.

**Conclusion: the gap is genuinely new, not a relabeled repeat of QN-068.** Same two response *shapes*, different *layer* (Core passthrough vs. Provider-direct), verifiably distinct code path and distinct regression-protection surface.

## 3. Live test run (personally executed)

```
$ node --test packages/*/test/*.test.mjs 2>&1 | tail -15
...
PASS: Core's taskCheck() passthrough surfaces the needs-human soft-stop shape unchanged (got: {"id":"NH-1","gate":"none","ok":false,"reason":"soft stop; human action required"})
PASS: Core's taskCheck() passthrough surfaces the unrecognized-status shape unchanged (got: {"id":"BAD-1","gate":"unknown","ok":false,"reason":"unrecognized status bogus-status-value"})

All QN-027/QN-069 taskCheck passthrough tests passed.
✔ packages/quay/test/task-check.test.mjs (1677.321797ms)
ℹ tests 26
ℹ suites 0
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 22634.152547
```

**26/26 passing, confirmed verbatim, matching the claim exactly.**

Read `packages/quay-native/src/store.js` lines 460-476 directly (the restored, current state):

```
    if (t.status === "needs-human") {
      return { id, gate: "none", ok: false, reason: "soft stop; human action required" };
    }
    return { id, gate: "unknown", ok: false, reason: `unrecognized status ${t.status}` };
```

This matches exactly what QN-069's new test asserts and what `taskCheck()` is claimed to forward unchanged. The claimed adversarial-verification failure message (`{"gate":"unknown","reason":"unrecognized status needs-human"}` when the `needs-human` branch is removed) is fully plausible given this code: removing the `if (t.status === "needs-human")` branch would fall through directly to the `unrecognized status` return, producing exactly that shape. The claim is internally consistent with the actual, current source and does not require re-breaking the code to verify (which would risk leaving unintended residue) — the logic is deterministic and the fall-through path is visible in the unmodified file.

## 4. ABI symmetry check (personally executed)

```
$ node packages/quay-native/test/abi-symmetry.mjs 2>&1 | tail -1
ALL FOUR SURFACES SYMMETRIC
```

Full output confirms `task_list`, `task_get`, `task_write` (+ two value-equivalence checks), and `task_check` all report `"match": true` for CLI vs. MCP surfaces. Matches the claim exactly.

## 5. `skeleton` V_instance factor scrutiny

§5.1's exact defining language:

> **skeleton** | The v0 loop runs end-to-end (`config → mcp → serve → action → Skill → done`).

Taken literally, this is a one-time boolean fact about the v0 loop, not an incrementable score. However, `experiment/provenance.md`'s own running history shows this factor has been used, since at least iteration 25 and consistently since iteration 54, as a `0.0X`-scale accumulator for "runtime-exercised, adversarially-verified, zero-source-diff test-coverage closures" — a documented convention drift from the literal §5.1 text, not something iteration 66 invented. This drift itself was flagged and scrutinized by the iteration-64 audit (`experiment/audits/iteration-64-independent-adjudicate.md`, quoting iteration-64's own §10 item 1: "whether the `skeleton +0.01` credit is genuinely distinguishable from `gate_correctness`") and was found to be "a genuine, disclosed close call, not a concealment," resulting in a PASS.

Closest precedent: iteration 64's QN-068 credit, `skeleton +0.01 (0.79 → 0.80)`, for closing the needs-human/unrecognized-status gap **directly against each Provider's own gate function**. Iteration 66's credit, `skeleton +0.01 (0.80 → 0.81)`, closes the **same two response shapes** but **one layer up**, through Core's `taskCheck()` passthrough — a distinct code path per §2 above.

**Judgment:** this is not double-counting the same underlying gap-class. QN-068 closed "does the Provider's own gate function return the right shape for these two branches" (a Provider-internal-logic question). QN-069 closes "does Core's generic MCP passthrough forward that shape unchanged, end-to-end over a real connection" (a Core/transport-fidelity question) — a distinct regression-protection surface that QN-068's tests structurally cannot cover (they never invoke Core's package at all, confirmed by the `bd7f047 --stat` zero-`packages/quay/` result in §2). The credit is proportionate to the established convention (each iteration in the 54-66 streak has taken exactly one incremental `+0.01` for one verifiably distinct closure) and is not a relabeling of iteration 64's work.

One residual concern, already flagged transparently by iteration 66's own report (§7, "abi_symmetry explicitly considered and rejected... it is a passthrough-fidelity claim... already the established boundary for gate_correctness reasoning") and by the standing chain of self-scrutiny since iteration 64: the ongoing ambiguity between `skeleton` and `gate_correctness` as the "correct" bucket for this closure-class is not fully resolved by protocol text, only by iterated precedent. This is a pre-existing, previously-audited-and-accepted condition of the experiment, not a new defect introduced by iteration 66 — no correction warranted on this point alone, consistent with iteration 64's and iteration 65's audits reaching the same conclusion for structurally identical situations.

## 6. V_meta "no movement" reasoning

Iteration 66's own reasoning (quoted from `provenance.md`) argues, factor by factor:
- **completeness** — no Method/Skill content edited; the change is one test file. No fit.
- **effectiveness** — no scope-matched timing comparator exists for a passthrough-fidelity unit test. No fit.
- **reusability** — the change touches zero GitHub-Provider content (Core + native only). No fit.
- **validation** — reserved for this very out-of-band audit; σ tracks task-completion state, and while σ did move (a task went from not-existing to done), the `validation` V-factor as defined tracks the self-host proof mechanism itself, not each individual σ increment — consistent with how iterations 62-65 treated their own σ-incrementing, test-only closures. No fit.

Independently re-derived: none of the four factors' §5.2 defining language ("Methodology... fully documented," "speedup building feature N+1," "transfers to a second Provider," "self-host proof: σ and the provenance log") plausibly stretches to cover a single-file, zero-source-diff, Core-scoped regression test. Consistent with the identical judgment independently reached by the iteration-64 and iteration-65 audits for structurally identical closures. **No missed credit, no unclaimed overreach found in the other direction.**

## 7. σ arithmetic and QN-069 provenance fields

```
$ ls tasks/*.md | wc -l
68
```

Denominator matches the claimed `61/68`. Task file front matter:

```
$ grep -n "id: QN-069\|status:" tasks/QN-069.md | head -3
id: QN-069
status: done
```

`experiment/provenance.md`'s iteration-66 table row:

| Task | author_by | execute_by | gate_by | Status |
|---|---|---|---|---|
| QN-069 | native | native | native | done |

Full `{native, native, native}` provenance confirmed, `status: done` confirmed. σ progression across the provenance log's tail is a consistent +1/+1 ladder (59/66 → 60/67 → 61/68), internally consistent with one new qualifying task added.

Arithmetic independently recomputed:
```
$ python3 -c "print(61/68)"
0.8970588235294118   →  0.8971 ✓ (rounds correctly, matches claim)
$ python3 -c "print(0.81*0.96*0.76*0.96)"
0.56733696           →  0.5673 ✓ (V_instance, matches claim)
$ python3 -c "print(0.74*0.26*0.79*0.64)"
0.09727744           →  0.0973 ✓ (V_meta, matches claim, unchanged)
```

## 8. Final git status clean check (personally executed)

```
$ git status --short
?? docs/proposal/baime-lite-driving-external-projects.md
?? docs/proposal/quay-core-bootstrap-experiment-v2.md
?? experiment/directives/pending/
```

Matches the claim exactly: the two pre-existing untracked `.md` files, plus the untracked `experiment/directives/pending/` directory. Confirmed the directory's actual contents:

```
$ ls -la experiment/directives/pending/
DIR-014-arm-manda-monitor-in-driving-session-and-continue-nested-subagent-audit-exploration.md
```

**This directory is not empty** — it contains one file, `DIR-014-...md`. The task prompt's framing ("an EMPTY untracked directory... expected/harmless, not new content") does not match what is actually on disk: `pending/` currently holds a real, substantive pending directive file (dated the same day, 01:15, one minute before the 872b1b8 commit at 01:17). This is a discrepancy between the audit brief's framing and ground truth, but it is **not a claim iteration 66's own report makes** — iteration 66's own §2 preconditions check states `ls experiment/directives/pending/` was `(empty)` **at the start of the iteration** (re-verified per instructions), which is a different point in time than "now." A directive (DIR-014) could legitimately have been dropped into `pending/` after iteration 66 completed and before this audit ran, by a separate process (the top-level orchestrator or a concurrent session), which is consistent with `git status --short` showing it as untracked (never committed by 872b1b8) rather than as a stray uncommitted change from iteration 66's own work.

**Verified this is not iteration-66-introduced content:**
```
$ git show 872b1b8 --stat | grep -E "directives/pending"
(no output — 872b1b8 does not touch experiment/directives/pending/ at all)
```
Confirmed: `pending/`'s current non-empty state is unrelated to and not created by commit 872b1b8. Iteration 66's own claim ("empty at the start of this iteration") is accurate for its own timeframe and is not contradicted. The task-prompt's characterization of the directory as empty reflects a stale snapshot, not a discrepancy in iteration 66's reporting. No correction to iteration-66.md or provenance.md is warranted on this point.

## 9. Pre-existing untracked files not modified

```
$ git show 872b1b8 --stat | grep -E "docs/proposal"
(no output)
```

Confirmed: neither `docs/proposal/baime-lite-driving-external-projects.md` nor `docs/proposal/quay-core-bootstrap-experiment-v2.md` appears anywhere in `872b1b8`'s stat. Neither was touched, staged, or committed by this iteration.

## 10. provenance.md ledger entry

Read the tail of `experiment/provenance.md` directly (see full quote captured during this audit). Confirmed it contains a new `## Iteration 66: QN-069 — ...` section with:
- The provenance table row (§7 above).
- σ_strict = 61/68 = 0.8971 (up from 60/67 = 0.8955).
- The "genuinely new angle, not a repeat of QN-068" reasoning, citing `git show --stat bd7f047 -- packages/` showing zero `packages/quay/` files touched — independently re-verified true in §2 above.
- Verbatim adversarial-verification failure output and the restored-and-passing re-run.
- V_instance factor-by-factor reasoning (`skeleton +0.01`, others explicitly considered and rejected) and the computed product 0.5673.
- V_meta factor-by-factor reasoning (all four held flat) and the unchanged product 0.0973.

All of this is consistent with `experiment/iterations/iteration-66.md`'s own §6-§8 (Provenance update, V_instance, V_meta sections), which were also read in full during this audit and match the provenance.md recap verbatim in figures and near-verbatim in reasoning prose.

---

## Overall recommendation

**PASS.** Every claim in the iteration-66 commit was independently re-verified against the actual repository state: the diff stat and content match exactly (task-only + test-only, zero src/ change); the "genuinely new angle vs. QN-068" claim survived scrutiny of the actual code paths (Core's MCP-transport passthrough vs. each Provider's direct gate function — verifiably distinct); the full regression suite was personally re-run and produced 26/26 passing with the exact claimed PASS lines for both new test cases; the ABI-symmetry script was personally re-run and produced the exact claimed "ALL FOUR SURFACES SYMMETRIC" output; σ/V_instance/V_meta arithmetic was independently recomputed and matches to the stated precision; QN-069's provenance fields are genuinely `{native, native, native}`/`done`; the final `git status --short` matches the claim for the two pre-existing untracked files, modulo one immaterial framing discrepancy (`experiment/directives/pending/` currently holds a DIR-014 file rather than being empty, but this is unrelated to and not introduced by commit 872b1b8, and iteration 66's own claim was scoped to "empty at start of iteration," which remains accurate).

**No post-hoc correction to `iteration-66.md` or `provenance.md` is required.** The skeleton-credit convention-drift concern (§5) is a pre-existing, previously-disclosed, and previously-audited-and-accepted condition of this experiment (first substantively surfaced and PASSed at iteration 64), not a new or iteration-66-specific overreach — re-litigating it here would duplicate the iteration-64 audit's already-settled judgment rather than find new grounds. The one factual note worth carrying forward (§8) is that `experiment/directives/pending/` is not currently empty (it holds `DIR-014-...md`), which the *next* iteration or directive-processing session should account for — this is an FYI for forward planning, not a defect in iteration 66's own reporting, and does not rise to the bar for a strikethrough-style post-hoc correction.
