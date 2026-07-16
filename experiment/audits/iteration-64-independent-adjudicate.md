# Iteration 64 — Independent Out-of-Band Audit (G3)

**Auditor:** independent session, fresh context (no prior iteration-64 context carried in); all commands in this report were personally re-run against the working tree at commit `bd7f047` ("Iteration 64: close the gate's untested needs-human/unrecognized-status branches (QN-068)").

**Scope:** `experiment/iterations/iteration-64.md` and the corresponding `experiment/provenance.md` update, per the audit task's 6-point checklist in the dispatch.

**Verdict: PASS**

---

## 1. New test coverage — verified

Both new test cases exist in both files, exactly as claimed:

- `packages/quay-native/test/gate-correctness.test.mjs`: cases `GC-F` (needs-human) and `GC-G` (unrecognized status, via on-disk frontmatter patch).
- `packages/quay-github/test/gate.test.mjs`: case `k` (needs-human) and case `l` (unrecognized status, via a literal passed directly to `checkGate()`).

**No prior test asserted either response shape, on either Provider**, confirmed independently three ways:

```
$ grep -rn "soft stop" packages/*/test/*.mjs
packages/quay-github/test/gate.test.mjs:107:  // QN-068 (iteration 64): the needs-human soft-stop branch and the final
...
packages/quay-native/test/gate-correctness.test.mjs:126: needs-human soft-stop branch has never been directly...
(only iteration-64-added occurrences; no pre-existing hits)

$ git log --all --oneline -S "soft stop" -- packages/
bd7f047 Iteration 64: close the gate's untested needs-human/unrecognized-status branches (QN-068)
1f3e27d Iteration 17: implement quay-github's gate capability (QN-028)
dd8fc63 Iteration 8: correct V_meta to protocol product formula, exercise executeEpic's needs-human branch, tighten author->ready gate
6761d5a Iteration 7: recursive compound-gate fix (QN-016) + first genuine needs-human exercise (QN-017)
5b452aa Add quay-native and quay Core v0-v1 walking skeleton, experiment scaffold

$ git log --all --oneline -S "unrecognized status" -- packages/
bd7f047 Iteration 64: close the gate's untested needs-human/unrecognized-status branches (QN-068)
0c26153 Iteration 63: close unrecognized-status-label precedence fallback gap (QN-067); skeleton +0.01
1f3e27d Iteration 17: implement quay-github's gate capability (QN-028)
5b452aa Add quay-native and quay Core v0-v1 walking skeleton, experiment scaffold
```

None of the pre-`bd7f047` commits touch `packages/*/test/*.mjs` with these strings — the earlier hits (iterations 7, 8, 17) are all in *source* (`store.js`, `github-client.js`) or narration in iteration reports, not test files. Directly diffed the prior test-file content to be certain:

```
$ git show fa94a10:packages/quay-native/test/gate-correctness.test.mjs | grep -n "needs-human\|unknown\|soft stop"
(no output)
$ git show fa94a10:packages/quay-github/test/gate.test.mjs | grep -n "needs-human\|unknown\|soft stop"
(no output)
```

(`fa94a10` is the commit immediately preceding `bd7f047`.) Confirmed: **zero prior test-file hits on either Provider.** The claim is accurate.

**Full suite run (personally executed):**

```
$ node --test packages/*/test/*.test.mjs 2>&1 | tail -8
ℹ tests 26
ℹ suites 0
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 22873.945047

$ node packages/quay-native/test/abi-symmetry.mjs 2>&1 | tail -2
ALL FOUR SURFACES SYMMETRIC
```

Matches the claimed 26/26 and ABI-symmetry result exactly.

## 2. Adversarial-verification claim — independently reproduced

Working tree was clean before starting (`git status --short` showed only the two pre-existing untracked docs, unrelated to this iteration). Backed up both source files, then removed the `needs-human` branch from each:

**Native — `store.js`, branch removed:**

```
$ node packages/quay-native/test/gate-correctness.test.mjs 2>&1 | grep -E "PASS|FAIL" | grep -i "GC-F"
FAIL: GC-F: needs-human task reports gate 'none'
PASS: GC-F: needs-human task gates ok:false (soft stop, not terminal-pass)
FAIL: GC-F: reason is the exact soft-stop text (got: unrecognized status needs-human)
```

**GitHub — `github-client.js`, branch removed:**

```
$ node packages/quay-github/test/gate.test.mjs 2>&1 | grep -E "PASS|FAIL" | grep -i "case k"
FAIL: case k: needs-human task reports gate 'none'
PASS: case k: needs-human task gates ok:false (soft stop, not terminal-pass)
FAIL: case k: reason is the exact soft-stop text (got: unrecognized status needs-human)
```

Both outputs are **byte-identical** to the report's own claimed adversarial output (§6 of iteration-64.md), including the "coincidental pass" of the `ok:false` assertion falling through to the unrecognized-status branch. Restored both files and confirmed zero diff:

```
$ cp /tmp/audit-store.js.bak packages/quay-native/src/store.js
$ cp /tmp/audit-github-client.js.bak packages/quay-github/src/github-client.js
$ git diff --stat -- packages/quay-native/src/store.js packages/quay-github/src/github-client.js
(no output)
$ node packages/quay-native/test/gate-correctness.test.mjs 2>&1 | tail -3
All gate-correctness tests passed.
$ node packages/quay-github/test/gate.test.mjs 2>&1 | tail -3
All QN-028 gate tests passed.
```

As an extra, stricter check not explicitly re-run in the report (but implied by its logic), I also independently broke the **"unrecognized status" fallthrough itself** (not just the `needs-human` branch) in `store.js`, to confirm case GC-G has real teeth on that side too:

```
$ node packages/quay-native/test/gate-correctness.test.mjs 2>&1 | grep -E "PASS|FAIL" | grep -i "GC-G"
FAIL: GC-G: unrecognized-status task reports gate 'unknown'
FAIL: GC-G: unrecognized-status task gates ok:false
FAIL: GC-G: reason names the exact unrecognized status value (got: terminal)
```

Restored and reconfirmed clean:

```
$ git diff --stat -- packages/quay-native/src/store.js
(no output)
$ node packages/quay-native/test/gate-correctness.test.mjs 2>&1 | tail -3
All gate-correctness tests passed.
```

Final full-suite and ABI re-run after all restores, and final tree state:

```
$ git diff --stat
(no output)
$ git status --short
?? docs/proposal/baime-lite-driving-external-projects.md
?? docs/proposal/quay-core-bootstrap-experiment-v2.md
$ node --test packages/*/test/*.test.mjs 2>&1 | tail -8
ℹ tests 26
ℹ pass 26
ℹ fail 0
$ node packages/quay-native/test/abi-symmetry.mjs 2>&1 | tail -2
ALL FOUR SURFACES SYMMETRIC
```

No temporary breakage was left committed or staged at any point. The adversarial-verification claim is **fully corroborated**, with an extra check (breaking the fallthrough branch itself) beyond what the report performed, which also behaved as expected.

## 3. Disclosed "bypass" techniques — accurately described

Read the actual test code for both unrecognized-status cases.

- **Native (`GC-G`, `gate-correctness.test.mjs`):** writes a valid `todo`-status task via `store.write()`, then reads the resulting on-disk file with `fs.readFileSync`, string-replaces `"status: todo"` with `"status: bogus-status-value"`, and writes it back with `fs.writeFileSync` — exactly "patching on-disk frontmatter directly," as claimed. This correctly simulates a hand-edited/corrupted task file, since `store.write()` itself enforces `VALID_STATUSES` (confirmed at `store.js` line 13/230) and would reject `"bogus-status-value"` if passed directly.
- **GitHub (case `l`, `gate.test.mjs`):** calls `checkGate({ id: "gh-12", status: "bogus-status-value", body: "..." })` directly — a bare literal passed straight into the pure function, with no write-path or validation layer involved at all, exactly "passing a bogus literal directly to the pure `checkGate()` function," as claimed.

Both techniques are disclosed inline in code comments in the test files themselves (not just the iteration report), and both are legitimate exercises of a genuinely reachable defensive branch: `check()`/`checkGate()` apply no status validation of their own (confirmed by reading the source — the dispatch chain is a plain `if`/`else if` on whatever string is in `status`), so any caller that bypasses the write-time guard (a corrupted file on disk, or a caller of the pure function that doesn't go through `store.write()`) can reach this branch in production. This is not exploiting a validation hole to fake a test pass — it is the intended, honestly-labeled way to reach a branch that structurally cannot be reached through the normal write path. No misrepresentation found.

## 4. QN-068 provenance and lifecycle — verified

`tasks/QN-068.md` contains full Proposal/Plan/AC/DoD sections (read in full), all four AC boxes and both DoD boxes checked. The provenance table row:

```
| QN-068 | Add unit test coverage for the gate's needs-human soft-stop and unrecognized-status fallback shapes, on both Providers | native | native | native | done |
```

The report's §7 shows a genuine gated walk, not a direct `status: done` write:

```
$ node .../quay-native.js task check QN-068 --json
{"gate":"author->ready","ok":true,...}
$ node .../quay-native.js task edit QN-068 --status ready
$ node .../quay-native.js task check QN-068 --json
{"gate":"execute->done","ok":true,"acTotal":4,"acChecked":4,...}
$ node .../quay-native.js task edit QN-068 --status done
$ node .../quay-native.js task check QN-068 --json
{"gate":"none","ok":true,"reason":"terminal"}
```

This is a genuine `todo → ready → done` gated transition sequence (each step gate-checked before the edit), matching the standing convention. The degraded-mode caveat (no subagent-dispatch primitive; all steps run in one session) is disclosed plainly, consistent with every prior iteration since iteration 1 — not a new or hidden concession.

## 5. σ / V-factor arithmetic — independently recomputed

```
$ ls tasks/QN-*.md | wc -l
67
```

Matches the claimed denominator. The provenance log's running strict-σ tally is monotonic and self-consistent across iterations: 59/66 (iter 63) → 60/67 (iter 64), i.e. +1 numerator and +1 denominator for the one new fully-`{native,native,native}` task (QN-068). This matches `ls tasks/QN-*.md | wc -l` exactly.

```
>>> 60/67
0.8955223880597015   # rounds to 0.8955, matches claim exactly
>>> 0.80*0.96*0.76*0.96
0.5603328            # rounds to 0.5603, matches claim exactly
>>> 0.74*0.26*0.79*0.64
0.09727744           # rounds to 0.0973, matches claim exactly (unchanged from iteration 63)
```

Note: `provenance.md`'s raw markdown table across its full history is a *cumulative running log* (each iteration appends its own recap section, not a single canonical master table), so a naive full-file grep for `native | native | native` rows over-/under-counts due to duplicated historical snapshots (e.g., QN-001–QN-006 appear repeatedly across early per-iteration recap tables). The authoritative figure is each iteration's own running tally (which increments consistently, +1/+1 per newly-qualifying task, iteration over iteration) cross-checked against the independent, unambiguous `ls tasks/QN-*.md | wc -l` denominator — both agree here. The skeleton factor bump (0.79 → 0.80) and the unchanged three other `V_instance` factors (0.96, 0.76, 0.96) and all four `V_meta` factors (0.74, 0.26, 0.79, 0.64) were independently confirmed against iteration 63's ending values, which match iteration 64's own "Context from prior iteration" §1 restatement.

## 6. The untracked file(s) — verified untouched

```
$ git show --stat bd7f047
...
 experiment/iterations/iteration-64.md              | 695 +++++++++++++++++++++
 experiment/provenance.md                           | 103 +++
 packages/quay-github/test/gate.test.mjs            |  31 +
 .../quay-native/test/gate-correctness.test.mjs     |  52 ++
 tasks/QN-068.md                                    | 146 +++++
 5 files changed, 1027 insertions(+)
```

Neither `docs/proposal/quay-core-bootstrap-experiment-v2.md` nor `docs/proposal/baime-lite-driving-external-projects.md` appears in this commit's file list. Confirmed both remain untracked in the current working tree, with no commit history at all:

```
$ git status --short
?? docs/proposal/baime-lite-driving-external-projects.md
?? docs/proposal/quay-core-bootstrap-experiment-v2.md

$ git log --oneline --all -- docs/proposal/quay-core-bootstrap-experiment-v2.md
(no output — never committed)
$ git log --oneline --all -- docs/proposal/baime-lite-driving-external-projects.md
(no output — never committed)
```

`quay-core-bootstrap-experiment-v2.md`'s on-disk mtime (`Jul 16 00:51`) falls between the DIR-012/DIR-013 commit (`fa94a10`, `00:43:28`) and iteration 64's own commit (`bd7f047`, `00:52:21`), consistent with the note that it appeared "around the same time" but was not created by, or touched by, iteration 64's own commit. Iteration 64's own report never opens, edits, or references this file. The claim that iteration 64 left it untouched and out-of-scope is **fully corroborated**.

---

## Overall assessment

All six verification points hold up under independent, from-scratch reproduction:

1. Four new test cases exist exactly as described; grep and `git log -S` across full history confirm no prior test asserted either response shape on either Provider; full suite is 26/26 green, matching the claim exactly.
2. The adversarial break/restore cycle was independently reproduced for both Providers' `needs-human` branch, byte-for-byte matching the report's claimed console output, with clean restores (`git diff --stat` empty) confirmed both by the report and independently by this audit. An additional, stricter check (breaking the unrecognized-status fallthrough itself, not performed explicitly in the report) also behaved correctly.
3. Both disclosed bypass techniques (on-disk frontmatter patch for native; bare literal to the pure function for GitHub) are accurately described and exercise a genuinely reachable, un-validated defensive branch — not a misrepresented validation hole.
4. QN-068's provenance triple (`native`/`native`/`native`) and its `todo → ready → done` gated lifecycle are genuine, each transition gate-checked before the edit, matching CLI output captured in the report.
5. All σ and V-factor arithmetic is exact (σ = 60/67 = 0.8955; V_instance = 0.5603; V_meta = 0.0973 unchanged), independently recomputed, with the task-count denominator (67) independently confirmed via `ls`.
6. Commit `bd7f047` touches only the five files it claims (iteration report, provenance, two test files, one task file); neither `quay-core-bootstrap-experiment-v2.md` nor `baime-lite-driving-external-projects.md` is part of it or any other commit in history — both remain untracked, exactly as claimed.

The one substantive judgment call flagged by the iteration itself (§10 item 1 in iteration-64.md: whether this belongs to `skeleton` or `gate_correctness`) is a genuine, disclosed close call, not a concealment — the a fortiori argument against the iteration-25 precedent is reasonable and consistently applied; this audit does not find grounds to override it, but concurs it is the correct item for a future iteration or human reviewer to keep scrutinizing if the precedent chain is ever revisited holistically.

No discrepancies, fabrications, or misrepresentations were found in any of the six checked areas.

**Verdict: PASS.**
