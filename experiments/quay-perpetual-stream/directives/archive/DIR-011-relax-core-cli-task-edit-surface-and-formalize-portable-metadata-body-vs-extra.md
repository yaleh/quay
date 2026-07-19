# DIR-011

- status: deferred
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-18
- title: Relax the Core CLI's status-only `task edit` to full-field editing (parity with the native provider CLI + MCP task_write it already sits in front of), and formalize the portable-metadata rule (body structured section = cross-provider, extra{} = native-only) verified against the GitHub provider

## Finding

DIR-009's design needs to write rich, structured metadata onto quay tasks
(milestone grouping, selection rationale, execution provenance). Investigating
the task store's actual edit surface and cross-provider support this
conversation surfaced two concrete, product-code-level facts:

1. **The Core CLI is the lone bottleneck, deliberately.** The native provider's
   own CLI (`packages/quay-native/bin/quay-native.js task edit`) already
   supports full-field edits — `--title`, `--status`, `--labels`, `--parent`,
   `--body`, `--children`, `--extra` (JSON), plus `--append-notes` (there is a
   `store.appendNote`) — and the MCP `task_write` tool accepts the full patch
   shape. Only the **Core** CLI (`packages/quay/bin/quay.js task edit`) is
   gated to status-only: "quay task edit: --status <s> is required (v1 supports
   status-only writes)" (QN-024). So "relax the CLI edit restriction so tasks
   can be edited by whole description/field" is a change confined to the Core
   CLI passthrough — the provider layer beneath it already does everything
   needed; the Core CLI simply refuses to pass the other fields through.

2. **`extra{}` is not provider-portable; the task body is.** The native store's
   `extra` is an arbitrary key/value map (`store.js` view-model), but the
   GitHub provider cannot WRITE `extra` at all — GitHub issues have no
   arbitrary-metadata slot, and M09's PR-ABI-001 fix deliberately turned an
   unsupported-field write into an explicit hard error (`isError:true`), not a
   silent drop. GitHub CAN write `title`/`body`/`labels` (M09-gh-write). So any
   metadata that must survive across providers has to live in the task BODY (a
   structured markdown section), with `extra{}` used only as a native-only
   machine-readable mirror — the same body-first-with-extra-mirror shape M05's
   anti-drift check already relies on (`extra.dirStatus` OR `Status mirror:`).

Net: the edit-surface relaxation is a real, self-contained product/ABI
improvement with its own value (CLI capability growth, not just method infra),
and it carries a portability rule that any DIR-009-style tracking must respect.
Splitting it out of DIR-009 keeps DIR-009 method-facing and keeps this
product-code + cross-provider concern independently scoped and reusable.

## Requested action

Design-only at this stage (same routing as DIR-009). Cover at least:

1. **Core CLI `task edit` full-field parity.** Design relaxing
   `packages/quay/bin/quay.js task edit` from status-only to accept
   `--title`/`--body`/`--labels`/`--extra`/`--parent`/`--children`/
   `--append-notes` (whichever the active provider supports), passing them
   through to the provider's existing write path — bringing the Core CLI to
   parity with the native provider CLI and the MCP `task_write` it already
   fronts. Decide whether to support whole-file/whole-body replacement as a
   first-class mode (e.g. `--body-file <path>` / stdin) so a task's entire
   description can be edited as a unit, per the human's ask.

2. **Provider-capability handling, not assumption.** The Core CLI is
   provider-agnostic and must not assume native. When a field is unsupported by
   the active provider (e.g. `extra`/`parent`/`children` on GitHub), it must
   surface the provider's existing hard-error (M09 PR-ABI-001 behavior) clearly
   rather than silently dropping — reuse, don't re-litigate, the ABI's
   already-decided error-floor. Verify behavior against BOTH providers live
   (native + github), in the M03-abi-eval / M09 differential-conformance style.

3. **Formalize the portable-metadata rule.** Document, as an ABI/skill-level
   convention: portable structured metadata lives in a task's BODY markdown
   section; `extra{}` is a native-only convenience mirror. This is the rule
   DIR-009 item 11 depends on; land it where both the `/quay-directive` skill
   and any future milestone-tracking skill will read it (e.g. `inherited-core.md`
   and/or the provider ABI doc).

4. **Non-goals.** Do not implement GitHub `extra` storage (out of scope; the
   hard-error floor is the correct behavior). Do not change the MCP or native
   provider CLI surfaces (already sufficient) — this is a Core-CLI + convention
   change only.

Value type: capability-growth (CLI surface) + risk/option (removes the
edit-surface asymmetry that DIR-009 would otherwise have to work around). This
one, unlike DIR-009, plausibly carries a small positive VT Δv̂ on the CLI
surface — size it at SELECT time.

## Resolution
- resolved_by: outer-loop drain (m12->m13 boundary), 2026-07-18
- outcome: deferred
- evidence: disposed as backlog.md candidate `M-CLI-EDIT-PARITY` (design-doc-only deliverable, per the human's own routing decision quoted in this file's Requested action). Not yet charter-ready; no Core CLI code changed. See `backlog.md`'s "DIR-009/DIR-010/DIR-011-sourced candidates" section for the full disposition record.

## Follow-up — design AND implementation subsequently DELIVERED (verified 2026-07-19)

This DIR's Resolution above ("deferred; no Core CLI code changed") was accurate only at the
m12→m13 drain. Both halves have **since shipped** — the Core CLI now has full-field `task edit`
parity. Verified against `master` on 2026-07-19:

- **Design — DONE (M14-cli-edit-parity).** `docs/proposals/exp5-cli-edit-parity.md` (28.9 KB)
  delivered as the design-doc milestone (ABSORB m14, `0a224f2`).
- **Implementation — DONE (M16-cli-edit-parity-impl).** Commit `5f1f1be` "full task-edit flag
  parity"; ABSORB m16 = `M-CLI-EDIT-PARITY-IMPL` (`473f29e`). `packages/quay/bin/quay.js`
  `task edit` now accepts `--title / --body / --body-file (incl. "-" stdin) / --labels / --extra
  / --parent / --children / --append-notes / --acceptance` — item 1's full-field parity plus the
  `--body-file`/stdin whole-body-replacement mode the DIR asked to decide on. The status-only
  restriction (QN-024) is gone.
- **item 2 (provider-capability hard-error, not silent drop) & item 3 (portable-metadata rule:
  body = cross-provider, `extra{}` = native-only)** were carried through the M14 design and the
  M16 impl per that design.

Outcome upgraded in substance from `deferred` to **applied**; the file stays archived.
`status:` left as `deferred` only as the historical record of its disposition AT THIS DRAIN —
the follow-up above is the authoritative current state. My earlier audit's "PROSE-ONLY" reading
was wrong: it missed that M16 shipped the code.
