# Simulated User Audit — Mobile-Only Persona
Date: 2026-07-17
Iteration: 6
Persona: Mobile-only user (375px, no CLI)

## Mobile rendering — CONCERNS

The page has a `<meta name="viewport" content="width=device-width,initial-scale=1">` tag and a
`@media (max-width: 600px)` breakpoint that hides `.col-role`, `.col-labels`, and `.col-updated`
columns, leaving id / status / title / actions visible. The actions column is sticky (`position:
sticky; right: 0`) so the Advance button remains reachable without horizontal scroll. That part
works.

Concern: the label nav block at the top is 25 inline links in a single wrapping paragraph, taking
up approximately 6–8 lines of dense link text on a 375px screen before the user even reaches the
search box or task table. The label block is the single most space-consuming element above the
fold on mobile — a first-time user must scroll past it to find the search form.

Screenshot confirmed: the orientation banner, h1, Prefix / Filter / Sort / Label nav blocks, and
the search form all appear before any tasks. At 812px height, the first actual task row is below
the fold. The page is *usable* but the above-fold density is poor for a phone.

## Search discoverability — CONCERNS

The search form (`<input type="search" placeholder="Search titles…">`) appears below the Label nav
block — approximately mid-page on mobile. A new mobile user opening the page sees: banner, h1,
four filter lines, and then a dense wall of 25 label links before they encounter the search box.
The search form itself is functional and compact (text input + Search button in a flex row), but
its position below the label nav reduces discoverability for a mobile-first user who has not yet
learned the page layout.

The placeholder text reads "Search titles…" which is slightly misleading (see body-search finding
below).

## Body search results — CONCERNS

Querying `/?q=Proposal` returns 117 tasks (6 pages). Inspection of the first result (QC-001)
confirms it does NOT have "Proposal" in its title ("Write browser-automation tests for Web UI
pages…"). It has "Proposal" as a heading inside its body markdown. So the search IS matching body
content.

Gap: the placeholder says "Search titles…" but the search actually includes body content. This is
a false-precision label — a mobile user searching by title keyword and getting hundreds of results
will be confused, especially with no visible indication that body text is matched. There is no
result snippet or match-highlight to explain why a result appeared.

## Label nav at scale — CONCERNS

46 total labels exist (25 shown + "… 21 more labels"). The "21 more labels" text is plain text
with no link, no expand button, and no way to reach those 21 hidden labels from the web UI. On
mobile the 25 shown labels already wrap across ~7 lines of dense text. A user wanting to filter
by one of the hidden 21 labels (e.g., `iteration-6`, `web-ui`, `methodology`) cannot do so from
the mobile interface without manually typing a URL or knowing to combine `?label=X` in the
address bar.

Severity: significant. The truncation is announced but the hidden labels are inaccessible via the
Web UI.

## Overall mobile UX — CONCERNS

The page is functional but not mobile-optimised for discovery:

1. Search form is buried below a large label block — above-the-fold position is wasted on
   navigation filters most mobile users will not use on first visit.
2. Placeholder copy "Search titles…" misrepresents the actual behaviour (body search included).
3. 21 labels are hidden with no access path from the web UI.
4. No match highlighting or snippet in search results — a mobile user cannot tell *why* a task
   matched, especially for body matches.
5. The sticky actions column is a genuine improvement; the `Advance` button is reachable at
   mobile width. No regression here.

## New gaps found

- **[significant] Hidden labels inaccessible on mobile**: 21 labels are truncated with no expand
  link or "show all" mechanism. A mobile user cannot filter by them. Suggested fix: add a `?label=`
  text input or a "show all labels" toggle link.

- **[significant] Misleading search placeholder "Search titles…"**: search includes body content
  but UI does not say so. Users get unexpected large result sets. Suggested fix: change placeholder
  to "Search tasks…" or "Search title + body…" and optionally show a match-count note like
  "Matched in body" per result.

- **[minor] Search form below-the-fold on mobile**: consider moving the search input above the
  filter/label nav rows, or collapsing the label nav by default on narrow viewports.

- **[minor] No result snippets**: matched tasks show only the title; when the match is in the
  body there is no indication what matched. Would help orient mobile users scanning results.

## Overall: CONCERNS

Label access is the most significant gap — 21 labels are completely inaccessible from the mobile
web UI. Search works but its placeholder is misleading (says "titles", does body). Layout is
functional but search discoverability suffers from below-fold positioning behind a dense label
wall.
