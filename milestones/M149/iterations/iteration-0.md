# M149 Iteration 0 Report

**Task:** DIR-094 — Ship distributable quay CLI + switch loop-driver to MCP tools
**Date:** 2026-07-25
**Outcome:** done

## What was done

Three file changes to make quay distributable cross-workspace and enable the loop-driver skill to use MCP tools instead of CLI commands.

### Changes

1. **packages/quay/package.json** — Added `"scripts": {"build": "node scripts/build-dist.mjs"}`. The `bin` entry (`./dist/quay.js`) was already correct; the build script now formalizes the build step. The existing `scripts/build-dist.mjs` bundles `bin/quay.ts` into a self-contained ESM `dist/quay.js` that runs on Node 20+.

2. **packages/quay-native/package.json** — Changed `bin` from `"./bin/quay-native.ts"` (TypeScript source, requires Node >=23 for native type-stripping) to `"./dist/quay-native.js"` (compiled ESM, runs on Node 20+). Added `"scripts": {"build": "bash scripts/build-dist.sh"}`, added `"dist"` to `files`. Created `scripts/build-dist.mjs` (esbuild ESM bundle with createRequire banner for yaml interop) and `scripts/build-dist.sh` (build wrapper, mirror of quay Core's pattern).

3. **plugin/skills/loop-driver/SKILL.md** — Switched from CLI commands to MCP tools:
   - Step 2 (Select): `quay task list` → MCP `task_list`
   - Step 5 (Gate): `quay gate` → MCP `gate_run`
   - Step 7 (Land): `quay task edit` → MCP `task_write`
   - Added all required MCP tools to `allowed-tools` frontmatter

## Done-when verification

1. quay Core CLI distributable. -- DONE (`npm run build` produces `dist/quay.js`, works on Node 20+)
2. quay-native CLI uses compiled JS. -- DONE (`npm run build` produces `dist/quay-native.js`, verified cross-workspace against archguard and meta-cc)
3. loop-driver skill uses MCP tools. -- DONE (all three CLI command sites replaced with MCP tool equivalents, allowed-tools updated)
4. Cross-workspace verified on archguard. -- DONE (built `dist/quay-native.js` runs from outside quay project against archguard and meta-cc task boards via `QUAY_NATIVE_TASKS_DIR`)

## Test results

- quay Core gate tests: 25/25 PASS
- quay Core loop-params tests: 38/38 PASS
- quay-native test failures (cas-writer-helper, concurrent-writer, reparent-writer): PRE-EXISTING (confirmed via git stash + rerun; same failures on clean tree)

## Build verification

```
$ cd packages/quay && npm run build
esbuild: quay ESM dist bundle written to dist/quay.js (createRequire banner injected).

$ cd packages/quay-native && node scripts/build-dist.mjs
esbuild: quay-native ESM dist bundle written to dist/quay-native.js (createRequire banner injected).

$ QUAY_NATIVE_TASKS_DIR=/home/yale/work/archguard/tasks node packages/quay-native/dist/quay-native.js task list --status ready
DIR-002  ready  primitive  DIR-002: TestCoverageRenderer.nodeId() collision...

$ QUAY_NATIVE_TASKS_DIR=/home/yale/work/meta-cc/tasks node packages/quay-native/dist/quay-native.js task list
DIR-001  todo   primitive  DIR-001: Human-readable error type labels...
DIR-002  todo   primitive  DIR-002: Fix completion_rate metric...
```

## Commits

All changes committed in a single commit.
