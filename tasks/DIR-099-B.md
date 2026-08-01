---
id: DIR-099-B
title: "Provider env validation (check #9), corrected: native tasks_dir is optional (warn), github QUAY_GITHUB_REPO required (error)"
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

Add provider-environment validation to `config validate` — but CORRECTED against the
actual runtime contract (the split review found the original Proposal's check #9 was a
false positive):

- **native provider**: `QUAY_NATIVE_TASKS_DIR` or a `tasks_dir` field is OPTIONAL —
  `resolveTasksDir()` defaults to repo-root `./tasks`, and Core never fails closed on
  their absence. Flagging a tasks_dir-less native provider as invalid is a FALSE POSITIVE
  (the config runs correctly at runtime). Emit a `warn` (informational, not error) when
  neither is set, noting the default.
- **github provider**: `QUAY_GITHUB_REPO` IS required — `quay-github.ts` throws when it
  is missing. This is an `error` (gate will not function).

Second child of the DIR-099 split. Depends on DIR-099-A's shared
`validateConfig({workspaceRoot, checkFiles})` module (this child is the check #9
provider-env sub-check within it).

## Chosen mechanism

In the shared `config-validate.ts` module (or a `provider-env.ts` sibling): a
`validateProviderEnv(provider)` check reading the enabled provider's `env:` map ONLY
(grounded fact #4: `resolveProviderEnv` reads `provider.env`, never `provider.tasks_dir`;
`QUAY_NATIVE_TASKS_DIR`/`QUAY_GITHUB_REPO` come from the config's `env:` map). Native
missing env → `warn` (default `./tasks` used); github missing `QUAY_GITHUB_REPO` →
`error`.

## Plan

N/A — resolved via a human-steered milestone. The resolving milestone authors a checked
`docs/plans/*.md` plan (DIR-117-B prepared-gate artifact) before implementation.

## Finding

The original DIR-099 check #9 ("native provider has QUAY_NATIVE_TASKS_DIR or a tasks_dir
field") is factually wrong as an error: `packages/quay-native/bin/quay-native.ts`
`resolveTasksDir()` (L46-55) defaults to repo-root `./tasks` with no fail-closed, and
Core (serve.ts/mcp-server.ts) builds provider env via `resolveProviderEnv` which reads
`provider.env` only — `provider.tasks_dir` is read nowhere in Core. A config that runs
correctly at runtime would be flagged invalid. The github clause is correct
(`quay-github.ts` L19-23 throws when `QUAY_GITHUB_REPO` missing).

## Requested action

1. `validateProviderEnv` check #9 with the corrected semantics: native missing
   env → `warn` (default tasks dir); github missing `QUAY_GITHUB_REPO` → `error`.
2. RED/GREEN tests: native-without-tasks_dir → warn (not error, exit 0); github-without-
   QUAY_GITHUB_REPO → error (exit 1); both-set → no issue.

## Acceptance Criteria

- [ ] A native provider without `QUAY_NATIVE_TASKS_DIR`/`tasks_dir` yields a `warn` (not
  an error) — the config exits 0 (false-positive fixed).
- [ ] A github provider without `QUAY_GITHUB_REPO` yields an `error` (exit 1).
- [ ] A provider with both env vars set yields zero provider-env issues.
- [ ] The check reads the provider's `env:` map only (grounded fact #4), never
  `provider.tasks_dir` as an env source.
- [ ] Tests: `packages/quay/test/config-validate.test.mjs` RED/GREEN for the corrected
  semantics.

## Definition of Done

Standard inherited-core DoD clauses apply.

- [ ] Landed on `master` under human-steered discipline.
- [ ] Real run: this repo's native provider (env set) → no provider-env issue; a
  github-without-repo fixture → error.
- [ ] A fresh independent audit finds no refutation.

## Human verification

1. Does a native provider without tasks_dir exit 0 (warn only), not error?

## Touches

- `packages/quay/src/config-validate.ts (new)` (or sibling provider-env check)
- `packages/quay/src/gate/config/` (types if touched)
- `packages/quay/test/config-validate.test.mjs (new)`
- `docs/plans/M230-dir-099-b.md`
