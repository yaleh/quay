# M172 — Move vendored plugin dist out of git (build-at-release + local fallback)

**Task:** DIR-108 · **Counter:** 172 · **Chart:** 2
**Class:** development · **Value type:** delivery-completeness
**Deliverable:** yes · **Charter tokens:** ~1.1 K · **type:** execution

GATE-HASH-REF: 5023da8232f12579e9a8db0ce26c5a5d1aadd5a7d095380016636330c63d2c93

## Value hypothesis
Δv̂ > 0. `plugin/vendor/quay/dist/quay.js` is a committed 1.2MB build artifact — the only tracked
build output in the repo, and it silently went stale for 10 commits until deletion broke the local
MCP server this session. Moving the build into the distribution pipeline (CI → orphan branch;
marketplace source repointed) removes the artifact from git while keeping both external installs
and local dev working, restoring single-source discipline (ADR-004).

## Scope
Per the directive's SAFETY-CRITICAL ordering (DIR-108) (do NOT reorder — artifact stays tracked
until the replacement path is proven):
1. CI publish job: on release, run `sync-vendor.sh`, commit the built `plugin/` subtree to an
   orphan branch `dist-plugin`, force-updated each release.
2. Repoint `.claude-plugin/marketplace.json` `source` from `./plugin` to the built `dist-plugin`
   branch; verify a real external install works from it.
3. Local fallback: wire `sync-vendor.sh` into `quay:init` and/or root `postinstall`, so a fresh
   clone + `npm install` (or `/quay:init`) yields a working local MCP with no manual step.
4. ONLY THEN: `git rm --cached plugin/vendor/quay/dist/quay.js`, gitignore it, drop the
   `!plugin/vendor/quay/dist/**` negation.

## Touches
- .github/workflows/ (new release-publish job)
- .claude-plugin/marketplace.json
- plugin/skills/init/SKILL.md and/or package.json (postinstall)
- .gitignore
- README.md

## Done-when
1. CI publish job exists, has run at least once, produced a fresh `dist-plugin` orphan-branch
   build containing `plugin/vendor/quay/dist/quay.js`
2. `marketplace.json` source points at `dist-plugin` (not `./plugin`)
3. A real external install from `dist-plugin` yields a working MCP server (tools list non-empty)
4. `quay:init`/postinstall regenerates the gitignored bundle in a fresh clone, verified
5. `plugin/vendor/quay/dist/quay.js` untracked + gitignored; negation rule removed
6. `git ls-files | grep dist` returns no committed bundles
7. Ordering followed — untrack happened only after orphan-branch distribution proven
8. All existing it0 selfchecks + gate hashes stay green

## Inner termination
Done-when-complete OR external HALT.

## Pointer
inherited-core.md @ e9905ca4931bfdc889c96d7ae83d657e786316c7
