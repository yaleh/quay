# Iteration 47 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh, zero-prior-context out-of-band review. Read
`docs/proposal/quay-bootstrap-experiment.md` in full (§4-§8 especially),
`experiment/iterations/iteration-47.md` in full, the end of
`experiment/provenance.md` (the full "Iteration 47" section, including the
σ/V-factor writeups), and independently re-confirmed the seven prior
post-hoc corrections (iterations 25, 29, 31, 33, 34, 35, 36) and the
ten-consecutive-PASS streak (37-46) via `grep`/direct read of each audit
file's verdict line. Ran every command in the report directly against the
working tree: `gh issue view 3`/`gh issue view 4 --repo yaleh/quay`, `gh
issue list --repo yaleh/quay --state all`, `gh pr list --repo yaleh/quay
--state all`, `node packages/quay-native/bin/quay-native.js task list
--json` (non-`done` filter), a fresh full read of `packages/quay/
DESIGN.md` §2.5 and `packages/quay-github/DESIGN.md`'s complete section
list plus its §4/§5, `cat tasks/QN-017.md`/`QN-020.md`/`QN-021.md`/
`QN-022.md`, `grep -n "^\- \*\*Status"` on all four Status-line files,
`grep -rn "TODO|FIXME|XXX"` across `packages/*/src/*.js`,
`packages/*/bin/*.js`, and (going further than the report's own scope) all
of `packages/*/test/*.mjs`, a source-file-to-test-file coverage cross-check
across all three packages, both `package.json` dependency manifests, `ps
aux | grep manda` plus a live `curl -s http://localhost:28912`, the full
25-file regression suite (`node --test` per file, real exit codes),
`abi-symmetry.mjs`, `ls tasks/QN-*.md | wc -l`, independent σ/V
recomputation, and `git status --short`/`git log --oneline`.

**Verdict: PASS** — every headline claim, including the unusual "no new
tractable increment" framing given deliberately adversarial scrutiny per
this iteration's flat-ΔV content, is independently verified accurate.
Iteration 47 extends the clean-PASS streak (37-46) to **eleven**
consecutive iterations.

## Findings

1. **GitHub issues #3/#4 — VERIFIED unchanged.** `gh issue view 3
   --repo yaleh/quay --json number,title,state,labels,updatedAt` (run
   live) confirms issue #3 is still `OPEN`, `status:ready`,
   `lane:execution`, "Fix MCP task_write silently dropping the extra
   field," `updatedAt: 2026-07-15T05:40:27Z`. `gh issue view 4` confirms
   issue #4 is still `OPEN`, `status:todo`, "Fix default tasksDir
   resolution to use repo root, not cwd," `updatedAt:
   2026-07-15T08:18:05Z`. Neither `updatedAt` timestamp is fresher than
   iteration 46's own read, and `gh issue list --state all` (all 10
   issues in the repo, including the 6 already-closed fixture issues
   from QN-035/QN-037) shows no new issue opened and `gh pr list --state
   all` returns an empty array — no PR activity of any kind exists to be
   overlooked.
2. **The native backlog's 4 unsatisfiable tasks — VERIFIED unchanged,
   and independently confirmed to be genuinely, deliberately
   unsatisfiable rather than merely labeled that way.** `node
   packages/quay-native/bin/quay-native.js task list --json` filtered to
   non-`done` status returns exactly `QN-017` (`needs-human`), `QN-020`
   (`needs-human`), `QN-021` (`todo`), `QN-022` (`needs-human`) — the
   same 4 tasks iterations 41-47 report. This audit went one step
   further than the iteration's own report and read all four task files
   in full: `QN-017`'s own Proposal explicitly states it "is authored
   deliberately to fail — not 'hard,' but unsatisfiable by construction"
   to exercise the `needs-human` fallback path, citing a real,
   re-confirmed environmental fact (no subagent-dispatch primitive found
   in this environment across every iteration since iteration 1). This
   is not neglected organic work masquerading as unsatisfiable; it is
   task content built specifically to be a permanent, honest
   `needs-human` case.
3. **`packages/quay/DESIGN.md` §2.5 and `packages/quay-github/
   DESIGN.md` — VERIFIED no open, un-struck "known gap" item remains in
   either file.** A fresh, full read of §2.5 ("Known gaps (named
   honestly, not silently claimed as covered)") shows all three listed
   items wrapped in strikethrough (`~~...~~`) with an explicit "**Closed
   (iteration N, QN-0NN)**" citation and closing evidence — the MCP
   stdio transport lifecycle gap (closed iterations 28/36), the
   CAS-passthrough gap (closed QN-043/iteration 32), and the
   `provider://manifest` resource-naming gap (closed QN-041/iteration
   30). `packages/quay-github/DESIGN.md`'s complete `grep -n "^##"`
   section list (14 headers) contains no section titled anything like
   "known gaps," "open," or "TODO"; its §4 ("What transferred cleanly
   vs. what required backend-specific work") and §5 ("Capabilities")
   describe already-resolved scope decisions (e.g. `data.write` as a
   deliberate status-only v1.1 scope, not an open gap) with no
   un-struck, currently-open item. This independently confirms the
   report's claim.
4. **QN-057's durable Status-line fix — VERIFIED still holding, one
   iteration later, via a live re-run of the exact check, not a re-read
   of the report's characterization.** `grep -n "^\- \*\*Status"` on all
   four files (`experiment/README.md`, `docs/proposal/
   quay-proposal.md`, `docs/proposal/quay-native-design.md`, `docs/
   proposal/quay-bootstrap-experiment.md`) shows all four still read the
   same relative, self-updating phrasing introduced at iteration 46 (
   pointing at "the highest-numbered report in `experiment/iterations/`"
   and `ls tasks/QN-*.md | wc -l`, with zero hardcoded, staleness-prone
   counts anywhere in any of the four lines). `ls experiment/iterations/
   | sort -V | tail -3` confirms `iteration-47.md` — the file this very
   audit is reviewing — is now the highest-numbered file, so the
   phrasing continues to resolve correctly for a second iteration in a
   row. The fix's durability claim is not merely repeated; it is
   re-demonstrated live.
5. **The ten-consecutive-clean-PASS streak claim — VERIFIED
   independently, not trusted from the iteration-47 report's own tally.**
   This audit ran its own `grep -o "Verdict: [A-Z]*"` against
   `experiment/audits/iteration-{37..46}-independent-adjudicate.md`
   directly: all ten return `Verdict: PASS`. Combined with this audit's
   own PASS verdict for iteration 47, the streak is now genuinely
   **eleven** consecutive clean-PASS audits (37-47). `experiment/
   audits/iteration-46-independent-adjudicate.md` (13,242 bytes,
   timestamped before this session started) was independently confirmed
   to exist on disk with the exact PASS verdict iteration 47's own
   report quotes — the "already existing on disk, produced separately by
   the top-level orchestrator" framing is consistent with this file's
   mtime predating this audit's own start and with iteration 47's report
   explicitly stating it did not dispatch or attempt to obtain it.
6. **σ_strict, V_instance, V_meta — VERIFIED unchanged and arithmetically
   exact.** `ls tasks/QN-*.md | wc -l` independently returns **56**
   (unchanged from iteration 46). `49/56 = 0.875000...` rounds to
   exactly **0.8750**. `0.70 × 0.96 × 0.76 × 0.96 = 0.4903` and `0.74 ×
   0.26 × 0.79 × 0.64 = 0.0973`, both reproduced exactly via independent
   recomputation, matching iteration 46's own figures component-by-
   component (consistent with zero source, Skill, or gate file having
   been touched — confirmed via `git show a6085b0 --stat`, which touches
   only the iteration-47 report and `provenance.md`).
7. **Full regression suite and ABI symmetry — VERIFIED.** `find packages
   -name "*.test.mjs" | wc -l` returns exactly **25**. This audit ran
   `node --test packages/*/test/*.test.mjs` directly, checking the real
   process exit code: all 25 files pass (`tests 25, pass 25, fail 0`,
   `fail 0`). `node packages/quay-native/test/abi-symmetry.mjs` reports
   "ALL FOUR SURFACES SYMMETRIC" across `task_list`, `task_get`,
   `task_write`, and `task_check`, all `match: true`. Zero regressions
   confirmed independently.
8. **`git status --short` — VERIFIED clean as claimed.** Shows only `??
   docs/proposal/baime-lite-driving-external-projects.md`, the one known
   pre-existing untracked file, matching the report's framing exactly.
   `git log --oneline` confirms the iteration-47 commit (`a6085b0`)
   lands cleanly on top of the iteration-46-audit commit (`9270fab`).
9. **Adversarial search for genuinely unclaimed engineering work —
   performed independently, beyond the report's own named checks, and
   found nothing the iteration should have done but did not.** This
   audit went beyond `packages/*/src/*.js` and `packages/*/bin/*.js` and
   also grepped `TODO|FIXME|XXX` across all of `packages/*/test/*.mjs`;
   the only hits are literal test-data/variable names (`CHILD-TODO`,
   `SINGLE-LEVEL-CHILD-TODO`, `EPIC-CHILD-TODO`) inside compound-gate
   test fixtures, not genuine debt markers. This audit also cross-checked
   every `src/*.js` file in all three packages against its actual test
   coverage (by content, not filename-substring matching, which
   initially produced several false positives for `store.js`,
   `github-client.js`, `manifest.js`, and `provider-client.js` before
   being corrected by direct `grep` of test file imports/usages) — every
   source file is genuinely exercised by at least one test file; native's
   `mcp-server.js` specifically is exercised by `abi-symmetry.mjs` (run
   separately from the 25-file `*.test.mjs` suite, correctly, since it is
   not itself named `*.test.mjs`). This audit also read
   `docs/proposal/quay-native-design.md` §8 ("Open decisions") in full:
   all five originally-open items are marked "RESOLVED" with concrete,
   checkable evidence (file paths, task IDs, iteration numbers) — no
   residual open design question remains. Both packages'
   `package.json` dependency lists were read directly; no unusual or
   stale dependency markers found (three small, consistent
   `@modelcontextprotocol/sdk`/`yaml`/`zod` manifests). `ps aux | grep
   manda` plus a live `curl -s http://localhost:28912` confirms the
   report's own framing is accurate and non-overclaiming in both
   directions: a manda `serve` process genuinely is running on that
   port (this audit found it in the process list), and it genuinely
   does return `404 page not found` on a bare root request — the
   report's careful "noted honestly rather than asserted as either
   'armed' or 'not armed' beyond what was directly observed" phrasing is
   exactly correct, neither over- nor under-claiming the daemon's state.
   No TODO, no stale design gap, no untested source file, no missed
   GitHub issue/PR, and no provider.yml inconsistency (`data.write`/
   `gate`/`skill` capability comments in both `provider.yml` files and
   both `DESIGN.md` files were cross-read and are mutually consistent)
   was found. The "nothing new to do" framing is not a shortcut; it
   holds up under a deliberately adversarial, independent search.
10. **Post-hoc-correction count and clean-streak count — VERIFIED.**
    `grep -n "^## Post-hoc correction" experiment/provenance.md` finds
    six standalone headers (iterations 25, 29, 31, 33, 34, 35); the
    seventh is the embedded iteration-36 correction — seven total,
    matching the task brief. Audits for iterations 37 through 46 were
    individually re-read (verdict line grepped from each file): all ten
    return **PASS** with no corrections, confirming the "ten consecutive
    clean PASS (37-46)" framing this report inherited from iteration
    46's own audit is accurate, and that iteration 47 itself is the
    eleventh candidate in — and, per this audit's own verdict above, now
    confirmed member of — that streak.

## Net assessment

Iteration 47's central, and most scrutiny-worthy, claim is that no
genuine V_instance- or V_meta-moving engineering work existed this
iteration and that holding both value functions exactly flat (Δ = 0.0000
on both axes) was the honest outcome rather than a shortcut dressed up as
rigor. This audit treated that claim adversarially rather than taking it
at face value: it independently re-ran every verification the report
claims (GitHub issues #3/#4, the 4 unsatisfiable native tasks, both
packages' "known gaps"/DESIGN.md ledgers, the Status-line durability
check, the 25-file regression suite, `abi-symmetry.mjs`, σ arithmetic, and
`git status`) and additionally went beyond the report's own scope — a
full read of all four candidate task files (not just their status
labels), a content-based (not filename-based) source-to-test coverage
cross-check across all three packages, a full re-read of `quay-
native-design.md` §8's five "open decisions," a TODO/FIXME/XXX sweep
extended into test files, a live process-list and HTTP probe of the
manda daemon, and a check for any draft PR or newly-opened issue anywhere
in the repository. Every one of these additional, adversarial checks
came back consistent with "no work available" — the 4 unsatisfiable
tasks are genuinely, deliberately constructed to be unsatisfiable (not
neglected organic work mislabeled); both DESIGN.md gap ledgers have zero
open items on a fresh read; no source file lacks test coverage; no open
design question remains; and the manda-daemon framing is neither over-
nor under-claimed. No genuine unclaimed engineering work was found that
iteration 47 should have done but did not.

The QN-057 durable Status-line fix (introduced at iteration 46) is
independently confirmed still holding one iteration later via a live
re-run of the exact check, not a re-read of the claim — `iteration-47.md`
(the very file under audit) now sorts as the highest-numbered iteration
report, and all four Status lines' relative phrasing continues to
resolve correctly against that fact.

σ arithmetic (49/56 = 0.8750, task-count denominator of 56 independently
confirmed), V_instance/V_meta recomputation (0.4903, 0.0973, both
unchanged component-by-component from iteration 46), the 25-file
regression suite, `abi-symmetry.mjs`, and `git status` all reproduce
exactly as claimed. The ten-consecutive-clean-PASS streak (37-46) is
independently re-verified by direct grep of every audit file's verdict
line, not trusted from the iteration-47 report's own tally.

**No correction needed. Iteration 47 stands as reported. The clean-PASS
streak (37, 38, 39, 40, 41, 42, 43, 44, 45, 46) now extends to eleven
consecutive iterations, including this audit's own verdict.**
