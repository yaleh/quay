---
id: gap-codex-selfcheck-fails-on-installed-codex-cli-0125
title: codex-stage1 selfcheck A8 fails — .codex/config.toml validated against
  codex-cli 0.146.0 but environment has 0.125.0
status: done
labels:
  - gap
  - defect
parent: null
children: []
extra:
  schema: v1
---

## Proposal

`plugin/test/codex-stage1-adapter.test.mjs` A8 (`codex-stage1-selfcheck.sh exits 0`)
fails on the current machine. Root cause (evidence from isolated run, 2026-08-05):

- `.codex/config.toml` header explicitly says it was **validated against codex-cli
  0.146.0** (`codex mcp list` reports the project `quay` server as enabled).
- The installed CLI is **codex-cli 0.125.0** (`codex --version`). The selfcheck's
  `codex mcp get quay` invocation fails against 0.125.0 — the `[mcp_servers.quay]`
  entry is not accepted by this older version.
- `codex mcp list` in 0.125.0 DOES show other project servers (archguard,
  chrome-devtools, playwright, swarm) as `enabled` — so the quay entry's format is
  what 0.125.0 rejects, not the tool in general.

The selfcheck already "degrades if codex absent" (exits 0 when codex is not
installed). This failure is the *present-but-incompatible* case: codex is installed
but too old to accept the config.

## Acceptance Criteria

- [x] AC1: `bash plugin/scripts/codex-stage1-selfcheck.sh` exits 0 on this machine
      (with the current codex-cli), OR the incompatibility is explicitly documented
      and A8 is made to degrade on it — not a raw failure.
- [x] AC2: `codex mcp get quay` succeeds on the installed codex-cli version after the
      fix (if the fix is config-side), OR the version-degrade path is mechanical and
      covered by a test.
- [x] AC3: `node --no-warnings --test --test-name-pattern="A8" plugin/test/codex-stage1-adapter.test.mjs`
      passes.
- [x] AC4: the fix is a deliberate choice between (a) upgrade codex-cli to ≥0.146.0
      (matches the config's validated version), (b) make `.codex/config.toml`
      compatible with 0.125.0, or (c) make the selfcheck degrade on
      present-but-incompatible versions — with the reason recorded. Prefer the choice
      that keeps the test meaningful (a real selfcheck, not a silent skip).

## Resolution

- **outcome: DONE** — chose **(c) make the selfcheck degrade on present-but-incompatible
  codex** (explicit, version-aware SKIP of the live proof; never a raw failure). Root
  cause confirmed empirically: codex-cli 0.125.0 does **not** load project-scoped
  `.codex/config.toml` MCP servers at all — a controlled probe project whose config
  registered `[mcp_servers.zztest]` was completely invisible to `codex mcp list` /
  `codex mcp get zztest` on the installed 0.125.0. So (b) "make `.codex/config.toml`
  compatible with 0.125.0" is **impossible** (there is no config-side change that makes
  an old version that never reads the file see the quay server, short of editing the
  user-level `~/.codex/config.toml` — a system-wide mutation that would expose quay to
  every project). **(a) upgrade codex-cli to ≥0.146.0 was deliberately NOT chosen**: it
  is a global `npm install -g @openai/codex` system mutation on an unattended loop
  machine (the loop's own automation does not invoke the codex binary — the selfcheck is
  the only live caller), and an environment-only fix is not reproducible as a repo
  change — the present-but-incompatible defect class would still raw-fail A8 on any other
  machine with an old codex. (c) keeps the selfcheck **meaningful, not a silent skip**:
  static validation still runs and still FAILs on a missing config / forbidden keys /
  wrong server command, a loaded-but-rejected quay server still FAILs (new negative test
  A10), and the degrade fires **only** when the installed codex physically cannot load the
  project config — with an explicit note naming the version, the reason, and the
  ≥0.146.0 remedy.
- **mechanics:** `codex mcp get quay` fails AND `codex mcp list` surfaces no `^quay`
  row ⇒ project config not loaded ⇒ present-but-incompatible ⇒ explicit SKIP + exit 0
  (if static validation passed); a `quay` row present ⇒ real defect ⇒ FAIL (unchanged
  strictness). Covered mechanically by new tests A9 (degrade) and A10 (negative: real
  defect still FAILs) using a fake `codex` on PATH.
- **evidence (AC1):** `bash plugin/scripts/codex-stage1-selfcheck.sh` exits 0; output
  tail: `implementing Codex version: codex-cli 0.125.0` → `SKIP (present-but-incompatible):
  codex-cli 0.125.0 does not load project-scoped .codex/config.toml MCP servers — 'codex
  mcp list' surfaces no 'quay' row. ...` → `=== RESULT: PASS (static; live codex
  confirmation SKIPPED — installed codex present-but-incompatible) ===` (exit 0).
- **evidence (AC3):** `node --no-warnings --test --test-name-pattern="A8"
  plugin/test/codex-stage1-adapter.test.mjs` → `✔ A8 ... (191ms)` → `tests 1, pass 1,
  fail 0` (exit 0). Scoped `bash scripts/test.sh --for-task gap-codex-selfcheck-fails-on-
  installed-codex-cli-0125` → `tests 27, pass 27, fail 0` (exit 0), A9/A10 included.
- **evidence (AC2):** the version-degrade path is mechanical (see mechanics) and covered
  by A9 (asserts exit 0 + `present-but-incompatible` + `SKIP`) and A10 (asserts exit 1 +
  `RESULT: FAIL`).

## Contract

measure   `node --no-warnings --test --test-name-pattern="A8" plugin/test/codex-stage1-adapter.test.mjs` 的 stdout → tests pass, fail 0
band      a8_fail_count = 0（tests 1, pass 1, fail 0）
invariant selfcheck 不得对 present-but-incompatible codex-cli 裸失败——要么工作、要么显式 degrade
invoke    `bash plugin/scripts/codex-stage1-selfcheck.sh`（exit 0）
control   负控制：把 codex-cli 置为 present-but-incompatible（当前 0.125.0 即此态）⇒ A8 必须通过或显式 degrade（不得裸失败）；absent 态走既有 degrade 路径照常
resume    n/a（fresh task）

## Dispatch review

reviewer: outer
at: 2026-08-05T22:5xZ
changed: 无

## Touches

- .codex/config.toml
- plugin/scripts/codex-stage1-selfcheck.sh
- plugin/test/codex-stage1-adapter.test.mjs
