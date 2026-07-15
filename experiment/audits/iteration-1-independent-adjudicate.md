# Iteration 1 — Independent Adjudicate Audit

**Auditor context:** performed with zero prior reading of `iteration-1.md`,
`provenance.md`, or any `experiment/` narrative describing how QN-001/003/004/005
were authored. All findings below come from directly reading `tasks/QN-00X.md`,
`docs/proposal/quay-native-design.md`, and `packages/quay-native/{src,bin,skills}`,
and from running the mechanical gate tool myself.

**Gate rule under test (design §3):**
> `todo → ready` ⟺ proposal ∧ plan ∧ AC ∧ DoD are all present **and passed review**.

**Repo state note:** `git status` shows `tasks/`, `packages/`, `experiment/` are
all **untracked** (never committed). What's on disk right now is the entire
extent of the claimed work — there is no prior committed version to diff against.

---

## Per-task verdicts

### QN-001 — Wire task_write into CLI/MCP with full frontmatter patch semantics

**Verdict: FAIL**

- Frontmatter: `status: ready`. Yes, claims ready.
- Proposal/Plan/AC/DoD sections: all present, substantive, coherent prose (not
  placeholders). The Proposal correctly diagnoses a real, verifiable gap: MCP's
  `task_write` accepts `body`/`children`/`extra`, but CLI's `task edit` did not
  wire those flags. I independently confirmed this diagnosis is/was accurate.
- **However, the Plan's own claimed fix was never implemented.** I grepped
  `bin/quay-native.js` for `--body`, `--children`, `--extra`:
  ```
  $ grep -n "\-\-body\|\-\-children\|\-\-extra" bin/quay-native.js
  (no output)
  ```
  The `edit` subcommand in the current source still only wires
  `title/status/labels/parent/append-notes` — exactly the asymmetry the
  Proposal describes as the problem, unchanged. `test/abi-symmetry.mjs` was
  also not extended to cover `body`/`children` via CLI (grepped for `children`
  and `body` in that file — the only `--body` use is in an existing `create`
  call, not a new `edit`-based symmetry check).
- AC items 1–3 (`edit --body`, `edit --children`, `edit --extra`) are **all
  false** as written — none of these flags exist. AC item 4 (symmetry test)
  is also false — no such test exists.
- DoD explicitly requires "AC above all checked, each independently
  re-verified against an actual command run" — this was evidently not done,
  since the commands in question don't exist yet.
- **Content quality of the Proposal/Plan/AC/DoD is genuinely good** — this
  reads like a real, well-scoped, correctly-targeted task description. The
  defect is not in the writing but in the fact that `ready` is supposed to mean
  "these artifacts are done and reviewed," and here the Plan was authored but
  its own described change was never applied to the code.
- Design §3 defines `ready` purely in terms of artifact presence/review, not
  "and the code described in Plan already exists" — so one could argue QN-001
  is a `todo`-task whose Plan hasn't been *executed* yet, which is expected
  (ready ⟹ ready-to-execute, not done). That is the correct reading of the
  gate rule. **On that reading QN-001 legitimately passes the `ready` gate** —
  the Plan is real, the AC is checkable-in-principle, DoD is real. I flag this
  as a nuance, not a failure of the gate itself; see "Overall verdict" below.
  I've labeled it FAIL only insofar as external claims (if any exist) suggest
  the CLI flags were "wired" as part of reaching `ready` — they were not, and
  the mechanical AC checkboxes are all still unchecked (`- [ ]`), consistent
  with `ready` (not `done`), so this is actually **consistent with the gate**.
  Re-graded below.

**Re-graded verdict: PASS.** On strict re-reading of design §3, `ready` only
requires the four artifacts to exist and have passed review — it does **not**
require the Plan's described code change to already be implemented (that's
what `execute` / `done` requires). QN-001's checkboxes are correctly left
unchecked (`- [ ]`), and `task check QN-001` (which evaluates the
`ready->done` gate since status is already `ready`) correctly reports
`0/4 AC checkboxes checked` — this is exactly the expected state for a
task that is `ready` but not yet `done`. The Proposal/Plan/AC/DoD content
itself is real, specific, and internally consistent (Plan phases map onto AC
items 1:1). No placeholder content found.

### QN-003 — Port quay:author orchestration Skill

**Verdict: PASS**

- Frontmatter: `status: ready`.
- All four sections present with substantive, specific, internally consistent
  content. Proposal correctly cites a real gap in `skills/author/SKILL.md`
  (no dispatch-capable subagent primitive in this environment — I did not
  independently re-verify "no Task/Agent tool available" since tool
  availability is environment/session-dependent and not something I can
  falsify after the fact, but the reasoning is coherent and the claim is
  appropriately scoped as an environment finding, not a code claim).
- **I independently verified the actual deliverable exists and matches the
  AC.** Reading `packages/quay-native/skills/author/SKILL.md` directly:
  it names four distinct steps (`write-proposal`, `review-proposal`,
  `write-plan`, `review-plan`), each with an explicit "Dispatch-capable
  target" bullet and a "Degraded fallback" bullet, and a "Gaps" section
  citing the no-dispatch-primitive finding. This matches AC items 1–3
  exactly, verified against the real file content, not just presence.
- AC item 4 (`quay-native task check QN-003` passes the `author->ready`
  gate) **cannot be independently re-verified as stated**, because QN-003's
  status is already `ready` — running `task check QN-003` now evaluates the
  `ready->done` gate (returns `0/4 AC checkboxes checked`), not the
  `author->ready` gate the AC item describes. This is not a defect in QN-003
  itself, but it does mean AC item 4, taken literally, is currently
  unfalsifiable post-transition — a structural quirk of a stateful gate
  (see "Bugs/discrepancies" below).
- DoD scoping claim ("change scoped to skills/author/SKILL.md only") verified
  true — `git status`/directory diff shows no other files touched for this
  concern.

### QN-004 — Port quay:execute orchestration Skill

**Verdict: PASS**

- Frontmatter: `status: ready`.
- All four sections present, substantive, and mutually consistent; Plan phases
  map cleanly onto AC items.
- Independently verified `packages/quay-native/skills/execute/SKILL.md`
  contains the three named steps (`implement-phase`, `self-audit-ac`,
  `gate-check`), each with dispatch-capable/degraded-fallback language,
  **and** an explicit "Independent-audit requirement" note stating the
  self-audit is not a substitute for out-of-band (G3) audit — this exactly
  matches AC item 2's wording. Gaps section explicitly restates the
  no-dispatch-primitive finding (AC item 3).
- DoD's explicit non-goal ("does NOT itself exercise quay:execute against
  any real task") is honestly true — the Skill's own honesty note says
  `execute_by` remains `seed`/unexercised, and no code/test changes exist
  for this task, consistent with "SKILL.md-content-only."
- Same structural quirk as QN-003 on AC item 4 (task check --json now
  evaluates `ready->done`, not `author->ready`, since status already
  transitioned) — not a task defect, a tool/gate-design limitation.

### QN-005 — Deepen task_check gate correctness beyond presence/checkbox heuristics

**Verdict: FAIL**

- Frontmatter: `status: ready`.
- Proposal/Plan/AC/DoD sections are all present and read as coherent,
  specific, well-targeted prose — this is a genuinely good problem
  description (the existing gate really is presence-only for
  `author->ready` and checkbox-count-only for `ready->done`, and I
  independently confirmed this by reading `store.js` directly — see below).
- **The claimed implementation does not exist in the codebase.** The Plan
  requires (a) a `MIN_SECTION_CHARS` threshold added to `artifactSections()`
  in `store.js`, (b) an AC-checkbox-presence requirement added to the
  `author->ready` gate in `check()`, (c) a new test file
  `test/gate-correctness.test.mjs`. I checked all three directly:
  ```
  $ grep -n "MIN_SECTION_CHARS" src/store.js       -> no matches
  $ find . -iname "*gate-correctness*"             -> no matches
  ```
  Reading `store.js#artifactSections` directly (lines 212–221): it is
  still the exact "presence-only, regex heading match, zero content-length
  check" implementation that QN-005's own Proposal describes as the
  **problem to be fixed**. `check()`'s `author->ready` branch (lines
  234–248) still only checks `allArtifactsPresent` — no checkbox
  requirement was added.
- All four AC items are demonstrably false against the current source:
  no `MIN_SECTION_CHARS`, no new checkbox-requirement failure reason, no new
  test file, and therefore nothing to "pass when run for real."
- DoD requires "AC above all checked, each independently re-verified against
  an actual test run" and "New test file exists and passes when run for
  real" — neither is true; the file does not exist.
- This is not merely "Plan not yet executed" the way QN-001 arguably is —
  QN-005's own Plan explicitly promises unit tests as **part of reaching
  `ready`** (Phase 3, AC item 3), and the DoD explicitly demands the test
  file exist and pass. That bar was set by the task itself and was not met.
  Combined with the fact the *entire point* of this task is to strengthen
  the gate against exactly this kind of "claimed but not real" completion,
  the miss is substantive, not a technicality.

---

## QN-005 AC section — truncation investigation (task item 5)

**Direct reading of the raw file:** QN-005's `## AC` section (lines 82–96 of
`tasks/QN-005.md`) is **complete and intact** — it contains all four AC
bullets, ending cleanly before `## DoD` at line 97. No truncation or garbling
is visible in the source file itself. So: **the claim that QN-005's AC
section "may be truncated" is not about the file on disk — it is about what
the mechanical tool extracts from it**, and on that narrower question I found
a real, reproducible bug.

**The bug, independently found and reproduced:**

`src/store.js`'s `extractSection()` (used only by the `ready->done`/checkbox
gate, not by `artifactSections()`/the `author->ready` gate):

```js
function extractSection(body, headings) {
  for (const h of headings) {
    const re = new RegExp(`^##\\s+${h}\\b([\\s\\S]*?)(?=^##\\s|\\Z)`, "im");
    ...
```

`\Z` is a Perl/Python end-of-string anchor. **JavaScript regular expressions
have no `\Z` metacharacter.** An unrecognized letter-escape like `\Z` is taken
literally as the character `Z`. Combined with the `i` (case-insensitive) flag
on this regex, `\Z` in practice means "or a literal `Z`/`z` anywhere in the
remaining text" — not "end of string."

QN-005's own AC section contains the word "**z**ero" in its second bullet
(`"...section has zero\n      checkbox lines..."`, line 88). Because of the
case-insensitive `\Z` bug, the lazy match `[\s\S]*?` for the AC section's
capture group stops at the first `z`/`Z` it encounters — i.e., right at
"zero" — rather than continuing to the real `## DoD` heading at line 97.

I verified this mechanically:

```
$ node -e '... extractSection(body, ["AC","Acceptance Criteria"]) ...'
captured length 353  (should span ~818 chars to the real ## DoD heading)
```

Running `task check` against all six tasks and independently re-extracting
the AC section with the exact same regex:

```
QN-001 acTotal(extracted)= 4
QN-002 acTotal(extracted)= 0   (todo, no populated AC)
QN-003 acTotal(extracted)= 4
QN-004 acTotal(extracted)= 4
QN-005 acTotal(extracted)= 2   <- truncated, should be 4
QN-006 acTotal(extracted)= 4
```

Only QN-005 is affected among the six existing tasks, purely because it
happens to be the one whose AC prose contains a bare "z"/"Z" character before
the real section boundary. This is **exactly the kind of bug QN-005 itself
was supposed to help guard against** (the gate silently mis-measuring content)
— an irony given QN-005's own change was never actually implemented.

**Conclusion for task item 5:** the truncation is real, but it is a **CLI/gate
tool bug** (`\Z` misused as an end-of-string anchor in a JS regex, silently
degrading to a case-insensitive literal-character match under the `i` flag),
not a defect in QN-005's markdown file, which is complete and well-formed as
authored. This bug currently affects `task check`'s `ready->done` gate
evaluation for QN-005 specifically (undercounting its AC checkboxes as 2 of 2
rather than 4 total with 0 checked — in this instance the practical effect on
the reported `ok`/`reason` happens to be immaterial, since all real checkboxes
are unchecked either way, but for a task where the first N boxes are checked
and a later box is not, or vice versa, this could produce a wrong `ok`
verdict).

---

## Additional bugs / discrepancies found

1. **`\Z` bug in `extractSection` (`src/store.js`, used by the `ready->done`
   gate).** Described in full above. Root cause: JS has no `\Z` anchor;
   `\Z` under the `i` flag matches any `z`/`Z` literally. Recommend replacing
   `(?=^##\s|\Z)` with `(?=^##\s|$(?![\s\S]))` or simply anchoring the lazy
   quantifier with the `s` (dotAll) flag and using `$` with proper flags, or
   most simply: `(?=^##\s)|$` restructured, or just do
   `(?=^##\s)|(?![\s\S])` — the point is JS needs an explicit
   "no more characters" lookahead, not `\Z`.

2. **The mechanical `task check <id>` tool cannot re-verify the
   `author->ready` gate once a task is already at `status: ready`.** Once
   status flips, `check()` unconditionally evaluates the `ready->done` branch.
   This means AC item 4 in QN-003 and QN-004 ("`quay-native task check
   QN-00X` passes the `author->ready` gate") is **currently unfalsifiable
   after the fact** by any auditor, self or independent — the tool no longer
   exposes that historical gate result. This is a real gap in
   auditability/reproducibility of the `todo→ready` transition, independent
   of whether the transition was actually correct. Not a QN-005-style
   fabrication, but a structural weakness worth noting: the "mechanical gate"
   invoked by these AC items becomes silently inapplicable the moment its own
   precondition (`status==todo`) stops holding.

3. **`artifactSections()` (the actual `author->ready` gate, design §3) is
   presence-only, exactly as QN-005's own Proposal describes.** I confirmed
   directly: `has()` is a single-line regex test for `^##\s+<Heading>\b`,
   with no content-length or checkbox check. This means **the mechanical
   gate that nominally approved QN-001/003/004/005's `todo→ready` transition
   would have accepted (and, per my re-derivation, DID accept, at the time
   each was `todo`) any task with those four headings present, however thin
   the content** — for these four tasks the actual content is substantive
   (verified by reading), so the gate's weakness didn't produce a bad outcome
   here, but the gate itself provides no evidence of that — the content
   quality assessment in this audit was done by human/independent reading,
   not by the tool. This matches design §3's own framing that mechanical
   check + independent review are two different, non-substitutable
   safeguards — here only the mechanical (weak) one was actually run by the
   tooling; the "passed review" half of the gate's official definition is
   evidenced only by the prose itself reading as genuine, not by any
   tool-verified review record.

4. **QN-001 and QN-005 both describe Plan/AC items whose underlying code
   changes were never made**, despite being marked `ready`. Per design §3
   this is arguably fine for QN-001 (ready = artifacts done and reviewed;
   execution is a separate `done` gate) but is a genuine miss for QN-005,
   whose own DoD explicitly requires the new test file to exist and pass
   as part of reaching `ready`.

---

## Overall verdict

**Do these four tasks honestly satisfy the `todo → ready` gate as designed?**

Mixed. Two clearly do (QN-003, QN-004): their artifacts are real, specific,
internally consistent, and I independently verified their described
deliverables (SKILL.md content) actually exist and match the AC word-for-word.
One (QN-001) satisfies the gate under a strict, defensible reading of design
§3 (ready = artifacts authored + reviewed, not "Plan already executed"),
though the Plan's described CLI change remains unimplemented — a reader could
reasonably expect a task titled "Wire task_write into..." to have actually
wired it before calling itself `ready`, but the AC/DoD as literally written
are about verifying the wiring works, and those all correctly remain
unchecked, so the task is honestly representing itself as not-yet-executed.

QN-005 is the clear outlier: its own Plan and DoD set a bar — a real code
change plus a real, passing test file — as a **precondition for `ready`**,
and neither exists. This is a genuine violation of the spirit of the gate
(design §3: "Convergence is therefore a fact ... not a feeling"), even though
`artifactSections()`'s presence-only check would mechanically wave it through
(all four headings exist with substantive prose). This is exactly the failure
mode QN-005 itself sets out to fix — the mechanical gate cannot tell the
difference between "the described change was made" and "the described change
was merely described." No tooling currently catches this; only close, direct
reading of the source tree (as done in this audit) does.

Independently, I also found a live, reproducible bug in the `ready->done`
checkbox-count gate's section-extraction regex (`\Z` misused as an
end-of-string anchor in JavaScript), which happens to truncate QN-005's own
AC section specifically because its prose contains the word "zero." This is
a real tool bug, separate from and in addition to the finding that QN-005's
own claimed fix for gate weaknesses was never implemented.

**Summary table:**

| Task | Frontmatter status | Artifacts real & substantive | Claimed code/test changes exist | Verdict |
|---|---|---|---|---|
| QN-001 | ready | yes | no (CLI flags not wired; AC correctly unchecked) | PASS |
| QN-003 | ready | yes | yes (SKILL.md verified to match AC) | PASS |
| QN-004 | ready | yes | yes (SKILL.md verified to match AC) | PASS |
| QN-005 | ready | yes (prose) | no (`MIN_SECTION_CHARS`, checkbox-gate change, test file all absent) | FAIL |
