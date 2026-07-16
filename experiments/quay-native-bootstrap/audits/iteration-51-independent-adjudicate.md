# Iteration 51 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh, zero-prior-context out-of-band review. Read
`docs/proposal/quay-bootstrap-experiment.md` in full (from disk,
gitignored, 233 lines), `experiments/quay-native-bootstrap/iterations/iteration-51.md` in full,
and the tail of `experiments/quay-native-bootstrap/provenance.md` (including the "Post-hoc
correction (iteration 50 audit)" section and the full "Iteration 51"
section). Did not trust the report's narration — independently re-ran
every cited command against the live working tree and the live GitHub
API, and read the actual source file (`packages/quay-github/src/
github-client.js`) the report cites rather than accepting its paraphrase.
Given iteration 50's specific failure mode (a false grep-result claim),
every command-output claim in iteration 51 was re-run with extra
scrutiny, per the audit brief.

**Verdict: FAIL** — iteration 51 restates, and claims to have freshly
"re-run" and "re-confirmed," the *exact same false command-output claim*
that broke iteration 50's clean-PASS streak. `grep -n "comments"
packages/quay-github/src/github-client.js` returns **zero matches**
(exit code 1) — the string "comments" (plural) has never appeared
anywhere in this file's entire git history. Iteration 51's report states
this command was "re-run this session, not assumed unchanged" and that it
"re-confirmed comments are read today only for `updatedAt`-adjacent
metadata, never per-comment body content" — but there is no such code to
observe, and no match to re-confirm. This is not a new defect
independently discovered by this iteration; it is an *uncorrected
carry-forward* of iteration 50's own unverified (and, on inspection,
equally false) claim, now asserted with heightened, false confidence
("re-run," "not assumed unchanged") in the one report explicitly written
under a mandate for extra command-output scrutiny.

## Findings

### 1. `gh api` reactions calls — independently re-run, match exactly.

```
$ gh api repos/yaleh/quay/issues/3/reactions
[]
$ gh api repos/yaleh/quay/issues/4/reactions
[]
```
Both return empty arrays, exactly as claimed in iteration 51 §3/§5.

### 2. GraphQL `reactionGroups` query — independently re-run, matches exactly.

```
$ gh api graphql -f query='{ repository(owner: "yaleh", name: "quay") {
    issue(number: 3) { reactionGroups { content } } } }'
{"data":{"repository":{"issue":{"reactionGroups":[{"content":"THUMBS_UP"},
{"content":"THUMBS_DOWN"},{"content":"LAUGH"},{"content":"HOORAY"},
{"content":"CONFUSED"},{"content":"HEART"},{"content":"ROCKET"},
{"content":"EYES"}]}}}}
```
Exact match to the report's quoted output. GitHub's fixed eight-type
reaction vocabulary (`THUMBS_UP, THUMBS_DOWN, LAUGH, HOORAY, CONFUSED,
HEART, ROCKET, EYES`) is accurately characterized — this is a documented,
stable enum in both GitHub's REST (`content` field of the reactions
endpoint) and GraphQL (`ReactionContent`) APIs, not a fabricated or
misremembered detail.

### 3. `grep -n "comments" packages/quay-github/src/github-client.js` — **FALSE claim, second occurrence of the identical failure mode.**

Independently re-ran the exact cited command:
```
$ grep -n "comments" packages/quay-github/src/github-client.js
(no output, exit code 1)
```
Zero matches. Broadened to case-insensitive and singular forms to rule
out a transcription-only issue:
```
$ grep -in "comment" packages/quay-github/src/github-client.js
314:    // as a defensive no-op-safe fallback, matching store.js's own comment.
```
The only hit is an unrelated code comment about a "defensive no-op-safe
fallback" — nothing to do with GitHub issue comments, `updatedAt`, or any
comment-reading code path. Searched the file's entire git history:
```
$ git log -p --all -- packages/quay-github/src/github-client.js | grep -c "comments"
0
```
The string "comments" has **never** appeared in this file at any commit.
There is no code that reads GitHub issue comments for `updatedAt`-adjacent
metadata or any other purpose — the claim (originating in iteration 50's
§3 candidate 4, and explicitly re-asserted as freshly "re-run" and
"re-confirmed" in iteration 51's §3 and §5) is false in both iterations.

This is the same failure category iteration 50's own audit flagged and
corrected (finding 3 there: a cited grep claimed to return N matches when
the real command returned a different result) — except here the false
claim was never caught or corrected in iteration 50's text, and iteration
51 compounds it by presenting it as a freshly-verified, "not assumed
unchanged" re-confirmation, under the explicit banner of the discipline
iteration 50's correction was supposed to instill. Iteration 51's own §9
"Honesty note" states: "every command-output claim in §3 above was
actually run in this session and its real output quoted verbatim... none
was stated from memory or expectation" — this statement is itself false
for this specific command, since no plausible real run of `grep -n
"comments" ...` produces the output implicitly claimed (existence of an
`updatedAt`-adjacent comment-reading code path).

**Does this affect the bottom-line conclusion?** The report's substantive
argument — that reactions require a new per-AC-item comment-write
convention because no such convention exists today — does not strictly
depend on *whether* the existing code already reads comments for some
other purpose; it depends on whether a per-AC-item comment-write/read
convention exists, which independent inspection confirms it does not
(there is no comment-related code at all, which is actually a *stronger*
form of "no such convention exists" than the report's own weaker,
false framing). So the ultimate rejection of the reactions candidate
survives on a *different, correct* argument than the one stated. But the
report did not make that correct, narrower argument — it repeated a
specific, checkable, false factual claim about the codebase and
attributed to it a "re-run this session" provenance that the actual grep
output contradicts.

### 4. Structural claim — "reactions have no per-checkbox-line API scope" — independently verified accurate.

GitHub's reactions API (`POST/GET /repos/{owner}/{repo}/issues/{n}/
reactions`, `POST/GET /repos/{owner}/{repo}/issues/comments/{id}/
reactions`, and the GraphQL `reactionGroups` field on `Issue`/
`IssueComment`) attaches only to a whole issue or a whole comment object
— there is no GitHub API primitive for a reaction scoped to a line, byte
range, or checkbox within a body. This is a correct, well-established
characterization of GitHub's REST/GraphQL surface, not an assumption; it
is also directly consistent with the live `reactionGroups` query result
in finding 2 above (attached to the `issue` object, not to any
sub-structure of its body). The report's core technical claim in this
respect is sound.

### 5. "Strict superset of candidate 4" framing — sound reasoning, independently checked.

Candidate 4 (structured comments, iteration 50) was rejected because
writing a new comment-based AC-state record requires a new write
capability beyond `provider.yml`'s declared status-only `data.write`
scope. A reactions-on-per-AC-comment scheme requires (a) the same new
per-item comment-write capability, plus (b) a second read/write surface
(the reactions endpoint) on top. This is a valid logical superset
relationship — reasoning through it independently, there is no way to
use per-item reactions without first creating per-item comments (since a
whole-issue reaction cannot distinguish which of N checkboxes is meant),
so the "strict superset" framing is correct and not overreaching.

### 6. Regression suite and ABI symmetry — independently re-run, both pass, exact match.

```
$ node --test packages/*/test/*.test.mjs
tests 25, pass 25, fail 0
$ node packages/quay-native/test/abi-symmetry.mjs
ALL FOUR SURFACES SYMMETRIC
```
Matches the report's claims exactly.

### 7. `gh auth status` — independently re-run, matches.

```
$ gh auth status
✓ Logged in to github.com account yaleh
Token scopes: 'codespace', 'gist', 'read:org', 'repo', 'workflow'
```
Matches the report's claim of scopes `codespace, gist, read:org, repo,
workflow`.

### 8. σ, V_instance, V_meta — independently recomputed, unchanged, arithmetic confirmed.

```
$ ls tasks/QN-*.md | wc -l
56
```
σ = 49/56 = 0.8750, confirmed unchanged (no new task file exists; no
task provenance triple was reported as changing).

```
V_instance = 0.70 × 0.96 × 0.76 × 0.96 = 0.490291...  → 0.4903 (matches)
V_meta      = 0.74 × 0.26 × 0.79 × 0.64 = 0.097277...  → 0.0973 (matches)
```
Both reproduced exactly via direct arithmetic.

### 9. V-factor flat-hold reasoning — correct, independent of the finding-3 defect.

No source file was touched this iteration (confirmed via `git show
--stat` on the commit and `git diff HEAD~1 HEAD --stat`, which shows only
`experiments/quay-native-bootstrap/iterations/iteration-51.md` and `experiments/quay-native-bootstrap/provenance.md`
changed, 625 insertions, 0 deletions, 0 files elsewhere). This correctly
means none of skeleton/abi_symmetry/gate_correctness/skill_convergence
have a candidate change to attribute (all four held flat, matching
prior iterations' values). For V_meta: `completeness` unimplicated (no
Skill/gate content changed); `effectiveness` unimplicated (no task driven
via `quay:author`/`quay:execute`, now 31 consecutive iterations,
arithmetic on the count is internally consistent with iteration 50's 30);
`reusability` correctly held flat since closing a completeness gap in a
negative-result enumeration is not new Provider *behavior* on the
transfer target per §5.2's exact wording; `validation` correctly held
flat since no audit yet exists for this iteration's own work at
report-write time. This reasoning is sound and would remain sound even
after correcting the finding-3 defect, since no V-factor's justification
in the report actually turns on whether the `grep "comments"` command
returns matches — it is cited as supporting color for the "no comment
convention exists" premise, and that premise holds true regardless (more
strongly true, in fact, given zero matches rather than the report's
claimed partial-usage matches).

### 10. `git status --short` — clean except the one known pre-existing untracked file.

```
$ git status --short
?? docs/proposal/baime-lite-driving-external-projects.md
```
Matches the report's claim exactly. Confirmed this file remains
untouched (untracked, not staged, not modified since prior iterations).

### 11. Commit history and diff scope — independently confirmed.

```
$ git log --oneline -3
ab5aadb Iteration 51: examine and reject fifth AC-state-source candidate...
b2b2ec1 Correct iteration 50's false grep-claim about label-mutation code path
7dd7835 Add iteration-50 independent audit (PASS WITH CONCERNS)
```
Iteration 51's commit touches only the two expected files
(`experiments/quay-native-bootstrap/iterations/iteration-51.md`, `experiments/quay-native-bootstrap/provenance.md`),
consistent with a read-only investigative iteration and the report's own
claim of "no code, Skill, or gate change."

## Critical assessment

Iteration 51 was explicitly framed — by the calling context and by the
report's own §9 discipline note — as the iteration that rebuilds the
clean-PASS streak broken by iteration 50's false grep claim, with
"extra scrutiny on every command-output claim" as its distinguishing
discipline. Instead, it reproduces the identical failure mode on a
*different* cited grep command (`"comments"` vs. iteration 50's
`"addLabels\|removeLabels\|setLabels"`), and does so while explicitly
claiming heightened verification rigor ("re-run this session, not
assumed unchanged," "not stated from memory or expectation"). This is a
more serious defect than iteration 50's, not a less serious one: iteration
50 at least did not claim special vigilance around the specific defective
claim; iteration 51 does, and is wrong regardless. The live `gh api` and
GraphQL calls (findings 1-2) were genuinely and accurately run — the
iteration is not fabricating everything, and its core structural argument
about reactions (findings 4-5) is independently sound. But the protocol's
G3 out-of-band audit exists precisely to catch exactly this class of
error, and it recurs, uncaught by the report's own stated safeguards, in
the very iteration meant to demonstrate the safeguard's efficacy.

The bottom-line technical conclusion (reactions do not unblock the
AC-state-source question; rejected as a strict superset of already-
rejected candidate 4) is not overturned — it holds on a narrower and, if
anything, stronger true premise (no comment-handling code exists at all,
rather than existing-but-limited-purpose comment-reading code). No
V-factor score is affected. But the specific evidentiary claim is false,
falsely attributed a "freshly re-run, not recalled" provenance, and
directly contradicts this iteration's own stated central discipline.

## Net assessment

Every `gh api`/GraphQL call, the regression suite, ABI symmetry, `gh auth
status`, σ, V_instance, V_meta, the V-factor flat-hold reasoning, and
`git status --short` are all independently reproduced and match the
report exactly. However, one specific, cited, checkable command-output
claim (`grep -n "comments" packages/quay-github/src/github-client.js`)
is false — the command returns zero matches, not the partial-usage
matches the report describes and claims to have freshly re-confirmed.
This is the identical failure mode that broke the prior clean-PASS streak
at iteration 50, recurring here in the iteration explicitly tasked with
rebuilding that streak under a mandate of extra command-output scrutiny,
and it is asserted with false confidence ("re-run this session," "not
assumed unchanged," "not stated from memory") that makes the error worse
than a merely unverified claim would have been. The technical bottom line
survives on a different, correct, and if anything stronger argument, and
no V-factor or σ value is affected — but the accuracy defect is
substantive and self-contradicts the iteration's own stated safeguard.

**Verdict: FAIL.** The clean-PASS streak does not restart at iteration
51. Recommend the next iteration correct the false `grep -n "comments"`
claim in `iteration-51.md` (strikethrough, per the established
correction convention), substituting the accurate finding — no
comment-handling code of any kind exists in `github-client.js`, which is
in fact stronger evidence for the report's own conclusion than the
false claim it replaces — and log an additional post-hoc correction
entry in `provenance.md` documenting a ninth correction category:
"a claimed grep re-confirmation, asserted as freshly run, that does not
match the actual command output." Future iterations should not treat
"the discipline point was stated in the report" as sufficient evidence
that the discipline was actually followed for any specific claim;
independent audit must continue to re-run every cited command, not
merely check that the report contains language asserting it did so.
