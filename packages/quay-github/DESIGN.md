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
| `status` | derived from `issue.state` + a `status:*` label | **Resolved convention** (also an open question in QN-002's Plan, resolved here): <br>• `issue.state == "closed"` → `status = "done"` (terminal, regardless of labels) <br>• else if a `status:ready` label is present → `"ready"` <br>• else if a `status:needs-human` label is present → `"needs-human"` <br>• else (open, no recognized status label) → `"todo"` (the default open-issue state) <br>This is deliberately the LCD-problem in miniature (proposal §2.2/§16): GitHub has no native `status` field, so the mapping is a **label convention**, not a GitHub feature. It is documented here, not hidden in code. |
| `lane` | a `lane:*` label (`lane:authoring` / `lane:execution` / `lane:exploration`) | absent → `null` (no lane assigned); the Core degrades gracefully (design §6.2) when a Provider leaves an optional field unset |
| `labels` | `issue.labels` **minus** the reserved `status:*`/`lane:*` labels above | avoids double-reporting the same GitHub label as both a semantic field and an opaque label |
| `parent` | not implemented in v1 | GitHub's native sub-issue/task-list linking is not read in v1 (explicitly out of scope per QN-002 AC — a known gap, not a silent omission) |
| `children` | not implemented in v1 | same caveat as `parent` |
| `extra` | `{ number, html_url, user, state }` | the escape hatch (design §7.1) for backend-specific fields that don't fit the canonical shape — GitHub's issue number, permalink, author login, and raw state string (useful for debugging/display even though `status` is the normalized field) |

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
- `parent`/`children` are **not** mapped in v1 at all — this is real,
  uncompensated normalization cost that native didn't have to pay (native's
  `children` is just a stored array; GitHub's is a whole separate
  sub-issue/task-list feature with its own API surface not yet touched).
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
