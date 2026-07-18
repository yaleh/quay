# M12-abi-parent-write — out-of-band adversarial audit (dispatched by the outer loop)

## VERDICT: CONCERNS

No claim central to the VT arithmetic or the live-write capability is refuted — the parent/children
write capability genuinely works, is live-verified against a real GitHub repo (independently
re-confirmed by this audit, see §(c) below), and the Δv=+1.54 arithmetic recomputes cleanly. But
several of the milestone's *process* claims (true independence of iteration-0/iteration-1,
cleanliness of the merge resolution, completeness of a specific cross-file claim) do not hold up,
and one specific claim in the ABSORBed artifact (`capability-matrix.md`'s "PR-ABI-003 — CLOSED"
citation into `gap-list.md`) is flatly false — that file was never touched by M12 at all. These are
non-blocking (they do not undermine the underlying code's correctness) but they materially weaken
the "two fully independent re-derivations converged" narrative both iteration reports lean on, and
one — the merge-provenance mislabeling — is a genuine, checkable factual error in what's now on
`master`.

---

## (a) Claims with no pasted evidence nearby (narrative-only)

- **iteration-0 §9, "Not provisional"** claims its evidence is "settled, not drafted-pending-
  iteration-1," yet the artifact iteration-0 itself produced (`dashboard.md`'s M12 section, per its
  own §6 Done-when-6 diff) is not what ended up on `master` at all — see finding (d) below.
  iteration-0's confidence about its own work being final/settled did not anticipate that its work
  would be the one *discarded* at merge time, which somewhat undercuts the "not provisional" framing
  in hindsight, though this is not something iteration-0 could have known at write time.
- **capability-matrix.md's "Findings feeding the VT re-baseline" §4 (PR-ABI-003 — CLOSED)** claims
  `gap-list.md`'s corresponding row was updated ("Fix: ... `mcp-server.js`'s schema... updated...")
  in the style of the PR-ABI-001/002 precedent, but **no PR-ABI-003 row, or any M12 mention at all,
  exists in `experiments/quay-continuous-bootstrap/gap-list.md`** (verified by direct grep — zero
  hits for "M12" in that file; the log's last exp5 entry is "exp5 M09-gh-write iteration-1"). This
  claim is narrative-only and does not survive a check of the file it claims to have edited. See
  finding (c) for the concrete verification.

## (b) Evidence that doesn't actually support the specific claim made

- Not found as a distinct category beyond (a)/(c)/(d) — the `gh issue view`/MCP transcripts pasted
  in both reports genuinely correspond to the claims made about them (add/reassign/remove/
  preserve-checked-state), and this audit's own live `gh issue view` calls against `gh-11`/`gh-12`/
  `gh-13`/`gh-14` (see §(c)) corroborate the transcripts' shape and content. No curl-standing-in-for-
  browser-style substitution was found here (this domain has no browser-claim analog; the charter's
  evidence bar is `gh issue view` transcripts, which both reports genuinely provide).

## (c) Arithmetic that doesn't recompute cleanly

**It does recompute cleanly — independently re-verified by this audit, not just re-read from the
reports.**

```
$ python3 -c "print(23.50+18.00+18.40+18.00+12.75+20*13/13)"
110.65
$ python3 -c "print(20*(1.00 - 12/13))"
1.5384615384615374
```

- Prior total (m9/m11, unchanged): 109.11/120 (CLI 23.50 + MCP 18.00 + Web UI 18.40 + Packaging
  18.00 + Docs 12.75 + Provider-ABI 18.46 = 109.11).
- New total: 110.65/120. Δv = 110.65 − 109.11 = **+1.54**, matching the charter's own pre-dispatch
  ceiling estimate (§ "Δv̂ (rough estimate)") **exactly**, to the stated precision. Both iteration
  reports' own arithmetic re-derivations (iteration-0 §6 Done-when-6, iteration-1 Done-when clause
  6) match this audit's independent recomputation.
- This audit also independently re-ran the live test suite (`node --test
  packages/quay/test/provider-abi-conformance.test.mjs`) against the CURRENT `master` state and
  confirmed 23/23 scenario cells pass, real live GitHub API calls (fresh `gh-11`/`gh-12`/`gh-13`/
  `gh-14` reads/writes, not mocked), matching iteration-1's own pasted output line-for-line in
  structure (23 cells, not iteration-0's claimed 25 — see finding (d), since master runs only
  iteration-1's test file).
- This audit independently queried `gh issue view` against `gh-11`/`gh-12`/`gh-13`/`gh-14` directly
  (outside of any test run) and confirmed real, live issues exist on `github.com/yaleh/quay` with
  bodies/titles matching what both reports describe — these are not fabricated or hand-typed
  transcripts; the issue numbers, `createdAt` timestamps, and body text are internally consistent
  with real `gh api`/`gh issue` output shapes (JSON key ordering, ISO-8601 timestamps, realistic
  GitHub body text) and this audit reproduced equivalent output independently, not by re-running the
  exact same recorded commands.

## (d) VT deltas / merge-provenance that don't match without a stated reason — THE HEADLINE FINDING

**The two branches' merge order and conflict resolution silently discarded iteration-0's entire
implementation, and the ABSORBed dashboard/capability-matrix entries on `master` are 100%
iteration-1's content — still labeled "DRAFT (iteration-1, independent derivation)" — despite the
final merge commit's own message claiming it is "iteration-0 ... initial implementation."**

Evidence:

```
$ git log --oneline master -6
47898fe Merge M12-abi-parent-write iteration-0 (exp5 m12): initial implementation, ...
a1f581a Merge M12-abi-parent-write iteration-1 (exp5 m12): independent re-derivation, ...
6d76cdf exp5 M12-abi-parent-write iteration-1: INDEPENDENT re-derivation ...
4cb3ac6 docs(proposals): automatic conditional post-milestone release cadence for exp5
f172b29 M12-abi-parent-write iteration-0: real parent/children write for GitHub Provider
9ae3cd3 SELECT m12 = M-ABI-PARENT-WRITE: author charter ...

$ git log -1 --format="%P" a1f581a
4cb3ac6... 6d76cdf...     # iteration-1 merged FIRST, onto 4cb3ac6

$ git log -1 --format="%P" 47898fe
a1f581a... f172b29...     # iteration-0 merged SECOND, on top of iteration-1's already-merged state,
                           # with a real 5-file conflict (per the merge commit's own "# Conflicts:" list)
```

For every one of the 5 conflicted files, `master`'s current tree is **byte-identical to
iteration-1's commit and has ZERO diff against it**, while it differs substantially from
iteration-0's commit:

```
$ for f in packages/quay-github/src/github-client.js packages/quay-github/src/mcp-server.js \
           packages/quay/test/provider-abi-conformance.test.mjs \
           experiments/quay-perpetual-stream/dashboard.md \
           experiments/quay-perpetual-stream/milestones/M03-abi-eval/capability-matrix.md; do
  echo "$f: vs-iter1=$(git diff 6d76cdf 47898fe -- "$f" | wc -l) vs-iter0=$(git diff f172b29 47898fe -- "$f" | wc -l)"
done
github-client.js: vs-iter1=0 vs-iter0=327
mcp-server.js: vs-iter1=0 vs-iter0=90
provider-abi-conformance.test.mjs: vs-iter1=0 vs-iter0=265
dashboard.md: vs-iter1=0 vs-iter0=99
capability-matrix.md: vs-iter1=0 vs-iter0=87
```

Consequences, verified live on the current checkout:
- `github-client.js` on `master` exports `writeRelations`/`setChildCheckboxes` (iteration-1's
  names) — `writeChildren`/`writeParent`/`reconcileChildCheckboxes` (iteration-0's names, the
  functions its own Done-when 1 pasted a diff for) **do not exist anywhere in the current
  codebase.**
- `dashboard.md`'s M12 section on `master` is titled `### Chart-1 re-score (M12-abi-parent-write,
  Provider-ABI write completion) — 2026-07-18 — DRAFT (iteration-1, independent derivation)`
  (dashboard.md:224) — **still marked DRAFT**, never resolved to a final/CONFIRMED state the way
  M08's and M09's own iteration-1 dashboard sections explicitly were (compare dashboard.md:165,
  which reads "CONFIRMED (iteration-1)" for M09, vs. M12's still-DRAFT heading).
- `capability-matrix.md`'s parent/children write row and Summary section on `master` likewise say
  "(M12-abi-parent-write, iteration-1 draft — CLOSED)" and "(iteration-1, independent draft)"
  throughout (capability-matrix.md:30, :50, :117) — never finalized.
- The merge commit that is actually `HEAD` (`47898fe`) carries the message "Merge M12-abi-parent-
  write iteration-0 ... initial implementation" — **this description is now false of the tree it
  produced**: the tree is iteration-1's implementation, not iteration-0's, for every one of the 5
  product/doc files that had a real conflict.

This is not a claim that the WRONG code shipped — this audit re-ran the live test suite against
`master` (see §(c)) and it passes cleanly with real GitHub API calls, so the code that IS on
`master` (iteration-1's) is real and works. The finding is that **the outer loop's own merge/ABSORB
bookkeeping is currently inconsistent with itself**: two merge commits exist, their messages
describe the wrong content relative to what final `HEAD` contains, and the VT-bearing artifacts
(`dashboard.md`, `capability-matrix.md`) that are supposed to be the "system of record" per this
experiment's own DIR-009/DIR-011 discipline are stuck in an unresolved DRAFT state with an
iteration-1-only voice, never cross-checked/finalized against iteration-0's independently-derived
numbers the way M08/M09's own iteration-1 ABSORB explicitly did (e.g. dashboard.md:99-103's
"iteration-1 correction" pattern, present for M04 and M08 but absent for M12). The Δv=+1.54 number
itself is not wrong (both iterations independently derived the same figure, and it recomputes
correctly against the CURRENT capability table), but the paper trail claiming this was a resolved,
cross-checked ABSORB is not accurate: **no cross-check narrative exists on `master` reconciling
iteration-0's and iteration-1's independently-authored dashboard/capability-matrix text; one was
simply overwritten by a git merge, silently, and the DRAFT label was never removed.**

## (e) Scope creep or scope-exemption the milestone granted itself without outer-loop sign-off

- No evidence of scope creep in the code itself — both implementations stayed within the charter's
  in-scope-work items 1-6, and both explicitly declined to combine `parent`+`children` in one call
  (charter didn't require it), stating so rather than leaving it implicit (Done-when 2 met by both).
- One minor self-granted exemption worth flagging: iteration-0's it0 §3(d) explicitly declines to
  stand up a fresh Docker container (the domain-misfit audit-channel mechanism M09's own it0 used),
  reasoning that "the charter's it0d for M12 names the SAME mechanism ... without requiring a fresh-
  container re-run." This is a reasonable reading of the charter text (§4.4d only says "a THIRD
  reuse of this convention"), but it IS a narrower interpretation of an ambiguous clause, decided
  unilaterally by the inner iteration rather than flagged for outer-loop sign-off. Not blocking
  (M09's own container requirement was for a different reason — proving `gh` CLI availability in an
  isolated environment — which is orthogonal to this milestone's actual write-correctness claim),
  but it is a self-granted narrowing of an audit-channel requirement that the charter's own gate
  discipline (§4.4, "run and record BEFORE first work") arguably intends to be more binding than a
  single inner iteration's own reading of it.

## Additional findings from the "specific things worth scrutinizing" list

**Both iterations claim full bidirectional reassignment — is this backed by real evidence in BOTH
reports?** Yes, both reports independently paste real `gh issue view`/`task_get` transcripts showing
the checkbox line moving from one parent's body to another's in a single `task_write`/`writeParent`/
`writeRelations` call (iteration-0 §6 Done-when-4 scenario (e); iteration-1 Done-when clause 4,
Transcript A step 2/2b/2c). Iteration-0's version is slightly more thorough here — it includes an
honest disclosure that checked-state does NOT carry across a reassignment (§6 scenario (e)'s closing
paragraph), a nuance iteration-1's report does not explicitly call out (iteration-1's Transcript B
only tests checked-state preservation within the SAME issue, not across a reassignment). This is a
real, if minor, evidence-quality asymmetry between the two reports, though it doesn't invalidate
either.

**iteration-1's "near-identical scratch-issue framing" note — does this undermine independence?**
Partially, yes — this audit finds the independence claim is weaker than both reports present it.
Chronological evidence:

```
gh-12 createdAt: 2026-07-18T13:46:14Z   (title: "...created live by M12-abi-parent-write iteration-0...")
gh-13 createdAt: 2026-07-18T13:46:15Z   (same iteration-0 framing text)
gh-14 createdAt: 2026-07-18T14:39:55Z   (iteration-1's own creation)
9ae3cd3 (shared SELECT base) authored: 2026-07-18T13:42:39Z
f172b29 (iteration-0's commit) authored: 2026-07-18T14:36:52Z
6d76cdf (iteration-1's commit) authored: 2026-07-18T15:05:28Z
```

- Both branches' git ancestry is genuinely independent (`git merge-base f172b29 6d76cdf` = `9ae3cd3`,
  the shared base — neither branch is a descendant of the other, no git-history contamination).
- But **iteration-1's dispatch/work window (ending 15:05:28Z) falls entirely AFTER iteration-0's
  commit (14:36:52Z)**, and iteration-1 explicitly reused `gh-12`/`gh-13` — real, live, shared
  external state on `github.com/yaleh/quay` that iteration-0 had already created (13:46Z, ~50
  minutes before iteration-0 even committed) and already exercised with its own probes. This is not
  "convergent independent derivation" of a design decision (which would be a meaningful signal about
  agreement on write semantics) — it is iteration-1 finding and reusing artifacts that already
  existed in the ONE shared mutable resource both iterations write to (the real GitHub repo), which
  is a materially different (weaker) form of "independence" than, e.g., M09's iteration-1 explicitly
  re-deriving evidence from a FRESH worktree/fresh `npm install` before ever touching iteration-0's
  commit.
- The reports' own framing ("this is exactly the kind of convergent-independent-derivation signal
  the outer loop's iteration-0/iteration-1 comparison is designed to surface" — iteration-1's report)
  overstates what was actually observed: two independent CODE implementations converging on the same
  Δv arithmetic and write semantics IS a meaningful signal; two iterations sequentially sharing the
  same external mutable GitHub fixtures is not additional evidence of independence, and arguably
  weakens the isolation guarantee the "iteration-0/iteration-1 both independently reach the same
  answer" methodology is supposed to provide, since iteration-1's live-mutation evidence was
  collected against issues iteration-0 had already mutated and partially cleaned up (iteration-0's
  own §4 item 5 admits finding "stray state" left on `gh-13` from an even EARLIER crashed session,
  which it patched before running its own probes — meaning `gh-12`/`gh-13`'s history includes at
  least 3 different agents' mutations by the time iteration-1 used them).
- This audit finds no evidence iteration-1 read iteration-0's REPORT or DIFF/commit (git ancestry is
  clean, and the code iteration-1 wrote — different function names, different helper structure,
  different comment style — reads as genuinely independently authored, not copied). The concern is
  narrower: iteration-1's evidence-gathering process was not conducted against a clean-room GitHub
  fixture state, and its report's framing of the gh-12/gh-13 reuse as a positive "convergence signal"
  understates that this was actually a shared-state collision that a stricter protocol (fresh scratch
  issue numbers per iteration, as iteration-1 itself did for its OWN `gh-14`) would have avoided.

**Was the merge conflict resolved honestly (i.e., current code is one of the two iterations' real,
tested implementations, not an untested hybrid)?** Yes — confirmed in finding (d): `master`'s
5 conflicted files are byte-identical to iteration-1's commit, zero diff, not a hybrid. This audit
independently re-ran the full conformance suite against this exact `master` state (see §(c)) and it
passes with real live GitHub API calls, confirming the code that "won" the merge is genuinely
functional, not an untested Frankenstein merge. The concern is not correctness of the resolution but
its **mislabeling** (the merge commit that actually determined final content is titled as
iteration-0's, and the DRAFT dashboard/matrix content from iteration-1 was never promoted out of
draft status).

**Does `capability-matrix.md`'s "14 of 14 non-N/A cells full/full" claim hold up against a literal
table review?** Yes, arithmetically: the file lists 20 scored cells (4 capabilities × 5 fields), 6
of which are explicitly marked N/A (gate/skill's title/body/labels rows + skill's parent/children
row — capability-matrix.md:38,46), leaving 14; a literal read of the Read/Write/Gate/Skill tables
(capability-matrix.md:16-45) shows every remaining cell marked **full** for both native and github,
including the previously-open write/parent-children row (line 30, now "full" for github per M12).
14/14 is accurate as a description of the table's current content. (Whether that table's own
"CLOSED" / "iteration-1 draft" labeling has been properly finalized by the outer loop is the
separate concern raised in finding (d).)

## Summary of what was specifically tried (for the "NO REFUTATION FOUND" bar, not met, but documented)

- Re-ran `node --test packages/quay/test/provider-abi-conformance.test.mjs` against current
  `master` — genuine live GitHub API calls, 23/23 PASS, matches iteration-1's pasted output.
- Independently queried `gh issue view` against `gh-3`, `gh-11`, `gh-12`, `gh-13`, `gh-14` outside
  of any test run — confirmed real, live, internally-consistent GitHub state matching both reports'
  narrative (not fabricated).
- Independently recomputed the Δv=+1.54 / 110.65 arithmetic from the charter's stated per-capability
  weights — matches exactly.
- Diffed `master`'s tree against both `f172b29` (iteration-0) and `6d76cdf` (iteration-1) for all 5
  conflicted files — found master = iteration-1 exactly, zero-diff, for all 5.
- Grepped `gap-list.md` in full for "PR-ABI-003" and "M12" — zero hits, contradicting
  `capability-matrix.md`'s explicit claim that this file was updated with a PR-ABI-003 closure row.
- Checked commit/issue-creation timestamps to assess the "independent" framing of iteration-1's
  gh-12/gh-13 reuse — found iteration-1's work window falls entirely after iteration-0's commit, and
  its fixtures were not clean-room.

## Recommendation for the outer loop

1. Do not treat this milestone's ABSORB as fully closed-out bookkeeping-wise: `dashboard.md` and
   `capability-matrix.md` on `master` are still literally labeled DRAFT/iteration-1-draft. The outer
   loop should either (a) explicitly promote iteration-1's numbers to CONFIRMED (they are correct,
   per this audit's independent recomputation and live re-test) and remove the DRAFT language, or
   (b) author a short reconciliation note (in the style of M08's/M09's own iteration-1 dashboard
   sections) explaining that iteration-1's version was kept and why, since the merge silently
   discarded iteration-0's implementation without any such note existing anywhere in the merged
   history.
2. Fix or retract `capability-matrix.md`'s "PR-ABI-003 — CLOSED" citation into `gap-list.md`, since
   no such entry exists in that file — either add the row (to match the PR-ABI-001/PR-ABI-002
   precedent this same file cites) or correct the claim.
3. Consider whether the two merge commits' messages should be corrected or annotated — `47898fe`'s
   message currently misdescribes its own resulting tree content.
4. No code-level defect was found. The underlying capability (parent/children write, live-verified)
   is real and works, confirmed independently by this audit.

---
*Audit performed by an out-of-band dispatch per `inherited-core.md`'s "Adversarial-audit role"
section, working from the main checkout on `master` (commit `47898fe` at audit time), read-only
except for this report.*
