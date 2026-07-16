# quay-github — Design (v1.4: read + status-write + gate (primitive + compound/epic) + skill)

- **Status:** v1.4 implemented — `data.read` + `manifest` (v1, QN-002),
  minimal status-only `data.write` (QN-024, iteration 10), `gate` (QN-028,
  iteration 17, primitive tasks; extended to compound/epic tasks by
  QN-035, iteration 25, DIR-006), and `skill` (QN-029, iteration 18) —
  see §5/§3.5/§3.6 and `provider.yml`'s own inline comments for the
  current, honest scope of each. `skill` required a real fix one layer
  below `provider.yml` itself — see §3.6 for why a config-only
  declaration would have been dishonest. This Provider's own MCP stdio
  transport (`src/mcp-server.js`) gained its first dedicated regression
  test at iteration 37 (QN-048) — see §3.7.
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
was added in iteration 17 (QN-028, see §3.5) after 13 consecutive
iterations of honestly finding no natural reason to implement it. `skill`
was added in iteration 18 (QN-029, see §3.6), the last capability named in
`provider.yml`'s original v1 comment set.

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
afterward. See `experiments/quay-native-bootstrap/provenance.md`'s iteration-10 section and
`tasks/QN-024.md` for the full transcript.

Covered by `test/write.test.mjs`.

### 3.5 Gate path (iteration 17, QN-028; extended to compound/epic tasks iteration 25, QN-035/DIR-006)

**Resolved `gate` scope: both primitive AND compound (epic) tasks, direct
port of `quay-native`'s `store.js#check()`/`artifactSections()`/
`extractSection()`/`childrenStatus()` semantics onto an issue's raw body
text.** `quay-github task check <id>`
(and Core's generic, provider-agnostic `quay task check --provider
github`) asserts the same two gates native does:

- `todo` status → `author->ready` gate: all four sections (`## Proposal`,
  `## Plan`, `## AC`/`## Acceptance Criteria`, `## DoD`/`## Definition of
  Done`) must be present with ≥40 non-whitespace characters each, the AC
  section must contain at least one Markdown checkbox (`- [ ]`/`- [x]`),
  and all AC checkboxes must be checked.
- `ready` status → `execute->done` gate: all AC checkboxes in the issue
  body's AC section must be checked (count-only; no artifact-presence
  re-check, matching native's own `ready`-branch behavior).
- `done` status: for a **primitive** task (no children), unconditional
  terminal pass, `{gate:"none", ok:true, reason:"terminal"}` — matches
  native's own done-branch degrade-to-leaf behavior. For a **compound**
  task (children non-empty), children are re-verified (see below) — a
  `done` epic whose child has regressed reports `ok:false`, not a
  rubber-stamped pass.
- `needs-human` status: soft-stop, `{gate:"none", ok:false, reason:"soft
  stop; human action required"}`.

**Compound/epic (children non-empty) support — implemented and
live-verified (iteration 25, QN-035, DIR-006).** Through iteration 24 this
section documented compound/epic support as "deliberately out of scope,"
reasoning that no real compound GitHub-backed task had organically
appeared in this repo's backlog. A human-asserted directive (DIR-006,
`experiments/quay-native-bootstrap/directives/archive/DIR-006-implement-quay-github-compound-epic-support.md`)
explicitly rejected that reasoning as a permanent excuse and required
real implementation, a **deliberately-created** real compound issue
structure (not a synthetic fixture), and live end-to-end verification.
This has now been done:

- `childrenStatus()` was added to `github-client.js`, a direct, line-for-
  line-comparable port of native's `store.js#childrenStatus()`
  (QN-012/QN-016): recursive, cycle-safe (a child id reappearing in its
  own ancestry is reported `"missing"`, not infinitely recursed), and
  reports a compound child whose own label says `done` but whose subtree
  is not entirely done as `"stale-done"`, matching native's own rollup
  rule exactly. The only structural difference from native's version is
  the child-fetch mechanism: native's calls a local file-store `get()`;
  this Provider's calls an **injected** `getChildTask(id)` fetcher
  (mirroring the `pageIssues`/`fetchPage` injection convention already
  established in this file), which `createGithubClient()`'s own `check()`
  wires to its own live, single-issue `get()` — i.e. each child is fetched
  live via `gh api` at check time, recursively.
- `checkGate()`'s `ready` and `done` branches now call `childrenStatus()`
  whenever `task.role === "compound"` (i.e. `children` non-empty),
  requiring every child to already be `done` before the task's own gate
  can pass — the same compound-aware behavior as native's `store.js`. A
  primitive task (`children` empty) is completely unaffected: the
  fetcher is never even invoked in that case (`.every(...)` over an
  empty array is vacuously true).
- **A real compound issue pair was deliberately created in `yaleh/quay`**
  (not a synthetic/mocked fixture, per DIR-006's explicit requirement):
  issue #5 (child A, closed/done), issue #6 (child B, initially open/
  todo), and issue #7 (the parent epic, body referencing both via the
  `- [ ] #5` / `- [ ] #6` checkbox convention `extractChildRefs()` already
  parsed). All three remain in the repo afterward as durable evidence, the
  same discipline this experiment applied to every other live-repo
  artifact since QN-028/QN-029.
- **Live-verified end-to-end**, the full lifecycle: `quay-github task
  check gh-7 --json` correctly derived `role:"compound"`,
  `children:["gh-5","gh-6"]`; while #6 was still open, the gate reported
  `ok:false`, `childrenStatus` showing `gh-6: todo`; after closing #6, the
  gate reported `ok:true` with both children `done`; closing the parent
  (#7 → status `done`) then re-running `task check` confirmed the
  compound-aware `done` branch's own re-verification: `ok:true, terminal`;
  an adversarial regression (reopening #6 while #7 remained `done`)
  correctly flipped the result to `ok:false, "compound task marked done,
  but not all children are done: gh-6 (todo)"`, exit code 1 — proving the
  gate has real teeth, not a static pass. Core's generic passthrough
  (`quay task check gh-7 --provider github --json`) was independently
  confirmed byte-identical to `quay-github`'s own direct CLI output at
  both the "before" (1/4 AC checked, one child still todo) and "after"
  (4/4 AC checked, both children done) states — the same reusability/
  transfer proof QN-028 established for the primitive-only gate, now
  extended to the compound path. See `experiments/quay-native-bootstrap/provenance.md`'s
  iteration-25 section and `tasks/QN-035.md` for the full transcript.
- Covered by `test/compound-gate.test.mjs` (24 assertions, injected-
  fixture unit coverage mirroring native's own
  `compound-gate.test.mjs`/`compound-gate-recursive.test.mjs` case
  structure: all-done, one-child-todo, dangling-child-reference,
  nested/stale-done rollup, cyclic-reference safety, ready-gate AC-vs-
  children interaction, and primitive-task non-regression).

**`executeEpic`'s compound recursion (Layer-2 Skill path, `skills/execute/
SKILL.md`)** required no code change here — it is Skill-level
orchestration pseudocode (`quay task check`/`quay task edit` calls
against each child in turn), not a `bin/quay-github.js` code path. It
was, however, exercised for the first time against a real GitHub-backed
compound task by this same live verification: `quay:execute`'s Method
already calls the generic, provider-parameterized `quay task check <id>
--provider <provider>` (QN-029, §3.6) — which this iteration's work
above confirmed now correctly returns compound-aware results for a
GitHub-backed epic, closing the specific gap `executeEpic`'s own "epic
path untested at v0" note (its own SKILL.md, still true for the seed-
dispatch/subagent-recursion mechanics, but no longer true for the gate it
recurses against).

**No cross-package import.** Per the design's Provider-independence
principle, `checkGate()`/`gateArtifactSections()`/`extractGateSection()`
in `github-client.js` are an independent re-implementation of the same
regex shapes and content-length floor as native's `store.js`, not a
shared import — each Provider ports the semantic itself, so the two
implementations can diverge safely if one backend's constraints ever
require it, at the cost of needing to keep the `\Z`-is-not-a-JS-anchor
class of bug (native's own QN-005 fix; the correct end-of-section anchor
is `(?![\s\S])`, not `\Z`) independently un-reintroduced in both places.
`test/gate.test.mjs`'s case (g) is a direct regression test for exactly
this bug class in the ported implementation.

**Live-verified, not merely unit-tested:** `quay-github task check gh-3
--json` and `gh-4 --json` were run against this repository's two real
issues (read-only; no state was mutated), each correctly reporting
`ok:false` (their real AC checkboxes are genuinely unchecked). Core's
existing, unmodified `taskCheck()` passthrough (`provider-client.js`,
added QN-027/iteration 13, zero backend-specific branching) was then run
against the same two issues via `quay task check gh-3/gh-4 --provider
github --json` and produced byte-identical JSON to the direct
`quay-github` CLI's own output — the concrete reusability/transfer proof
this task exists to produce. See `experiments/quay-native-bootstrap/provenance.md`'s
iteration-17 section and `tasks/QN-028.md` for the full transcript.

Covered by `test/gate.test.mjs`.

### 3.6 Skill path (iteration 18, QN-029)

**What "skill" means operationally, and why it was not a config-only
change.** `provider.yml`'s `status_skill_map`/`action_buttons` fields are
read generically by Core's `composePayload` (`packages/quay/src/action.js`)
— zero Provider-specific branching exists there, confirmed by reading that
file in full. Declaring the two fields in this Provider's `provider.yml`
alone would therefore have technically "worked" at the config-reading
layer. But reading `packages/quay-native/skills/{author,execute}/SKILL.md`
in full (not assumed from this document alone) found both Skills'
documented Method steps hardcoded every invocation to `quay-native task
<cmd>` — `quay-native`'s own local CLI, not Core's provider-agnostic `quay
task <cmd> --provider <id>` passthrough. Declaring `skill: true` here
without fixing that would have been a real bug disguised as a capability:
an action button on a GitHub-backed task would compose a payload naming
`quay:author`/`quay:execute`, and invoking either Skill would silently
operate on `quay-native`'s own task store — the wrong data entirely.

**The actual fix, made once, generically (QN-029), not duplicated per
Provider.** Both Skill `.md` files were parameterized to accept an
optional `provider` argument (default `native`) and now invoke `quay task
<cmd> --provider <provider>` throughout — this required zero new code in
Core (the `--provider` flag and `withProvider` passthrough already existed
since QN-024/QN-027) and zero duplication of the Skills' own Method logic
per backend. `quay task view/check <id> --provider native --json` was
confirmed byte-identical to the pre-existing direct `quay-native task
get/check <id> --json` invocation — the regression proof that every prior
iteration's native-mode evidence remains valid unchanged.

**Scope, formerly narrow, now extended (iteration 25, QN-035/DIR-006):**
`executeEpic`'s compound path was already parameterized (it recurses into
the same `provider`-aware `quay task check`/`quay task edit` calls as the
leaf path) — what had never happened was exercising it against a real
compound GitHub task, since §3.5's gate itself had no children-recursion
to exercise. Now that §3.5's gate supports compound tasks, `executeEpic`'s
own recursive `quay task check <child-id> --provider <provider>` calls
correctly receive compound-aware results when a GitHub-backed epic's
child is itself compound — see §3.5's live-verification transcript above,
which is this capability's own live-verification too (the same generic
Skill call path, not a separate code path to test twice).

**Live-verified, not merely declared:** the parameterized `quay:author`
Method's `write-proposal` step (`quay task view <id> --provider github
--json`) and `gate-check` step (`quay task check <id> --provider github
--json`) were run for real against a live `yaleh/quay` GitHub issue,
confirming the Skill's own documented steps — not a hand-simulated
substitute — correctly reach quay-github when told `provider: github`.
See `experiments/quay-native-bootstrap/iterations/iteration-18.md` for the full transcript.

### 3.7 MCP stdio transport regression coverage (iteration 37, QN-048)

**Gap closed, named honestly since iteration 24's own problem list:**
`src/mcp-server.js` (this Provider's own MCP stdio transport —
`provider://manifest`, `task_list`, `task_get`, `task_write`, `task_check`)
had **zero automated test coverage** through iteration 36 — the sibling gap
to QN-034 (iteration 24), which closed the identical class of gap for this
package's CLI dispatch layer (`bin/quay-github.js`) but explicitly named
"the `mcp` subcommand (starting the stdio MCP transport)" as out of scope,
"for its different (long-running, stdio-server) process-lifecycle shape."
Iteration 24's own problem list predicted this exact task would require
"managing a long-running stdio server process's lifecycle, not just
spawning a CLI command and reading its exit code/stdout."

**Closed via `packages/quay-github/test/mcp-server.test.mjs`** (iteration
37, QN-048): spawns the real `bin/quay-github.js mcp` subprocess via a real
MCP client (`StdioClientTransport`, same SDK pattern as
`packages/quay/test/mcp-server.test.mjs`), live against the real
`yaleh/quay` repo, asserting: resource enumeration (`provider://manifest`,
correct `name` field), `task_list` (includes the real open issues gh-3/
gh-4), `task_get` for `gh-3` (cross-checked byte-identical against the
direct CLI's own `task get gh-3 --json` output), `task_get`/`task_write`
for an unknown id (both `isError:true`, not a crash), and `task_check` for
both `gh-3` and `gh-4` (cross-checked byte-identical against the direct
CLI's own `task check <id> --json` output for each). Same live-repo
discipline already established by this package's `write.test.mjs`/
`cli.test.mjs`: the one write-capable tool (`task_write`) is exercised
**only** via its unknown-id error path, which returns before
`client.setStatus` is ever reached — no live write to any real GitHub
issue ever occurs (`gh issue list --repo yaleh/quay` re-run after this
task's completion confirmed byte-identical state to before it started).

**Zero source-code change** — this is a pure test-addition, mirroring
QN-030 through QN-034's own precedent shape: `mcp-server.js` itself is
unmodified (confirmed via `git diff --stat`). An adversarial break/restore
cycle (inverting `task_check`'s `structuredContent: result` line to negate
`ok`) produced exactly 2 live FAILs, confirming the new test has real
teeth; restoring produced a byte-identical diff and a full green re-run.

Covered by `test/mcp-server.test.mjs`.

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
- Quay Core's `quay task check` CLI / `taskCheck()` passthrough (QN-027,
  iteration 13) — **zero lines changed** to talk to this Provider's new
  `task_check` tool (QN-028, iteration 17); confirmed by byte-identical
  JSON output against the direct `quay-github` CLI (§3.5).

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
- Gate section extraction (added iteration 17, §3.5) — a genuine
  re-implementation (not a shared import) of native's `store.js` regex
  shapes against a different body-text source; low marginal cost because
  the read-side §3 heading/label conventions already existed, but real,
  independently-authored code nonetheless.
- Skill-invocation provider-parameterization (added iteration 18, §3.6) —
  NOT backend-specific work at all, in the end: the fix lived one layer up
  (in the shared `quay:author`/`quay:execute` Skill `.md` files, made
  provider-aware once), not duplicated per Provider. Worth naming
  explicitly here because it is the one capability in this list where the
  *naive* approach (a config-only `provider.yml` declaration) would have
  been backend-specific-*looking* but actually silently wrong — see §3.6.

## 5. Capabilities (v1.4)

```
data.read: true    # task_list, task_get
manifest:  true    # provider://manifest
data.write: true   # QN-024 (iteration 10): status-only patch — see §3.4.
                   # title/body/labels/parent/children remain unimplemented.
gate:       true    # QN-028 (iteration 17): task_check, primitive tasks;
                   # extended to compound/epic tasks by QN-035 (iteration
                   # 25, DIR-006) — see §3.5.
skill:      true    # QN-029 (iteration 18): status_skill_map/action_buttons
                   # — see §3.6. Compound/epic scope matches gate above,
                   # since QN-035 (iteration 25).
```

Matches `provider.yml`'s own capability booleans verbatim (re-verified
iteration 38, QN-049: the booleans themselves were never wrong, but both
this section's own comments and `provider.yml`'s own inline comments had
drifted stale since iteration 25/QN-035 — both described "primitive tasks
only" for `gate`/`skill` 12 iterations after compound/epic support was
implemented and live-verified. Corrected here and in `provider.yml`
directly; see §3.5/§3.6 above, which had already been kept accurate).

## 6. Iteration 27 — first live `quay:execute` Skill-level `executeEpic` drive

Fixture A (issue #8, child of epic issue #10): this sentence is fixture A's
own real, independently-verifiable Plan-step-1 deliverable, added as part
of driving issue #8 through `quay:execute`'s `executeLeaf` path for real.

Fixture B (issue #9, sibling child of epic issue #10): this sentence is
fixture B's own real, independently-verifiable Plan-step-1 deliverable,
added as part of driving issue #9 through `quay:execute`'s `executeLeaf`
path for real, immediately after fixture A completed.
