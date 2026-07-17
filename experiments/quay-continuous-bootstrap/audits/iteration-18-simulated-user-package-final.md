# Simulated User: Package artifact final check — Iteration 18

## package.json files field (current contents)

```json
"files": [
  "bin/",
  "src/",
  "README.md",
  "CHANGELOG.md",
  "LICENSE"
]
```

Five entries total: two directories (`bin/`, `src/`), two auto-included files explicitly listed (`README.md`, `CHANGELOG.md`), and one ghost entry (`LICENSE`).

## PKG-006: README.md exists

PASS — `/packages/quay/README.md` exists (4227 bytes, written 2026-07-17).

## PKG-007: LICENSE ghost

`"LICENSE"` is listed in the `files` field. The file `packages/quay/LICENSE` does **not** exist on disk.

npm automatically includes any `LICENSE` or `LICENCE` file it finds regardless of the `files` array. Since no LICENSE file exists at all, this entry is a ghost: it doesn't cause npm to error, it just refers to a non-existent file. npm will silently skip it during pack. The package will be published without a LICENSE file — not because of the ghost entry, but because the file is missing entirely.

## Simulated artifact contents

Given the `files` field and the actual disk state, `npm pack` would include:

| Path | Source | Included? |
|------|--------|-----------|
| `package.json` | npm always-include | YES |
| `README.md` | explicit + npm always-include | YES |
| `CHANGELOG.md` | explicit in files | YES |
| `LICENSE` | explicit in files — but file missing | NO (file absent) |
| `bin/quay.js` | `bin/` glob | YES |
| `src/action.js` | `src/` glob | YES |
| `src/config.js` | `src/` glob | YES |
| `src/mcp-server.js` | `src/` glob | YES |
| `src/provider-client.js` | `src/` glob | YES |
| `src/provider-env.js` | `src/` glob | YES |
| `src/serve.js` | `src/` glob | YES |
| `test/` | not in files | NO (excluded) |
| `DESIGN.md` | not in files | NO (excluded) |
| `scripts/` | not in files | NO (excluded) |

Runtime essentials: all present. Test files: excluded. Unwanted docs (DESIGN.md): excluded. LICENSE: absent from artifact.

## PKG-007 severity

**MINOR** — not NON-ISSUE, not SIGNIFICANT.

Reasoning: The ghost `"LICENSE"` entry causes no pack error and no runtime breakage. However, the package will be published to npm without any license file. npm itself will still show the `license` field if one were declared in package.json (it isn't — no `"license"` key is present), but OSS consumers and automated license scanners will find no license file in the tarball. This is a real omission for a publishable package, but the root cause is the missing LICENSE file itself, not the ghost entry. The ghost entry is a symptom/indicator that something was intended but not delivered. Fixing it requires creating the LICENSE file (e.g. MIT), not just removing the `files` entry.

Secondary note: `CHANGELOG.md` is listed explicitly in `files`, which is redundant (npm auto-includes it), but harmless.

## Other gaps

1. **No `"license"` field in package.json** — npm publish will warn "No license field". The missing LICENSE file compounds this: both the metadata field and the actual license text are absent.
2. **`"private": true`** — the package cannot be published to npm as-is. This may be intentional for the walking skeleton phase, but if publishability is a CB-008 goal, this field must be removed before release.
3. **No `devDependencies` for test runner** — test files exist in `test/` but there is no declared test runner dependency. This is a pre-existing gap unrelated to packaging artifacts.

## Overall verdict

PARTIAL — PKG-006 (README.md) is now resolved (PASS). PKG-007 is a MINOR ghost entry but points to a real omission: no LICENSE file on disk and no `"license"` field in package.json. The `"private": true` flag also blocks actual npm publish. Artifact contents are otherwise correct: runtime files included, tests excluded.
