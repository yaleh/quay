# Iteration 1 — out-of-band adjudicate co-sign (G3)

**Tasks audited:** QN-001, QN-003, QN-004, QN-005 (all four `todo -> ready`
transitions performed via `quay:author` in iteration 1 — see
`experiments/quay-native-bootstrap/provenance.md`).

**Gate being audited:** `author -> ready` (design §3: "proposal ∧ plan ∧ AC ∧
DoD are all present and passed review"), NOT `ready -> done` — no task was
driven to `done` in iteration 1 (execution stays seed-driven this iteration,
per the fixed per-Skill retirement order, protocol §10.2).

**Auditor:** this session, re-verifying `quay:author`'s self-reported
`ok: true` gate results with an adversarial, independent re-derivation —
**not** trusting the authoring session's own checklist pass. See "Limitation"
below for the honest scope of this independence, which is the central G3
finding of this iteration.

## Step 0 — audit-independence scoping (honesty-first, per G3/G4)

Before auditing content, this iteration explicitly investigated whether a
genuinely separate (fresh-context, separately-dispatched) audit session could
be created, since iteration 0 flagged this as the precondition for a real G3
pass:

- Searched for a subagent/Task-dispatch tool via `ToolSearch` (multiple
  queries) — **none exists in this harness.**
- Investigated `manda-dispatch`'s `submit/status/cancel/fork-join` mechanism
  as an alternative — concluded it requires a separately **registered
  executor session** (`claim/release/exec`), which itself must be a distinct
  process/session this single tool-calling turn cannot spawn. Not usable as a
  substitute for a real independent audit dispatch.

**Conclusion: no mechanism exists in this environment to produce a true
fresh-context independent audit this iteration.** This audit is therefore the
same class of limitation iteration 0 recorded (same-session adversarial
re-check, not a separately-dispatched subagent), but conducted with more
rigor: it does not merely re-read the authoring session's own claims — it
independently re-derives gate results from scratch using fresh tool
invocations against the actual stored files, and it actively looked for (and
found) a discrepancy between the authoring session's belief and the tool's
actual behavior (see Step 2, QN-005). This is stronger evidence than iteration
0 produced (which found no discrepancies to report), but it is still **not**
criterion 4 of protocol §7 ("out-of-band audit passed" in the fully
independent sense the protocol intends). See Limitation.

## Step 1 — audit depth

Per `adjudicate`'s `auditDepthFor` heuristic (iteration 0's audit): all four
tasks are authoring-artifact-only (no source-code change shipped this
iteration except the two SKILL.md files, which are documentation/process
artifacts, not `store.js`/`mcp-server.js` core logic). **Depth = full**,
applied uniformly, because the objective (retiring seed dependency in
authoring) is exactly the kind of process claim that most needs adversarial
verification, not because the code-diff surface is large.

## Step 2 — independent verification (full depth, per task)

### QN-001 — Wire task_write into CLI/MCP with full patch semantics

1. Read the task file fresh from disk (not from authoring-session memory).
2. Fresh `quay-native task check QN-001 --json`: `acTotal: 4, acChecked: 0`,
   gate branch `execute->done` (confirms status is genuinely `ready`, not
   just claimed).
3. Verified the Proposal's core factual claim independently: read
   `bin/quay-native.js`'s `edit` subcommand definition directly — confirmed
   `--body`, `--children`, `--extra` are **not** wired into the patch object
   for `edit` (only `create` exposes `--body`), matching the Proposal's
   claim exactly. This is a real, verifiable gap, not an invented one.
4. AC items are machine-checkable (each names a specific CLI flag + a
   specific verification command) and Plan phases map onto them 1:1.

**Verdict: ready-gate genuinely earned.** No discrepancy found.

### QN-003 — Port quay:author orchestration Skill

1. Fresh `quay-native task check QN-003 --json`: `acTotal: 4, acChecked: 0`,
   confirms `ready`.
2. Cross-checked each AC line against the actual current
   `skills/author/SKILL.md` content (not the authoring session's claim that
   it did this):
   - AC1 ("names `write-proposal`, `review-proposal`, `write-plan`,
     `review-plan` as four distinct steps... dispatch-capable... degraded
     fallback"): **confirmed** — `grep` shows all four step names present as
     numbered `**stepname**` headers, each followed by a "Dispatch-capable
     target" / "Degraded fallback" pair.
   - AC2 ("degraded-mode checklist matches, concretely, the checks iteration
     1 actually ran"): **confirmed** — the checklist items (heading +
     content presence, AC checkbox presence, Plan/AC alignment) match what
     was actually done for QN-001/QN-005/QN-004 in this session.
   - AC3 ("Gaps section states no subagent-dispatch primitive exists,
     citing the iteration 1 finding"): **confirmed** — the Gaps section
     leads with exactly this finding, citing the explicit `ToolSearch` check.
   - AC4 ("`quay-native task check QN-003` passes the `author->ready`
     gate"): this AC is self-referential (checking the gate that checks
     itself) — **confirmed indirectly**: the gate did pass (step 1), and the
     `author->ready` gate is presence/content-based (not touched by QN-003's
     own scope), so no circularity risk here.

**Verdict: ready-gate genuinely earned.** No discrepancy found.

### QN-004 — Port quay:execute orchestration Skill

1. Fresh `quay-native task check QN-004 --json`: `acTotal: 4, acChecked: 0`,
   confirms `ready`.
2. Cross-checked each AC line against `skills/execute/SKILL.md`:
   - AC1 (three named steps `implement-phase`/`self-audit-ac`/`gate-check`,
     each with dispatch/degraded pair): **confirmed** by direct grep.
   - AC2 ("self-audit is not a substitute for out-of-band G3 audit... `done`
     gate transition is provisional pending co-sign"): **confirmed** — the
     literal word "provisional" appears in exactly this context (line 88 of
     the file).
   - AC3 (Gaps section names the same no-dispatch-primitive finding):
     **confirmed**.
   - AC4 (gate passes): confirmed by step 1.
3. Independently verified the DoD's own honesty claim ("this task does NOT
   exercise quay:execute") against `experiments/quay-native-bootstrap/provenance.md`: as of this
   audit, `execute_by` is `seed` for every task — **confirmed true**, matches
   the DoD's explicit non-goal.

**Verdict: ready-gate genuinely earned.** No discrepancy found.

### QN-005 — Deepen task_check gate correctness

1. Fresh `quay-native task check QN-005 --json` returned:
   ```json
   {"id":"QN-005","gate":"execute->done","ok":false,"acTotal":2,"acChecked":0,
    "reason":"0/2 AC checkboxes checked"}
   ```
   This **did not match** the authoring session's own review-pass count of 4
   AC checkboxes. This is a genuine discrepancy, actively investigated rather
   than dismissed or silently reconciled.
2. Root-caused via direct regex/source inspection of
   `store.js#extractSection` (line 280):
   ```js
   const re = new RegExp(`^##\\s+${h}\\b([\\s\\S]*?)(?=^##\\s|\\Z)`, "im");
   ```
   **Finding: `\Z` is not a valid end-of-string anchor in JavaScript regular
   expressions** (JS has no `\Z`; only `$`/`\b` end anchors exist in this
   position). The engine parses `\Z` as an escaped literal capital letter
   `Z`. Combined with the `i` (case-insensitive) flag on this same regex,
   the lookahead `(?=^##\s|\Z)` therefore also matches any **lowercase
   `z`** anywhere in the remaining text — not just a real `##` heading.
3. QN-005's own AC section prose (describing the very gate defect this task
   proposes to fix) contains the word **"zero"** ("... when the `## AC`
   section has zero checkbox lines ..."). The extraction regex stops right
   at that "z", truncating the AC section after only 2 of its 4 real
   checkbox lines.
4. Confirmed this is content-triggered, not universal: re-ran
   `task check` against QN-001/QN-003/QN-004 — all three correctly report
   `acTotal: 4` because none of their AC prose happens to contain a bare
   `z`/`Z` before the next real heading. QN-005 is uniquely affected by its
   own subject matter.
5. Confirmed via minimal repro (`node -e` script isolating the regex against
   synthetic strings) that a literal case-insensitive `Z`/`z` match, not a
   heading, is what ends the capture — ruling out an alternative hypothesis
   (e.g., a stray real `##` heading in prose) definitively.

**Verdict: this is a genuine, reproducible `store.js` bug — pre-existing
since iteration 0 (the `\Z` typo was already in the code QN-006 shipped),
never previously exercised against prose containing "z", and surfaced only
now because QN-005 is (fittingly) the first task whose own AC content
happens to trigger it.**

**Gate-honesty implication for QN-005 itself:** the `todo->ready` gate that
`quay:author` used to advance QN-005 is **presence-only** (per QN-005's own
Proposal) and was unaffected by this bug (all four headings were correctly
found present). The bug affects the **`ready->done`** checkbox-counting path,
which was not exercised this iteration (QN-005 was not driven to `done`).
**QN-005's `ready` status itself is not compromised by this finding** — but
the finding is material evidence that QN-005's own proposed fix is well-
motivated, and it should be added to QN-005's own Proposal as a second,
concrete repro case in a future iteration (recommended, not done here — see
Gap Analysis in iteration-1.md; fixing `store.js` mid-audit would exceed this
iteration's authoring-only scope and G5's restraint guardrail).

## Step 3 — verdict

```
verdict (QN-001): ready — genuinely earned, no discrepancy
verdict (QN-003): ready — genuinely earned, no discrepancy
verdict (QN-004): ready — genuinely earned, no discrepancy
verdict (QN-005): ready — genuinely earned for the todo->ready gate audited;
  BUT this audit surfaced a real, reproducible defect in store.js's
  extractSection() (literal-Z / \Z-is-not-JS-anchor bug) affecting AC-
  checkbox counting for any task whose AC prose contains a bare "z"/"Z"
  before the next real heading. Filed as a new finding, not silently patched.
auditDepth: full, all four tasks
independence: same-session adversarial re-derivation (NOT a fresh-context
  dispatched subagent — see Step 0). This is the same class of limitation as
  iteration 0, exercised with more rigor (active discrepancy-hunting, one
  found and root-caused), but does not satisfy protocol §7 criterion 4 in
  the fully independent sense.
```

## Limitation (honesty note, per G3/G4)

Same structural limitation as `iteration-0-adjudicate.md`: this audit was
performed by the same class of session (single tool-calling context) that
performed the authoring, not a separately dispatched, fresh-context
subagent. Iteration 1 explicitly re-confirmed (rather than assumed, per G1)
that no dispatch primitive exists in this environment to do otherwise (see
Step 0). Unlike iteration 0 — which found no discrepancies and therefore
could not demonstrate its own rigor — this iteration's same-session audit
**did** find and root-cause a real, independent-of-the-author's-own-claims
discrepancy (QN-005's `acTotal` mismatch), which is meaningful evidence this
audit method has some real teeth even without full session independence.
However, this does **not** upgrade the finding to a true G3 pass: a same-
session auditor still shares the author's blind spots by construction for
anything neither party thinks to check (e.g., neither the authoring pass nor
this audit pass initially suspected `\Z`'s JS semantics — it was found only
by adversarially re-deriving the gate's numeric output and refusing to accept
a mismatch as "probably fine"). **Protocol §7 criterion 4 ("out-of-band audit
passed") is therefore still NOT satisfied at iteration 1**, for the same
underlying reason as iteration 0 (no fresh-context dispatch primitive
available in this environment) — see iteration-1.md's Convergence Check.
