# DIR-006

- status: pending
- created_by: human (Yale), asserted directly in this live conversation
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
