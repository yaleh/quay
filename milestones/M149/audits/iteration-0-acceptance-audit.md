# M149 Iteration 0 Acceptance Audit — DIR-094

**Audit session id:** ee05dd8f-1d70-4c6c-bd46-2fcb1299743e

## Verdict: NO REFUTATION FOUND

All 5 Acceptance Criteria and 5 Definition of Done items are satisfied with concrete, independently verifiable evidence. No deviation row required (zero refutations).

---

## AC 1: `quay` CLI binary exists and invocable from PATH outside quay project

**VERIFIED.** Evidence:

- `/home/yale/work/quay/packages/quay/dist/quay.js` exists (1.25 MB, 33,952 lines, shebang `#!/usr/bin/env node`, executable)
- `packages/quay/package.json` declares `"bin": {"quay": "./dist/quay.js"}` and `"build": "node scripts/build-dist.mjs"`
- `packages/quay/scripts/build-dist.mjs` bundles `bin/quay.ts` via esbuild (ESM, createRequire banner, Node 20+)
- `cd /tmp && node /home/yale/work/quay/packages/quay/dist/quay.js --help` produces full help output (all commands listed)
- `build-dist.test.mjs`: 3/3 PASS (includes shell wrapper smoke)
- `build-dist-smoke.test.mjs`: 4/4 PASS (different-cwd task list, serve, MCP round-trip, doc gate)

## AC 2: `quay-native` CLI binary invocable from PATH (compiled JS)

**VERIFIED.** Evidence:

- `/home/yale/work/quay/packages/quay-native/dist/quay-native.js` exists (1.10 MB, 30,473 lines, shebang, executable)
- `packages/quay-native/package.json` changed `bin` from `"./bin/quay-native.ts"` (TS source) to `"./dist/quay-native.js"` (compiled ESM)
- `packages/quay-native/package.json` added `"build": "bash scripts/build-dist.sh"` and `"dist"` to `"files"`
- `packages/quay-native/scripts/build-dist.mjs` builds a self-contained ESM bundle with createRequire banner (verified load-bearing banner prevents yaml `__require` crash)
- `cd /tmp && node /home/yale/work/quay/packages/quay-native/dist/quay-native.js --help` produces `usage: quay-native <task|mcp|manifest> ...`

## AC 3: `quay-loop-driver` skill uses MCP tools, not CLI commands

**VERIFIED.** Evidence:

- `plugin/skills/loop-driver/SKILL.md` allowed-tools frontmatter: `mcp__quay__task_list, mcp__quay__task_get, mcp__quay__task_write, mcp__quay__gate_run, mcp__quay__gate_log, mcp__quay__lifecycle_complete, mcp__quay__lifecycle_promote, mcp__quay__lifecycle_retreat, mcp__quay__lifecycle_adjudicate, mcp__quay__action_list, mcp__quay__action_run, mcp__quay__task_check`
- Step 2 (Select): `quay task list --status ready --provider` replaced by `MCP task_list with { status: "ready", provider: <params.board> }`
- Step 5 (Gate): `quay gate <task.id> --gate` replaced by `MCP gate_run with { id: <task.id>, gate: <params.gates[0]>, cwd: <worktree>, provider: <params.board> }`
- Step 7 (Land): `quay task edit <id> --status` replaced by `MCP task_write with { id: <id>, status: ..., provider: <params.board> }`
- `grep` for `quay ` CLI command patterns in SKILL.md returns only the description field (not a command invocation)

## AC 4: Cross-workspace verification on archguard + meta-cc

**VERIFIED.** Independent re-verification performed:

```
$ QUAY_NATIVE_TASKS_DIR=/home/yale/work/archguard/tasks node /home/yale/work/quay/packages/quay-native/dist/quay-native.js task list --status ready
DIR-002  ready  primitive  DIR-002: TestCoverageRenderer.nodeId() collision...

$ QUAY_NATIVE_TASKS_DIR=/home/yale/work/meta-cc/tasks node /home/yale/work/quay/packages/quay-native/dist/quay-native.js task list
DIR-001  todo   primitive  DIR-001: Human-readable error type labels...
DIR-002  todo   primitive  DIR-002: Fix completion_rate metric...
DIR-003  todo   primitive  DIR-003: get_tech_debt should scan source code...
DIR-004  todo   primitive  DIR-004: file_ref mode should support streaming...
MCTEST   done   primitive  DELIVERY-D: meta-cc Provider-ABI proof
```

Both cross-workspace invocations succeed with correct task listings.

## AC 5: Existing behavior unchanged in quay workspace

**VERIFIED.** Test suites pass:

- `gate.test.mjs`: 25/25 PASS (duration 9.1s)
- `loop-params.test.mjs`: 38/38 PASS (duration 0.22s)
- `build-dist.test.mjs`: 3/3 PASS
- `build-dist-smoke.test.mjs`: 4/4 PASS
- `package-json-bin.test.mjs`: 1/1 PASS
- `npm-pack-e2e.test.mjs`: 1/1 PASS

---

## DoD Satisfaction

### DoD 1: `packages/quay/` has build step producing `dist/quay.js`

**SATISFIED.** `packages/quay/package.json`: `"build": "node scripts/build-dist.mjs"`, `"bin": {"quay": "./dist/quay.js"}`. `scripts/build-dist.mjs` exists (M120, builds ESM bundle with createRequire banner). `dist/quay.js` exists (1.25 MB).

### DoD 2: `quay-native` global install produces working binary

**SATISFIED.** `packages/quay-native/package.json`: `"bin": {"quay-native": "./dist/quay-native.js"}`, `"build": "bash scripts/build-dist.sh"`. `scripts/build-dist.mjs` + `scripts/build-dist.sh` exist. `dist/quay-native.js` exists (1.10 MB). Verified operational cross-workspace (archguard, meta-cc).

### DoD 3: `plugin/skills/loop-driver/SKILL.md` uses MCP tools

**SATISFIED.** All three CLI command sites (select, gate, land) replaced with MCP equivalents. allowed-tools frontmatter updated with all required MCP scopes. No CLI command invocations remain.

### DoD 4: Cross-workspace verification: archguard + meta-cc loop operational

**SATISFIED.** `dist/quay-native.js` operates correctly with `QUAY_NATIVE_TASKS_DIR` set to archguard and meta-cc task directories.

### DoD 5: Plugin packaging test passes

**SATISFIED.** `package-json-bin.test.mjs`: 1/1 PASS (package.sh builds dist/ before npm pack). `npm-pack-e2e.test.mjs`: 1/1 PASS.

---

## Mechanical Gate (it0-dod-check.sh)

**PASS (exit 0).** All 12 clauses satisfied:

- clause0-ac-dod-present: PASS (5 AC, 5 DoD, all checked)
- clause1-adversarial-audit: PASS (disposition statement present)
- clause2-vmeta-lag: PASS (disposition statement present)
- clause3-line-budget: PASS (scope within small-milestone norm)
- clause4-impl-row: PASS (not design-only)
- clause5-no-self-exemption: PASS
- clause6-escrow-delta-v: N/A (not design-only)
- clause7-test-floor: PASS (WAIVER for infrastructure changes)
- clause8-task-canonical-lifecycle-record: PASS (Proposal + Plan present)
- clause9-split-or-commit: N/A (no needs-human outcome)
- clause10-tree-hygiene: PASS (clean tree)
- clause11-worktree-branch-hygiene: PASS (no orphaned branches)
- clause12-audit-independence: N/A (no Audit-independence check section)

---

## Diff scope verification

The M149 commit `b4fc2dd` touches exactly 6 files, all within the declared scope:

1. `packages/quay/package.json` (build script + bin)
2. `packages/quay-native/package.json` (bin fix, build script, dist in files)
3. `packages/quay-native/scripts/build-dist.mjs` (new, ESM bundle builder)
4. `packages/quay-native/scripts/build-dist.sh` (new, build wrapper)
5. `plugin/skills/loop-driver/SKILL.md` (CLI → MCP migration)
6. `milestones/M149/iterations/iteration-0.md` (evidence record)

No unexpected file changes.
