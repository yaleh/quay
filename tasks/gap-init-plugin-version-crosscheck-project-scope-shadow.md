---
id: gap-init-plugin-version-crosscheck-project-scope-shadow
title: quay init does not cross-check installed plugin version for the target
  project; a project-scope 0.17.0 silently shadowed the 0.19.0 init
status: ready
labels:
  - gap
parent: null
children: []
extra:
  schema: execution
---
## Proposal
Evidence origin: cold-start /quay:init on fresh dir /data/home/yale/work/quay-fleet, quay 0.19.0 (plugin cache), reported 2026-10-12 by the session "user/project scope 下的 quay 旧版本".
~/.claude/plugins/installed_plugins.json held a project-scope quay@quay 0.17.0 entry with projectPath=<root>. init ran as 0.19.0, generated a 0.19.0 config and pointed .quay/plugin at 0.19.0 with zero warning, while Claude Code would load the more specific project-scope 0.17.0 at runtime. Found only by manual `claude plugin list --json | jq`. Existing reader packages/quay/src/loaded-version.ts:213 installedVersionFromRegistry(homeDir) serves the driver/doctor path but NOT init, and it picks one "best" entry across scopes without regard to projectPath, so it cannot answer "what will THIS project load".

## Plan
1. Add a project-aware registry reading (scope==project and projectPath==root, layered over user scope) by extending the existing parser rather than forking it. Verify field names against a real installed_plugins.json before coding; state the precedence assumption (project over user) as checked or unchecked.
2. Call it from init and warn when the effective version for root differs from init's own version. Warn-only, exit code unchanged (rule 12: blocks nothing).
3. Output is THREE-valued (rule 3b): match / mismatch (versions + scope) / not-evaluated (registry missing or unparsable); not-evaluated must never read as match.

## Acceptance Criteria
- [x] Unit tests with fixtures cover: user-only, project-shadows-user (older), project-same-version, registry absent, malformed JSON; each yields the expected one of the three states.
- [x] An init test (HOME pointed at a fixture dir) asserts the mismatch warning names both versions and the scope, and the exit code is unchanged.
- [x] Negative control: absent registry yields not-evaluated, never match.
- [x] If a new plugin/scripts file is added, its capability-catalog declaration exists; otherwise state N/A. — N/A: no new `plugin/scripts` file was added (Touches are 2 Core `src` files + 1 test file + this task file).
- [x] `node --test` on the touched test files exits 0.

## Definition of Done
All ACs ticked with output pasted; the project-over-user precedence assumption recorded as verified or flagged unverified.

## Notes

### What was wrong
`quay init` answered "what version is installed on this machine" (`installedVersionFromRegistry` — the
**highest** entry in `installed_plugins.json`) and never asked "what will **this project** load" (the
session layer's `projectPath`-matching project/local entry, else the user entry). When a project-scope
entry is OLDER than the user entry, init wrote a config for the version it was NOT running as while
Claude Code loaded the older one — with zero warning.

### The tier rule (Plan step 1's precedence assumption) — VERIFIED (in-repo measurement, not a guess)
The rule is recorded in this repo as a MEASUREMENT, in `packages/quay/src/init.ts`'s plugin-link header
(2026-10-06, `claudecodeui` project record 0.14.0 vs user entry 0.15.0):

> "the registry tier rule (`projectPath`-matching local/project entry wins, else the `user` entry)"

⇒ the reader implements THAT rule (`PROJECT_SCOPES = {project, local}`); it does not invent a second one.
Field names were verified against a real `~/.claude/plugins/installed_plugins.json` BEFORE coding:
`scope` ∈ {user, project, local}; `projectPath` present only on project/local entries; `version` /
`installedAt` / `lastUpdated` / `installPath` as the existing parser already read them.
⚠️ Basis: an in-repo recorded measurement, not an independent re-measurement of the Claude Code loader
performed in this task. (Plan step 1 named both arms as acceptable; this is the "checked" arm.)

### Implementation
- `loaded-version.ts`: the ONE registry parser (`readQuayRegistryEntries`) is now SHARED by
  `installedVersionFromRegistry` (behavior UNCHANGED — highest entry) and the new
  `projectScopedVersionReading(homeDir, root, selfVersion)`. The latter is three-valued
  (`match` / `mismatch` / `not-evaluated`); `not-evaluated` carries a non-empty `reason` and NEVER shares
  a value with `match` (硬规则 3b). Both sides of the `projectPath` comparison are realpath-normalized so
  a symlink / trailing-slash difference cannot fake a mismatch.
- `init.ts`: `runInit` computes the reading — init's own version read from its PLUGIN ROOT
  (`readPluginRootVersion(opts.pluginRoot)`), ⛔ never from the registry, which would make the measured
  object its own baseline — and on `mismatch` writes a WARN-ONLY line to STDERR naming BOTH versions and
  the scope. Exit code unchanged (硬规则 12); stderr keeps `--json`'s stdout contract intact. The reading
  rides on every `InitResult` as `pluginVersionForProject`.

### AC evidence
AC1 (five-fixture unit) + AC3 (negative control) from `node --test --experimental-strip-types packages/quay/test/init.test.mjs`:
    ✔ plugin-version cross-check unit: the five registry fixtures yield the expected one of three states
    ✔ plugin-version cross-check negative control: an unreadable/empty registry is not-evaluated, NEVER match

AC2 (init test, HOME → fixture) + its matching-registry control:
    ✔ plugin-version cross-check: init WARNS naming BOTH versions and the scope, exit code UNCHANGED
    ✔ plugin-version cross-check negative control: a MATCHING registry prints NO warning (exit 0)
  Observed warning bytes (stderr), exit code 0:
    warning: this project will load quay plugin 0.17.0 (scope "project"), but init is running as 0.19.0.
    Claude Code resolves a projectPath-matching project/local entry over the user entry, so this project's
    sessions load 0.17.0 while init wrote a 0.19.0 config. …

AC4 — N/A (no new `plugin/scripts` file added).

AC5 — `node --test --experimental-strip-types packages/quay/test/init.test.mjs`:
    ℹ tests 83   ℹ pass 83   ℹ fail 0
  Scoped gate (`scripts/test.sh --for-task gap-init-plugin-version-crosscheck-project-scope-shadow --allow-thin`):
    ℹ tests 173  ℹ pass 173  ℹ fail 0   GATE_EXIT=0

## Touches
- packages/quay/src/init.ts
- packages/quay/src/loaded-version.ts
- packages/quay/test/init.test.mjs
- tasks/gap-init-plugin-version-crosscheck-project-scope-shadow.md
