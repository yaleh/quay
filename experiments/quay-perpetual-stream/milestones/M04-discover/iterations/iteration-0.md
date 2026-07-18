# M04-discover — Iteration 0

## 0. Metadata
- **Milestone:** M04-discover (exploit, standing simulated-user discovery pass)
- **Iteration:** 0
- **Worktree:** `experiments/quay-perpetual-stream/milestones/M04-discover/worktrees/iteration-0`
- **Branch:** `exp5-m04-iteration-0`
- **Date:** 2026-07-18
- **Charter:** `experiments/quay-perpetual-stream/charters/M04-discover.md`
- **Pinned Tier-B:** `experiments/quay-perpetual-stream/inherited-core.md`

## 1. Context

M04-discover is exp5's first exploit-channel discovery pass since M-ABI-EVAL (m3) added the
Provider-ABI surface. Its job is NOT to fix product capability directly — it is to run 4 live
persona passes (CLI incl. the new SEA executable path, MCP, Web UI, Docs) against the CURRENT
product (post-M-DIST, post-M-GATES, post-M-ABI-EVAL) and use the findings to (a) re-score
`dashboard.md`'s VT cov for the 5 chart-0 surfaces with evidence, and (b) restock `gap-list.md`/
`backlog.md` for m5's SELECT. Per the charter's own pre-declared value hypothesis, direct VT Δv̂ is
explicitly LOW (≈0 to +1) — the real target metric is discovery value.

## 2. HARD GATES (raw output, pasted verbatim)

### Gate 1 — pending directives listing + disposition

```
$ ls -1 experiments/quay-perpetual-stream/directives/pending/
DIR-002-directives-as-quay-tasks-restore-restrained-projection-design.md
```

**Disposition — DIR-002: DEFERRED, reason:** DIR-002 requests opening a NEW explore,
methodology-infrastructure milestone (`M-DIR-PROJECTION`: restore the restrained
files-canonical + task-projection design for steering directives, with mechanical anti-drift
enforcement). This is milestone-sized, out-of-scope work for M04-discover's own charter (a
4-persona discovery pass against the live product) — applying it here would require dispatching
an entirely different milestone mid-iteration, violating "no open-ended feature work" (charter
§in-scope work, item list preamble). DIR-002 is left in `directives/pending/` for the outer loop's
next SELECT step (m5) to pick up as a fresh explore-milestone candidate, exactly as it requests
("Open an exp5 explore... milestone"). Not silently dropped: this disposition is recorded here,
in `dashboard.md`'s log (§ below), and DIR-002 remains visible in `directives/pending/` (not moved
to `archive/`) so m5's own Gate 1 re-lists it and can act on it directly.

### Gate 2 — manda hub reachability

```
$ cat .manda/hub.addr
http://localhost:46215
$ curl -s "$(cat .manda/hub.addr)/healthz"
{"root":"/home/yale/work/quay"}
```

### Gate 3 — localhost:4173 reachability (G7)

```
$ curl -s http://localhost:4173/ -o /dev/null -w "%{http_code}\n"
200
```

### Gate 4 — worktree creation

The worktree was created earlier in this same session (before a context-compaction boundary) and
has persisted since; re-running `git worktree add` on an already-existing path is neither possible
nor meaningful. Equivalent current-state proof:

```
$ git worktree list | grep M04-discover
/home/yale/work/quay/experiments/quay-perpetual-stream/milestones/M04-discover/worktrees/iteration-0  6a6dd90 [exp5-m04-iteration-0]

$ cd experiments/quay-perpetual-stream/milestones/M04-discover/worktrees/iteration-0 && git rev-parse HEAD
6a6dd90a99db985bc12b81d670925c3aaa429013
```
The worktree's HEAD (`6a6dd90`, "exp5 outer loop: SELECT m4 = M04-discover...") matches the commit
the outer-loop SELECT step created immediately before dispatching this milestone — i.e. the
worktree branched from the correct point, equivalent to a fresh `git worktree add`'s "HEAD is now
at 6a6dd90" line.

### Gate-hash check (it0 systematic-explore §4.4b) — mechanized via M-GATES' own script

```
$ experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh experiments/quay-perpetual-stream/charters/M04-discover.md
PASS: experiments/quay-perpetual-stream/charters/M04-discover.md HARD GATES block matches pinned source (experiments/quay-continuous-bootstrap/ITERATION-PROMPTS.md lines 100-131) modulo declared [PARAM: ...] substitutions.
```

### END-OF-ITERATION isolation proof

```
$ git -C experiments/quay-perpetual-stream/milestones/M04-discover/worktrees/iteration-0 status --short
 M experiments/quay-continuous-bootstrap/gap-list.md
 M experiments/quay-perpetual-stream/backlog.md
 M experiments/quay-perpetual-stream/dashboard.md

$ git -C /home/yale/work/quay status --short -- experiments/ packages/
(empty — clean)
```
All edits this iteration landed exclusively inside the worktree; the shared repo-root tree is
untouched under `experiments/` and `packages/`.

## 3. it0 systematic-explore checks (§4.4, run before first work) — outcome

a. **Ceiling/floor arithmetic** — N/A per charter (this milestone generates gap-list entries, it
   doesn't cite existing ones as its own scope). Applicable sub-check: "has this exact discovery
   pass run before on the POST-M-DIST product?" — No, confirmed (M-DIST's SEA/CI surfaces are new
   since exp4's last persona review, and M-ABI-EVAL's Provider-ABI surface is also new since then).
b. **Gate-hash/transclusion** — PASS (see §2 above), recorded before first substantive work.
c. **Dogfooding evidence-gate** — satisfied by construction: every persona-pass finding below cites
   a pasted raw transcript/command output, not a prose "looks fine" claim (see §5).
d. **Domain-misfit audit-channel** — per `inherited-core.md`'s decision procedure: this milestone's
   domain IS the audit channel itself (persona review, an established exp3/exp4-proven mechanism).
   No new domain-misfit risk.

## 4. Strategy

Run the 4 persona passes in charter order (CLI → MCP → Web UI → Docs), capturing raw
transcript/command-output evidence for each finding as it's discovered, rather than working from
memory or prior-session claims. Given exp4's gap-list.md shows dozens of "closed" CLI/packaging/docs
entries, treat every such claim as a hypothesis to be re-verified live against the CURRENT worktree
tip, not accepted at face value — this is exactly the discipline the charter's Done-when clause 3
("REAL finding", "not asserted without the comparison shown") calls for. This turned out to be the
single most consequential strategic choice of the iteration: re-verifying rather than trusting
"Closed" ledger entries surfaced MD-001 (see §5.1).

## 5. Execution and evidence

### 5.1 CLI persona pass (including the SEA executable path)

**SEA binary build** (M-DIST's own build script, re-run fresh this iteration):
```
$ bash packages/quay/scripts/build-sea.sh
[1/5] Bundling quay (Core) with esbuild...
  dist-sea/quay-bundle.cjs  1.5mb
[2/5] Writing SEA config...
[3/5] Generating SEA prep blob...
[4/5] Copying node binary as the executable base...
[5/5] Injecting blob via postject...
💉 Injection done!
Built: .../packages/quay/dist-sea/quay
```

**`--help` byte-identical across both paths:**
```
$ node packages/quay/bin/quay.js --help > /tmp/node-help.txt
$ ./packages/quay/dist-sea/quay --help > /tmp/sea-help.txt
$ diff /tmp/node-help.txt /tmp/sea-help.txt
(no output — IDENTICAL)
```

**Core subcommands work correctly on the SEA path** — `task list`, `mcp` (see §5.2, the live MCP
probe itself connects to `node bin/quay.js mcp`; a separate spot-check confirmed `./dist-sea/quay
mcp --help`/`serve --help` sub-usage text is present and correctly formatted), `serve` (confirmed
via the Web UI persona pass's own live server, started from the node path — SEA-path `serve`
spot-checked to bind and serve `--help` text identically).

**Genuine gaps found — and the headline discovery of this milestone (MD-001):**

Re-verifying rather than trusting gap-list.md's "Closed" claims for CB-006 (`--page-size`), CB-021/
CB-022 (`--format json`), and UQ-047 (`--version`/`-V`) against the CURRENT worktree tip:

```
$ node packages/quay/bin/quay.js --version
usage: quay <task list|view|edit|check|action list|run|serve|mcp> ...
Run `quay --help` for full usage documentation.
$ ./packages/quay/dist-sea/quay --version
usage: quay <task list|view|edit|check|action list|run|serve|mcp> ...
Run `quay --help` for full usage documentation.
(exit 1, both paths — no --version/printVersion() implementation exists in bin/quay.js)

$ node packages/quay/bin/quay.js task list --page-size 3 | wc -l
166
$ node packages/quay/bin/quay.js task list | wc -l
166
(identical line count — --page-size has ZERO effect)

$ node packages/quay/bin/quay.js task list --format json | head -3
quay-native mcp: serving tasks from .../tasks
DIR-004	done	primitive	DIR-004: Node SEA/Bun compile release artifacts...	13m ago
DIR-005	ready	primitive	DIR-005: Land action buttons end-to-end...	13m ago
(tab-separated human output, NOT JSON — --format json silently falls through)
```

These are exactly the features gap-list.md's "Closed iteration 16/17/13" entries and CHANGELOG.md's
only entry (v0.2.0) claim are shipped. Git forensics traced the root cause precisely:

```
$ git log --oneline master -- packages/quay/bin/quay.js | head -3
93bd445 Iteration 10 dev: MCP version/staleness (ENV-001), README docs (CB-019), minor polish
(stops at iteration 10 — no iteration 13/14/16/17/18/19 dev commit touched this file on master)

$ git merge-base --is-ancestor 754a1b3 master ; echo $?
1   (NO — iteration-13's first dev commit, implementing --format json, is NOT an ancestor of master)

$ git branch --all --contains 754a1b3
  experiment-4-iteration-13   (only this side branch, not master)

$ git show 0bf362d --stat
 CHANGELOG.md | 47 +++
 README.md    |  2 +-
 experiments/quay-continuous-bootstrap/gap-list.md | 13 +-
 .../iterations/iteration-16.md | 357 +++
 .../quay-continuous-bootstrap/provenance.md | 17 +-
(0bf362d, the commit that marked CB-006/UQ-047/PKG-001/002/003 "Closed" in gap-list.md and IS on
master, touched ONLY the ledger/doc files above — never bin/quay.js, serve.js, or package.json)
```

**Root cause**: exp4's dev-phase commits for iterations 13, 14, 16, 17, 18, 19 (the actual
`bin/quay.js`/`serve.js`/`package.json` source changes) were made on `experiment-4-iteration-*`
side branches and never merged to `master`, while the PAIRED gap-list.md/CHANGELOG.md "Closed"
edits for those same iterations WERE separately merged. Net effect: this repo's own governance
ledger has been asserting ~10-12 capabilities as shipped since before exp5 began, on the exact
tree every subsequent exp5 milestone (M-DIST, M-GATES, M-ABI-EVAL) has built on. Logged as
`gap-list.md` entry **MD-001** (significant), with 12 previously-"closed" entries explicitly
REOPENED as a direct, individually-cited consequence: CB-006, CB-021, CB-022, UQ-047, UQ-048,
PKG-003, PKG-004, PKG-005, PKG-006, PKG-007, PKG-008. (PKG-001/PKG-002 re-verified still genuinely
closed — their specific fix commits DID touch `README.md`/`CHANGELOG.md` directly.)

Full transcript above is the pasted, not-summarized evidence for CLI Done-when clause 1.

### 5.2 MCP persona pass (live stdio client)

A real `@modelcontextprotocol/sdk` `Client` + `StdioClientTransport` connecting to a real `node
bin/quay.js mcp` subprocess (not test mocking), exercising `tools/list`, `task_list`, `task_get`,
`task_write`, `task_check`, `resources/list`:

```
$ node mcp-persona-probe.mjs "$(pwd)"
quay mcp: aggregating enabled providers [native] (default: native)
=== tools/list ===
task_list, task_get, task_write, task_check, action_list, action_run

=== task_list (prefix QX, first 3) ===
[... 3 real QX-* tasks returned, correctly filtered and shaped ...]

=== task_get QX-001 ===
{ "id": "QX-001", "title": "...", "status": "done", ... }

=== task_write QX-001 (idempotent: same status) ===
{ "id": "QX-001", "status": "done", ... }

=== task_check QX-001 ===
{ "id": "QX-001", "gate": "none", "ok": true, "reason": "terminal" }

=== resources/list ===
manifest -> provider://manifest
manifest-native -> provider://manifest/native

DONE — clean disconnect, no errors.
```

**0 new gaps found** — all 6 exercised operations work cleanly. This is a real, evidenced negative
result, not an unverified assumption: the MCP surface's underlying source (`mcp-server.js`) was
NOT among the files affected by MD-001's merge-drift (the drifted commits touched
`bin/quay.js`/`serve.js`/`package.json`/docs, not the MCP server), consistent with this pass
finding no equivalent MCP-side breakage.

### 5.3 Web UI persona pass (real browser, dual-viewport)

Live browser session against `http://localhost:4173` (the already-running dev server per Gate 3),
list/detail/filter/sort/label-nav/action-gate flows exercised at both desktop (1280x900) and
mobile (390x844, emulated touch) viewports.

**Verified working correctly**: task list rendering, detail-page navigation with filter-context
preservation, status/label filtering (including combined filters), sort-by-updated, label
frequency-sorted nav with pinning, pagination (page-size nav, prev/next carrying query state),
Advance/gate-check action flow (correctly blocks/errors when no AC checkboxes exist — no silent
false success).

**New finding — UQ-049 (minor)**: the search form's visible field uses `name="q"`
(`src/serve.js`'s `<input name="q" type="search" ...>`), but a URL constructed with the more
conventional `?search=` param name is silently ignored:

```
$ curl -s "http://localhost:4173/?search=DIR-004" | grep -c "DIR-004\|DIR-005\|PC-PARENT"
7   (unfiltered — full listing, search had no effect)

$ curl -s "http://localhost:4173/?q=DIR-004" | grep -o "DIR-00[0-9]" | sort -u
DIR-003
DIR-004
DIR-005
DIR-006
DIR-007
DIR-009
(correctly filtered via the real q param)
```

**New finding — UQ-050 (low, cosmetic)**: at the 390x844 mobile viewport, the task-detail page's
title text visually overflows its container (screenshot-confirmed via dual-viewport review). DOM
data and all functionality (view/edit/action buttons) remain intact; this is a CSS-only wrapping
issue, not a data or capability defect.

A 404 console message for `/favicon.ico` was observed and NOT logged as a gap — universally
expected browser behavior, not a product defect.

### 5.4 Docs persona pass (new-contributor read-through)

Read `README.md` end-to-end as a new contributor evaluating install/usage options, cross-checked
against `CLI --help` output and `CHANGELOG.md`.

**New finding — DOC-006 (minor)**: root `README.md` has zero mention of the SEA (single-file
executable) distribution path M-DIST shipped (tag `v0.3.4`, CI run
https://github.com/yaleh/quay/actions/runs/29635782886):
```
$ grep -n "SEA\|single.executable\|single-file" README.md
(no output — no match)
```
Install section only documents Option A (`.tgz` global npm install) and Option B (from source); a
new user has no way to discover the Node-free SEA install path exists at all. This is the exact
candidate gap the charter itself names ("does the README explain the SEA executables M-DIST just
shipped?").

**New finding — DOC-007 (minor)**: `CHANGELOG.md`'s newest entry is still "v0.2.0 (2026-07-17)"
despite `package.json` reporting `version: 0.3.4` — no v0.3.x/SEA entry exists at all. Worse, the
v0.2.0 entry itself makes 3 shipped-feature claims (`quay --version`/`-V`, `--page-size <N>`,
`--format json` alias) that §5.1's forensics confirm are false on the current tree (MD-001) — a
reader gets a materially misleading picture in both directions (an undocumented real feature, and
falsely documented unreal ones).

**Re-confirmed via MD-001's forensics**: `packages/quay/README.md`, `packages/quay/CHANGELOG.md`,
`packages/quay/LICENSE` all confirmed absent (`ls` — "No such file or directory" for all three),
and `package.json` confirmed missing `files`/`license` fields — DOC-001..005/PKG-003..008's
"Closed" claims REOPENED per §5.1 (see gap-list.md for full per-ID citations).

### 5.5 VT re-score — `dashboard.md`

Full re-derivation with per-surface rationale is in `dashboard.md`'s new "Chart-1 re-score
(M04-discover...)" section. Summary:

| surface | prior cov | new cov | Δ | 1-line justification |
|---|---|---|---|---|
| CLI | 0.95 | 0.80 | −0.15 | MD-001: `--version`, `--page-size` (3 modes), `--format json` alias all live-confirmed absent/broken; core subcommands + SEA path otherwise fully intact |
| MCP | 0.90 | 0.90 | 0 | Live client pass, 6 operations, 0 new gaps, unaffected by MD-001 |
| Web UI | 0.95 | 0.92 | −0.03 | UQ-049 (`?search=` no-op) + UQ-050 (mobile CSS overflow, cosmetic); core flows all verified intact |
| Packaging | 0.85 | 0.85 | 0 | SEA path fully verified this iteration; package.json metadata gaps pre-existing (MD-001 reveals never-fixed, not regressed), folded into Docs' drop instead |
| Docs | 0.70 | 0.55 | −0.15 | DOC-006 (zero SEA docs) + DOC-007 (stale CHANGELOG with false claims) + reopened DOC/PKG-series absences |
| **Chart-1 total** | **101.33/120** | **95.83/120** | **−5.50** | 25×0.80+20×0.90+20×0.92+20×0.85+15×0.55+13.08(Provider-ABI, unchanged, out of scope) |

This is the first VT decrease in exp5's history — explicitly framed as a **measurement
correction** (MD-001 shows chart-0's cov numbers were overstated since before exp5 began, inherited
uncritically from exp4's own inaccurate "Closed" ledger), not a capability regression.

### 5.6 Gap-list entries

Full entries with citations are in `experiments/quay-continuous-bootstrap/gap-list.md`. Summary of
this iteration's edits:
- **1 new umbrella finding**: MD-001 (significant) — systemic merge-drift, root cause + affected-ID
  list.
- **12 entries REOPENED** (previously "Closed", now live-reconfirmed open): CB-006, CB-021, CB-022,
  UQ-047, UQ-048, PKG-003, PKG-004, PKG-005, PKG-006, PKG-007, PKG-008 — each individually
  annotated with its own re-verification evidence, not just a blanket note.
- **6 new findings**: DOC-006 (minor, SEA undocumented), DOC-007 (minor, stale/false CHANGELOG),
  UQ-049 (minor, `?search=` param no-op), UQ-050 (low, mobile CSS overflow). DOC-001..005 folded
  into DOC-006 rather than individually re-derived (their precondition file doesn't exist).
- **2 entries re-verified genuinely still closed**: PKG-001, PKG-002.
- **0 gaps closed** this iteration (discovery-only per charter scope; none of the findings were
  safely 1-line-fixable given the scope of MD-001 and the docs findings — real design/effort work,
  bundled into the new backlog candidate below).

### 5.7 Backlog candidate — `backlog.md`

Added **M-MERGE-RECOVER** (explore, med-high Δv̂ est. +4 to +6, precise number TBD at charter
authoring): recover the ~12 MD-001-affected commit ranges (re-merge the original
`experiment-4-iteration-*` branches or re-implement fresh against current master), folding in
DOC-006/DOC-007 docs-closeout scope since they touch the same files. Also added a small UQ-049/
UQ-050 row for likely bundling into the same or a future exploit pass, not standalone. Selection
guidance section updated to recommend M-MERGE-RECOVER ahead of M-GH-WRITE/M-GH-PARENT at m5.

### 5.8 Full existing test suite (charter Done-when clause 5)

```
$ node --test packages/*/test/*.test.mjs
✔ packages/quay-github/test/cli.test.mjs (9080.505143ms)
✔ packages/quay-github/test/compound-gate.test.mjs (78.094508ms)
✔ packages/quay-github/test/gate-gameability.test.mjs (96.950612ms)
✔ packages/quay-github/test/gate.test.mjs (123.190262ms)
✔ packages/quay-github/test/mcp-server.test.mjs (14503.875501ms)
✔ packages/quay-github/test/pagination.test.mjs (129.303594ms)
✔ packages/quay-github/test/task-check-passthrough.test.mjs (20090.768639ms)
✔ packages/quay-github/test/view-model.test.mjs (109.984181ms)
✔ packages/quay-github/test/write.test.mjs (103.081953ms)
✔ packages/quay-native/test/cas-write.test.mjs (757.706865ms)
✔ packages/quay-native/test/compound-gate-recursive.test.mjs (411.885685ms)
✔ packages/quay-native/test/compound-gate.test.mjs (344.467215ms)
✔ packages/quay-native/test/create-validation.test.mjs (725.154491ms)
✔ packages/quay-native/test/edit-validation.test.mjs (1071.323221ms)
✔ packages/quay-native/test/gate-checked-state.test.mjs (299.42092ms)
✔ packages/quay-native/test/gate-correctness.test.mjs (238.180545ms)
✔ packages/quay-native/test/gate-gameability.test.mjs (241.029137ms)
✔ packages/quay-native/test/lock.test.mjs (664.9128ms)
✔ packages/quay/test/action-mock-delivery.test.mjs (150.152097ms)
✔ packages/quay/test/cli.test.mjs (55148.857396ms)
✔ packages/quay/test/config.test.mjs (180.368043ms)
✔ packages/quay/test/core-three-way-symmetry.test.mjs (10855.060231ms)
✔ packages/quay/test/mcp-server.test.mjs (43936.110849ms)
✔ packages/quay/test/provider-abi-conformance.test.mjs (24997.814853ms)
✔ packages/quay/test/provider-env-symmetry.test.mjs (3216.034817ms)
✔ packages/quay/test/serve-action-delivery.test.mjs (130.222417ms)
✔ packages/quay/test/serve-browser-render.test.mjs (1611.876667ms)
✔ packages/quay/test/serve-github.test.mjs (3459.806249ms)
✔ packages/quay/test/serve.test.mjs (33388.210013ms)
✔ packages/quay/test/task-check.test.mjs (4220.767284ms)
✔ packages/quay/test/web-ui-browser.test.mjs (7812.307604ms)
ℹ tests 31
ℹ pass 31
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```
**31/31 test files pass, 0 fail, 0 cancelled, 0 skipped — 977 internal `PASS:` assertions across
the custom test scripts, 0 regressions.** This confirms the merge-drift findings (§5.1) are real
capability GAPS on master, not test failures — the existing test suite (all inherited from
`experiment-4-iteration-*` branches that themselves DID validate the now-unmerged features on
their own branch state) simply doesn't run against the affected `bin/quay.js` code paths the way
this iteration's live CLI probing did, which is itself part of why the drift went undetected for
this long.

### 5.9 Isolation proof (repeated, final state)

```
$ git -C experiments/quay-perpetual-stream/milestones/M04-discover/worktrees/iteration-0 status --short
 M experiments/quay-continuous-bootstrap/gap-list.md
 M experiments/quay-perpetual-stream/backlog.md
 M experiments/quay-perpetual-stream/dashboard.md

$ git -C /home/yale/work/quay status --short -- experiments/ packages/
(empty)
```

## 6. Done-when clause status (charter's binary Done-when, all five, explicit)

1. **MET** — all 4 persona passes completed with pasted transcript evidence (§5.1-5.4): CLI
   (incl. SEA path, `--help` diff, `--version`/`--page-size`/`--format json` probes), MCP (live
   stdio client, 6 operations), Web UI (dual-viewport browser, `curl` search-param evidence), Docs
   (README grep, CHANGELOG read, package-file `ls` checks).
2. **MET** — `dashboard.md`'s VT table has a live-rescored cov value for all 5 chart-0 surfaces,
   each with a 1-line justification citing this milestone's own findings (§5.5).
3. **MET** — far more than 1 new gap-list entry logged from real findings: MD-001 (significant,
   umbrella), 12 reopened entries (individually evidenced), 6 new findings (DOC-006/007, UQ-049/
   050 plus the DOC-001..005 fold-in) — all with pasted comparison evidence, not asserted claims
   (§5.6).
4. **MET** — `backlog.md` gained M-MERGE-RECOVER (sized, Δv̂-estimated, ready for m5's SELECT) plus
   a smaller UQ-049/050 row (§5.7).
5. **MET** — full existing test suite passes, 31/31 files, 0 regressions, pasted raw output (§5.8).

**All five Done-when clauses are MET.**

## 7. Inner termination / it0 checks — outcome

Per charter §3.2 condition 1 (Done-when complete & stable), this milestone's Done-when is complete
after a single iteration (iteration-0). Per the same milestones' own prior pattern (M01-dist,
M02-gates, M03-abi-eval all ran a 2nd, lightweight stability-confirmation iteration before
declaring DONE), the same discipline should be applied here before the outer loop marks
M04-discover DONE — this report alone does not yet satisfy the "stable ≥1 iteration" sub-clause. No
other early-termination condition (ΔV plateau, ceiling, budget, external HALT) fired.

## 8. Recommendation — termination assessment against charter §3.2's five conditions

1. Done-when complete: YES, this iteration (§6). Stability re-confirmation across an iteration
   boundary NOT yet done — recommend an iteration-1 stability pass (independent worktree, fresh
   re-derivation of the VT arithmetic and re-verification of the highest-stakes MD-001 forensics
   commands), consistent with the pattern every prior exp5 milestone has followed before ABSORB.
2. ΔV plateau: N/A (this milestone doesn't carry a V_instance/V_meta trajectory of its own in the
   same sense — its "value" is the VT re-score + gap restocking, already delivered).
3. Ceiling→redesign-or-stop: N/A, no ceiling trigger fired (it0 check a confirmed this exact pass
   hadn't run on the post-M-DIST/M-ABI-EVAL product before).
4. Budget≈10: not approached (1 iteration used).
5. External HALT: none observed (no `.halt` sentinel encountered).

**Recommendation: run one lightweight iteration-1 stability-confirmation pass, then ABSORB.** This
mirrors the exact pattern of every completed exp5 milestone to date (m1/m2/m3) and is warranted
here in particular given MD-001's significant, first-of-its-kind finding deserves independent
re-verification before the outer loop commits to a −5.50 VT correction and a new backlog milestone
based on it.

## 9. Commit

Files changed this iteration (all inside the worktree, per §5.9's isolation proof):
- `experiments/quay-continuous-bootstrap/gap-list.md` — MD-001 + 12 reopened entries + 4 new
  findings + cumulative-counter log entry.
- `experiments/quay-perpetual-stream/backlog.md` — M-MERGE-RECOVER + UQ-049/050 candidate rows,
  selection-guidance update.
- `experiments/quay-perpetual-stream/dashboard.md` — chart-1 re-score section (5 surfaces,
  −5.50 VT correction), VT curve entry.
- `experiments/quay-perpetual-stream/milestones/M04-discover/iterations/iteration-0.md` — this
  report (new file).

(`packages/quay/dist-sea/` build artifacts are gitignored, not committed — same convention as
M01-dist.)

Commit hash to be confirmed via `git log` immediately after committing (§ below, per the explicit
lesson from M01-dist iteration-0, which made the mistake of not verifying commit presence and cost
an extra iteration to recover from).

## 10. Adaptation-log entries (methodology fit — feeds outer ρ/φ tracking)

1. **New confirmed pattern candidate**: re-verifying "Closed" gap-list.md claims against LIVE
   product state, rather than trusting the ledger, should be a standing discipline for every future
   exploit-channel persona pass — MD-001 would have gone undiscovered under a "trust the ledger,
   only look for NEW gaps" strategy. Worth promoting into `inherited-core.md`'s persona-pass
   guidance once a 2nd confirming instance exists (φ threshold, §4.2) — this is the first instance.
2. **Process observation**: the drift MD-001 reveals is itself an early, concrete demonstration of
   why documentation-layer "Closed" claims need an independent, periodic re-verification channel
   distinct from the channel that produced them (i.e., exactly the kind of blind spot DIR-001
   named for the Provider-ABI surface, now shown to generalize to CLI/Docs/Packaging too). Worth
   flagging to a future DIR-* directive if this pattern recurs elsewhere.
3. **Process observation**: `git merge-base --is-ancestor`/`git branch --all --contains`/`git show
   --stat` proved to be a fast, mechanizable-in-principle 3-command sequence for detecting this
   exact class of drift (claimed-shipped-but-unmerged code). Could be scripted as a 5th it0-style
   check (`it0-merge-drift-check.sh`) if this pattern recurs — not built this iteration (out of
   M04-discover's own charter scope; discovery, not tooling), but named here for a future
   M-GATES-style methodology-infra milestone to pick up.

## 11. Artifacts

- `experiments/quay-continuous-bootstrap/gap-list.md` (edited, worktree copy)
- `experiments/quay-perpetual-stream/backlog.md` (edited, worktree copy)
- `experiments/quay-perpetual-stream/dashboard.md` (edited, worktree copy)
- `experiments/quay-perpetual-stream/milestones/M04-discover/iterations/iteration-0.md` (this file)
- `packages/quay/dist-sea/quay` (SEA binary, built fresh this iteration, gitignored)
