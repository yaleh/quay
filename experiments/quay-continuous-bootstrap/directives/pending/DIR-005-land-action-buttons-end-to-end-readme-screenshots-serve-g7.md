# DIR-005

- status: pending
- priority: **URGENT — dedicated iteration requested** (added 2026-07-17, see "Priority amendment" below)
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-17
- title: Land action buttons end-to-end (epicd-referenced), show Web UI screenshots in README, and fix the connected serve host-binding / G7 log — for experiment 4

## Priority amendment (2026-07-17)

- amended_by: human (Yale Huang), asserted directly in this live conversation
- Iterations 4 through 8 have each acknowledged this directive and deferred
  it every time, most recently iteration 8: "action buttons landed (QX-009,
  iteration 2). G7 confirmed 200. README screenshots outstanding but not
  blocking. DEFERRED — low priority relative to open capability gaps." Item
  1 (end-to-end manda dispatch to an actual consumer) and item 2 (in-UI
  receipt) remain unimplemented; item 4 (README screenshots) remains
  unimplemented despite six untracked screenshot PNGs accumulating at the
  repo root as of iteration 7 with no organization into `docs/screenshots/`;
  item 5 (the specific misleading `localhost` log line at `serve.js`) was
  independently verified (external investigation, not this directive's own
  iterations) to still be present and unfixed as of iteration 6, despite
  iteration 5 and iteration 6's own reports both asserting it was "confirmed
  satisfied" — a factual inaccuracy in those reports' dispositions, not a
  disposition problem with this directive itself, but relevant context for
  why this item needs a dedicated, careful pass rather than another
  deferral-by-assertion.
- **The human is now explicitly requesting this be prioritized and executed
  in its own dedicated iteration as soon as possible**, rather than
  continuing to be deferred in favor of other gap-list work. This does not
  override the applying iteration's own judgment on implementation details
  (which manda dispatch shape, which receipt UI form, etc. — see "Requested
  action" below, unchanged) — it overrides only the *scheduling* deferral.
  The applying iteration must verify item 5's log-line fix with direct
  evidence (the actual line in `serve.js`, not a restated prior claim),
  given the above-noted prior inaccuracy.
- This amendment does not change the directive's Finding or Requested action
  sections below, which remain as originally filed.

## Finding

In this live conversation the human asked to analyze the current `quay`
project state and file a directive for three improvement directions
(explicitly EXCLUDING "bring DIR into quay task management," which the human
is continuing to discuss separately and must NOT be pre-empted by this
directive). Investigation of the actual code (not assumption) established
the following current state:

### Action buttons — already present on the detail page, but not landed end-to-end
- `packages/quay/src/serve.js:440-468` already renders `action_buttons`
  (read from the active Provider manifest) as POST `<form>`s on the **task
  detail page**, filtered by `whenStatus`.
- `packages/quay/src/serve.js:475-495` handles
  `POST /task/:id/action/:actionId`: it composes the payload server-side
  (`composePayload`, `packages/quay/src/action.js:31-39`) from the manifest
  — the client sends only `id`+`actionId`, never the command — then calls
  `deliverTrigger` and issues a **silent 302 redirect** back to the task,
  with only a server-side `console.log` receipt. The user gets NO in-UI
  feedback that anything happened.
- `packages/quay/src/action.js:94-109` `deliverTrigger` has three modes:
  mock-log (`QUAY_ACTION_MOCK_LOG`), manda, and print-degrade. The manda
  path is `manda send task-<id> <json>` onto a **per-task channel with no
  confirmed consumer** — i.e. the message is emitted but nothing is
  subscribed to `task-<id>` to actually do the work. So the button
  "fires" but no task actually advances.
- `packages/quay-native/provider.yml:49-61` and
  `packages/quay-github/provider.yml:68-80` both declare an "Advance"
  button (`whenStatus: ["todo","ready"]`, payload template with `{{id}}`)
  and a `status_skill_map` mapping status → Skill.
- A `manda monitor terminal --root .` process IS currently running in this
  workspace (confirmed via `ps`; hub reachable per `.manda/hub.addr`), so
  the consumer substrate exists — it is simply not wired to the per-task
  channel `deliverTrigger` emits on.
- The gap list (iteration 0) already records **CB-003** ("action buttons
  missing from Web UI list page") — but that entry is about *placement
  only*. There is currently NO gap-list entry for the *end-to-end delivery
  + receipt* problem this directive targets.

### Reference implementation — epicd
`/home/yale/work/epicd` implements action buttons end-to-end and is the
human's cited reference. Its model (confirmed by reading that repo):
- Buttons declared in config (`.epicd/config.yml` `task_actions`: `id`,
  `label`, `command`, optional `whenPhase`); schema at
  `src/types/index.ts:427-448`.
- Click → `POST /api/tasks/:id/actions/:actionId` sending only id+actionId
  (`src/web/lib/api.ts:288-292`); server looks the command up from config
  by id (`src/server/index.ts:1120-1151`) — no client-supplied command,
  no injection.
- The command **fires an intent** (typically `manda-dispatch submit
  -id=$TASK_ID -to=worker -async -args='{task:"/skill "+id}'`) and returns
  a non-destructive **receipt** (`{exitCode, stdout, stderr}`) surfaced as
  a toast (`src/web/components/TaskActionReceiptToast.tsx`); it NEVER
  optimistically changes task status. Real progress is made by the
  dispatched worker and shows up later on normal board refresh
  (`docs/task-actions.md`).

quay's existing security shape (server-side compose, client sends only
id+actionId) already matches epicd's; what is missing is (a) a dispatch
that reaches an actual consumer, and (b) an in-UI receipt.

### README has no screenshots
- `README.md` embeds ZERO images (`grep` for `.png`/`![` finds none). Web
  UI screenshots exist only under `experiments/quay-webui-bootstrap/audits/`
  as per-iteration audit artifacts.
- The experiment-4 standing simulated-user mechanism (protocol §5.2,
  `ITERATION-PROMPTS.md` §0c) already drives the browser and can screenshot
  every iteration — the capability exists; it is simply not sinked into
  user-facing documentation.

### serve host-binding log is misleading (G7)
- `packages/quay/src/serve.js:501-502` calls `server.listen(port)` with no
  host arg — Node binds all interfaces (0.0.0.0/::) by default, so the
  service IS externally reachable — but the log line hard-codes
  `http://localhost:${port}`, which can be misread during experiment 4's G7
  precondition check ("reachable on 0.0.0.0, not localhost-only") as a
  failure when it is not.

This directive is scope-additive process/capability steering for a future
experiment-4 iteration; it does not assert that any current V_instance
dimension is mis-scored. It also does NOT touch the "DIR-as-quay-task"
question, which the human is discussing separately.

## Requested action

1. **Land the action-button trigger end-to-end, epicd-referenced.**
   Change `deliverTrigger`'s manda path (`packages/quay/src/action.js`) so a
   button press dispatches to an actual consumer rather than emitting onto
   an unconsumed per-task channel — model it on epicd's
   `manda-dispatch submit -id=<id> -to=<worker> -async -args=<...>` shape,
   composing the Skill to run from the Provider manifest's existing
   `status_skill_map[task.status]` (already surfaced by
   `composePayload`, `action.js:36-38`) so no new manifest data is
   required. Record the exact command/channel/worker-name/message shape
   chosen and why. Keep the mock-log and print-degrade modes intact.

2. **Add an in-UI receipt.** Replace the current silent 302
   (`serve.js:491`) with a visible, non-destructive receipt (a flash
   message or toast) reporting delivered/degraded/failed — following
   epicd's "fire an intent, never optimistically change status" discipline
   (`TaskActionReceiptToast.tsx`, `docs/task-actions.md`). The task's status
   must NOT be optimistically mutated by the button press.

3. **Add action buttons to the Web UI list page** (closes gap-list
   **CB-003**), reusing the same server-composed POST-form partial the
   detail page already uses (`serve.js:440-447`) rather than a second code
   path. Cover the desktop AND mobile viewport per the standing dual-viewport
   guardrail.

4. **Show Web UI screenshots in README.** Commit a small, canonical set
   (at least: list + detail, each desktop + mobile) under a committed path
   (e.g. `docs/screenshots/`) and embed them in `README.md`. Two
   preconditions the applying iteration MUST satisfy first, or the images
   will churn every commit:
   - Screenshots must be taken against a **fixed, reproducible seed task
     set** (state where it lives and how it is regenerated) — this same
     seed set is the stable target the standing simulated-user mechanism
     also needs, so stand it up once and reuse it.
   - Add a test (or CI check) asserting the README-referenced image files
     exist and links resolve, so the docs cannot silently rot
     (`verification_coverage`).
   Refresh cadence: only when a Web UI change is actually claimed (not
   every iteration) — the human's stated "若干迭代，有 Web UI 变更后".

5. **Fix the serve host-binding log / G7 ambiguity.** Either bind
   explicitly (`server.listen(port, "0.0.0.0", …)`) or correct the log line
   at `serve.js:502` so it no longer claims `localhost` while binding all
   interfaces — so the G7 precondition check reads an honest reachability
   signal. State which was done and confirm external reachability with
   evidence (not just assertion).

6. **Testing discipline (hard constraint, do not relax).** Automated tests
   for the action path must assert on the deterministic mock-log delivery
   record (`QUAY_ACTION_MOCK_LOG`, `action.js:61-74`) and on server-side
   payload composition — they must NOT gate pass/fail on a **live** manda
   dispatch succeeding, per the standing manda-reliability constraint
   already documented in `action.js:16-22` (DIR-008/§2.3) and
   `.claude/skills/quay-core-bootstrap-methodology/reference/manda-reliability-envelope.md`.
   The live end-to-end manda path is verified observationally/manually,
   with evidence recorded, not in CI.

7. **Scope / attribution.** Items 1-3 are `capability_breadth` +
   `usability_quality` work; item 4 is `usability_quality`
   (documentation-findability) + `verification_coverage`; item 5 is process
   /infrastructure (G7). Any test added counts toward `verification_coverage`.
   Every source/build change under `packages/quay` requires the standard
   independent G3 adjudicate dispatch (no self-certification), and any new
   write surface is evaluated per the protocol §3 write-surface rule
   (state, per change, which applies) — note the action trigger edge is an
   already-existing write surface, not a new one.

8. Record the resolution of this directive (applied/deferred/rejected, with
   evidence — including which V_instance dimension(s) actually moved and by
   how much) in whichever iteration first acts on it.

## Resolution
<!-- to be filled in by whichever iteration applies it -->
