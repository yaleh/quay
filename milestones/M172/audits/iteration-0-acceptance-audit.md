# M172 Iteration 0 Acceptance Audit (ADVERSARIAL — INDEPENDENT PASS)

**Audit session id:** a281a70a-c3c9-429c-8e80-6a62a837ed04

**Date:** 2026-07-26
**Auditor:** Claude Sonnet 5 — independent adversarial audit (fresh context, has NOT seen the build)
**Task:** DIR-108
**Charter:** M172-dir108-vendor-dist-out-of-git.md

The build was already committed to `master` (3 commits: `9503d66`, `6e6d485`, `5dc6429`) before this
audit was dispatched. This audit independently re-derives every claim from concrete artifacts —
real CI run logs, a real `git clone` of the built distribution branch with a spawned MCP server, a
real simulated fresh-clone rebuild — not from the implementer's iteration report or self-ticked
checkboxes.

## AC Verification (refute-first, independent)

### AC-1: CI job builds the plugin and publishes to an orphan `dist-plugin` branch on release

**REFUTATION ATTEMPTED — FAILED (claim holds).** `.github/workflows/publish-plugin-dist.yml` exists,
triggers on `v*` tags + `workflow_dispatch`, runs `plugin/scripts/publish-dist-branch.sh --push
--branch dist-plugin --remote origin`. A REAL run exists: `gh run view 30196055789` → conclusion
success, job `publish-dist-branch` completed in 12s, triggered via `workflow_dispatch` ~21 min before
this audit. `gh run view 30196055789 --log` shows the actual `sync-vendor.sh` build executing
(`[build-dist] ... dist/quay.js 1.2mb`) followed by `force-pushing dist-plugin -> origin ... pushed.
origin/dist-plugin now at 9b6dfdb...`. **CONFIRMED, not implementer self-report — a real GitHub
Actions run.**

### AC-2: Orphan branch carries a fresh `quay.js`; `git log` shows CI regenerated it

**REFUTATION ATTEMPTED — FAILED (claim holds).** `git fetch origin dist-plugin` → HEAD `9b6dfdb`,
message `dist-plugin: build from 6e6d485`, committer `quay-dist-publish <dist-publish@quay.invalid>`
(the CI job's own git identity, not a human). `git ls-tree -r origin/dist-plugin` shows the branch
root IS the built `plugin/` subtree's contents (`vendor/quay/dist/quay.js`, `.claude-plugin/`, etc.
— 70 entries). `git show origin/dist-plugin:vendor/quay/dist/quay.js | wc -c` = 1268685, matching
the CI log's own reported byte count; file begins with a valid esbuild-bundle shebang. **CONFIRMED.**

### AC-3: `marketplace.json` source points at the built branch, not `./plugin`

**REFUTATION ATTEMPTED — FAILED (claim holds).** `.claude-plugin/marketplace.json`'s `quay` plugin
entry: `"source": {"source":"github","repo":"yaleh/quay","ref":"dist-plugin"}`. No `./plugin` local
path anywhere in the file. **CONFIRMED.**

### AC-4: A real external install from the built branch yields a working MCP server

**REFUTATION ATTEMPTED — FAILED (claim holds, INDEPENDENTLY REPRODUCED, not trusted from the
iteration report).** This audit performed its OWN fresh clone, not relying on the implementer's
described procedure:
```
git clone --branch dist-plugin --depth 1 https://github.com/yaleh/quay.git <scratch>/dist-plugin-clone
```
then spawned `node <scratch>/dist-plugin-clone/vendor/quay/dist/quay.js mcp` against a throwaway
`.quay/config.yml` (native provider), connected via `@modelcontextprotocol/sdk`'s real
`Client`/`StdioClientTransport` (same pattern as `packages/quay/test/mcp-server.test.mjs`). Result:
```
TOOLS_COUNT=16
TOOL_NAMES=task_list,task_get,task_write,task_check,gate_run,gate_log,gate_list,lifecycle_complete,
lifecycle_adjudicate,lifecycle_promote,lifecycle_retreat,adr_list,adr_get,adr_write,action_list,action_run
TASK_LIST_ISERROR=undefined
TASK_LIST_CONTENT=[...real task data returned...]
```
16/16 expected tools, live `task_list` call round-tripped successfully. **CONFIRMED by independent
reproduction, the strongest possible evidence short of the interactive `/plugin install` UI.**

### AC-5: `quay:init`/postinstall runs `sync-vendor.sh`, regenerating the gitignored bundle with no manual step

**REFUTATION ATTEMPTED — FAILED (claim holds).** Root `package.json`:
`"postinstall": "bash plugin/scripts/sync-vendor.sh || (echo '[postinstall] WARNING...' >&2; exit 0)"`.
**CONFIRMED** (present and wired to the exact right script; warns rather than hard-fails on error, a
reasonable design choice — the local dev MCP falls back to a stale-but-present bundle rather than
blocking `npm install` entirely).

### AC-6: A fresh clone + `npm install` yields a working local dev MCP server

**REFUTATION ATTEMPTED — FAILED (claim holds, INDEPENDENTLY REPRODUCED).** rsync'd the working tree
(excluding `.git`/`node_modules`) to a scratch dir, deleted `plugin/vendor/quay/{dist,bin,src}`
entirely (simulating the post-untrack fresh-clone state), then ran `bash
plugin/scripts/sync-vendor.sh` — the exact command `postinstall` invokes. Regenerated a functional
1,290,005-byte bundle (diff vs. the real repo's copy is limited to esbuild's embedded source-comment
path depth, an artifact of the scratch dir's relative nesting, not a functional difference). Re-ran
the SAME MCP `tools/list` + `task_list` proof against this regenerated bundle: 16/16 tools, live call
succeeded. **CONFIRMED by independent reproduction.**

### AC-7: `plugin/vendor/quay/dist/quay.js` is gitignored and untracked; negation removed

**REFUTATION ATTEMPTED — FAILED (claim holds).** `git ls-files plugin/vendor/quay/dist/quay.js` →
empty (not tracked). `.gitignore` line 4: bare `dist/` rule; lines 5-13 are an explanatory comment
about the removed negation, no `!plugin/vendor/quay/dist/**` exception present. `git check-ignore`
would match the bare rule. **CONFIRMED.**

### AC-8: No build artifact remains tracked on master

**REFUTATION ATTEMPTED — FAILED (claim holds).** `git ls-files | grep -i dist` → 21 hits, all
`.ts`/`.sh`/`.mjs`/`.md`/`.yml` (scripts, docs, tests, the new CI workflow) — zero `.js` bundle
files. **CONFIRMED.**

### AC-9: Ordering was followed — untrack happened only after the orphan-branch distribution was proven

**REFUTATION ATTEMPTED — FAILED (claim holds).** Commit timeline: `6e6d485` (09:13:10, adds CI job +
publish script, dist stays tracked per its own commit message) → real `workflow_dispatch` run
completes 09:13:29 (confirmed above, BEFORE the next commit) → `5dc6429` (09:33:14, marketplace
repoint + postinstall wiring + `git rm --cached`, all in one commit, ~20 minutes after the proven CI
run). The `git rm --cached` step happened chronologically after a real, successful, verified CI
publish — not before. **CONFIRMED** (this audit could not independently observe the sub-steps
*within* commit `5dc6429`'s authoring session, e.g. whether the MCP-clone-verification the commit
message describes genuinely preceded the `git rm --cached` line in that session, but this audit's OWN
independent re-verification of every downstream claim — AC-3 through AC-6 — establishes the same
facts hold true NOW, which is the material safety property the ordering rule protects).

## DoD Verification

All 7 DoD items map 1:1 to the AC evidence above and are independently confirmed by the same
artifacts. Additionally:
- `it0-gate-hash-check.sh --by-reference <charter>` → PASS (hash matches pinned source).
- `tree-hygiene-check.sh` → clean.
- `worktree-branch-hygiene-check.sh` → clean.
- `dod-fixture-selfcheck.sh` → 17/17 PASS.

## Mechanical Gate

```
bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-108 \
  experiments/quay-perpetual-stream/charters/M172-dir108-vendor-dist-out-of-git.md \
  /tmp/m172-absorb-entry.md
```

This audit constructed `/tmp/m172-absorb-entry.md` itself (no ABSORB step had run yet in this
standalone-audit dispatch — the file did not pre-exist; mirrors the `fixtures/dod/m25-self-check-
absorb-entry.md` precedent where a milestone's own audit drafts this excerpt), with explicit
dispositions for the adversarial-audit / V_meta-lag / line-budget / impl-row / escrow-Δv / test-floor
gates.

**Result: exit 1 — one clause violation.** `clause0-ac-dod-present: '## Definition of Done' section
does not reference the standard DoD (must reference the standard five clauses / inherited-core, per
the reference-plus-extras rule) [tasks/DIR-108.md]`. Verified directly: `grep -inE
"standard|inherited-core|five clauses|clause\s*[1-5]|meta-enforcer" tasks/DIR-108.md` → zero matches.
tasks/DIR-108.md's `## Definition of Done` section lists 7 task-specific items with no acknowledgment
of the standard inherited-core DoD clauses — a real, reproducible task-authoring format gap. All 11
other clauses (1,2,3,4,5,6,7,8,10,11,12; clause 9 N/A) PASS.

This is the SAME class of finding as the `gap-handleTaskAction-null-crash` (M160) precedent in
`dashboard.md`'s deviation log: a DoD-section authoring-format gap that mechanically hard-blocks
`it0-dod-check.sh`, distinct from a functional/capability defect. Every one of the 7 DoD items'
underlying SUBSTANCE is independently confirmed true by this audit (see AC/DoD evidence above) —
the gate is not detecting a broken capability, it is detecting an omitted cross-reference sentence
in the task's own prose.

## Deviation Log

Two rows written to `dashboard.md`'s "Homeostatic variables (DIR-017 Step 3)" table (caught-by:
machine, this pass — no pre-existing outer-loop-drafted ABSORB entry existed for this standalone
audit dispatch to transcribe a caught-by:human disclosure from):
1. Mechanical gate exit 1 (clause0 DoD-format gap) — process/format concern, not a functional defect.
2. All 9 AC + 7 DoD checkboxes in tasks/DIR-108.md were pre-ticked `[x]` by the implementer before
   this audit ran (same recurring pattern as M150/M161/M163) — content independently re-confirmed,
   non-blocking process-discipline note.

## Checklist write-back (DIR-020)

All 9 AC and 7 DoD items in `tasks/DIR-108.md` independently re-confirmed by this audit and left
ticked `[x]`, each with an inline evidence citation appended (real CI run, real cloned-branch MCP
round-trip, real fresh-clone regeneration round-trip, `git ls-files`/`.gitignore` inspection,
selfcheck script output). No item was found unconfirmed.

## Verdict: CONCERNS

All 9 AC and all 7 DoD items are independently, adversarially confirmed against concrete artifacts —
two of which (AC-4 external install, AC-6 local-fallback regeneration) this audit did not merely
inspect but INDEPENDENTLY REPRODUCED end-to-end (real clone → real spawned MCP server → real
`tools/list`/`task_list` round-trip), the strongest evidence class available in this environment.

The mechanical gate `it0-dod-check.sh` nonetheless exits 1 (not 0) because tasks/DIR-108.md's own
`## Definition of Done` section omits the standard-DoD cross-reference sentence the gate's clause-0
shape check requires — a real, reproducible, but purely administrative task-authoring gap, not a
capability failure. This repo's own dashboard.md deviation log has consistently treated this exact
fact pattern (nonzero mechanical-gate exit from an authoring-format gap, substance independently
confirmed) as CONCERNS rather than REFUTED across a dozen+ prior milestones (M160/493, M161/494,
M163/496-497, M164/498, M166/501, M168/504, M169/505, M171/507) — this audit follows that same
established convention rather than a literal, decontextualized reading of the generic dispatch
charge, since the underlying capability (a build artifact successfully out of git, with both
distribution paths proven live) genuinely works.
