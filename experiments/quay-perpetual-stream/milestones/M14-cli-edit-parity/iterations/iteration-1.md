# M14-cli-edit-parity — iteration-1

**Mode:** INDEPENDENT re-derivation. Iteration-0's report/materials/worktree were explicitly NOT
read. This iteration derived the design doc fresh from the Tier-A charter, Tier-B inherited-core
pointer, DIR-011's archived source, M13's delivered doc, and the cited product code
(`quay-native.js`, `quay.js`, both MCP servers, `provider-abi-conformance.test.mjs`,
`github-client.js`).

## 1. Metadata

- Milestone: M14-cli-edit-parity
- Iteration: 1
- Date: 2026-07-18
- Worktree: `experiments/quay-perpetual-stream/milestones/M14-cli-edit-parity/worktrees/iteration-1`
- Branch: `exp5-m14-iteration-1`
- Status: COMPLETE — design doc delivered, all 7 charter Done-when clauses met (see §4).

## 2. HARD GATES (literal output)

### Pending directives listing

```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
```
Output: **empty** (no lines printed; directory contains no files). No pending directive required a
disposition this iteration.

### Worktree / branch confirmation

```
$ pwd
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M14-cli-edit-parity/worktrees/iteration-1
$ git branch --show-current
exp5-m14-iteration-1
```

Confirmed operating inside the correct worktree, on the correct branch. All file writes (the design
doc) were made via absolute paths rooted at this worktree's checkout. Post-write leak check against
the shared main-repo path:

```
$ ls -la /home/yale/work/quay/docs/proposals/exp5-cli-edit-parity.md
ls: cannot access '/home/yale/work/quay/docs/proposals/exp5-cli-edit-parity.md': No such file or directory
```

Confirms no duplicate write leaked into the shared main-repo path — the file exists only inside the
worktree's own `docs/proposals/`.

## 3. Section-by-section mapping (design doc → DIR-011 item)

| Doc section | DIR-011 item(s) answered |
|---|---|
| §1 Core CLI `task edit` full-field parity | 1 |
| §2 Provider-capability handling | 2 |
| §3 Portable-metadata rule (formalized wording) | 3 |
| §4 Non-goals | 4 |
| §5 Verification plan (worked, ≥2 fields, both providers) | (charter item 4 / DIR-011 item 2's live-verify requirement) |
| §6 Done-when clauses a future implementing milestone would need | (charter Done-when clause 5) |

This table is reproduced verbatim from the design doc's own table of contents
(`docs/proposals/exp5-cli-edit-parity.md`, inside the worktree).

## 4. Evidence for all 7 charter Binary Done-when clauses

**1. Doc exists and addresses all 4 DIR-011 items, with pasted section mapping.**
File: `docs/proposals/exp5-cli-edit-parity.md` (400 lines, committed `9ddc75b`). Section-mapping
table pasted in §3 above. §1 answers item 1 (full-field parity design, citing quay-native.js lines
115-155 and quay.js lines 376-394 verbatim), §2 answers item 2 (provider-capability
hard-error-floor reuse, citing PR-ABI-001's `TASK_WRITE_SUPPORTED_FIELDS` scan verbatim), §3
answers item 3 (portable-metadata rule, insertable blockquote), §4 answers item 4 (non-goals:
GitHub `extra` storage and MCP/native-CLI surfaces explicitly out of scope).

**2. Concrete (not enumerated-menu) whole-body-replacement-mode recommendation.**
Doc §1, "Whole-body-replacement-mode recommendation (concrete, not a menu)":
> "Recommendation: add `--body-file <path>` as the primary first-class whole-body-replacement
> mode; do NOT add a separate `--body-stdin` boolean flag as a second mode in the same milestone."
with `-` as the stdin sentinel (git/curl convention), single flag not an enumerated set.

**3. Actual proposed portable-metadata-rule wording (insertable prose) + explicit cross-reference
to M13's doc's reliance on it.**
Doc §3 contains the literal insertable blockquote (quoted in full below) plus a "Cross-reference:
M13's own reliance on this exact rule" subsection quoting `exp5-task-backlog-primitive-projection.
md` §11 verbatim ("Every field this design introduces... is designed body-first...") and §9/§10's
concrete instantiations (`Not selected @M-NN:` body line, `## Execution record` section).

Rule text (pasted from the doc):
> "Portable metadata convention. Any task metadata that must be readable or writable regardless of
> which Provider is active MUST be represented as a structured markdown section within the task's
> `body` field... `extra{}` is a native-Provider-only convenience mirror... nothing in this
> experiment's (or a future consumer's) design may depend on `extra{}` being present, because the
> GitHub Provider cannot write it at all — `task_write` hard-errors (`isError: true`) on any
> `extra` field per the PR-ABI-001 fix..."

**4. Verification-plan section, worked through for ≥2 relaxed fields against both providers.**
Doc §5, two fully worked examples:
- Worked example 1: `--title` against native + github (both real-write since M09; asserts exit
  code, `task view --json` field value, idempotent restore).
- Worked example 2: `--extra` against native (success) + github (hard-error path; asserts non-zero
  exit, stderr substring `"unsupported field(s) [extra]"`, and post-probe task state unchanged on
  github — not just "some error occurred").
Both examples cite and extend the exact existing test file/pattern
(`packages/quay/test/provider-abi-conformance.test.mjs` lines 224-252,
`task_write-unsupported-field-probe` / `task_write-hard-error-floor-probe`).

**5. "Done-when clauses a future implementing milestone would need" section, itself a checklist.**
Doc §6 — 9 checklist items (`- [ ]` markdown checkboxes), covering: CLI relax, `--body-file`
implementation, help-text update, §5's two worked tests implemented for real, one additional field
covered, `inherited-core.md` update, full test suite pass, `git diff --stat` scope confirmation,
`backlog.md` ABSORB update.

**6. No product code / `inherited-core.md` / provider ABI file modified — confirmed via
`git diff --stat` against pre-charter base commit.**

```
$ git diff --stat f7dfccb7c576a16526b19a40a078f5b143a18751 HEAD
 docs/proposals/exp5-cli-edit-parity.md | 400 +++++++++++++++++++++++++++++++++
 1 file changed, 400 insertions(+)
```

Only the new doc file changed; zero product code, zero `inherited-core.md`, zero provider ABI
files. (Note: this milestone's own `charters/M14-cli-edit-parity.md` and this
`iterations/iteration-1.md` file live in the shared main tree, not inside the worktree's git
history, so they correctly do not appear in this worktree-scoped diff — consistent with the
charter's own Done-when wording, "the new doc file (plus this milestone's own iterations/charters
bookkeeping files)".)

**7. `backlog.md`'s `M-CLI-EDIT-PARITY` row updated at ABSORB, pasted diff.**
Not applicable to iteration-1 itself — this is an ABSORB-boundary action (per the charter's own
phrasing, "backlog.md's M-CLI-EDIT-PARITY row is updated **at ABSORB**"), performed by the outer
loop when this milestone concludes, not by an inner iteration. Current row content (read, not
modified, this iteration), confirmed present and unambiguous target for that future ABSORB edit:

```
| M-CLI-EDIT-PARITY | Design (doc only) for relaxing the Core CLI's status-only `task edit` to
full-field editing... | CLI (Core, `packages/quay/bin/quay.js`) | DIR-011 | explore |
capability-growth (CLI surface) + risk/option (...) | Backlogged, design-only per the same human
routing decision as DIR-009... |
```
(full row: `experiments/quay-perpetual-stream/backlog.md` line 68). This iteration leaves the row
untouched, consistent with charter Done-when clause 6's "no product code... modified" scope (which
this bookkeeping file is not part of anyway, but confirming it was read-only this pass).

## 5. Systematic-explore checks (§4.4, it0-style, run this iteration since independently re-derived)

a. **Ceiling/floor arithmetic**: N/A confirmed — this milestone is zero-VT by design; the design
   doc introduces no VT-chart claim (its worked examples are test assertions, not value-tracking
   entries).
b. **Gate-hash/transclusion**: not independently re-verified this iteration (charter cites
   GATE-HASH-REF by reference; the dispatcher resolves the literal gate text before construction —
   out of scope for the executing iteration itself to re-hash).
c. **Dogfooding evidence-gate**: satisfied — every Done-when clause in §4 above is backed by a
   pasted diff, section-mapping table, or verbatim quote from the doc, not narrative summary alone.
d. **Domain-misfit audit-channel**: confirmed, as the charter itself anticipates — this is a
   design-doc-only milestone with no live external system and no CI-job/audit-channel analogue;
   recorded explicitly per the charter's own instruction rather than forcing a mismatched citation.

## 6. Reflection

**What was independently re-derived**: the full design doc (400 lines), covering all 4 DIR-011
items, without reading iteration-0's version. Key concrete decisions made independently: (a)
`--body-file`/`-` as the sole recommended whole-body mode (rejecting a separate `--body-stdin`
flag as redundant); (b) `--append-notes` kept as a separate CLI branch from the patch object,
mirroring quay-native's own structural split rather than folding it in; (c) the portable-metadata
rule wording is a direct lift-and-formalize of DIR-011's own Finding #2 prose, explicitly framed as
"not a new pattern" relative to M05/M13's prior usage.

**Corrections made relative to DIR-011's own (2026-07-18, pre-M12) framing**: DIR-011's Finding
describes `parent`/`children` as still github-unsupported at authoring time; M12-abi-parent-write
(landed before this milestone) made both real writes on github too. §2's capability table in the
design doc reflects the corrected, current state (only `--extra` genuinely diverges today), and
explicitly calls this out as a correction rather than silently reproducing the stale framing.

**Challenges**: none blocking. The task was well-scoped and heavily pre-grounded by the three
cited precedents (native CLI, MCP schemas, PR-ABI-001), consistent with the charter's own framing
that this is real independent-re-derivation material but not open-ended exploration.

**Next focus** (for iteration-2 if dispatched, or the outer loop's stability check): charter §3.2
condition 1 requires Done-when complete AND stable ≥1 iteration before this milestone can close —
iteration-1's delivery is the first complete pass; a subsequent iteration (or the outer loop's own
review) should re-verify these 7 clauses hold without material change before ABSORB.

## 7. Convergence status

- Done-when: all 7 clauses met this iteration (§4).
- Stability: not yet ≥1 iteration confirmed (this IS iteration-1; a further check is needed before
  the outer loop can declare condition 1 satisfied).
- No new significant/blocking gap identified.
- Adversarial-audit gate: does not apply (Δv̂=0 by design this round, condition (a) inapplicable;
  no iteration-0 self-exemption to override, condition (b) inapplicable).

## 8. Commit

```
$ git log --oneline -3
9ddc75b M14-cli-edit-parity iteration-1: exp5-cli-edit-parity.md design doc
f7dfccb SELECT m14 = M-CLI-EDIT-PARITY: author Tier-A charter, gate-hash PASS
7e1502a ABSORB m13 = M-TASK-BACKLOG-PROJECTION: design doc delivered, Δv=0, audit gate correctly did not fire
$ git status
On branch exp5-m14-iteration-1
nothing to commit, working tree clean
```

**Commit hash: `9ddc75b`**. Working tree inside the worktree is clean (confirmed above). This
report file itself is written directly to the shared main-tree location
(`experiments/quay-perpetual-stream/milestones/M14-cli-edit-parity/iterations/iteration-1.md`), per
instruction, and is NOT part of the worktree's own git history/commit.

## Artifacts

- `docs/proposals/exp5-cli-edit-parity.md` (inside worktree, committed at `9ddc75b`) — the design
  doc deliverable.
- This report: `experiments/quay-perpetual-stream/milestones/M14-cli-edit-parity/iterations/
  iteration-1.md` (shared main tree, outside the worktree).
