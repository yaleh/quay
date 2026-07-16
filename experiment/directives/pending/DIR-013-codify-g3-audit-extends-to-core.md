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

<!-- Filled in by whichever iteration applies this directive. -->
