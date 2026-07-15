# Iteration 5 — Independent Adjudicate Audit

Conducted with zero prior context from `iteration-5.md` or the existing
`iteration-5-adjudicate.md` — all findings below are derived directly from
raw artifacts (task files, source code, live CLI invocations, live test
runs, and hand-crafted synthetic probes) in this repo as of 2026-07-15.

## Claim 1 — Epic decomposition (QN-008 / QN-009 / QN-010 / QN-011)

**Verdict: PASS**

- Raw frontmatter of `tasks/QN-008.md`: `status: done`, `children: [QN-009,
  QN-010, QN-011]`, `parent: null`, `labels` include `epic`.
- Raw frontmatter of `tasks/QN-009.md`, `QN-010.md`, `QN-011.md`: each has
  `parent: QN-008`, `children: []`, `status: done`.
- Live CLI check (`QUAY_NATIVE_TASKS_DIR=/home/yale/work/quay/tasks node
  packages/quay-native/bin/quay-native.js task get <id> --json`):
  - QN-008 → `"role": "compound"` (derived from non-empty `children`).
  - QN-009 / QN-010 / QN-011 → `"role": "primitive"` each (derived from
    empty `children`).
  - This matches `store.js`'s documented derivation rule exactly
    (`role: children.length > 0 ? "compound" : "primitive"`, never stored,
    always computed) — confirmed by direct code read, not just output.
- QN-008's own AC/DoD read as genuine integration-level acceptance,
  distinct from any child's own AC:
  - AC items: "QN-009/010/011 exist as children ... each independently
    reaches done"; "after all 3 children are done, the full
    view-model.test.mjs passes"; "the full quay-native regression suite
    passes ... re-verified after all 3 children's changes are merged
    together (not just each child's own isolated verification)"; "a live
    `quay task list --provider github --json` call ... reflects the
    combined effect of all 3 fixes."
  - None of these four AC items duplicate a child's own AC verbatim; they
    are explicitly phrased at the assembled-system / integration level
    ("not merely inferred from each child's own DoD having passed
    individually" appears verbatim in QN-008's DoD). This is a real,
    distinct acceptance bar, not a rubber-stamped copy.

## Claim 2 — Three bug fixes in `packages/quay-github/src/github-client.js`

**Verdict: PASS** (all three fixes are real, functioning, non-decorative)

### 2a. Parent/children mapping

- Real logic present: `CHILD_CHECKBOX_RE` regex, `extractChildRefs(body)`
  (parses `- [ ] #N` / `- [x] #N` lines, de-duplicates, order-preserving),
  and `buildParentIndex(issues)` (reverse-scans a full issue list into a
  `childId -> [parentIds]` map), all wired into `issueToViewModel` and
  `list()`/`get()`.
- Live check of real issues (`gh issue list --repo yaleh/quay --state all
  --json number,title,body,labels`): none of the 4 real issues (#1-#4) use
  checkbox-referencing syntax in their bodies — consistent with what
  QN-009/010/011's own DoD honestly state ("though none of the 4 real
  issues currently use checkbox refs, so this call is a no-regression
  check, not a positive-case check").
- Hand-crafted synthetic test (constructed independently, not copied from
  the existing test file), calling `issueToViewModel` directly with
  synthetic issue objects (not touching real GitHub state):
  - Parent issue body `"- [ ] #11\n- [x] #12\n- [ ] #12\n"` →
    `children = ["gh-11", "gh-12"]` (de-duplicated, order-preserved),
    `role = "compound"`. Confirmed.
  - Supplying a hand-built `parentIndex` Map with an ambiguous case
    (`gh-11` referenced by both `gh-10` and `gh-20`) → child's `parent`
    resolves to first-found (`gh-10`), and `extra.multipleParents =
    ["gh-10", "gh-20"]` surfaces the ambiguity rather than silently
    dropping it. Confirmed.
  - Unambiguous case (`gh-12` referenced only by `gh-10`) → `parent =
    "gh-10"`, no `multipleParents` key present. Confirmed.
  - No `parentIndex` supplied (simulating `get()`'s single-issue path) →
    `parent = null` (documented limitation, not a silent regression).
    Confirmed.
  - All assertions passed; scratch script was deleted after use, no
    residue left in the repo.

### 2b. Pagination

- Real loop confirmed by reading `createGithubClient`'s `fetchAllIssues()`:
  a `for (let page = 1; page <= maxPages; page++)` loop calling `gh api`
  with explicit `per_page=100`/`page=<n>` params, breaking on a
  short/natural-end page (`if (batch.length < perPage) break`), and
  throwing a descriptive error if `issues.length >= maxIssues` is reached
  without a natural end. `maxIssues` defaults to `DEFAULT_MAX_ISSUES = 500`
  and is overridable via `process.env.QUAY_GITHUB_MAX_ISSUES`. This is a
  genuine, functioning loop with a real cap and a real failure mode — not
  decorative.

### 2c. Status-label tie-breaking

- `STATUS_PRECEDENCE = ["done", "needs-human", "ready", "todo"]` is defined
  and used: `issueToViewModel` now collects *all* `status:*` labels into
  `statusLabelsFound` (not just the last seen), and when more than one is
  present, sorts by index in `STATUS_PRECEDENCE` (unrecognized values sink
  to lowest precedence) and takes the top-ranked one.
- **Label-order-independence trace (synthetic, hand-run):**
  - Labels `["status:ready", "status:todo"]` (order A) →
    `issueToViewModel(...).status === "ready"`.
  - Labels `["status:todo", "status:ready"]` (order B, reversed) →
    `issueToViewModel(...).status === "ready"`.
  - **Result: IDENTICAL status regardless of label declaration order.**
    Old bug (last-write-wins / iteration-order-dependent) is confirmed
    fixed. `closed` state still unconditionally forces `"done"` per
    unchanged code path (`if (issue.state === "closed") status = "done";`
    executed after precedence resolution).
- The existing `packages/quay-github/test/view-model.test.mjs` independently
  covers this same property with its own two-orders test plus 3-way and
  closed-interaction cases (see Claim 3 below for its live run, all pass).

## Claim 3 — Regression check

**Verdict: PASS**

- `node packages/quay-github/test/view-model.test.mjs` → 14/14 assertions
  `PASS`, exit 0, final line `All quay-github view-model tests passed`.
- `packages/quay-native/test/abi-symmetry.mjs` → all four surfaces
  (`task_list`, `task_get`, `task_write`, `task_write` value/extra
  equivalence, `task_check`) report `"match": true`; final line `ALL FOUR
  SURFACES SYMMETRIC`, exit 0.
- `packages/quay-native/test/gate-correctness.test.mjs` → all 13 assertions
  `PASS`, exit 0, final line `All gate-correctness tests passed.`
- `packages/quay-native/test/lock.test.mjs` → all 7 assertions `PASS`,
  exit 0, final line `All QN-006 lock tests passed.`
- `packages/quay-native/test/concurrent-writer.mjs` is **not** a
  standalone regression test — it is a helper script spawned with CLI args
  by `lock.test.mjs` (confirmed via `grep` showing `lock.test.mjs` invoking
  it as a child process via `path.join(__dirname, "concurrent-writer.mjs")`
  and passing arguments). Running it directly with no arguments throws
  (expected/irrelevant, not a regression).
- Spot-checked QN-001, QN-005, QN-007 via `task check`: all three report
  `PASS — terminal` (clean, `done`, gate `none`, `ok: true`).

## Claim 4 — Provenance honesty spot check

**Verdict: PASS**

- `experiment/provenance.md`'s table rows for QN-008/009/010/011 all show
  `author_by = execute_by = gate_by = native`, footnoted `**` with an
  explicit paragraph distinguishing QN-008's own record from its children's:
  QN-008 "did not implement anything new"; its `execute_by = native` is
  earned specifically by re-running `quay:execute`'s `executeEpic` branch
  (ensureChildrenExist / driveEach / integration acceptance) and is
  explicitly labeled "a genuinely new *kind* of native provenance (epic
  integration, not leaf implementation)" rather than being silently folded
  into the same bucket as a leaf task's `execute_by`.
  - Independently confirmed: the underlying integration-acceptance items
    QN-008 documents (view-model.test.mjs 14/14, quay-native's 3-file
    regression suite, a live `task list --provider github --json` call)
    match what this audit independently re-ran and reproduced.
- The document explicitly flags the σ = 0.727 headline as a **weaker**
  bootstrap-maturity signal than prior iterations' σ increases, because it
  is driven substantially by new tasks created and completed within the
  *same* iteration (QN-008/009/010/011), not by an old seed-authored
  backlog item finally retiring seed dependency — this caveat is stated
  plainly, not buried or omitted. This is a materially honest disclosure
  that works against the document's own reported headline number, which is
  a positive signal for provenance integrity.
- Same-session execution (author/execute/gate all performed in one
  continuous session) is expected and permitted under the stated protocol;
  the document does not misrepresent this as multi-session or
  independently-reviewed work — it explicitly and repeatedly notes the
  "same-session degraded-fallback mode" and the absence of a
  subagent-dispatch primitive.

## Claim 5 — General sanity (does anything look silently broken?)

**Verdict: PASS-WITH-CONCERNS — one real gap found, but honestly pre-declared, not hidden**

- `store.js`'s `check(id)` function (the actual mechanical gate used by
  `quay-native task check`) has **no role-aware (compound vs. primitive)
  branch at all**. For a task whose `status === "done"`, `check()`
  unconditionally returns `{ gate: "none", ok: true, reason: "terminal" }`
  — confirmed live: `task check QN-008 --json` today returns exactly that,
  regardless of whether its children are actually done or whether
  integration tests still pass. In other words, **the mechanical gate does
  not itself re-verify "all children done + integration regression
  passes"** for a compound task — that verification happened as
  process-level work performed by the executing agent (per
  `quay:execute`'s documented `executeEpic` pseudocode in
  `skills/execute/SKILL.md`), and was recorded narratively in QN-008's own
  DoD/provenance entry, not enforced by any code path in `store.js`.
- This is a real, load-bearing limitation for anyone relying on `task
  check` alone to re-validate a compound task's integrity after the fact
  (e.g., if a child were later silently reverted to `todo`, `task check
  QN-008` would still report `ok: true, reason: terminal` with no
  cross-check against child state).
- However, this gap is **not silently introduced by this iteration** — it
  is a natural consequence of `store.js`'s pre-existing, generic
  presence/checkbox-based gate design (unchanged by QN-008/009/010/011),
  and `skills/execute/SKILL.md`'s own "Gaps (honestly declared)" section
  already states the epic branch was, before this iteration, "unexercised
  ... untested code-as-documentation, not a validated path" — i.e., the
  design was always aware this branch runs on Skill-level process
  discipline, not on a mechanical enforced gate. This iteration's
  provenance entry does not claim otherwise; it explicitly ties QN-008's
  `execute_by = native` to "re-running `quay:execute`'s documented method,"
  not to any automated re-verification `store.js` performs.
- Recommendation (not a blocking finding): a future task should add a
  `role === "compound"` branch to `check()` that mechanically verifies all
  `children` are themselves `status: done` before allowing `ready -> done`
  or reporting `ok: true` on a `done` compound task — currently this is
  purely a human/agent-process convention, not code-enforced.

## Overall Verdict

**PASS.** All five claims independently verify as described. The epic
decomposition is real (frontmatter, derived `role`, and genuinely distinct
integration-level AC/DoD all check out via live CLI). All three
`github-client.js` bug fixes are real, non-decorative, and independently
reproducible via hand-crafted synthetic tests, including the
label-order-independence property (traced directly: both orderings resolve
to `"ready"`, no last-write-wins observed). All named regression suites
pass (view-model.test.mjs 14/14, abi-symmetry, gate-correctness, lock).
Provenance labeling is honest, including a caveat that works against the
iteration's own headline σ number. The one substantive concern is that the
mechanical `task check` gate has no compound-aware re-verification logic —
a real, currently-undetected-by-tooling gap, but one the design/Skill docs
already flag as an intentionally-unenforced process convention, not a
newly introduced or concealed defect.
