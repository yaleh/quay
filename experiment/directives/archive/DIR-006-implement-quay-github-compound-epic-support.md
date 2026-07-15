# DIR-006

- status: applied
- created_by: human (Yale), asserted directly in this live conversation
  (hedged per standing rule — this session cannot itself verify the exact
  provenance of that assertion beyond the artifact's own claim; acted on
  regardless, per iteration 24's own correct precedent)
- created_at: 2026-07-15
- title: Implement and verify quay-github compound/epic (children non-empty) task support — reject the "deliberately out of scope" deferral

## Finding

`packages/quay-github/DESIGN.md` documents `children`/`parent` mapping,
`checkGate()`'s compound path, and `executeEpic`'s compound recursion as
**deliberately out of scope for v1**, with the stated justification being
that "this experiment has never had a real compound/epic GitHub-backed
task (`children` has always been empty for both real issues used so far)"
— i.e., the gap is left open because no real compound GitHub issue has
organically appeared in the `yaleh/quay` repo's issue backlog to motivate
the work. Iterations 19-23 (five consecutive iterations, per this
conversation's own review of `experiment/iterations/iteration-{19..23}.md`)
each re-confirmed this same live `gh issue list` check finds no compound
issue and treated the axis as unchanged/closed for that reason. This is
the direct cause of convergence criterion 3 ("contract proven: native +
GitHub both run") remaining **NO** as of iteration 23 — the two Providers
are not actually ABI-symmetric for compound/epic tasks, only for primitive
ones; native's `childrenStatus()` recursion has never been exercised
against a GitHub-backed equivalent at all.

This human directive explicitly rejects "no organic backlog growth" as a
sufficient reason to leave this permanently unimplemented and unverified.
Absence of a naturally-occurring compound issue is not evidence that the
capability is unneeded or that the ABI-symmetry claim can be left
unproven — it is a gap in test/verification setup, not a scope boundary.

## Requested action

A future iteration (or a directed follow-up) must:

1. Create a real compound/epic task structure in the `yaleh/quay` GitHub
   issues backend — a parent issue whose body contains `- [ ] #N` /
   `- [x] #N` checkbox lines referencing one or more real child issues in
   the same repo (per `github-client.js`'s documented `children` parsing
   rule) — rather than waiting for one to appear organically.
2. Implement whatever is currently missing to make
   `packages/quay-github/src/github-client.js`'s `children`/`parent`
   mapping, `checkGate()`'s compound path, and `bin/quay-github.js`'s
   `executeEpic` compound-recursion path actually work end-to-end against
   that real structure — matching native's `childrenStatus()` compound
   convention (design §2), per `quay-github/DESIGN.md`'s own stated intent.
3. Verify this live, the same standard already used for every other
   quay-github capability in this experiment (e.g. QN-028's gate,
   QN-029's skill): real `gh api`/CLI calls against the real compound
   issue structure, not mocked or simulated — asserting the exact
   observed output shapes, not merely restating the design doc's claims.
4. Update `quay-github/DESIGN.md` to remove or narrow the "deliberately
   out of scope" framing once implemented and verified, and record the
   result in `provenance.md` / the relevant task file(s) so it counts
   toward convergence criterion 3.
5. If, after genuinely attempting the above, some sub-part is found to be
   infeasible or disproportionate (e.g. GitHub's structured sub-issues
   preview API), that determination must be reached by actually attempting
   the checkbox-based path this repo already documents as its chosen
   mechanism first — not reasserted from the prior "no organic issue
   exists" reasoning this directive rejects.

## Resolution
<!-- filled in by whichever iteration applies, defers, or rejects this directive -->

### Progress note (iteration 24, 2026-07-15) — DEFERRED, not applied, not rejected

**This directive appeared in `experiment/directives/pending/` mid-session**,
after this iteration's own `ls experiment/directives/pending/` precondition
check at the very start (confirmed empty at that time — see §2 of
`experiment/iterations/iteration-24.md`) and after this iteration had
already substantially completed its own planned increment (QN-034,
`bin/quay-github.js`'s CLI dispatch layer, driven fully to `done` and
gated). It was discovered only while staging this iteration's commit
(`git status --short` unexpectedly showed a new untracked
`experiment/directives/pending/` entry).

**Honest assessment of scope, performed before deciding to defer rather
than rush:**

- This is a substantial, well-scoped, legitimate piece of real
  implementation work, not a small addendum. Confirmed by reading
  `packages/quay-github/src/github-client.js` and
  `packages/quay-native/src/store.js` side by side: native's
  `childrenStatus()` (store.js lines ~191-210) recursively fetches each
  child task and aggregates status/gate results, and `check()`'s compound
  branch (lines ~412-469) requires all children `done` before a compound
  task's own `execute->done` gate passes. `github-client.js`'s
  `checkGate()` has **no equivalent recursion at all** — porting it
  requires: (a) a live-fetching children-status helper (paralleling
  `childrenStatus`, but calling `get()` on each child issue number via
  real `gh api` calls, recursively), (b) wiring it into `checkGate()`'s
  `ready`/`done` branches the same way native's does, (c) creating a REAL
  parent+child issue pair in the live `yaleh/quay` repo (this directive's
  own point 1 — no synthetic/mocked fixture is acceptable per the
  directive's explicit rejection of "no organic issue" reasoning), and (d)
  live-verifying the whole path end-to-end, the same evidentiary standard
  every other quay-github capability in this experiment has met (QN-028,
  QN-029).
- This is realistically a multi-step, multi-hour scope of its own — not
  something to compress into the tail end of an iteration whose own
  planned work (QN-034) was already complete, gated, and evidenced before
  this directive was even discovered. Attempting to rush it now would risk
  exactly the failure mode G1/G5 warn against: a hastily-authored task,
  under time pressure, with a real risk of shallow or incompletely
  live-verified evidence being represented as equivalent in rigor to
  QN-028/QN-029's own careful precedent.
- **Deferred, not rejected**: this directive's substance is accepted as
  correct and important — it correctly identifies that convergence
  criterion 3 ("contract proven: native + GitHub both run") cannot
  honestly read anything but NO while compound/epic support remains
  unimplemented on the GitHub side, and correctly rejects "no organic
  issue has appeared" as a permanent excuse rather than a temporary gap.
  Iteration 24's own report (`experiment/iterations/iteration-24.md`)
  independently reached a compatible, though narrower, finding on this
  same point in its own criterion-3 discussion, before this directive was
  even discovered — the two assessments corroborate each other.
- **This file correctly stays in `pending/`** (per the README's own
  lifecycle rule for `deferred`), to be read and acted on as the primary,
  first-priority target of iteration 25's own OBSERVE step — ahead of any
  further `skeleton`-axis search, per this directive's explicit priority
  as a human-asserted steering intervention (see the README's own
  discussion of directives as a distinct, out-of-band artifact class from
  ordinary backlog prioritization).

**No part of the requested action (points 1-5) was attempted this
iteration** — not even a partial start — specifically to avoid a rushed,
partial implementation being mistaken for genuine progress. This is a
deliberate, complete-honesty deferral, stated plainly rather than
disguised as partial completion.

## Resolution

- **resolved_by:** iteration 25
- **outcome:** applied
- **evidence:** `experiment/iterations/iteration-25.md` (full transcript);
  `tasks/QN-035.md` (Proposal/Plan/AC/DoD, driven `todo → ready → done`
  natively); `experiment/provenance.md`'s iteration-25 section;
  `packages/quay-github/src/github-client.js` (`childrenStatus()` added,
  `checkGate()`'s `ready`/`done` branches extended);
  `packages/quay-github/test/compound-gate.test.mjs` (24 new passing
  assertions); `packages/quay-github/DESIGN.md` §3.5/§3.6 (compound/epic
  framing updated from "deliberately out of scope" to "implemented,
  live-verified"); real GitHub issues #5, #6, #7 in `yaleh/quay` (retained,
  not deleted, as durable evidence).

**All five requested actions were completed, in full, this iteration —
not deferred a second time:**

1. **A real compound/epic structure was created in `yaleh/quay`** — issue
   #7 (parent epic), body referencing child issues #5 and #6 via the
   `- [ ] #N` checkbox convention `extractChildRefs()` already parses.
   Not a synthetic/mocked fixture — real, durable GitHub issues, clearly
   labeled `[QN-035-fixture]` and left in the repo afterward.
2. **`childrenStatus()` was implemented in `github-client.js`**, a direct,
   structurally-comparable port of native's `store.js#childrenStatus()`
   (QN-012/QN-016 semantics: recursion, cycle-safety, stale-done rollup),
   adapted for live per-child fetching via an injected `getChildTask`
   function. `checkGate()`'s `ready` and `done` branches now require all
   children `done` for a compound task; primitive tasks are provably
   unaffected (existing `gate.test.mjs`'s 19 assertions pass unchanged).
   `bin/quay-github.js` itself required zero changes — `executeEpic`'s own
   compound recursion is Skill-level orchestration (`skills/execute/
   SKILL.md`) that already called the generic, provider-parameterized
   `quay task check <id> --provider <provider>` path (QN-029); it is this
   gate the recursion depends on, and that gate is what this task fixed.
3. **Live-verified end-to-end against the real structure**, the same
   evidentiary standard as QN-028/QN-029: `quay-github task check gh-7
   --json` correctly reported `ok:false` (naming the blocking child)
   while #6 was open, `ok:true` once both children were closed, correctly
   re-verified children on the compound `done` branch, and correctly
   flipped back to `ok:false` under an adversarial reopen-while-done
   regression test (exit code 1) — proving real teeth, not a static pass.
   Core's generic `quay task check --provider github --json` passthrough
   was confirmed byte-identical to `quay-github`'s own direct CLI output
   at both the "before" and "after" states.
4. **`packages/quay-github/DESIGN.md` updated** — header status line
   (v1.3 → v1.4), §3.5 (gate path) and §3.6 (skill path) both rewritten to
   describe compound/epic support as implemented and live-verified, with
   the full transcript summarized inline; the separate (and still
   correctly out-of-scope) GitHub structured sub-issues preview API
   distinction was left untouched, since DIR-006 targeted the checkbox
   convention specifically, not that separate API.
5. **No sub-part proved infeasible.** The checkbox-based convention this
   repo already documented as its chosen mechanism (rather than GitHub's
   preview sub-issues API) was the one actually implemented and verified,
   per DIR-006's own point 5 preference-ordering.

This directly moves convergence criterion 3 ("contract proven: native +
GitHub Provider both run") meaningfully forward — see
`experiment/iterations/iteration-25.md` §10 for the full, honest
re-assessment (it is not yet unconditionally YES; the remaining precise
gap, if any, is stated there rather than glossed over).
