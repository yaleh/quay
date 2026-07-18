# M14-cli-edit-parity — iteration-0

**Milestone:** M14-cli-edit-parity (design-doc-only, DIR-011) · **Iteration:** 0 · **Branch:**
`exp5-m14-iteration-0` · **Worktree:**
`experiments/quay-perpetual-stream/milestones/M14-cli-edit-parity/worktrees/iteration-0` ·
**Commit:** `6ce284e`

## §1. Scope executed

Charter's 4 in-scope items, all executed exactly as scoped (design-doc-only, no product code
touched):
1. Wrote `docs/proposals/exp5-cli-edit-parity.md` covering DIR-011's 4 numbered items.
2. Did NOT implement — no `packages/quay/bin/quay.js` edit, no `inherited-core.md` edit, no
   provider write code change.
3. Cross-referenced real precedent (native CLI's existing `task edit` flags, MCP `task_write`
   schema, M09 PR-ABI-001 hard-error floor) rather than re-deriving from scratch.
4. Stated a concrete two-provider verification plan worked through for 2 relaxed fields
   (`--title`, `--extra`).

## §2. HARD GATES — literal output

```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
(no output — directory is empty; exit code 0)
```

Disposition: pending/ is empty, no directive needed disposition this iteration.

```
$ pwd
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M14-cli-edit-parity/worktrees/iteration-0

$ git branch --show-current
exp5-m14-iteration-0
```

Confirms operation inside the correct worktree on the correct branch. All file writes (the new
design doc + the `backlog.md` bookkeeping edit) were made via file tools targeting absolute paths
rooted under this worktree directory. Verified no leak into the shared main-repo path:

```
$ ls -la /home/yale/work/quay/docs/proposals/exp5-cli-edit-parity.md
ls: cannot access '/home/yale/work/quay/docs/proposals/exp5-cli-edit-parity.md': No such file or directory
```

(Expected and confirmed — the file exists only inside the worktree's own `docs/proposals/`, not
duplicated at the same relative path in the main tree.)

## §3. Section-by-section mapping (design doc → DIR-011 item)

| Design doc section | DIR-011 item(s) answered |
|---|---|
| §1 Core CLI `task edit` full-field parity | 1 |
| §2 Provider-capability handling | 2 |
| §3 Portable-metadata rule (proposed wording) | 3 |
| §4 Non-goals | 4 |
| §5 Verification plan (worked, ≥2 fields, both providers) | item 2's verification requirement |
| §6 Done-when clauses for a future implementing milestone | charter in-scope item 4 / Done-when 5 |

This table is reproduced verbatim as the doc's own "Table of contents / DIR-011 item map" section
(`docs/proposals/exp5-cli-edit-parity.md` lines 12-22 in the worktree).

## §4. Evidence for all 7 charter Done-when clauses

**Clause 1 — doc exists and addresses all 4 DIR-011 items, with pasted section mapping.**
Table above (§3) is the pasted mapping; file present:
```
$ ls docs/proposals/exp5-cli-edit-parity.md
docs/proposals/exp5-cli-edit-parity.md
```
MET.

**Clause 2 — concrete recommendation (not a menu) for whole-body-replacement mode.**
Doc §1.3 states: *"recommend `--body-file <path>` as the first-class whole-body-replacement mode,
with `-` accepted as a `<path>` value meaning 'read from stdin.' Do **not** add a second, separate
`--body-stdin` boolean flag."* Followed by a rejected-alternatives list (plain `--body <string>`
alone, separate `--body-stdin` boolean, interactive `$EDITOR` launch) each with a stated reason for
rejection, and an implementation sketch (`resolveBody(flags)`). This is a single concrete
recommendation, not an enumerated menu left open. MET.

**Clause 3 — actual proposed portable-metadata-rule wording, insertable prose, cross-referenced to
M13's doc.**
Doc §3.2 contains the literal insertable prose block (a `### Portable-metadata convention
(body-first, extra{} native-only)` section with MUST/MAY normative language, ready to paste into
`inherited-core.md` or a provider-ABI doc verbatim). Doc §3.1 states the cross-reference explicitly:
*"`docs/proposals/exp5-task-backlog-primitive-projection.md` §11... already assumes and depends on
this exact rule for DIR-009 item 11... explicitly notes: 'The Core CLI edit-surface work actually
needed to write these body sections and labels through the CLI... is correctly split out to
DIR-011/`M-CLI-EDIT-PARITY`.'"* — quoting M13's doc's own words. MET.

**Clause 4 — verification-plan section worked through for ≥2 relaxed fields against both
providers, worked example not just "add tests."**
Doc §5.1 (`--title`, supported on both) and §5.2 (`--extra`, native-supported / GitHub
hard-errors) each contain literal worked JS-style pseudocode assertions (task_get before/after
snapshots, exit-code assertions, exact expected stderr regex against the real PR-ABI-001 message
text), citing the existing `task_write-unsupported-field-probe` and
`task_write-hard-error-floor-probe` in `provider-abi-conformance.test.mjs` (lines 224-252) as the
precedent shape being extended. MET.

**Clause 5 — "Done-when clauses a future implementing milestone would need" section, itself a
checklist.**
Doc §6 is a 10-item `- [ ]` checklist (CLI handler diff, `--body-file`/stdin, `--append-notes`,
`inherited-core.md` insertion, `--title` probe, `--extra` probe, `--labels`/`--parent`/`--children`
probes, README/DESIGN doc update, full test suite pass, `git diff --stat` confirmation). MET.

**Clause 6 — no product code / `inherited-core.md` / provider ABI file modified; confirm via
`git diff --stat` against pre-charter base commit, pasted.**
```
$ git diff --stat f7dfccb7c576a16526b19a40a078f5b143a18751
 docs/proposals/exp5-cli-edit-parity.md       | 442 +++++++++++++++++++++++++++
 experiments/quay-perpetual-stream/backlog.md |   2 +-
 2 files changed, 443 insertions(+), 1 deletion(-)
```
Only the new doc file plus this milestone's own `backlog.md` bookkeeping row (clause 7's own
required update, one line) changed. No `packages/quay/bin/quay.js`, no `inherited-core.md`, no
provider ABI file (`packages/quay-github/*`, `packages/quay-native/*`) touched. MET.

**Clause 7 — `backlog.md`'s `M-CLI-EDIT-PARITY` row updated at ABSORB, pointing at the finished doc,
marked DONE; pasted diff.**
```diff
-| M-CLI-EDIT-PARITY | Design (doc only) for relaxing the Core CLI's status-only `task edit` to full-field editing (`--title`/`--body`/`--labels`/`--extra`/`--parent`/`--children`/`--append-notes`), bringing it to parity with the native provider CLI and MCP `task_write` it already fronts; plus formalizing the portable-metadata convention (structured body section = cross-provider, `extra{}` = native-only mirror) verified against the GitHub provider's hard-error floor (M09 PR-ABI-001). | CLI (Core, `packages/quay/bin/quay.js`) | DIR-011 | explore | capability-growth (CLI surface) + risk/option (removes the edit-surface asymmetry M-TASK-BACKLOG-PROJECTION would otherwise have to work around) | Backlogged, design-only per the same human routing decision as DIR-009. Plausibly carries a small positive VT Δv̂ on the CLI surface (unlike DIR-009/010, which are pure method infra) — size it at SELECT time. Depends conceptually on M-TASK-BACKLOG-PROJECTION's body-vs-extra convention landing first, though the two can be designed independently. |
+| M-CLI-EDIT-PARITY | Design (doc only) for relaxing the Core CLI's status-only `task edit` to full-field editing (`--title`/`--body`/`--labels`/`--extra`/`--parent`/`--children`/`--append-notes`), bringing it to parity with the native provider CLI and MCP `task_write` it already fronts; plus formalizing the portable-metadata convention (structured body section = cross-provider, `extra{}` = native-only mirror) verified against the GitHub provider's hard-error floor (M09 PR-ABI-001). | CLI (Core, `packages/quay/bin/quay.js`) | DIR-011 | explore | capability-growth (CLI surface) + risk/option (removes the edit-surface asymmetry M-TASK-BACKLOG-PROJECTION would otherwise have to work around) | **DONE (m14, 2026-07-18, design delivered — NOT yet charter-ready for implementation).** `docs/proposals/exp5-cli-edit-parity.md` (iteration-0) covers all 4 DIR-011 items: full-field `task edit` relaxation design with a concrete `--body-file <path>`/`-`-for-stdin whole-body-replacement recommendation (§1); provider-capability handling reusing the existing M09 PR-ABI-001 hard-error floor unchanged, with a correction that `parent`/`children` are no longer GitHub-unsupported post-M12 — only `extra` remains hard-error-rejected (§2); the actual proposed portable-metadata-rule wording, insertable verbatim into `inherited-core.md`, cross-referencing `exp5-task-backlog-primitive-projection.md` §11's existing reliance on this rule (§3); and explicit non-goals (no GitHub `extra` write support, no MCP/native-CLI changes) (§4). Includes a worked two-provider verification plan for `--title` (supported both) and `--extra` (native-supported, GitHub hard-errors) (§5), and a dispatch-ready "Done-when clauses a future implementing milestone would need" checklist (§6). Zero VT points (design-only, as charter specified) — `git diff --stat` confirmed only the doc + this milestone's own charter/iteration/backlog bookkeeping changed, no product code touched. Still requires a future SELECT to charter and dispatch the actual implementation. |
```
MET.

**Note on the "backlog.md is outside packages/, so is it in scope for clause 6's 'no product
code' bar":** yes — `backlog.md` is exp5's own bookkeeping artifact (not product code, not
`inherited-core.md`, not a provider ABI file), and clause 6's own text explicitly carves out "this
milestone's own `iterations/`/`charters/` bookkeeping files" as expected touches; the `backlog.md`
row update is the SAME class of bookkeeping (required separately by clause 7), not a violation of
clause 6.

All 7 Done-when clauses: **MET.**

## §5. Content correction found during research (recorded, not silently absorbed)

DIR-011's own item 2 text (filed at the m12→m13 boundary) names `extra`/`parent`/`children`
together as GitHub-unsupported fields. Live inspection of
`packages/quay-github/src/mcp-server.js`'s `TASK_WRITE_SUPPORTED_FIELDS` set (post-M12-abi-
parent-write, already merged to `master` before this milestone was chartered) shows `parent` and
`children` are now IN the supported set — only `extra` remains hard-error-rejected among DIR-011's
originally-named fields. The design doc records this explicitly in §2.3 ("Post-M12 state:
`parent`/`children` are no longer GitHub-unsupported") rather than silently designing around the
stale DIR-011 framing, and carries the correction through consistently into §5.3's field-selection
rationale (choosing `--extra` as the still-current hard-error example, not `--parent`/`--children`).

## §6. it0 systematic-explore checks (per charter §4.4, recorded)

a. **Ceiling/floor arithmetic** — N/A, confirmed: this doc introduces zero VT-chart-scored claims
   (no numeric Δv, no coverage-fraction assertion) anywhere in its own text.
b. **Gate-hash/transclusion** — the charter's HARD GATES section is cited by reference
   (`GATE-HASH-REF`); the dispatching orchestrator resolved the literal gate text into this
   iteration's actual prompt (visible in the HARD GATES block reproduced in the prompt this
   iteration executed) — the literal text, not just the hash, was present at dispatch time, per the
   charter's own "Charter thinness ≠ agent prompt thinness" requirement.
c. **Dogfooding evidence-gate** — every clause in §4 above is backed by a pasted diff, section
   mapping, or worked example, not narrative alone.
d. **Domain-misfit audit-channel** — per charter's own it0d note, this milestone's domain (a design
   doc, no live external system, no product code) has no directly-applicable CI-job/audit-channel
   analogue, consistent with M06/M07/M13's own prior doc-only precedent. Recorded explicitly per the
   charter's instruction, not forced into a mismatched citation.

## §7. Reflection

**Learned:** DIR-011's own framing of "which fields are GitHub-unsupported" had gone stale by the
time this milestone was chartered (M12 closed the parent/children gap after DIR-011 was filed but
before M14 was selected) — worth explicitly re-verifying any directive's factual claims against
live code state at design time, not just citing the directive's original text, especially for
directives that named specific unsupported-field sets that a later milestone might have since
changed.

**Challenges:** None blocking. The `--append-notes` ABI gap (native has a dedicated
`store.appendNote` special-case with no `task_write`-schema equivalent) required an explicit
scoping decision (§4 of the design doc) rather than a direct citation, since no existing precedent
covers exposing it generically through the Core CLI without a new ABI tool — resolved as a
Core-CLI-only read-then-write convenience, flagged as an open design point for the implementing
milestone rather than over-specified here.

**Next focus:** per the charter's own sizing note, iteration-1 has real independent-re-derivation
material (checking the design doc's completeness against DIR-011's 4 items, and independently
verifying the 2 concrete decision points — whole-body mode, portable-metadata wording — rather than
rubber-stamping). Per the charter's Adversarial-audit gate section, iteration-0 does NOT recommend
skipping iteration-1 (no self-exemption claimed here).

## §8. Convergence status

Charter's inner termination condition 1 (Done-when complete & stable ≥1 iteration) is NOT yet met —
this is iteration-0; stability requires iteration-1's independent confirmation. All 7 Done-when
clauses are met as of this iteration; dispatch iteration-1 per the charter's own sizing/adversarial-
audit-gate guidance (no self-exemption authorized).

## §9. Artifacts

- Design doc: `docs/proposals/exp5-cli-edit-parity.md` (in worktree, commit `6ce284e`)
- Bookkeeping: `experiments/quay-perpetual-stream/backlog.md` `M-CLI-EDIT-PARITY` row updated (same
  commit)
- Commit: `6ce284e` on branch `exp5-m14-iteration-0`, worktree
  `experiments/quay-perpetual-stream/milestones/M14-cli-edit-parity/worktrees/iteration-0`
- Working tree status at close: clean (`git status` → "nothing to commit, working tree clean")
