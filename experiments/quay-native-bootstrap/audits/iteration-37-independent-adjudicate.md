# Iteration 37 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh, zero-prior-context out-of-band review. Read
`docs/proposal/quay-bootstrap-experiment.md` in full, `experiments/quay-native-bootstrap/iterations/
iteration-37.md` in full, `experiments/quay-native-bootstrap/iterations/iteration-24.md` in full
(the report's cited precedent), the relevant `provenance.md` sections
(iteration-37's own σ/V-factor sections, the seven prior post-hoc
corrections, and iteration 25/26's `reusability` history), and ran all
tests/diffs/commands directly against the working tree, including an
independent reproduction of the adversarial break/restore cycle. Special
scrutiny applied, per instructions, to whether `skeleton` (rather than
`reusability`) is the correct factor for this iteration's `packages/
quay-github`-side, test-coverage-only work.

**Verdict: PASS** — every headline claim is independently verified accurate.
The new test file is genuinely new (zero prior coverage of `quay-github`'s
MCP transport in any commit), genuinely live-verified against real,
currently-open issues #3/#4, and genuinely adversarially tested (this audit
independently reproduced the exact break/restore cycle claimed: 2 live FAILs,
then byte-identical clean restore, then a full green re-run). The
`skeleton`/`reusability` factor-attribution judgment call, given special
scrutiny per the audit brief, is correct and well-supported by an accurate
precedent citation — this session found no repeat of either the "V-factor
overclaim" or "fabricated precedent" patterns documented in the seven prior
post-hoc corrections.

## Findings

1. **Claim 1 (genuinely new test file, zero prior coverage) — VERIFIED.**
   `git log --all --oneline -- packages/quay-github/test/mcp-server.test.mjs`
   shows exactly one commit (`54bcb21`, this iteration). `git log -p --all
   -- packages/quay-github/test/` shows no reference to `mcp-server` or
   `StdioClientTransport` in any prior commit touching that directory —
   `cli.test.mjs`, `compound-gate.test.mjs`, `gate.test.mjs`,
   `pagination.test.mjs`, `view-model.test.mjs`, and `write.test.mjs` were
   independently grepped and none references `mcp-server` or
   `StdioClientTransport`. The "zero test coverage anywhere in the repo"
   claim for `packages/quay-github/src/mcp-server.js` is accurate.

2. **Claim 2 (live-verified against real issues #3/#4) — VERIFIED.**
   `gh issue list --repo yaleh/quay --state all --json ...` confirms issues
   #3 ("Fix MCP task_write silently dropping the extra field", OPEN) and #4
   ("Fix default tasksDir resolution to use repo root, not cwd", OPEN) exist
   exactly as described. Running the test file directly
   (`node packages/quay-github/test/mcp-server.test.mjs`) produces live `gh
   api` calls (visible via the real `gh: Not Found (HTTP 404)` stderr lines
   for the deliberate unknown-id probes) and real `task_get`/`task_check`
   results for `gh-3`/`gh-4`, cross-checked byte-identical against direct
   CLI output — this is a genuine subprocess-plus-real-MCP-client exercise
   against the live repo, not a mock.

3. **Claim 3 (adversarial break/restore cycle) — INDEPENDENTLY REPRODUCED,
   VERIFIED exact.** This audit made its own backup copy of
   `packages/quay-github/src/mcp-server.js`, applied the identical mutation
   the report describes (`task_check`'s handler:
   `structuredContent: result,` → `structuredContent: { ...result, ok:
   !result.ok },`), and re-ran the test file. Result: **exactly 2 live
   FAILs** — `task_check('gh-3')` and `task_check('gh-4')` byte-identity
   assertions — matching the report's claim precisely (same 2 assertions,
   no others affected). The file was then restored from the backup; `diff`
   confirmed byte-identical restoration and `git diff --stat -- packages/
   quay-github/src/mcp-server.js` showed empty. Re-running produced a full
   green run (0 failures), matching the report exactly.

4. **Claim 4 (24-file regression suite + abi-symmetry, zero regressions) —
   VERIFIED.** `find packages -name "*.test.mjs" | wc -l` = **24** (one more
   than iteration 36's 23, exactly as expected). All 24 files run directly:
   0 non-zero exits. `node packages/quay-native/test/abi-symmetry.mjs` →
   "ALL FOUR SURFACES SYMMETRIC." Zero regressions confirmed independently.

5. **Claim 5 (V_instance arithmetic and `skeleton`-only attribution) —
   ARITHMETIC VERIFIED EXACT; FACTOR ATTRIBUTION VERIFIED SOUND, given
   special scrutiny.**
   - `0.70 × 0.96 × 0.76 × 0.96 = 0.4903` recomputed exactly. `0.4903 -
     0.4833 = 0.0070` recomputed exactly.
   - **On whether `skeleton` (not `reusability`) is the right factor:**
     iteration 24 (QN-034) was read in full independently by this audit,
     not merely trusted from iteration 37's characterization. Iteration
     24's own actual text (§7) states verbatim: *"`skeleton`: 0.64 → 0.65
     (+0.01)... a pure dispatch/formatting layer with no independent
     business logic of its own — every branch delegates immediately to an
     already-tested `github-client.js` function"* and separately (§8):
     *"`reusability`: 0.68 (unchanged)... QN-034 is NOT counted toward
     `reusability` even though it exercises the GitHub Provider live — per
     G2 and protocol §5.2, `reusability` measures whether the *methodology
     transfers* to building the GitHub Provider (i.e., quay-native driving
     the construction of new GitHub-Provider capability), not whether an
     existing GitHub-Provider capability is merely tested more
     thoroughly."* This is quoted accurately and applied correctly by
     iteration 37 — QN-034's fact pattern (test-coverage-only addition,
     zero source-code change, live-repo-constrained) is genuinely
     analogous to QN-048's (test-coverage-only addition for `mcp-server.js`
     specifically, zero source-code change, live-repo-constrained), one
     layer harder in process-lifecycle shape but otherwise the same kind
     of evidence.
   - **Is there a closer precedent this audit could find that iteration 37
     missed?** This audit independently searched all of `provenance.md` for
     every prior reference to `mcp-server.js`/MCP-transport work
     (`grep -n "mcp-server.js\|MCP.*transport"`) and specifically checked
     whether `packages/quay/test/mcp-server.test.mjs` (Core's own MCP
     transport test, the file iteration 37 cites as the pattern it
     mirrored) constitutes a closer, first-of-its-kind precedent. It does
     not: `git log --oneline -- packages/quay/test/mcp-server.test.mjs`
     shows it was created in iteration 26 (QN-036) as part of the **same
     task that implemented Core's MCP server itself** (`DIR-007`) — a
     materially different fact pattern (new capability + its first test,
     scored as new `skeleton`/`abi_symmetry`-relevant capability, per
     provenance.md's iteration-26 section) than QN-048's fact pattern (an
     already-existing, unmodified capability gaining test coverage only).
     Iteration 24/QN-034 — a pure test-coverage-only addition against
     already-existing, unmodified code, live-repo-constrained — is
     therefore genuinely the closest and most on-point precedent
     available in `provenance.md`, not a convenient-but-mismatched
     citation.

6. **Claim 6 (V_meta unchanged, `effectiveness`/`reusability` held flat) —
   VERIFIED sound, with the `reusability` scrutiny point resolved in the
   report's favor.**
   - Protocol §5.2 defines `reusability` precisely as "the methodology
     transfers to a second Provider (GitHub) **unmodified**" — i.e.,
     whether quay-native's methodology is used to **drive construction of
     new GitHub-Provider capability**, not merely whether GitHub-Provider
     files are touched. This audit independently checked `reusability`'s
     own scoring history in `provenance.md`: the only genuine post-baseline
     `reusability` increase (0.68 → 0.79) occurred at iteration 25 (QN-035),
     which implemented **new** compound/epic gate support in the GitHub
     Provider (a real capability port, ported logic from `store.js`'s
     `childrenStatus()`), not a test-only addition. This is the correct
     comparator, and it confirms the report's distinction is not merely
     asserted but empirically supported by this experiment's own scoring
     precedent: capability-porting work moves `reusability`; test-coverage-
     only work targeting an already-existing, unmodified capability does
     not, regardless of which package directory the new test file lives
     in. `git diff --stat -- packages/quay-github` being non-empty (the new
     test file only) does not, on its own, license a `reusability` bump —
     the factor's protocol definition is about methodology-driven
     *construction*, and QN-048 built no new GitHub-Provider capability
     (`git diff --stat -- packages/quay-github/src/mcp-server.js` is empty
     after the adversarial cycle, confirming zero source change). This
     audit finds the report's refusal to credit `reusability` here correct
     on the merits, not merely "matching a precedent that happens to be
     convenient."
   - `effectiveness` held flat: the live-`gh api` network-I/O confound
     reasoning inherited from iteration 24 is checked and found to
     genuinely apply — QN-048, like QN-034, makes live `gh api` calls
     (visible directly in this audit's own test run, the `gh: Not Found`
     stderr lines), the same confound dimension iteration 24 identified.
     Sound.
   - `completeness` and `validation` held flat: correctly reasoned (no new
     Skill-orchestration Method content; validation awaits this very
     audit).

7. **Claim 7 (σ_strict arithmetic, task-count denominator) — VERIFIED
   exact.** `ls tasks/QN-*.md | wc -l` = **47**, confirmed independently.
   `40/47 = 0.851063... ≈ 0.8511` recomputed exactly; `39/46 = 0.847826...
   ≈ 0.8478` (prior value) also recomputed exactly.

8. **Claim 8 (convergence verdict, all 5 criteria NO) — VERIFIED sound.**
   V_instance = 0.4903, V_meta = 0.0973, both far below 0.80 — criterion 1
   correctly NO. σ = 0.8511, far from 1 — criterion 2 correctly NO.
   Criterion 4 correctly NO (no audit existed for this iteration's work
   until now, this audit being that audit). Criterion 3 correctly NO,
   unchanged framing, consistent with the last several iterations'
   treatment. Criterion 5's literal-vs-substance split is judged sound:
   ΔV_instance = +0.0070 (< 0.02) for a third consecutive iteration
   satisfies the literal wording, but the report's "scored NO on substance"
   reasoning (a value function pinned near its own floor, not approaching
   convergence and leveling off) is a continuation of the same standing
   practice established at iterations 28-36, not a new or inconsistent
   rationalization introduced this iteration.

9. **Claim 9 (`git status --short` clean) — VERIFIED.** Output: only `??
   docs/proposal/baime-lite-driving-external-projects.md`, the known
   pre-existing untracked file. Nothing else untracked or modified, both
   before and after this audit's own independent break/restore
   reproduction (confirmed via a second `git status --short` check after
   restoring the file).

10. **Claim 10 (new DESIGN.md §3.7) — VERIFIED.** `packages/quay-github/
    DESIGN.md` contains a `### 3.7 MCP stdio transport regression coverage
    (iteration 37, QN-048)` section (line 358) and a header-status
    reference to it (line 12). `git log -1` confirms this file was touched
    in the same commit (`54bcb21`) as the new test file and `tasks/
    QN-048.md`.

## Additional check: repeat of prior failure patterns

Per the audit brief, this session specifically checked whether iteration 37
repeats either of the two documented failure patterns from the seven prior
post-hoc corrections (V-factor overclaim, or fabricated precedent
corroboration). Neither pattern is present:

- No V-factor was credited beyond what the evidence supports — `skeleton`
  +0.01 is the only movement, and it is independently confirmed correct
  above (Finding 5).
- The precedent citation to iteration 24 was checked by reading iteration
  24's actual report content directly (not trusting iteration 37's
  characterization), and the quoted language in iteration 37 §7/§8 matches
  iteration 24's real text verbatim. No corroborating-iteration claim of
  the "iterations X and Y independently agreed" shape (the iteration-36
  failure mode) appears anywhere in iteration 37 — the report cites exactly
  one precedent (iteration 24) and does not claim additional corroboration
  from other iterations it did not actually re-read for this specific
  point.

## Net assessment

Iteration 37's engineering work is genuine and fully reproducible: a new,
previously-nonexistent test file (`packages/quay-github/test/
mcp-server.test.mjs`) closes a real, zero-coverage gap in the GitHub
Provider's MCP stdio transport, verified live against real, currently-open
GitHub issues #3 and #4, with a real subprocess and a real MCP client — not
a mock. This audit independently reproduced the claimed adversarial
break/restore cycle byte-for-byte (2 live FAILs on the exact two assertions
named, then a clean, verified restore, then a full green re-run) and
independently re-ran all 24 regression test files plus `abi-symmetry.mjs`
with zero failures. All arithmetic (V_instance, V_meta, σ_strict) recomputes
exactly as reported, and the task-count/test-file-count denominators (47
tasks, 24 test files) are independently confirmed.

The report's own request for special scrutiny — whether `skeleton` rather
than `reusability` is the correct factor for this GitHub-Provider-side,
test-coverage-only work — is resolved in the report's favor. This audit
independently verified iteration 24's actual reasoning (not just iteration
37's paraphrase), confirmed no closer precedent exists in `provenance.md`
(specifically ruling out `packages/quay/test/mcp-server.test.mjs`'s creation
at iteration 26, which was part of a new-capability task, not a
test-coverage-only one), and independently checked `reusability`'s own
scoring history to confirm the factor has only ever moved for genuine
new-capability construction (iteration 25/QN-035), never for test-coverage
additions to already-existing code — regardless of which package directory
the new test file lives in. The distinction the report draws is protocol-
faithful, not a convenient rationalization.

No overclaim, misattribution, or fabricated precedent found. No correction
needed to `iteration-37.md` or `provenance.md`.
