# Simulated User Audit — Project Maintainer / Packaging Persona
Date: 2026-07-17
Iteration: 9
Persona: Project maintainer wanting to publish a release

---

## Build script (package.sh) — PASS

`bash packages/quay/scripts/package.sh` exits 0. The script correctly resolves
`SCRIPT_DIR`/`PACKAGE_DIR` so it can be called from any working directory, `cd`s
to the package root before running `npm pack`, and verifies the artifact was
produced before printing the install instructions. The shebang is `#!/usr/bin/env
bash` and `set -euo pipefail` is set — safe for CI.

One minor style note: the echo at the end says `Install globally: npm install -g
quay-0.1.0.tgz` without the full path; this is fine in interactive use but
slightly ambiguous in CI logs.

## Artifact quality — CONCERNS

Artifact produced: `packages/quay/quay-0.1.0.tgz` (109.7 kB packed / 443.5 kB
unpacked, 22 files). The binary entrypoint `bin/quay.js` is present, has the
correct `#!/usr/bin/env node` shebang, and `package.json` has the `bin` field
pointing to it. Runtime dependencies (`@modelcontextprotocol/sdk`, `yaml`) are
listed in `dependencies` so `npm install -g <tgz>` will fetch them.

**Concerns:**

1. **Test files bundled** — 12 `test/*.mjs` files (~370 kB unpacked) are
   included in the artifact. End users installing globally have no use for them.
   Fix: add a `"files"` field to `package.json` (e.g., `["bin", "src"]`) or a
   `.npmignore`. Severity: minor (bloat, not breakage).

2. **`"private": true` in `packages/quay/package.json`** — `npm pack` works
   despite this flag, but `npm publish` would be blocked. If the maintainer ever
   wants to publish to npmjs.com the flag must be removed. Not blocking for the
   current GitHub Release approach. Severity: minor.

3. **No `node_modules` bundled** — correct and expected; `npm install -g` will
   fetch deps from the registry. Requires internet access at install time.
   Documented in the workflow release body but not in the root README. Severity:
   minor.

## GitHub Actions workflow — CONCERNS

`release.yml` is syntactically valid YAML. Trigger (`on: push: tags: - 'v*'`),
Node.js setup (`actions/setup-node@v4` with `node-version: '20'`), `npm install`
at the workspace root, and `softprops/action-gh-release@v2` upload are all
structurally correct.

**Concerns:**

1. **No test step before publish** — the workflow builds and publishes without
   running `npm test`. A broken release could be shipped. Severity: significant.

2. **Release body filename mismatch (bug)** — The release body instructs users to
   run:
   ```sh
   npm install -g quay-${{ github.ref_name }}.tgz
   ```
   For a tag `v0.1.0`, `github.ref_name` is `v0.1.0`, so the instruction
   becomes `npm install -g quay-v0.1.0.tgz`. But `npm pack` names the artifact
   from `package.json` `"version"`: `quay-0.1.0.tgz` (no `v` prefix). The
   instruction is wrong and will cause user confusion/failure. Fix: strip the
   leading `v` in the body, e.g.:
   ```yaml
   body: |
     npm install -g quay-$(echo ${{ github.ref_name }} | sed 's/^v//').tgz
   ```
   or use a separate step to export `VERSION` without the prefix.
   Severity: **blocking** — users following the release notes will get an error.

3. **Action versions not SHA-pinned** — `actions/checkout@v4`,
   `actions/setup-node@v4`, and `softprops/action-gh-release@v2` use floating
   major-version tags. Security-conscious projects pin to commit SHAs. Severity:
   minor (acceptable for most projects, non-blocking).

4. **`npm install` at workspace root** — this installs all workspace packages'
   dependencies, not just quay's. Correct for a monorepo but results in a slower
   CI step than `npm install --workspace=packages/quay`. Not blocking.

## Install experience — CONCERNS

When a user downloads `quay-0.1.0.tgz` from the GitHub Release and runs
`npm install -g quay-0.1.0.tgz`:

- Dependencies are fetched from npm registry (online required).
- `bin/quay.js` is linked as `quay` on PATH.
- `quay task list` should work if a provider is configured.

However:

- The release body install command will reference `quay-v0.1.0.tgz` (wrong name,
  see workflow concern #2). A user following the copy-pasted command will fail.
- No `engines` field in `packages/quay/package.json` (only in root
  `package.json`). When installed globally via tgz, npm will not warn the user
  if their Node.js version is below 20.

## Documentation — CONCERNS

The root `README.md` has a `## Install` section documenting Node.js ≥ 20 as a
requirement and shows `git clone` + `npm install`. It does **not** mention the
new GitHub Release / `npm install -g <tgz>` path, which is the primary user
journey this iteration closes. A maintainer publishing a release needs the README
to reflect the non-dev installation option.

The workflow release body partially fills this gap (it contains install
instructions inline), but the filename bug (see workflow concern #2) undermines
it.

---

## New gaps found

- [severity: blocking] Release body install command uses `quay-${{ github.ref_name }}.tgz`
  which resolves to `quay-v0.1.0.tgz` for tag `v0.1.0`, but `npm pack` produces
  `quay-0.1.0.tgz`. Users copy-pasting the release notes will get "file not found".

- [severity: significant] No test step in the release workflow — a broken build
  can be shipped without any gate.

- [severity: minor] Test files (12 × `.mjs`, ~370 kB) bundled in the release
  artifact. Add a `"files"` field or `.npmignore` to exclude them.

- [severity: minor] `packages/quay/package.json` has no `engines` field. When
  installed globally via tgz, npm does not warn on Node.js < 20.

- [severity: minor] Root README does not document the `npm install -g <tgz>`
  install path for non-developer users.

---

## Overall: CONCERNS

Core packaging mechanics work (script exits 0, artifact produced, correct
structure). The blocking filename mismatch in the release body and the missing
test gate are the critical issues to fix before tagging a release.
