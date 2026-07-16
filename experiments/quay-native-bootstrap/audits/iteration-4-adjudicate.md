# Iteration 4 — same-session adjudicate check (NOT independent — see honesty note)

**IMPORTANT HONESTY NOTE, read first, exact same structural caveat as
iterations 0/1/2/3:** this document is a **same-session mechanical/
adversarial re-check**, performed by the same session that did this
iteration's execution work. It is **not** a genuinely independent audit.
The real, independent, out-of-band audit that satisfies protocol §7
criterion 4 happens **externally** — the orchestrator (a separate
top-level process) dispatches a fresh, zero-context subagent after this
iteration completes, exactly as was done after iterations 1, 2, and 3
(`experiments/quay-native-bootstrap/audits/iteration-{1,2,3}-independent-adjudicate.md`). That
external document is what actually resolves criterion 4 for this
iteration's work, not this file.

**Re-confirmed this iteration, not assumed:** no subagent-dispatch
primitive exists in this environment (fifth consecutive iteration
confirming this; not re-derived from `ToolSearch` fresh this pass since
the deferred-tool list surfaced during the session already showed no
dispatch-capable tool — consistent with prior iterations' findings, and
no new tool of that shape has appeared).

**Tasks audited:** QN-002 (`ready → done`, this iteration's sole task
transition), plus the standing tasksDir bug fix (not itself a tracked
task, but a concrete deliverable this iteration).

## Step 0 — incorporating iteration-3-independent-adjudicate.md's finding

Re-reading `experiments/quay-native-bootstrap/audits/iteration-3-independent-adjudicate.md`
directly: verdict was PASS on QN-007/QN-002 (as authored), with one
non-blocking bug flagged: default `tasksDir` resolves to
`process.cwd()+"/tasks"`, causing silent misresolution when
`quay-native` is run from `packages/quay-native/` without
`QUAY_NATIVE_TASKS_DIR` set.

**Re-derived verdict on the fix, via a fresh adversarial break/restore in
this same-session pass (not merely trusting my own earlier-in-session
claim):** temporarily replaced `findRepoRoot`'s body with `return null;`
(forcing the old fallback path), then ran `quay-native task list` from
`packages/quay-native/` with no env var set:

```
$ node bin/quay-native.js task list
V-1	todo	primitive	verify extra bug
```

This reproduces the *exact* originally-reported symptom: silently
resolving into the stray, near-empty `packages/quay-native/tasks/`
directory (containing only a leftover `V-1` test artifact from an earlier
manual smoke test) instead of the real repo-root `tasks/` (which holds
QN-001..QN-007). Restored the fix, re-ran:

```
$ node bin/quay-native.js task list
QN-001	done	primitive	...
QN-002	done	primitive	...
... (all 7 real tasks)
```

Re-ran the full regression suite (`abi-symmetry.mjs`,
`gate-correctness.test.mjs`, `lock.test.mjs`) after restoring: all three
exit 0, no regressions.

**Verdict: the tasksDir fix is genuinely correct and minimal** — a single
upward directory walk for `.quay/config.yml`, falling back to the old
behavior when no workspace marker is found (preserves standalone-use
compatibility), with the explicit-env-var override path completely
unchanged.

## Step 1 — audit depth

QN-002's execution phase involved real, substantial new code (a full new
package, `packages/quay-github/`, plus two files in `packages/quay/`
changed to support provider selection) — **depth = full**.

## Step 2 — independent (same-session) re-derivation

### QN-002 — GitHub Provider execution

1. Fresh `task check QN-002 --json` (post-done): `{"gate":"none",
   "ok":true,"reason":"terminal"}` — confirms `done`, terminal gate,
   consistent with a task that has completed its lifecycle.
2. Re-ran `gh auth status` fresh in this audit pass: confirms user
   `yaleh`, scopes include `repo` and `workflow` — precondition genuinely
   held before any Provider code ran, not merely asserted.
3. Re-verified the repo is real and reachable: `gh repo view yaleh/quay
   --json visibility,url` returns `{"visibility":"PRIVATE","url":
   "https://github.com/yaleh/quay"}` — matches the claimed repo/
   visibility exactly.
4. Re-verified the 4 issues are real, not fabricated: `gh issue list -R
   yaleh/quay --state all --json number,title,labels,state` returns 4
   real issues matching the claimed numbers/labels/states (#1,#2 closed;
   #3 open with `status:ready`+`lane:execution`; #4 open, unlabeled beyond
   defaults).
5. **Adversarial re-break of `github-client.js`'s own bug fix** (the
   missing `-X GET` before `-f state=all`, originally found and fixed
   this iteration): removed `-X`/`"GET"` from the `gh api` args array,
   re-ran `createGithubClient({owner:'yaleh',repo:'quay'}).list()` fresh
   in this audit pass — reproduced the exact original failure (`gh api`
   defaults to POST, HTTP 422 "title wasn't supplied"). Restored the
   fix, re-ran: returns all 4 issues correctly mapped
   (`gh-4:todo, gh-3:ready, gh-2:done, gh-1:done`). This proves the fix
   is real and necessary, not merely present in the diff.
6. Re-ran the Core CLI parity proof fresh, independently diffing key sets
   (not just re-reading the earlier-in-session output): `quay task list
   --provider native --json` and `quay task list --provider github --json`
   both return arrays of objects with the same core key set (`id, title,
   status, labels, parent, children, role, extra, body`); the github
   provider additionally includes `lane` (an additive, non-conflicting
   extension of the shape, consistent with the canonical view-model's
   documented purpose for optional fields — not a schema mismatch).
   `quay task view gh-3 --provider github --json` returns the real issue
   #3 body verbatim.
7. Re-checked for scope creep / gold-plating (G5): `grep -n "task_write\|
   task_check" packages/quay-github/src/mcp-server.js` → no matches —
   confirms the v1 Provider genuinely registers only `task_list`/
   `task_get`/`provider://manifest`, no write/gate tools, matching
   `provider.yml`'s `data.write: false, gate: false, skill: false`.
8. Re-checked `packages/quay/src/provider-client.js` is byte-for-byte
   untouched this iteration (it is the file making the strongest claim —
   "the ABI-consuming client code needed zero changes"): confirmed via
   `git status --short packages/quay/src/provider-client.js` showing no
   change relative to the iteration-3 commit (the file is tracked as of
   the `5b452aa` commit and shows no diff).

**Verdict: `done` gate genuinely earned.** Both the new Provider's own
bug (the `gh api` method bug) and the standing native-side tasksDir bug
were independently re-proven via fresh break/restore cycles in this same
audit pass, not merely re-read from earlier-in-session claims. The
Core-needs-zero-changes claim holds for `provider-client.js` specifically
(the actual MCP client) — the CLI wiring extension
(`config.js`/`bin/quay.js`) is honestly reported as a separate,
provider-agnostic addition, not conflated with "zero changes anywhere."

## Step 3 — verdicts summary

```
QN-002:            done — genuinely earned (full-depth re-derivation;
                    both this iteration's own new bug (gh api method) and
                    the standing tasksDir bug independently re-proven via
                    fresh adversarial break/restore cycles; Core CLI
                    parity re-confirmed with fresh command output, not
                    reused output)
tasksDir fix:       genuinely correct (adversarially re-broken and
                    restored in this pass; regression suite green
                    before and after)
```

## Limitation (honesty note, repeated per G3/G4 — do not skip this)

Same structural limitation as iterations 0-3: this document was produced
by the same session that did the execution work this iteration, not a
genuinely separate, fresh-context dispatched subagent. No mechanism to
produce one exists in this harness.

**This file is NOT a substitute for a real, independent, out-of-band
audit.** The orchestrator is expected to separately dispatch a genuinely
independent subagent (as was done producing
`experiments/quay-native-bootstrap/audits/iteration-{1,2,3}-independent-adjudicate.md`) after
this iteration's work is complete. Protocol §7 criterion 4 is not
satisfied by this document alone.

**On criterion 3 ("contract proven — native AND GitHub both run"):** this
same-session check finds strong, concrete evidence this criterion is now
met (native runs, GitHub Provider runs, Core CLI parity demonstrated
live against both, with fresh adversarial re-verification of the two
bugs found and fixed along the way). Per G4, **this finding alone does
not constitute overall convergence** — criterion 3 is one of five
protocol §7 criteria, and dual V thresholds, σ→1, and independent
out-of-band audit sign-off are still outstanding. See
`experiments/quay-native-bootstrap/iterations/iteration-4.md`'s Convergence Check section for
the full accounting.
