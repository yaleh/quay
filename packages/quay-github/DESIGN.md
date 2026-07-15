# quay-github — Design (v1.1: read + minimal status-write)

- **Status:** v1.1 implemented — `data.read` + `manifest` (v1, QN-002) plus
  a minimal, status-only `data.write` (QN-024, iteration 10). `gate` and
  `skill` remain deferred (no natural reason found through iteration 12 —
  see this file's §5 and `provider.yml`'s own inline comments for the
  current, honest justification).
- **Scope:** the GitHub Provider — second real backend, proves the ABI
  transfers to a heterogeneous store (proposal §14, protocol §10.1). See
  `tasks/QN-002.md` for the original read-only Proposal/Plan/AC/DoD, and
  `tasks/QN-024.md` for the status-write increment this document was
  updated (QN-026) to reflect.

## 1. Purpose

Unlike `quay-native` (a path + markdown-format convention this project
invented), GitHub Issues is a **pre-existing, heterogeneous backend** with
its own object model (issue state, labels, no native `status`/`lane`
concept). Building this Provider is the concrete test of proposal §16's
"normalization cost" risk: each backend is real work — this document *is*
that normalization work, made explicit and reviewable rather than buried in
code.

v1 was deliberately **read-only** (`data.read` + `manifest` only) — mirrors
how `quay-native` itself staged `data.read` before `data.write`/`gate`
(iteration 0's v0 loop). Iteration 10 (QN-024) added a real, minimal,
status-only `data.write` on top of that read-only base — see §3.4. `gate`
and `skill` capabilities remain explicitly deferred; no natural reason to
implement either has arisen through iteration 12 (each iteration since
QN-024 has re-checked and found none — see `provider.yml`'s own inline
comments, which are the single source of truth for the current capability
booleans).

## 2. Backing store

GitHub Issues in a single repository (`yaleh/quay`, the repo this project
itself is published to — protocol §10.1: "the GitHub Provider is built
against this repository's own issues"), read via the `gh` CLI subprocess
(`gh api repos/<owner>/<repo>/issues ...`), matching quay-native's own
CLI-first design ethos (design §1 "Claude-Code-first... consumed through
MCP and CLI") rather than a separate REST/GraphQL client library.

## 3. View-model mapping (GitHub Issue → canonical view-model, design §7.1)

| canonical field | source | normalization notes |
|---|---|---|
| `id` | `"gh-<number>"` (e.g. `gh-3`) | **Resolved, not left open** (QN-002's Plan named this an open question at authoring time — resolved here at execution time, per walking-skeleton discipline: pick the simplest scheme that's unambiguous within one repo, document it, defer multi-repo schemes). Short, stable, sorts sensibly enough for a single-repo v1. |
| `title` | `issue.title` | verbatim, no normalization |
| `body` | `issue.body` | verbatim; no Provider-side content rewriting (mirrors proposal §6.3's "no backend branch in Core" principle applied one level down — no Provider-side reformatting either) |
| `status` | derived from `issue.state` + `status:*` label(s) | **Resolved convention** (also an open question in QN-002's Plan, resolved here): <br>• `issue.state == "closed"` → `status = "done"` (terminal, regardless of labels) <br>• else if exactly one `status:*` label is present → that value <br>• else if **multiple** `status:*` labels are present (iteration-5 fix, see §3.1 below) → the highest-precedence one, by a documented rule, NOT last-write-wins <br>• else (open, no recognized status label) → `"todo"` (the default open-issue state) <br>This is deliberately the LCD-problem in miniature (proposal §2.2/§16): GitHub has no native `status` field, so the mapping is a **label convention**, not a GitHub feature. It is documented here, not hidden in code. |
| `lane` | a `lane:*` label (`lane:authoring` / `lane:execution` / `lane:exploration`) | absent → `null` (no lane assigned); the Core degrades gracefully (design §6.2) when a Provider leaves an optional field unset |
| `labels` | `issue.labels` **minus** the reserved `status:*`/`lane:*` labels above | avoids double-reporting the same GitHub label as both a semantic field and an opaque label |
| `parent` | derived from a task-list checkbox reference in *another* issue's body (iteration-5 fix, see §3.2 below) | **Partial v1 mapping** (was "not implemented" through iteration 4). Only populated by `list()` (needs the full issue set to build the reverse index); `get()` on a single issue id leaves it `null` — a documented, narrower limitation than before, not a silent omission. |
| `children` | parsed from this issue's own body for `- [ ] #N` / `- [x] #N` checkbox lines referencing other issues in the same repo (iteration-5 fix, see §3.2 below) | Populated by both `list()` and `get()` (only needs this issue's own body). Does **not** use GitHub's separate, preview-gated sub-issues REST/GraphQL API — deliberately out of scope (G5, disproportionate effort for v1's read-only scope). |
| `extra` | `{ number, html_url, user, state, multipleParents? }` | the escape hatch (design §7.1) for backend-specific fields that don't fit the canonical shape — GitHub's issue number, permalink, author login, and raw state string; `multipleParents` (iteration-5 addition) only appears when more than one issue's checkbox list references this issue, surfacing that ambiguity instead of silently dropping it |

### 3.1 Status tie-breaking rule (iteration-5 fix)

Found by iteration-4's independent audit (bug #4 in that audit's "Bugs /
concerns" section): if a user manually applies two conflicting `status:*`
labels to the same open issue, the original code took whichever label
`issue.labels` happened to iterate last — an undocumented, accidental
"last-write-wins" that depends on GitHub's unspecified label ordering.

**Resolved rule:** precedence order `done > needs-human > ready > todo`
(most-advanced lifecycle stage wins). Rationale: a human who left a stale
earlier-stage label while adding a newer one almost always means the newer,
more-advanced one to take effect. Unrecognized label values are treated as
lowest precedence. This rule only resolves ties among labels on an **open**
issue; `issue.state == "closed"` still unconditionally forces `"done"`
regardless of any label, unchanged from the original convention. Covered by
`test/view-model.test.mjs`.

### 3.2 parent/children mapping (iteration-5 fix)

Found by iteration-4's independent audit (bug #1): `parent`/`children` were
unconditionally `null`/`[]` for every GitHub-backed task, with no mapping at
all, even though GitHub does have real linking mechanisms (sub-issues API,
task-list checkboxes).

**Resolved, deliberately minimal mapping:** GitHub's markdown task-list
checkbox syntax (`- [ ] #12`, `- [x] #12`) referencing another issue number
in the *body* of an issue is read as a parent → children link: the issue
containing the checkbox is the parent, the referenced issue is a child.
`children` is derived directly from an issue's own body (cheap, works in
both `list()` and `get()`). `parent` requires an index built by scanning
*all* issues' bodies for such references, so it is only available where the
full issue set has already been fetched — i.e. inside `list()`; `get()` on a
single id leaves `parent: null` (documented limitation, not silently wrong).
`role` now derives correctly (`compound` when `children` is non-empty, else
`primitive`), matching the native Provider's convention (design §2).

**Deliberately out of scope (G5):** GitHub's newer, structured sub-issues
REST/GraphQL API (`gh api` sub_issues endpoints) was evaluated and rejected
for v1 — it requires an org-level preview opt-in and a heavier API surface,
disproportionate to this read-only v1's scope. The checkbox convention is a
strict subset of real-world usage (a repo not using task-list checkboxes for
hierarchy will simply see childless leaves, same as before this fix) but
costs no extra API calls and needs no additional permissions.

**Ambiguity handling:** if more than one issue's checkbox list references
the same child issue, `parent` resolves to the first one found (documented,
not an error), and the full list of referencing issues is surfaced via
`extra.multipleParents` so a consumer can detect and reconcile the ambiguity
rather than have it silently hidden.

Covered by `test/view-model.test.mjs`.

### 3.3 Pagination / scale safety net (iteration-5 fix)

Found by iteration-4's independent audit (bug #2): `list()` fetched the
entire issue set via `--paginate` with no cap — fine for this experiment's
4-issue repo, but an unbounded O(n) full-history fetch for a real production
repo, with no caching or field-selection to reduce payload.

**Resolved:** `list()` now fetches in explicit 100-per-page batches up to a
hard ceiling (`DEFAULT_MAX_ISSUES = 500`, overridable via
`QUAY_GITHUB_MAX_ISSUES`). If the ceiling is reached, `list()` throws a
clear, descriptive error rather than silently continuing to fetch or
silently truncating results. This is a minimal safety net, not a real
solution (still no caching, no server-side field selection, no incremental/
streaming API) — a real fix for a large repo would need a genuinely paged
`task_list` API contract, tracked as a follow-up, not attempted here per G5
(walking-skeleton discipline: this experiment's repo has 4 issues; building
a full caching/streaming layer against zero evidence of need would be
gold-plating).

**Overflow path genuinely exercised (iteration 6, QN-014):** the paging/
overflow loop was extracted from `createGithubClient`'s `fetchAllIssues`
into a standalone, exported, injectable `pageIssues({ maxIssues, perPage,
fetchPage })` function — `createGithubClient`'s real `fetchAllIssues` is now
a thin wrapper supplying the real `gh api`-calling `fetchPage`, provably
identical live behavior to before the refactor (regression-checked against
the real `yaleh/quay` repo). `packages/quay-github/test/pagination.test.mjs`
exercises `pageIssues` directly with a synthetic `fetchPage`, genuinely
throwing the overflow error (a real caught exception, not code inspection)
and covering the natural-end and raised-cap cases too — closing the gap
iteration 5 deferred (this experiment's real repo has only 4 issues, so a
real 500+-issue overflow could never be exercised against live GitHub state
without creating one, which would be disproportionate for a test fixture).

### 3.4 Status-write path (iteration 10, QN-024)

**Resolved, minimal `data.write` scope: status-only.** `quay-github task
edit <id> --status <new-status>` (and Core's generic, provider-agnostic
`quay task edit --provider github`) patches an issue's `status:*` label
set to reflect the requested status, reusing exactly the same label
convention §3 already established for *reading* status — no new
normalization work was required for the write direction, because the
read-side convention (one `status:*` label per issue, `done` also derived
from `issue.state == "closed"`) already fully specifies what a write must
produce. Concretely: writing `status: "ready"` removes any existing
`status:*` label and applies `status:ready`; writing `status: "done"`
closes the issue (`issue.state = "closed"`) rather than relying on a
label, matching §3's own read-side rule that `state == "closed"` takes
precedence over any label.

**Scope, deliberately narrow (G5):** only `status` is writable. `title`,
`body`, `labels` (non-status), `parent`, `children` remain read-only in
v1.1 — there is no AC/DoD requirement or observed drift motivating a
broader write surface yet, and adding one now would be anticipatory
gold-plating.

**Live-verified, not merely unit-tested:** two real writes were performed
against this repository's actual issue #4 during QN-024 (one via
`quay-github`'s own CLI, one via Core's generic `quay task edit
--provider github` passthrough), each independently re-verified by a
fresh `gh issue view --json` read (not by trusting the write call's own
return value), and the issue was restored to its original label
afterward. See `experiment/provenance.md`'s iteration-10 section and
`tasks/QN-024.md` for the full transcript.

Covered by `test/write.test.mjs`.

## 4. What transferred cleanly vs. what required backend-specific work

**Transferred unmodified (zero Core changes, zero ABI changes):**

- The MCP transport itself — same `@modelcontextprotocol/sdk` server/stdio
  pattern as `quay-native`'s `mcp-server.js`.
- The `provider://manifest` resource shape.
- The `task_list`/`task_get` tool names, input shapes (`status`/`label`
  filters; `id` lookup), and output shapes (`structuredContent: { tasks }`
  / `{ task }`).
- Quay Core's `provider-client.js` (`connectProvider`) — **zero lines
  changed** to talk to this Provider; it only needed a second
  `.quay/config.yml`-style provider entry (see `config.github.yml` /
  `mcp_entry`).
- Quay Core's `quay task list` / `quay task view` CLI — **zero lines
  changed**; same code path as native, only the active provider config
  differs.

**Required backend-specific normalization work (the real cost, honestly
budgeted, proposal §16):**

- The entire `status`/`lane` mapping (§3 above) — GitHub has no native
  concept of either; this is genuinely new design work, not a mechanical
  translation.
- `id` scheme choice (`gh-<number>`) — GitHub's natural identifier (issue
  number) is not globally unique across repos, unlike `quay-native`'s
  filename-derived id; had to pick a scheme.
- `extra`'s specific field selection — different backend, different
  "doesn't fit the canonical shape" fields.
- `parent`/`children` mapping (added iteration 5, §3.2) — real,
  uncompensated normalization cost that native didn't have to pay (native's
  `children` is just a stored array; GitHub's hierarchy has to be read out
  of task-list checkbox conventions in issue body text, with real
  limitations: `parent` unavailable from a single-issue `get()`, ambiguity
  possible with multiple referencing issues). A fuller mapping using
  GitHub's native sub-issues API was evaluated and deliberately deferred
  (disproportionate effort for v1's read-only scope, G5).
- Multiple-`status:*`-label tie-breaking (added iteration 5, §3.1) — GitHub
  gives no label ordering guarantee, so a defined precedence rule had to be
  designed and documented; this is genuinely new normalization work with no
  native-Provider analogue (native's `status` is a single stored field, no
  ambiguity possible).
- Auth/access: `gh` CLI subprocess auth, vs. native's plain filesystem
  access — a qualitatively different failure mode (network/auth errors
  possible; native only has filesystem errors).

## 5. Capabilities (v1.1)

```
data.read: true    # task_list, task_get
manifest:  true    # provider://manifest
data.write: true   # QN-024 (iteration 10): status-only patch — see §3.4.
                   # title/body/labels/parent/children remain unimplemented.
gate:       false  # deferred — no natural reason found through iteration 12
skill:      false  # deferred — same reason
```

Matches `provider.yml`'s own capability booleans verbatim (verified this
iteration — see QN-026's AC/DoD).
