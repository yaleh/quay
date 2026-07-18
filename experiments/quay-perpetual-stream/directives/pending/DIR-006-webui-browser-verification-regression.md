# DIR-006

- status: pending
- created_by: human (Yale Huang), asserted directly in this live conversation
- created_at: 2026-07-18
- title: Web UI verification regression — exp5 charters/reports narrate "real browser" sessions but paste only curl evidence; playwright/chrome-devtools tools never actually invoked; plus a systematic carry-forward audit is owed

## Finding

Asked whether the `quay` web server was kept running during exp5 and whether
browser-tool-based verification (playwright / chrome-devtools MCP tools) was
ever performed, a live investigation of all 9 milestones' charters and 15
iteration reports found:

1. **Zero real browser-tool usage across the whole experiment.** Grepping
   every `milestones/*/iterations/*.md` for `mcp__playwright__*` /
   `mcp__chrome-devtools__*` tool-call strings returns zero matches, in all
   9 milestones (M01–M09).

2. **M04-discover's charter explicitly required a real browser** —
   `charters/M04-discover.md` item 3: "exercise list/detail/filter/search/
   action flows in a real browser (dual-viewport ... holistic visual
   review)." Its `iterations/iteration-0.md:254-290` *narrates* this as a
   "Live browser session against `http://localhost:4173` ... at both desktop
   (1280x900) and mobile (390x844, emulated touch) viewports" and even
   claims a CSS bug is "screenshot-confirmed via dual-viewport review"
   (lines 285-287) — but the only literal, pasted evidence is two `curl`
   commands (lines 271, 274) comparing `?search=` vs `?q=` query params. No
   screenshot artifact, no DOM/HTML snapshot, no browser-tool trace exists
   anywhere in that report. This is narrative language dressed as a browser
   session, backed only by an HTTP fetch / code-reading check — a **claim
   vs. pasted-evidence mismatch**, the exact class of error this
   methodology's iteration-1 independent-re-verification discipline exists
   to catch, and did not catch here.

3. **No mechanized enforcement exists.** `docs/proposals/
   quay-perpetual-stream-experiment-v5.md` and `OUTER-LOOP.md` never
   mention playwright/chrome-devtools/browser. `inherited-core.md` only
   transcludes-by-reference the older `quay-webui-bootstrap-methodology`
   skill's "dual-viewport requirement / holistic visual review" language,
   but this was never turned into an exp5 Done-when clause or HARD GATE.
   The actual Web UI HARD GATE in play (e.g. M04-discover charter's `G7`)
   is just `curl -s http://localhost:4173/ -o /dev/null -w "%{http_code}"`
   — an HTTP-status check, unrelated to real rendering/interaction
   verification.

4. **Web server lifecycle is ephemeral, not a standing service.** Where
   evidence exists, the server is started per-check via background shell
   (`&`) and in at least one case explicitly `kill`ed afterward
   (`M01-dist/iterations/iteration-1.md:285-289`, inside a CI job).
   M04-discover/M05-dir-projection reference an "already-running dev
   server" on port 4173/4175 without ever showing how or where it was
   started persistently — consistent with a short-lived ambient process,
   not a service kept up specifically to support browser-based checks.

5. **This is a regression, not a gap that was never covered.** Earlier
   quay experiments (exp1–4, and specifically the `quay-webui-bootstrap`
   line) did establish and exercise real browser-based verification as
   part of their methodology (the "dual-viewport / holistic visual review"
   language exp5 inherits-by-citation traces directly back to that lineage
   — see `.claude/skills/quay-webui-bootstrap-methodology/reference/
   visual-review-mechanism.md`). exp5's two-layer refactor (charter
   authoring, transclusion-by-reference, it0/HARD-GATES mechanization)
   appears to have carried the *citation* forward without carrying the
   *requirement* forward into anything enforceable — the same class of
   silent methodology drift DIR-005/V_meta-lag was built to catch, but for
   a *practice*, not a *pattern*.

## Requested action

1. Add a real, mechanically-checkable Web UI verification requirement to
   exp5's inherited core / charter template for any future milestone that
   scopes Web UI work: an actual `mcp__playwright__*` or
   `mcp__chrome-devtools__*` tool-call trace (navigation + at least one
   screenshot or DOM snapshot artifact, at both configured viewports) must
   be present as pasted, literal evidence in the iteration report — not
   narrative language, not a `curl` status check standing in for it. HTTP
   `curl` checks remain valid for liveness/HARD-GATES but must not be
   conflated with or substituted for visual/interaction verification.
2. Treat M04-discover's Web UI cov claims (in `dashboard.md`'s VT table,
   scored partly from this milestone) as provisionally uncertain pending a
   real re-verification with actual browser tooling — do not let the
   existing 0.92/0.95 cov numbers stand unaudited once this directive is
   applied.
3. **Systematically audit exp1–4 for other DIRs / methodology requirements
   that were established, validated, and intended to persist, but that
   exp5's two-layer refactor (charter/transclusion/mechanization) silently
   dropped the *enforcement* of while keeping only the *citation*.** This
   is the same failure class as finding 5 above, generalized — DIR-002
   (directive-projection) and DIR-005 (V_meta consolidation lag) already
   each caught one instance of "agreed requirement, never actually
   enforced" for a different subsystem; this directive's finding is a
   third instance, for Web UI verification specifically. The audit itself
   is being scoped as separate follow-up work (not blocking this
   directive's own disposition) and its results should be recorded either
   as amendments to this directive's Resolution or as new directives of
   their own, whichever the disposing iteration judges cleaner.

## Resolution

<!-- to be filled in by whichever iteration applies this directive -->
