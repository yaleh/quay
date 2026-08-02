---
id: gap-tests-use-cli-where-module-import-suffices
title: "18 test files test logic through a 3.5s CLI spawn instead of importing
  the module"
status: todo
labels:
  - gap
  - milestone-candidate
extra:
  schema: v1
---

**type:** execution

## Proposal

Of 113 non-symlink test files in the CI glob:

```
直接 import src 模块: 59 文件   （毫秒级）
只走 CLI 不 import:   18 文件   （每次 spawn 1.4–3.5 s）
```

The 18, by CLI call-site count:

| 文件 | CLI 处 |
|---|---|
| `packages/quay/test/cli.test.mjs` | 24 |
| `packages/quay/test/mcp-server.test.mjs` | 9 |
| `packages/quay-github/test/cli.test.mjs` | 4 |
| `plugin/test/codex-stage1-adapter.test.mjs` | 3 |
| `provider-abi-conformance` / `package-json-bin` / `gap002-create-ergonomics.iteration-0` / `gap-cli-gate-enforcement` / `cli-migrate` / `cli-edit-parity-conformance` / `quay-github/mcp-server` | 2 each |
| `mcp-adr` / `init` / `gap002-create-ergonomics` / `cli-adr` / `quay-github/task-check-passthrough` / `quay-github/create-mcp` / `quay-backlog/mcp-server` | 1 each |

[[gap-tests-spawn-cli-from-ts-source]] makes each spawn ~2.1 s cheaper. This task reduces how many
spawns are needed at all — a smaller but more durable win, because it removes work rather than
speeding it up.

### The distinction that decides each case

A CLI spawn is **necessary** when the assertion is about the CLI contract itself:

- argument parsing (flag-before-id, greedy value consumption, unknown-flag handling)
- exit codes
- stdout/stderr shape and routing
- process-level behavior (env var handling, cwd resolution, signal handling)

A CLI spawn is **incidental** when the assertion is about logic that happens to be reachable through
the CLI:

- "creating a task with these fields produces this frontmatter"
- "this config shape yields these gates"
- "this lifecycle transition is rejected"

The second class should `import` the module and call the function. Same assertion, ~3.5 s → ~0 s.

**This is a judgment call per test, not a mechanical rewrite.** The task is to make the judgment
explicitly, case by case, and record it — not to convert everything.

## Chosen mechanism

Work the 18 files in descending CLI-call order (`cli.test.mjs` first — 24 sites, the single largest
concentration). For each CLI call site:

1. Read what the test actually asserts
2. Classify **contract** (keep the spawn) or **incidental** (convert to a module import)
3. Convert only the incidental ones; the assertion text must survive unchanged
4. Record the classification in a comment at the call site so the next reader does not re-derive it

**Hard rule: coverage must not shrink.** A converted test asserts the same thing about the same
code path. If converting would lose coverage of the CLI layer, it is contract, not incidental —
keep the spawn.

**Keep at least one end-to-end spawn per CLI surface.** Even when every individual assertion in a
file is incidental, one real spawn must remain to prove the CLI wires to the module at all.
Converting a file to 100% imports would make a broken CLI entry point invisible.

**Deliberately NOT done:** no mass mechanical conversion, no assertion rewrites, no file
reorganization. If a file's sites are all genuinely contract-level, it is left alone and that
finding is recorded — a file that legitimately needs 24 spawns is a valid outcome.

## Acceptance Criteria

- [ ] AC1: All 18 files reviewed; each CLI call site classified `contract` or `incidental` in a comment
- [ ] AC2: Every `incidental` site converted to a direct module import with the assertion text unchanged
- [ ] AC3: Every file retains ≥1 real CLI spawn (end-to-end wiring proof)
- [ ] AC4: Zero assertions weakened or deleted — `git diff` reviewed for assertion-text changes; any change justified in the commit
- [ ] AC5: Per-file wall-clock recorded before and after for the top 4 files (`cli.test.mjs`, `quay/mcp-server`, `quay-github/cli`, `codex-stage1-adapter`)
- [ ] AC6: Suite wall-clock recorded before and after
- [ ] AC7: Files where all sites are contract-level are documented as such, with the reason — not silently skipped
- [ ] AC8: Test count unchanged or higher — conversion must not drop test cases (`node --test` count compared)
- [ ] AC9: Group declarations preserved per [[gap-test-suite-has-no-layer-grouping]]

## Definition of Done

- [ ] 18 files reviewed, classifications recorded at each site
- [ ] Before/after timings for the top 4 files and the suite
- [ ] `scripts/test.sh` green with an unchanged-or-higher test count
- [ ] A short summary in the task body: how many sites were contract vs incidental, and the total saved

## Touches

- packages/quay/test/cli.test.mjs
- packages/quay/test/mcp-server.test.mjs
- packages/quay/test/provider-abi-conformance.test.mjs
- packages/quay/test/package-json-bin.test.mjs
- packages/quay/test/gap002-create-ergonomics.iteration-0.test.mjs
- packages/quay/test/gap-cli-gate-enforcement.test.mjs
- packages/quay/test/cli-migrate.test.mjs
- packages/quay/test/cli-edit-parity-conformance.test.mjs
- packages/quay/test/mcp-adr.test.mjs
- packages/quay/test/init.test.mjs
- packages/quay/test/gap002-create-ergonomics.test.mjs
- packages/quay/test/cli-adr.test.mjs
- packages/quay-github/test/cli.test.mjs
- packages/quay-github/test/mcp-server.test.mjs
- packages/quay-github/test/task-check-passthrough.test.mjs
- packages/quay-github/test/create-mcp.test.mjs
- packages/quay-backlog/test/mcp-server.test.mjs
- plugin/test/codex-stage1-adapter.test.mjs
