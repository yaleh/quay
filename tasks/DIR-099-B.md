---
id: DIR-099-B
title: "Provider env validation (check #9), corrected: native tasks_dir is optional (warn), github missing QUAY_GITHUB_REPO also defaults (warn); present-but-malformed → error"
status: todo
labels:
  - directive
  - human-steered
  - milestone-candidate
parent: DIR-099
children: []
extra:
  schema: v1
---

**type:** execution

## Proposal

Add provider-environment validation to `config validate` — CORRECTED against the actual
runtime contract (the split review AND a further ProposalReview round both found the
original check #9's "required" premises were false positives — including an initially-
over-corrected github clause):

- **native provider**: `QUAY_NATIVE_TASKS_DIR` or a `tasks_dir` field is OPTIONAL —
  `resolveTasksDir()` defaults to repo-root `./tasks`; Core never fails closed on their
  absence. Missing env → `warn` (informational, exit 0), noting the `./tasks` default.
- **github provider**: `QUAY_GITHUB_REPO` is ALSO OPTIONAL — `resolveRepo()`
  (`packages/quay-github/bin/quay-github.ts` L18-27) defaults to `yaleh/quay` when the
  env var is absent and never throws; the throw fires only for PRESENT-but-malformed
  values (not `owner/repo`). Missing env → `warn` (exit 0), noting the `yaleh/quay`
  default. A PRESENT-but-malformed `QUAY_GITHUB_REPO` (not `owner/repo`) → `error`
  (matches the runtime throw).
- **Warn-exit contract (pinned, owned by DIR-099-A's CLI):** `warn`-severity issues are
  NON-FATAL — `config validate` exits 0 when the only issues are warns; only `error`-
  severity issues force exit 1. DIR-099-B pins this contract so AC1 ("config exits 0")
  holds regardless of A's implementation.

Second child of the DIR-099 split. Depends on [[DIR-099-A]]'s shared
`validateConfig({workspaceRoot, checkFiles})` module and its warn/error severity →
exit-code mapping (this child is the check #9 provider-env sub-check within it).

## Chosen mechanism

In the shared `packages/quay/src/config-validate.ts` module that DIR-099-A creates: a
`validateProviderEnv(provider)` check reading the enabled provider's `env:` map ONLY
(grounded fact #4: `resolveProviderEnv` reads `provider.env`, never `provider.tasks_dir`;
`QUAY_NATIVE_TASKS_DIR`/`QUAY_GITHUB_REPO` come from the config's `env:` map). Native
missing env → `warn` (default `./tasks`); github missing env → `warn` (default
`yaleh/quay`); github PRESENT-but-malformed (not `owner/repo`) → `error` (matches the
runtime throw at quay-github.ts L18-27). Warns exit 0; errors exit 1 (the pinned
warn-exit contract).

## Plan

Resolved via milestone M230. Checked Plan: `docs/plans/M230-dir-099-b.md` (base revision
`e1b45823`, 2026-08-01) — manually authored after 6 prepare-milestone attempts exhausted
the epoch full-review cap; the task body (corrected through 6 mechanism-inventory review
rounds) is authoritative. 4 mechanical stages (RED → implementation → GREEN → real-callsite
evidence + audit), all 7 AC indices mapped.

## Finding

The original DIR-099 check #9 ("native provider has QUAY_NATIVE_TASKS_DIR or a tasks_dir
field") is factually wrong as an error: `packages/quay-native/bin/quay-native.ts`
`resolveTasksDir()` (L46-55) defaults to repo-root `./tasks` with no fail-closed, and
Core (serve.ts/mcp-server.ts) builds provider env via `resolveProviderEnv` which reads
`provider.env` only — `provider.tasks_dir` is read nowhere in Core. A config that runs
correctly at runtime would be flagged invalid. The github clause was ALSO mis-
premised: `resolveRepo()` (quay-github.ts L18-27) defaults to `yaleh/quay` when
`QUAY_GITHUB_REPO` is absent (`(envRepo || "yaleh/quay").split("/")`), and the throw
fires only for PRESENT-but-malformed values (e.g. `foo`, `foo/`, `/repo`); empty-string
is treated as absent. So github-missing-env is ALSO a false-positive-as-error.

## Requested action

1. `validateProviderEnv` check #9 with the corrected semantics: native missing
   env → `warn` (default tasks dir); github missing `QUAY_GITHUB_REPO` → `warn`
   (default `yaleh/quay`); github PRESENT-but-malformed → `error`.
2. RED/GREEN tests: native-without-tasks_dir → warn (exit 0); github-without-
   QUAY_GITHUB_REPO → warn (exit 0); github present-but-malformed → error (exit 1);
   both-set → no issue.

## Acceptance Criteria

- [ ] A native provider without `QUAY_NATIVE_TASKS_DIR`/`tasks_dir` yields a `warn` (not
  an error) — the config exits 0 (false-positive fixed).
- [ ] A github provider without `QUAY_GITHUB_REPO` yields a `warn` (exit 0, not error) —
  `resolveRepo()` defaults to `yaleh/quay`, so the config runs correctly at runtime
  (second false-positive fixed).
- [ ] A github provider with PRESENT-but-malformed `QUAY_GITHUB_REPO` (not
  `owner/repo`) yields an `error` (exit 1). NOTE the runtime predicate is NOT a
  strict `^owner/repo$` regex: `resolveRepo()` accepts `a/b/c` (uses the first two
  split segments) and treats an empty-string PRESENT env as absent (defaults, no
  throw). AC3 must mirror the RUNTIME predicate — a strict-shape check over-flags
  and breaks the "matches the runtime throw" guarantee.
- [ ] A provider with both env vars set yields zero provider-env issues.
- [ ] `warn`-severity issues are non-fatal: `config validate` exits 0 when the only issues
  are warns; only `error` severity forces exit 1 (the pinned warn-exit contract owned by
  DIR-099-A's CLI).
- [ ] The check reads the provider's `env:` map only (grounded fact #4), never
  `provider.tasks_dir` as an env source.
- [ ] **Real-callsite evidence (AC, not DoD prose):** a real `config validate` run against
  a github-provider workspace with no `QUAY_GITHUB_REPO` emits a `warn` and exits 0; a
  real run with malformed `QUAY_GITHUB_REPO` emits an `error` and exits 1.

- [ ] A github provider with `QUAY_GITHUB_REPO: ""` (present-but-empty) yields a `warn`
  (not error) — the empty string is falsy, `resolveRepo` treats it as absent and defaults
  to `yaleh/quay`; the check must mirror this, never "key present + not owner/repo →
  error" (that re-introduces the false-positive class this child exists to fix).
- [ ] AC6 falsifier (env-map-only): a native provider with `tasks_dir` set but
  `QUAY_NATIVE_TASKS_DIR` absent from the env map STILL yields a `warn` — proving the
  check reads the env map only, never `tasks_dir` as an env source.
- [ ] Tests: `packages/quay/test/config-validate.test.mjs` RED/GREEN for the corrected
  semantics.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] Real run: this repo's native provider (env set) → no provider-env issue; a
  github-without-repo fixture → warn (exit 0); a present-malformed fixture → error.
- [ ] A fresh independent audit finds no refutation.

## Human verification

1. Does a native provider without tasks_dir exit 0 (warn only), not error?

## Touches

- `packages/quay/src/config-validate.ts` (shared module; adds `validateProviderEnv` function)
- `packages/quay/src/gate/config/` (types if touched)
- `packages/quay/test/config-validate.test.mjs (new)`
- `docs/plans/M230-dir-099-b.md`
