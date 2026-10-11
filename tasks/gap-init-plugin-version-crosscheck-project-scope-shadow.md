---
id: gap-init-plugin-version-crosscheck-project-scope-shadow
title: quay init does not cross-check installed plugin version for the target
  project; a project-scope 0.17.0 silently shadowed the 0.19.0 init
status: todo
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
- [ ] Unit tests with fixtures cover: user-only, project-shadows-user (older), project-same-version, registry absent, malformed JSON; each yields the expected one of the three states.
- [ ] An init test (HOME pointed at a fixture dir) asserts the mismatch warning names both versions and the scope, and the exit code is unchanged.
- [ ] Negative control: absent registry yields not-evaluated, never match.
- [ ] If a new plugin/scripts file is added, its capability-catalog declaration exists; otherwise state N/A.
- [ ] `node --test` on the touched test files exits 0.

## Definition of Done
All ACs ticked with output pasted; the project-over-user precedence assumption recorded as verified or flagged unverified.

## Touches
- packages/quay/src/init.ts
- packages/quay/src/loaded-version.ts
- packages/quay/test/init.test.mjs
- tasks/gap-init-plugin-version-crosscheck-project-scope-shadow.md
