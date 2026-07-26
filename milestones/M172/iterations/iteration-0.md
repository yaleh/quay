# M172 Iteration 0 — Move vendored plugin dist out of git (DIR-108)

**Charter:** [M172-dir108-vendor-dist-out-of-git.md](../../experiments/quay-perpetual-stream/charters/M172-dir108-vendor-dist-out-of-git.md)
**Task:** DIR-108
**Date:** 2026-07-26

## Done-when completion

Implemented in the SAFETY-CRITICAL order the charter/task mandate (artifact stays tracked on
`master` until each prior step is proven working):

### 1. CI publish job → orphan `dist-plugin` branch (Done-when 1, 6, 7)

- Added `plugin/scripts/publish-dist-branch.sh`: builds via `sync-vendor.sh`, then assembles the
  built `plugin/` subtree at the ROOT of an orphan `dist-plugin` branch (via a `git worktree add`
  off the calling checkout, so it inherits that checkout's remote credentials — a plain `git init`
  in a scratch dir would NOT, and would silently fail auth in CI) and force-pushes it.
- Added `.github/workflows/publish-plugin-dist.yml`: runs the above on `v*` tag pushes and on
  `workflow_dispatch`.
- **Manually seeded** `origin/dist-plugin` once by hand first (to prove the script works before
  wiring it into CI), then committed the script+workflow to `master` (`6e6d485`) and triggered a
  **real** `workflow_dispatch` run: [run 30196055789](https://github.com/yaleh/quay/actions/runs/30196055789),
  completed successfully in 12s. Confirmed `origin/dist-plugin` now carries a CI-authored commit
  (author `quay-dist-publish`, from source `6e6d485`) with `.claude-plugin/plugin.json` at branch
  root and a 1,268,685-byte `vendor/quay/dist/quay.js` (`gh api repos/yaleh/quay/commits/dist-plugin`).
  `git ls-files | grep dist` on `master` still returns no bundles (see below) — CI, not a manual
  commit, is what regenerates the branch on every release from here on.

### 2. Marketplace repoint + real external-install verification (Done-when 2, 3)

- Repointed `.claude-plugin/marketplace.json`'s `quay` plugin `source` from `"./plugin"` to
  `{"source":"github","repo":"yaleh/quay","ref":"dist-plugin"}`. **Finding that shaped this
  design:** Claude Code's plugin-level marketplace sources currently support `ref` but NOT `path`
  (confirmed via `gh api repos/anthropics/claude-code/issues/15439`, an open feature request whose
  own comments show `path` is missing from the live zod schema while `ref`/`sha` already exist) —
  so the orphan branch's plugin content had to be published at branch ROOT, not nested under
  `plugin/`, for a no-`path` github-source to find `.claude-plugin/plugin.json`. `claude plugin
  validate .claude-plugin/marketplace.json --strict` passes against the new source shape.
- **Real verification** (not just schema validation): `git clone --branch dist-plugin --depth 1`
  into a scratch dir, then spawned the cloned `vendor/quay/dist/quay.js mcp` as a real MCP server
  and connected the `@modelcontextprotocol/sdk` `Client`/`StdioClientTransport` (the same pattern
  `packages/quay/test/mcp-server.test.mjs` uses) against a throwaway workspace pointed at
  `packages/quay-native` as the provider. `tools/list` returned all 16 expected tools
  (`task_list`, `task_get`, `task_write`, `task_check`, `gate_*`, `lifecycle_*`, `adr_*`,
  `action_list`, `action_run`); a live `task_list` tool CALL round-tripped with `isError: false`.
  This is the strongest headless proof available in this environment short of driving the
  interactive `/plugin install` UI (not scriptable from a subagent session without disturbing this
  session's own active plugin registry).

### 3. Local fallback via root `postinstall` (Done-when 4, 5)

- Added `"postinstall": "bash plugin/scripts/sync-vendor.sh || (echo '[postinstall] WARNING...' >&2; exit 0)"`
  to root `package.json` — warns instead of hard-failing the install if the build step ever breaks
  in an unusual environment, but runs unconditionally on every `npm install`.
- **Real verification**: rsync'd the working tree (excluding `.git`/`node_modules`) into a scratch
  dir, deleted `plugin/vendor/quay/{dist,bin,src}` entirely (simulating the post-untrack fresh-clone
  state), ran `npm install` there — `sync-vendor.sh` ran automatically via `postinstall` and
  regenerated a byte-identical-shaped `plugin/vendor/quay/dist/quay.js` (1,268,685 bytes) with zero
  manual steps. Ran the same MCP `tools/list` + `task_list` proof against THIS locally-rebuilt
  bundle too — 16/16 tools, live call succeeded.

### 4. Untrack the artifact (Done-when 8, 9, 10) — done LAST, only after steps 1-3 verified

- `git rm --cached plugin/vendor/quay/dist/quay.js`.
- `.gitignore`: removed the `!plugin/vendor/quay/dist/` / `!plugin/vendor/quay/dist/**` negation
  pair (with a comment pointing at this milestone and explaining why the bare `dist/` rule now
  covers it like every other build output in the repo). `git check-ignore -v` confirms the file is
  now genuinely ignored (matched by the bare `dist/` rule).
- `git ls-files | grep -i dist` on `master`: 17 hits, all source/docs/scripts/reports — zero
  `.js`/build-bundle files.

### 5. README updated (Done-when 11)

- `plugin/README.md`: new "## Installation" section documenting the `/plugin marketplace add` +
  `/plugin install` flow, where the installed bytes come from (`dist-plugin`, not `master`), and
  the dev-local fallback (`postinstall` → `sync-vendor.sh`).
- `README.md`: new "### Option C — as a Claude Code plugin" subsection under `## Install`,
  cross-referencing `plugin/README.md#installation`.

### 6. Regression check (Done-when 12)

- `bash plugin/scripts/sync-vendor.sh --check`: CLEAN, no drift.
- `bash experiments/quay-perpetual-stream/scripts/dod-fixture-selfcheck.sh`: all 17 DoD fixtures PASS.
- `bash experiments/quay-perpetual-stream/scripts/tree-hygiene-check.sh`: clean.
- `bash experiments/quay-perpetual-stream/scripts/worktree-branch-hygiene-check.sh`: clean.
- `bash experiments/quay-perpetual-stream/scripts/it0-gate-hash-check.sh --by-reference <charter>`:
  PASS (charter's `GATE-HASH-REF` matches the current pinned source hash).
- `node --experimental-strip-types scripts/version-consistency-check.ts`: OK, all 8 artifacts at
  `0.3.13` (my `source` object edit to `marketplace.json` did not touch its `version` field).
- Full package test suite (`node --test $(ls packages/*/test/*.test.mjs | grep -vE
  'serve-github|provider-abi-conformance|cli-edit-parity-conformance')`, ~295s): **472/473 pass.**
  The one failure (`packages/quay/test/package-json-bin.test.mjs` — "exports is unchanged"
  regression guard) is **pre-existing and unrelated**: it fails because `packages/quay/package.json`
  `exports` now includes `./init` (from DIR-098's `quay init` command, commit `f78d904`, well
  before this session, no local modifications by me to that file or test). Confirmed via
  `git status --short` (clean on both files) and `git log` (both predate this work).
- `packages/quay/test/build-dist-smoke.test.mjs` + `build-dist.test.mjs` run in isolation: 8/8 pass.

## DoD gate

Not run in this BUILD iteration. `extra.acceptance` on `tasks/DIR-108.md` is
`bash experiments/quay-perpetual-stream/scripts/it0-dod-check.sh DIR-108
experiments/quay-perpetual-stream/charters/M172-dir108-vendor-dist-out-of-git.md
/tmp/m172-absorb-entry.md` (pre-flight-confirmed already set, unchanged). `/tmp/m172-absorb-entry.md`
carries the ABSORB-time disposition statements (adversarial-audit verdict, V_meta-lag disposition,
`## Backlog row`) that the mechanical DoD check's documentation-discipline clauses (1/2/6/7/12)
read — those are the audit/absorb phase's own output, not BUILD's, so this iteration does not
fabricate them. The Done-when items above are independently, mechanically evidenced regardless
(real CI run, real cloned-branch MCP server, real fresh-clone `npm install`, real `git ls-files`),
so the DoD gate's substantive question ("was the milestone actually done") is already answered by
this report; the gate script's own documentation-discipline clauses are exercised at ABSORB.

## Files changed

- `plugin/scripts/publish-dist-branch.sh` (new) — build + orphan-branch publish, used by CI and by hand.
- `.github/workflows/publish-plugin-dist.yml` (new) — CI publish job (release tag + workflow_dispatch).
- `.claude-plugin/marketplace.json` — `quay` plugin `source` repointed to `{"source":"github","repo":"yaleh/quay","ref":"dist-plugin"}`.
- `package.json` — added root `postinstall` running `sync-vendor.sh`.
- `.gitignore` — removed the `plugin/vendor/quay/dist/**` negation; bare `dist/` rule now covers it.
- `plugin/vendor/quay/dist/quay.js` — `git rm --cached` (untracked; still present on disk, gitignored, regenerated by `sync-vendor.sh`).
- `plugin/README.md` — new "Installation" section.
- `README.md` — new "Option C — as a Claude Code plugin" subsection.
- `tasks/DIR-108.md` — AC/DoD checkboxes checked off against the evidence above.

## Notable finding not in the original charter

Claude Code's plugin-level marketplace `source` schema supports `ref` (git branch/tag/sha) but
**not** `path` (subdirectory) as of this session (`gh api repos/anthropics/claude-code/issues/15439`,
open). This ruled out publishing the orphan branch with `plugin/` nested at its usual repo-relative
path and mirroring `./plugin`'s shape exactly — the orphan branch instead publishes the built
`plugin/` subtree's CONTENTS at its own root, which a no-`path` `ref`-only github source can find.
This is a real environment constraint, not a design preference, and is why
`publish-dist-branch.sh`'s `rsync` step copies `plugin/` → branch-root rather than `plugin/` →
`plugin/` on the orphan branch.
