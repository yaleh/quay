# Iteration 50 — Independent Out-of-Band Audit (G3)

**Auditor:** fresh, zero-prior-context out-of-band review. Read
`docs/proposal/quay-bootstrap-experiment.md` in full (from disk, gitignored,
233 lines), `experiment/iterations/iteration-50.md` in full, and the tail of
`experiment/provenance.md` (the full "Iteration 50" section). Did not trust
the report's narration — independently re-ran every cited command against
the live working tree, and read the actual source files
(`packages/quay-github/src/github-client.js`, `packages/quay-github/
DESIGN.md`, `packages/quay-github/provider.yml`) the report cites rather
than accepting its paraphrase.

**Verdict: PASS WITH CONCERNS** — every durability re-check, σ/V-factor
recomputation, and regression/test result is independently verified
accurate. However, one specific evidentiary claim in the iteration's
central investigation (§3, candidate 1 of the four-candidate enumeration)
is **factually false as stated**: the report claims a cited `grep` command
returns zero matches and that "no label-mutation code path exists at all,
not even for status" — both are directly contradicted by the actual file.
The higher-level conclusion of that candidate (per-AC-item labels would
require new write capability) still holds on independent re-analysis, so
this does not overturn the iteration's bottom-line answer, but it is a
genuine accuracy defect in a report whose entire value proposition this
iteration is "exhaustive, code-verified enumeration," and it breaks the
otherwise-unbroken thirteen-iteration streak of clean PASSes.

## Findings

1. **Protocol and iteration report — read in full, correctly
   cross-referenced.** `docs/proposal/quay-bootstrap-experiment.md`
   (§5.1/§5.2 value-function definitions, §10 resolved decisions) and
   `experiment/iterations/iteration-50.md` (all 10 sections plus
   Reflections and Problems) were read directly from disk. The report's
   framing — a milestone (50th) iteration closing a named fresh angle
   (alternate AC-state source for `checkGate()`) plus two durability
   re-checks and a brief retrospective — is accurately represented.

2. **`checkGate()`'s signature and exclusive `body` reliance — confirmed
   by reading the source.** `packages/quay-github/src/github-client.js`
   is 611 lines (matches). `checkGate(task, getChildTask)` (line 356) is
   the only export of that name; `getChildTask` is used exclusively for
   compound/epic children rollup, never for AC state (confirmed by
   reading both gate branches, lines ~361-433). Both branches call
   `extractGateSection(body, ["AC", "Acceptance Criteria"])` (lines 363,
   399) and count `- [ ]`/`- [x]` matches against that section only.
   `body` is the destructured `task.body`, itself populated from
   `issue.body` in the view-model construction. No second parameter, no
   injected AC-state function, no alternate task-view-model field exists.
   This part of §3's claim is accurate.

3. **Candidate 1 (per-AC-item labels) — the cited `grep` claim is
   FALSE.** The report states (§3, item 1): `grep -n
   "addLabels\|removeLabels\|setLabels" packages/quay-github/src/
   github-client.js` "returns no matches — no label-mutation code path
   exists at all, not even for status." Independently re-ran the
   identical command:
   ```
   $ grep -n "addLabels\|removeLabels\|setLabels" \
       packages/quay-github/src/github-client.js
   222:    return { close: true, addLabels: [], removeLabels: [] };
   224:  const removeLabels = currentLabelNames.filter(...);
   226:  const addLabels = removeLabels.includes(desired) ...
   231:    addLabels,
   234:    removeLabels: removeLabels.filter(...),
   564:      for (const label of plan.removeLabels) {
   579:      for (const label of plan.addLabels) {
   ```
   Seven matches, not zero. There **is** a label-mutation code path: it
   is `computeStatusWrite()` (lines ~220-234), which the write executor
   (lines ~564-583) uses to `DELETE`/`POST` labels via `gh api` — this is
   precisely how this Provider's own declared, implemented `data.write:
   status-only` capability (QN-024, `provider.yml`) writes the
   `status:*` label. The report's own §3/§6 elsewhere correctly describes
   `data.write` as implemented for status, which directly contradicts its
   own parenthetical "not even for status" in this specific claim — an
   internal inconsistency, not just an inaccurate grep transcription.

4. **Does the false claim overturn candidate 1's conclusion? No, on
   independent re-analysis, but the report's stated evidence for it is
   wrong.** `STATUS_LABEL_RE = /^status:(.+)$/` (line 7) shows the
   existing label-mutation path is narrowly scoped to the `status:*`
   vocabulary only — it does not write arbitrary or per-AC-item labels
   (e.g. `ac:1-checked`). So the substantive point candidate 1 needed —
   "a new label vocabulary for per-AC-item state would be new write
   capability beyond what's implemented" — is still correct in
   substance. But the report did not make this narrower, correct
   argument; it made a broader, false one ("no label-mutation code path
   exists at all"), which is falsified by the same file it claims to
   have grepped. This is a genuine accuracy defect in the investigation's
   documented methodology, not a harmless rounding error — the whole
   claimed rigor of this iteration rests on "checked against actual code
   or actual provider.yml/DESIGN.md scope declarations, not assumed"
   (§6), and this specific check was evidently not actually run as
   described, or was misread.

5. **Candidate 2 (sub-issues/tasklist API) — DESIGN.md citation
   confirmed accurate.** `packages/quay-github/DESIGN.md` lines 97-101
   read directly:
   > "Deliberately out of scope (G5): GitHub's newer, structured
   > sub-issues REST/GraphQL API (`gh api` sub_issues endpoints) was
   > evaluated and rejected for v1 — it requires an org-level preview
   > opt-in and a heavier API surface, disproportionate to this
   > read-only v1's scope."
   This matches the report's paraphrase and citation ("lines 97-100")
   closely enough (off by one line, immaterial). The report's
   characterization — that this is scoped out for an orthogonal reason
   (disproportionate effort for read-only v1), not the AC-state question
   — is accurate; the child-issue/tasklist concept is structurally
   different from checkbox lines in one issue's body, as claimed.

6. **Candidate 3 (GitHub Projects v2 fields) — confirmed no code path
   exists.**
   ```
   $ grep -n "projects" packages/quay-github/src/github-client.js
   (no output, exit code 1)
   $ grep -rni "projects" packages/quay-github/ --include="*.js" --include="*.yml"
   (no output)
   ```
   `provider.yml`'s `capabilities:` block declares only `data.read`,
   `manifest`, `data.write` (status-only), and `gate` — no `projects`
   capability. This candidate's rejection is accurate: adopting Projects
   v2 would indeed require an entirely separate API surface, auth scope,
   and capability category, correctly characterized as materially larger
   than "extend `checkGate()`'s AC source."

7. **Candidate 4 (structured comments) — independently assessed;
   report's judgment is sound and appropriately conservative, not
   overreaching.** Comments are indeed writable via GitHub's REST API
   without touching `issue.body`, and are structurally distinct from a
   body edit — the report is correct that this is "the sharpest version"
   of the fresh angle. The report's conclusion — that this is still a
   `data.write` scope expansion, because `provider.yml`'s own scope
   line is "status-only write" (a capability-category boundary), not
   merely "no body writes" (a field-level boundary) — is the more
   defensible reading of QN-024's own language ("only `status` is
   writable... there is no AC/DoD requirement or observed drift
   motivating a broader write surface yet, and adding one now would be
   anticipatory gold-plating," DESIGN.md line 162). A comment-based
   AC-state record would be a **new write path** regardless of which
   API field it targets, and doing so specifically to make `checkGate()`
   pass for two issues is a plausible instance of the G5
   anticipatory-scope-expansion pattern. This is a genuine judgment call
   and the report's position is reasonable and not overly conservative
   — it correctly distinguishes "technically distinct from a body edit"
   from "distinct from a `data.write` scope expansion," and grounds the
   distinction in the protocol's own G5 language rather than a vague
   appeal to caution.

8. **Exhaustiveness of the four-candidate enumeration — one plausible
   fifth candidate was not considered: GitHub reactions (emoji) as an
   ad-hoc per-item status signal.** Reactions on a comment or issue
   (👍/👎/etc., or on a per-AC-line comment) are a genuinely distinct
   mechanism from all four candidates examined: they are not part of
   `issue.body`, not a label, not Projects v2, and not a full "structured
   comment" write (they're a lightweight, narrowly-typed REST endpoint,
   `PUT /repos/{owner}/{repo}/issues/comments/{id}/reactions`). Whether
   this candidate would ultimately be rejected on the same G5 grounds as
   candidate 4 (any new write path is a `data.write` scope expansion) is
   plausible, but the report did not name or consider it, so its
   "exhaustive" framing (§3: "concretely enumerated every candidate...to
   test whether any is real") is an overstatement — a more accurate
   claim would be "every candidate this iteration considered." This is a
   completeness note, not a correction to the bottom-line answer (the
   same G5 argument used for candidate 4 would very likely apply to
   reactions too), but it should not be re-asserted as literally
   exhaustive in future iterations without acknowledging this gap.
   GitHub Issue Forms and milestones were also checked and are much
   weaker candidates (Issue Forms concern issue *creation* templates,
   not per-item state tracking; milestones are issue-level, not
   per-checkbox) — not flagging these as gaps.

9. **Status-line durability (QN-057) — independently re-confirmed across
   all four files.**
   ```
   $ grep -n "^\- \*\*Status" docs/proposal/quay-bootstrap-experiment.md \
       docs/proposal/quay-native-design.md docs/proposal/quay-proposal.md \
       experiment/README.md
   ```
   All four lines use relative, self-updating phrasing ("see the
   highest-numbered report...", "run `ls tasks/QN-*.md | wc -l`...") with
   no hardcoded iteration number or task count. Matches the report's
   claim exactly.

10. **Manda dispatch `--self` wiring — independently re-confirmed
    unchanged.**
    ```
    $ ps aux | grep -i "manda-tools mcp"
    yale ... manda-tools mcp --self  --allow todo.write,todo.read,agent.spawn
    yale ... manda-tools mcp --self  --allow todo.write,todo.read,agent.spawn
    yale ... manda-tools mcp --self  --allow todo.write,todo.read,agent.spawn
    ```
    All three processes show an empty `--self` value (immediately
    followed by `--allow`), matching iteration 49's finding exactly. No
    change.

11. **σ, V_instance, V_meta — all independently recomputed and
    unchanged.**
    ```
    $ ls tasks/QN-*.md | wc -l
    56
    ```
    σ = 49/56 = 0.8750 confirmed. `V_instance = 0.70 × 0.96 × 0.76 × 0.96
    = 0.4903` and `V_meta = 0.74 × 0.26 × 0.79 × 0.64 = 0.0973`, both
    independently recomputed via direct arithmetic — exact matches.

12. **V-factor flat-hold reasoning verified against the protocol's exact
    wording — correct.** Re-read §5.1/§5.2 directly. No source file was
    touched this iteration (`git status --short` at commit time showed
    only the one known untracked file), so none of
    skeleton/abi_symmetry/gate_correctness/skill_convergence have a
    candidate change to attribute. For §5.2: `completeness` requires new
    Skill/gate/decomposition-rule content (none changed — the
    hypothetical `checkGate()` injection-point refactor was correctly
    identified as unmotivated and not performed). `effectiveness`
    requires a marginal increment built via `quay:author`/`quay:execute`
    (none — this iteration was source-reading/enumeration only); flat for
    30 consecutive iterations (21-50), arithmetic confirmed. `reusability`
    requires new Provider *behavior* on the transfer target, not a more
    complete proof that none is available under current scope — the
    report's own reasoning on this point (§8) is correct and
    appropriately conservative; flat for 25 consecutive iterations
    (26-50), arithmetic confirmed. `validation` requires an out-of-band
    audit of *this iteration's own work*, which does not yet exist at
    report-write time (this audit is that missing piece) — correctly
    held flat. Flat-hold across all eight factors is the protocol-correct
    outcome, independent of the accuracy defect found in finding 3 (which
    concerns the *evidentiary basis* for a conclusion the iteration
    reached, not whether a V-factor should have moved — no V-factor
    moving is separately, correctly justified either way).

13. **Retrospective's two-phase characterization — reasonable and
    evidenced, not an overreach.** Spot-checked `provenance.md`'s section
    headers: iterations 18-27 show genuine feature/task work (QN-029
    through QN-037, including QN-035 compound/epic gate support and
    QN-036 Core's own MCP server) — consistent with "iterations 0-36
    built real capability." From iteration 41 onward, section titles
    shift to "no new tractable increment," "durable-fix confirmation,"
    "fresh-angle sweep (no new tractable increment)" — consistent with
    "iterations ~37-50 are a floor." No new `tasks/QN-*.md` file was
    created after QN-057 (iteration 46) through iteration 50 (56 total
    files, consistent across iterations 49 and 50). The retrospective's
    claim that `effectiveness`/`reusability` are "the longest-running
    flat factors in the whole 50-iteration history" is consistent with
    the 30-iteration and 25-iteration counts independently verified in
    finding 12. This characterization is well-grounded in the provenance
    record, not asserted without support.

14. **Full regression suite and ABI symmetry — independently re-run,
    both pass.**
    ```
    $ node --test packages/*/test/*.test.mjs
    tests 25, pass 25, fail 0
    $ node packages/quay-native/test/abi-symmetry.mjs
    ALL FOUR SURFACES SYMMETRIC
    ```

15. **Thirteen-consecutive-PASS streak (37-49) independently
    re-verified.** Confirmed `experiment/audits/iteration-{37..49}-
    independent-adjudicate.md` all exist and each carries a `Verdict:
    PASS` line (spot-checked iteration-49's file directly, read in
    full — matches the report's characterization). This audit is the
    first in the streak not to extend it cleanly, per finding 3.

16. **`git status --short` — clean except the one known pre-existing
    untracked file.**
    ```
    $ git status --short
    ?? docs/proposal/baime-lite-driving-external-projects.md
    ```
    Matches exactly.

## Critical assessment

Iteration 50's stated methodology was to check every candidate "against
the actual codebase" rather than assume or re-cite abstract scope
citations (§6). For three of the four candidates (sub-issues API,
Projects v2, structured comments) this was done correctly and the
resulting judgments are sound, including the most judgment-dependent one
(structured comments), which stands up to independent scrutiny. For the
first candidate (per-AC-item labels), however, the specific `grep` command
cited does not produce the claimed output, and the accompanying textual
claim ("no label-mutation code path exists at all, not even for status")
is directly false and self-contradicts other parts of the same report
that correctly describe the implemented status-label write path. This
matters for two reasons: (a) it is a factual claim about a specific,
cited, re-runnable command — exactly the category of claim this
experiment's audit discipline (G3) exists to catch, and it is caught here
only because this audit re-ran the command rather than trusting the
report; (b) it slightly undersells how close the real distinction is —
the correct argument (existing status-label writes are narrowly scoped to
`status:*` and do not generalize to arbitrary per-AC-item labels) is a
finer, more defensible point than "no label-mutation code path exists,"
and the report reached for the cruder, false claim instead. The
bottom-line conclusion of candidate 1 (rejected, correctly) is
unaffected, and the overall four-candidate verdict ("no alternate AC-state
source avoids a `data.write` scope expansion") still stands on independent
re-analysis. Separately, the enumeration's claim to be exhaustive is an
overstatement — GitHub reactions were a plausible, unconsidered fifth
candidate (see finding 8), though very likely subject to the same
rejection logic as structured comments.

## Net assessment

Every durability re-check (Status-line files, manda `--self` wiring),
σ/V-factor recomputation, and regression/ABI-symmetry result was
independently reproduced and matches the report exactly. Three of the four
rejected AC-state-source candidates hold up to direct source
verification, including the hardest judgment call (structured comments),
which is reasoned soundly from the protocol's own G5 language rather than
asserted by default caution. However, the first candidate's cited
evidence (`grep` output, and the derived "no label-mutation code path...
not even for status" claim) is factually false, contradicted by the same
file it claims to cite, and self-inconsistent with the report's own
correct description of the implemented status-write path elsewhere.
The exhaustiveness claim is also an overstatement (reactions were not
considered). Neither defect changes the iteration's bottom-line
conclusion or the (correctly unmoved) V-factor scores, and no code,
Skill, gate, or task-provenance state was affected. But this is a genuine
accuracy defect in the specific evidentiary chain of the iteration's
central, most-touted contribution, of the exact kind this out-of-band
audit process exists to catch — and it is sufficient to break the
thirteen-consecutive-clean-PASS streak.

**Verdict: PASS WITH CONCERNS.** Durability, σ/V computation, retrospective
characterization, and three of four candidate rejections are all
independently verified sound. The first candidate's central cited
evidence is false as stated (though its conclusion survives on a
narrower, correct argument this audit supplies), and the enumeration's
"exhaustive" framing overstates its actual coverage by one plausible
candidate (reactions). Recommend the next iteration correct the
grep-based claim for candidate 1 (replace with the narrower, accurate
"`STATUS_LABEL_RE` restricts the existing label-write path to `status:*`
only; no path writes arbitrary/per-AC-item labels") and, if the
enumeration is cited again, either add reactions as a fifth
examined-and-rejected candidate or soften "exhaustive" to "every
candidate examined."
