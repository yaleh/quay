# Simulated User: npm package installer — Iteration 15

## Persona
New user installing via GitHub Release artifact, not cloning. Found `quay` mentioned somewhere and wants to install it from a release artifact using npm, without touching the source repo.

## Findings

### GitHub release v0.2.0 exists
PASS — `gh release view v0.2.0` returns a valid, non-draft, non-prerelease entry published 2026-07-17T13:00:47Z by `github-actions[bot]`. One asset is listed: `quay-0.2.0.tgz`. The release body includes clear install instructions (download + `npm install -g`).

```
title:  v0.2.0
tag:    v0.2.0
draft:  false
author: github-actions[bot]
asset:  quay-0.2.0.tgz
```

### Artifact download
PASS — `gh release download v0.2.0 --pattern "*.tgz" --dir /tmp/quay-persona-b-iter15 -R yaleh/quay` succeeded without error.

```
-rw-r--r-- 1 yale yale 116K Jul 17 13:16 quay-0.2.0.tgz
```

File size: 116 KB. Filename matches the release asset name exactly.

### Install from artifact
PASS — Install and `--help` both succeeded.

```
npm install -g /tmp/quay-persona-b-iter15/quay-0.2.0.tgz --prefix /tmp/quay-persona-b-npm
# added 95 packages in 12s

/tmp/quay-persona-b-npm/bin/quay --help
```

First 5 lines of `--help` output:
```
quay — task management for AI-assisted development

Usage:
  quay task list [--status <status>] [--label <label>] [--prefix <prefix>] [--sort id|status|updated] [--search <query>] [--json]
  quay task view <task-id> [--json]
```

The CLI binary is functional and all subcommands are documented in the help output.

### Packaging quality checks

**Gap 1 (minor): README has a stale version example.**
`README.md` line 41 shows `npm install -g quay-0.1.0.tgz` — the old version. With v0.2.0 now released, a first-time installer following the README verbatim would try to download a `quay-0.1.0.tgz` (which still exists), getting the old binary instead of the current one. The comment says "replace with the actual filename from the release" but the visual anchor `0.1.0` misleads.

**Gap 2 (minor): No CHANGELOG entry for v0.2.0.**
`CHANGELOG.md` exists and contains experiment findings, but has no versioned release entry for v0.2.0. A user reading the changelog to understand what changed between v0.1.0 and v0.2.0 finds nothing. There is no `## v0.2.0` or `## 0.2.0` section.

**Gap 3 (low severity): Test files bundled in the release artifact.**
`npm pack` includes the `test/` directory because `package.json` has no `"files"` field and no `.npmignore`. The tgz contains 12 test `.mjs` files and `scripts/package.sh`. These are dead weight for an end user (~add several KB, no runtime impact) but indicate the package boundary is not explicitly declared.

```
package/test/action-mock-delivery.test.mjs
package/test/cli.test.mjs
... (10 more test files)
package/scripts/package.sh
```

**No gap:** `package.json` correctly lists `"private": true` — this will not accidentally be published to the npm registry.

**No gap:** The release artifact installs and the `quay` binary resolves correctly on PATH (under the `--prefix` bin).

## New gaps
1. README stale version example (`quay-0.1.0.tgz` → should say `quay-0.2.0.tgz` or use a generic placeholder like `quay-<version>.tgz`)
2. CHANGELOG missing v0.2.0 entry — no user-facing changelog for the release
3. `package.json` missing `"files"` field — test files and build scripts ship in the artifact unnecessarily

## Overall verdict
PARTIAL — Core distribution works end-to-end (release exists, artifact downloads, installs cleanly, CLI is functional). Three documentation/packaging polish gaps found; none block a user from installing and using the tool, but gap 1 (stale README version) is the most likely to cause confusion for a real new user following the README.
