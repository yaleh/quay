# DIR-010

- status: pending
- created_by: human (Yale), asserted directly in this live conversation
- created_at: 2026-07-15
- title: Establish Core-level CLI/MCP/Web-UI three-way symmetry, per `quay-proposal.md` §5/§9's own "one capability set, three bindings" requirement — closing the CLI-vs-MCP action-tool gap

## Finding

**This is an existing, already-written requirement, not a new proposal.**
`docs/proposal/quay-proposal.md` §5 (line 54) states: "Three sibling
front-ends over the same Provider ABI: **Web UI**, **Core CLI (`quay`)**,
and an **MCP projection** for agents — **one capability set, three
bindings**." §9 (line 235) restates it directly: "The Web UI is **the
same capability set** with a web binding." Note this is *not* the same
thing as principle P3 in `docs/proposal/quay-native-design.md` §6 ("CLI/MCP
symmetry") — P3 is explicitly Provider-scoped and explicitly excludes Web
UI (`quay-native-design.md` P2: "Web is a *Core* concern," i.e. out of
`quay-native`'s own remit). §5/§9's three-way claim is the Core-level
requirement this directive is actually grounded in; P3 is cited below only
as the existing *pattern* for how to test a symmetry contract
(`abi-symmetry.mjs`), not as the source of the three-way requirement
itself.

Despite being a stated requirement, it has never been operationalized
into a checkable test at the Core level (unlike P3, which
`packages/quay-native/test/abi-symmetry.mjs` already enforces). A direct
read of the three Core-level surfaces, performed in this conversation,
shows a concrete, checkable gap against that requirement — but also shows
the requirement's own scope is narrower than "everything the CLI has
today":

- **What §9 itself lists as "the same capability set"** (lines 226-230):
  `serve`, `task list`, `task view`, `action list`, `action run` — that
  is the literal scope of the three-way claim as written. **`task edit`
  and `task check` are not in that list** — both were added to the CLI
  later (QN-024, QN-027), after the proposal's §9 example was written,
  and neither was ever proposed for the Web UI. Their absence from the
  Web UI is therefore not a gap against this requirement; it must not be
  reported as one by this directive's test.
- **Core CLI** (`packages/quay/bin/quay.js`) today dispatches: `task
  list`, `task view`, `task edit`, `task check`, `action list`, `action
  run`, `serve`, `mcp` — a superset of §9's listed set.
- **Core MCP** (`packages/quay/src/mcp-server.js`, shipped by DIR-007 /
  iteration 26, independently audited PASS) registers exactly four tools
  — `task_list`, `task_get`, `task_write`, `task_check` — plus
  `provider://manifest[/<id>]` resources. **There is no `action_list` or
  `action_run` MCP tool**, even though both are explicitly part of §9's
  own listed capability set. The CLI can list and run action buttons; an
  Agent connected only via `quay mcp` cannot do either. This is the one
  concrete gap against the *actual written requirement* that this
  directive names.
- **Web UI** (`packages/quay/src/serve.js`) exposes exactly three
  behaviors: task-list rendering, task-detail rendering, and one POST
  route that triggers an action button — matching §9's listed set for the
  Web UI leg exactly (no more, no less).

`docs/proposal/quay-core-scope-expansion-discussion.md` §2.2 (already
discussed with the human before this directive was drafted) is a
discussion note, not itself a directive or a requirement source — it
correctly identified the gap but should not be cited as the origin of the
three-way symmetry requirement; §5/§9 above are. §2.2's contribution is
the concrete definition of "Web UI functionality" (task-list rendering,
task-detail rendering, action-button triggering), which happens to match
§9's own listed set exactly.

This directive depends on DIR-007 (Core's own MCP server), which has
shipped and passed independent audit — the precondition is met. It also
builds on DIR-009 / iteration 31's deterministic mock/file-log delivery
mode (`QUAY_ACTION_MOCK_LOG`, `packages/quay/test/action-mock-delivery.test.mjs`)
as the intended verification harness for action-button behavior — this
directive must reuse that mechanism, not reintroduce a live-manda
dependency into a new symmetry test. It also must not re-investigate
manda dispatch/monitor reliability from scratch; that ground is already
covered by DIR-004/DIR-005 and is orthogonal to this directive's scope
(same discipline `experiment/ITERATION-PROMPTS.md`'s Core-scope section,
added by DIR-008, already codifies).

## Requested action

A future iteration should, **in this order — item 2's test asserts
against item 1's completed implementation; it must not be written first
against a capability that does not yet exist**:

1. **Close the identified CLI-vs-MCP gap**: add `action_list` and
   `action_run` tools to `packages/quay/src/mcp-server.js`, mirroring the
   existing `task_list`/`task_get`/`task_write`/`task_check` tools' shape
   (optional `provider` argument, same error-handling convention). `action_run`
   must support selecting the mock/file-log delivery mode (DIR-009) so its
   own regression test does not depend on live manda delivery, consistent
   with the existing `action.js`/`bin/quay.js` wiring for `QUAY_ACTION_MOCK_LOG`.
2. **Add a Core-level symmetry test**, analogous in spirit to
   `packages/quay-native/test/abi-symmetry.mjs` but scoped to the three
   Core surfaces (CLI, Core MCP, Web UI) rather than Provider CLI vs.
   Provider MCP, and scoped to exactly the capability set `quay-proposal.md`
   §9 lists (task-list rendering, task-detail rendering, action-button
   triggering) — **not** the CLI's full current command set. It must
   assert, for each of those three behaviors, now that item 1 has closed
   the gap:
   - the capability exists in the Core CLI,
   - the capability exists as a Core MCP tool,
   - the Web UI's own rendering/handling of that capability produces
     content/behavior consistent with what the CLI/MCP surfaces return for
     the same task fixture (e.g. same task fields rendered, same action
     buttons listed, same delivery-mode-tagged result on trigger).
   `task edit` and `task check` are explicitly out of scope for the
   Web-UI leg of this test — not because the Web UI is deficient, but
   because §9's own requirement never listed them as part of "the same
   capability set" (see Finding). The test must not report their absence
   from the Web UI as a symmetry failure.
3. **State the symmetry contract explicitly** in `packages/quay/DESIGN.md`
   (a new section, following DIR-007's and DIR-009's own precedent of
   documenting each shipped capability there): what "Core-level P3" means,
   which three Web UI behaviors it covers, and a pointer to the new test
   as the enforcement mechanism — so a future capability added to only one
   of the three surfaces has a named test that will fail, not silence.
4. Not touch `abi-symmetry.mjs` or any Provider-level file — this is
   additive, Core-layer-only work, same additive-only discipline DIR-009's
   resolution confirmed via `git diff --stat`.
5. Record V-factor attribution (per `experiment/ITERATION-PROMPTS.md`'s
   existing convention) with explicit reasoning citing the DIR-007/QN-036
   and DIR-009/QN-042 precedents, rather than a bare number.

## Resolution
<!-- added when moved to archive/, or updated in place if deferred -->
