# quay-github — Design (v1, read-only minimal)

- **Status:** v1 implemented (read-only: `data.read` + `manifest` only)
- **Scope:** the GitHub Provider — second real backend, proves the ABI
  transfers to a heterogeneous store (proposal §14, protocol §10.1). See
  `tasks/QN-002.md` for the authored Proposal/Plan/AC/DoD this package
  executes.

## 1. Purpose

Unlike `quay-native` (a path + markdown-format convention this project
invented), GitHub Issues is a **pre-existing, heterogeneous backend** with
its own object model (issue state, labels, no native `status`/`lane`
concept). Building this Provider is the concrete test of proposal §16's
"normalization cost" risk: each backend is real work — this document *is*
that normalization work, made explicit and reviewable rather than buried in
code.

v1 is deliberately **read-only** (`data.read` + `manifest` only) — mirrors
how `quay-native` itself staged `data.read` before `data.write`/`gate`
(iteration 0's v0 loop). `data.write`, `gate`, and `skill` capabilities are
explicitly deferred to a future task.

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

## 5. Capabilities (v1)

```
data.read: true    # task_list, task_get
manifest:  true    # provider://manifest
data.write: false  # deferred
gate:       false  # deferred
skill:      false  # deferred
```
