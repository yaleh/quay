# DIR-013

- **status:** pending
- **created_by:** human (Yale), asserted directly in this live conversation
- **created_at:** 2026-07-16
- **title:** Codify "G3 out-of-band audit must extend to Core" into ITERATION-PROMPTS.md

## Finding

`docs/proposal/quay-core-scope-expansion-discussion.md` §3 recorded four
additional constraints identified during the original Core-scope
discussion, beyond the three human-raised proposals. Constraint 3 reads,
verbatim:

> **G3 (out-of-band audit) must extend to Core.** If a future Core MCP
> server (DIR-007) is used as evidence toward quay-native's own
> self-certification claims, the independent audit mechanism (G3) must
> explicitly cover Core-level code too — quay-native's own gate must not
> be the sole judge of Core's correctness, the same "no self-certification"
> principle the protocol already applies at the Provider level.

DIR-008 (`experiment/directives/archive/DIR-008-*.md`, applied at
iteration 29) codified the discussion doc's constraints into
`experiment/ITERATION-PROMPTS.md`'s new "§Core-scope work: standing
constraints for any task touching `packages/quay`" section — but only
**four** items are present there today (verified by direct reading,
2026-07-16): (1) terminology discipline, (2) G5 discipline for Web UI
verification, (3) manda-investigation reuse discipline, (4) resolution
of the scope/attribution open questions. The G3-extends-to-Core
constraint (discussion doc §3 item 3, quoted above) is **not** among
them — it was discussed and recorded in the discussion doc but never
actually written into the binding iteration-prompt text, despite
`packages/quay` (Core) having since been touched by many more tasks
(QN-036, QN-038, QN-039, and the Core MCP server itself from DIR-007).
This is a real, checkable gap: `grep -n "G3" experiment/ITERATION-PROMPTS.md`
shows G3 defined only once, in the generic §5 OUT-OF-BAND AUDIT section,
with no Core-specific language anywhere in the file.

## Requested action

1. Add a fifth item to `experiment/ITERATION-PROMPTS.md`'s "§Core-scope
   work: standing constraints for any task touching `packages/quay`"
   section, stating explicitly that G3's independent `adjudicate` pass
   (§5 OUT-OF-BAND AUDIT) applies to Core-layer changes on exactly the
   same terms as Provider-layer changes — no self-certification by
   whichever Skill/session authored or executed the Core change, and no
   exemption for Core code on the theory that it is "infrastructure"
   rather than "the thing being verified."
2. Cite `docs/proposal/quay-core-scope-expansion-discussion.md` §3 item 3
   directly in the new text (per this experiment's own citation
   discipline — do not silently paraphrase without a pointer back to the
   source discussion).
3. Do a one-time retrospective check: confirm (or note as an open
   finding if not true) that the audits already run for Core-touching
   iterations since DIR-007 shipped (e.g. any iteration whose task
   touched `packages/quay/src/mcp-server.js`, `serve.js`, `bin/quay.js`,
   or the new `provider-env.js`) were in fact produced by an
   independent-of-the-author process, consistent with what this
   directive is asking to make explicit — so the codification is a
   clarification of existing good practice, not a discovery that past
   Core audits were non-independent. If any past Core-touching iteration
   turns out to have skipped or self-certified its audit, record that as
   a separate finding rather than silently folding it into this
   directive's resolution.

## Resolution

- resolved_by: iteration 65
- outcome: applied

**(a) Action 1 — fifth Core-scope item added — applied.** Added item 5
to `experiment/ITERATION-PROMPTS.md`'s "§Core-scope work: standing
constraints for any task touching `packages/quay`" section, stating that
G3's independent `adjudicate` pass applies to Core-layer changes on
exactly the same terms as Provider-layer changes — no self-certification,
no "infrastructure" exemption — naming the specific Core files this
applies to (`mcp-server.js`, `serve.js`, `bin/quay.js`,
`provider-env.js`, `action.js`, `config.js`, `provider-client.js`, or any
other Core source file).

**(b) Action 2 — citation — applied.** The new item quotes
`docs/proposal/quay-core-scope-expansion-discussion.md` §3 item 3
verbatim (the exact blockquote reproduced in the new item), rather than
paraphrasing it, per this experiment's own citation discipline.

**(c) Action 3 — one-time retrospective check — completed, with a
POSITIVE finding (no gap found).** Directly checked (2026-07-16) which
iterations touched Core source files since DIR-007 shipped (iteration
26):

```
$ git log --oneline --all -- 'packages/quay/**'
```
shows Core-touching iterations at: 10 (pre-DIR-007, out of this check's
scope), 13, 21, 22, 23, 26 (DIR-007 itself), 29, 30, 31, 32, 33, 34, 35,
36, 54, 55, 56, 57, 58, 62 (plus the earlier v0/QN-002 scaffold commits,
also out of scope). For **every one** of these iterations, a
corresponding `experiment/audits/iteration-{N}-independent-adjudicate.md`
file exists — none missing. Spot-checked the `**Auditor:**` line of each:
every one reads "fresh `general-purpose` subagent, zero prior context" or
equivalent language (e.g. iteration 26: "fresh `general-purpose`
subagent, zero prior context... ran all tests/scripts and live GitHub
round-trips directly"; iteration 36: "fresh, zero-prior-context
out-of-band review... ran all tests/diffs/commands directly against the
working tree"), and each verdict (PASS, PASS WITH CONCERNS, etc.) is
accompanied by the auditor's own independently-reproduced command output,
not a restatement of the iteration's own claims. Two were read in full
(iterations 26 and 36) as a direct spot-check beyond the auditor-line
grep, and both are substantively independent (running their own diffs,
their own test executions, their own live-GitHub round-trips, and in
iteration 36's case, catching and correcting a factual misattribution the
iteration's own report had made).

**Finding: no separate gap to record.** Every Core-touching iteration
since DIR-007 was, in fact, audited by the same independent,
fresh-context `adjudicate` process used for every other iteration
regardless of layer — consistent with the fact (already true before this
directive) that this experiment's own top-level-orchestrator G3 dispatch
mechanism has been used uniformly for every iteration since 13,
irrespective of which layer (Provider or Core) the iteration's task
touched. This directive's action 1 is therefore correctly characterized
as **codifying existing good practice explicitly**, not discovering or
correcting a past lapse. No past Core-touching iteration is found to have
skipped or self-certified its audit.

**(d) V-factor movement: none claimed.** This is process/protocol
documentation work (one new standing-constraint item, a citation, and a
retrospective verification check), not a feature increment. No
`V_instance` or `V_meta` factor is credited — see `experiment/iterations/
iteration-65.md` §7-8 for the full reasoning.
