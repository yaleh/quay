# Iteration 4 — Independent Adjudicate Audit

Conducted with zero prior context; all evidence gathered directly from live
`gh` API calls, git history, and actual command execution against the repo
at `/home/yale/work/quay` (HEAD `def5c9262d3f96786bdd107a50c7c1c0cb5e43a3`).
No mutating `gh` commands were run.

## Claim 1 — A real GitHub repo was published

**Verdict: PASS (with one caveat)**

```
$ gh repo view yaleh/quay --json name,visibility,url,pushedAt
{"name":"quay","pushedAt":"2026-07-15T06:00:53Z","url":"https://github.com/yaleh/quay","visibility":"PRIVATE"}
```

Repo exists, is `PRIVATE` as claimed. `git status` shows local branch
`master` is up to date with `origin/master`, and:

```
$ git rev-parse HEAD
def5c9262d3f96786bdd107a50c7c1c0cb5e43a3
$ gh api repos/yaleh/quay/commits/HEAD --jq .sha
def5c9262d3f96786bdd107a50c7c1c0cb5e43a3
```

Remote HEAD == local HEAD, confirming genuine push, not a stale/divergent
remote.

**Caveat:** the specific spot-check file named in the audit brief,
`docs/proposal/quay-bootstrap-experiment.md`, **does not exist** — not
locally, not on the remote (`gh api .../contents/...` returns 404, and
`git ls-tree -r HEAD` recursive listing confirms it was never committed).
The actual `docs/proposal/` directory contains `glossary.md`,
`quay-native-design.md`, and `quay-proposal.md` only. This looks like an
error in the audit brief's example path (or a stale reference to a file
from an earlier/different plan) rather than evidence of tampering — since
independently confirmed remote HEAD == local HEAD covers the substance of
the claim ("content matches") for every file that does exist. Recommend
whoever wrote the original claim correct or drop that specific filename.

## Claim 2 — 4 real GitHub issues, label-convention mapping

**Verdict: PASS**

```
$ gh issue list --repo yaleh/quay --state all --json number,title,state,labels
```
returned exactly 4 issues:
- #4 "Fix default tasksDir resolution..." — OPEN, labels: `status:todo`
- #3 "Fix MCP task_write silently dropping the extra field" — OPEN, labels: `status:ready`, `lane:execution`
- #2 "Wire task_write into quay-native CLI/MCP..." — CLOSED, labels: `lane:execution`
- #1 "Deepen task_check gate correctness..." — CLOSED, labels: `lane:execution`

Read `packages/quay-github/src/github-client.js`'s `issueToViewModel()`:
the code implements exactly the claimed precedence —
`issue.state === "closed"` unconditionally forces `status = "done"`
(overriding any leftover `status:*` label), else whatever `status:<x>`
label is present sets `status`, else default `"todo"`. `lane:<x>` labels
are captured separately into `lane`. This was confirmed by direct
execution: `quay task view gh-3 --provider github --json` produced
`status: "ready"` (from its `status:ready` label, issue still open) and
`quay task list --provider github` produced `gh-2`/`gh-1` (both closed) as
`status: "done"` even though #2/#1 carry no `status:*` label at all
(closed-wins rule correctly exercised), and `gh-4` (open, no status label)
correctly defaulted to `"todo"`. All mapping behavior matches actual code
and actual live data — no discrepancy found.

## Claim 3 — GitHub Provider is genuinely read-only (v1 scope discipline)

**Verdict: PASS**

`packages/quay-github/src/mcp-server.js` registers exactly one resource
(`provider://manifest`) and two tools (`task_list`, `task_get`). No
`task_write`/`task_check` registration exists anywhere in the file; a code
comment explicitly documents this is deliberate ("v1 is read-only... `task_write` / `task_check` are deliberately NOT implemented").

`packages/quay-github/provider.yml` declares:
```
data.read: true
manifest: true
data.write: false
gate: false
skill: false
```
matching the claim exactly.

## Claim 4 — Core CLI parity (native vs github provider)

**Verdict: PASS**

Both commands ran without crashing:
- `node bin/quay.js task list --provider native --json` → returned array of QN-* tasks with keys `id/title/status/labels/parent/children/role/extra/body`.
- `node bin/quay.js task list --provider github --json` → returned array of gh-* tasks with the same core key set **plus** `lane`.

Ran `quay task view gh-3 --provider github --json` and compared directly
against `gh issue view 3 --repo yaleh/quay --json title,body,state,labels`:
title, body (full markdown proposal/plan/AC/DoD text), derived status
(`ready`, from the real `status:ready` label) and lane (`execution`, from
the real `lane:execution` label) all matched byte-for-byte. This is a
direct, non-mocked round-trip proof.

## Claim 5 — "consumer layer needs zero changes" (provider-client.js unchanged)

**Verdict: PASS**

```
$ git log --oneline -- packages/quay/src/provider-client.js
5b452aa Add quay-native and quay Core v0-v1 walking skeleton, experiment scaffold
$ git diff 5b452aa HEAD -- packages/quay/src/provider-client.js
(empty output, exit 0)
```

The file has exactly one commit in its history (its creation at `5b452aa`)
and zero diff between that commit and current HEAD (`def5c92`). The claim
is literally true: `provider-client.js` was not touched by the GitHub
Provider work. (The `--provider` flag machinery lives in `bin/quay.js`'s
`withProvider()`/`resolveProviderEnv()`, not in `provider-client.js`.)

## Claim 6 — Full regression check

**Verdict: PASS**

All three quay-native test files run clean, exit 0:
- `test/abi-symmetry.mjs` → "ALL FOUR SURFACES SYMMETRIC" (task_list, task_get, task_write, task_write value-equivalence incl. nested `extra`, task_check — all cliKeys==mcpKeys, match:true throughout).
- `test/gate-correctness.test.mjs` → 13/13 checks PASS ("All gate-correctness tests passed").
- `test/lock.test.mjs` → 7/7 checks PASS ("All QN-006 lock tests passed").

(`test/concurrent-writer.mjs` is a helper invoked by `lock.test.mjs`, not a
standalone suite — no separate run needed.)

Spot-checked native tasks via `quay-native task check <id> --json`:
- QN-001 → `{"gate":"none","ok":true,"reason":"terminal"}`
- QN-005 → `{"gate":"none","ok":true,"reason":"terminal"}`
- QN-007 → `{"gate":"none","ok":true,"reason":"terminal"}`

All three are `done` with clean (terminal, ok:true) gates as claimed.

## Claim 7 — No fake/mocked data; real gh API calls

**Verdict: PASS**

`grep -rn "fixture|mock|hardcod|fake"` across `packages/quay-github/src`
and `bin` returned nothing. Traced the call path:
`mcp-server.js`'s `task_list` tool → `client.list()` (from
`github-client.js`'s `createGithubClient`) → `ghApiJson(["repos/<owner>/<repo>/issues", "-X", "GET", "-f", "state=all", "--paginate"])`
→ `execFileSync("gh", ["api", ...args])` — a genuine subprocess call to the
real `gh` CLI. This was independently corroborated by claim 4's direct
comparison: the output of `quay task view gh-3 --provider github --json`
matched `gh issue view 3` exactly, which would be essentially impossible to
fake by coincidence with real, current issue body text.

`action list gh-3 --provider github --json` also ran cleanly and returned
`[]` (no crash), consistent with the documented "no status_skill_map for a
read-only Provider — nothing for an action button to trigger" design
decision (degrades gracefully rather than erroring).

## "Contract proven, ABI transfers" claim (criterion 3)

**Honestly earned, not overstated.** The claim is scoped carefully in
`packages/quay-github/DESIGN.md` §4 into what transferred unmodified
(MCP transport pattern, `provider://manifest` shape, `task_list`/`task_get`
tool shapes, and critically `provider-client.js`/Core CLI needing zero
changes — all independently verified above) versus what required real,
budgeted normalization work (status/lane label convention, id scheme,
`extra` field selection, and an explicitly named gap: `parent`/`children`
are NOT mapped in v1 at all). This is not a "look, it just works"
over-claim — the DESIGN.md is explicit that non-trivial backend-specific
design work was required, and one whole canonical field pair
(parent/children) is left as a named, honest gap rather than silently
faked. The strongest part of the claim — that the ABI-consuming code
(`provider-client.js`) is byte-for-byte unchanged — is the most falsifiable
sub-claim and it held up exactly under `git diff`.

## Bugs / concerns for a real GitHub Provider user

1. **`parent`/`children` are unconditionally empty/null** for every GitHub
   task (`parent: null, children: []`, hardcoded in `issueToViewModel`).
   This is documented as a known v1 gap, not hidden — but a consumer doing
   generic tree/hierarchy UI over a mixed native+github workspace will
   silently see GitHub-backed tasks as childless leaves even if they logically
   have GitHub sub-issues. Acceptable for v1 given explicit documentation, but
   worth flagging as a real limitation, not merely theoretical.
2. **No pagination safety net beyond `--paginate`**: `list()` fetches *all*
   issues (`state=all`) unfiltered before applying status/label filters
   client-side. For a repo with many issues this is an O(n) full-fetch on
   every `task list` call — fine for this experiment's 4-issue repo, would
   not scale silently for a real production repo (no caching, no field
   selection to reduce payload).
3. **PR exclusion via `!i.pull_request`** is correct per GitHub's API
   semantics (the Issues API does return PRs), and was verified present in
   both `list()` and `get()` — no bug found here, but worth noting this is
   a subtle correctness detail that could easily have been missed and would
   have silently leaked PRs into the task list.
4. **Multiple `status:*` labels on one issue**: the mapping loop takes the
   *last* matching `status:*` label found in `issue.labels` (simple
   iteration, last-write-wins), with no defensive handling/warning if a user
   manually applies two conflicting status labels to the same open issue.
   Not currently exercised by the 4 real issues (each has at most one status
   label) but is a latent silent-surprise if this Provider is used
   hands-on by a human editing labels directly on GitHub.
5. The audit brief's example spot-check file
   (`docs/proposal/quay-bootstrap-experiment.md`) does not exist in this
   repo at all — see Claim 1 caveat. Not a bug in the work under audit, but
   worth correcting in the brief/process itself for future iterations.

## Regression status

All native regression suites pass (3/3 files, exit 0 each); 3/3 spot-checked
native tasks (QN-001, QN-005, QN-007) remain `done` with clean terminal
gates. No regressions found.

## Overall verdict

**PASS.** All 7 claims independently verified true against live, real
artifacts (a real private GitHub repo with real HEAD parity, 4 real issues
with label/state data matching the documented mapping convention exactly as
implemented in code, a genuinely read-only MCP surface, working CLI parity
across two providers with a byte-level content match against the real
GitHub API, an unmodified `provider-client.js` proven via git diff, and a
green regression suite). The "ABI transfers" claim is scoped honestly with
named gaps (parent/children) rather than oversold. Minor, non-blocking
scalability/edge-case concerns noted above (full-repo fetch on every list
call, last-write-wins on conflicting status labels) should be tracked as
follow-up hardening, not blockers for the v1 walking-skeleton scope this
work explicitly claims.
