# Changelog

## v0.3.x — M08-merge-recover (dated per-item below; see git log for exact commit dates)

### v0.3.5 (2026-07-18) — CLI/Docs/Packaging capability recovery (M08-merge-recover)

M04-discover (MD-001) found that the CLI/Web-UI/packaging capabilities
below were claimed shipped in the v0.2.0 entry (previous section) but were
never actually merged to `master` — the work existed only on unmerged exp4
branches. This entry lands them for real, re-implemented fresh against
current `master` (not a re-merge of those branches, which predate M-DIST/
M-ABI-EVAL and would have deleted files master now depends on). See
`experiments/quay-perpetual-stream/charters/M08-merge-recover.md` for the
full charter and `experiments/quay-perpetual-stream/gap-list.md` (MD-001,
CB-006/021/022, UQ-047/048, PKG-003..008, DOC-001..007) for closure evidence.

#### New features

- **`quay --version` / `quay -V`**: print the real `packages/quay/package.json`
  version and exit 0 (UQ-047). Previously both flags fell through to the
  generic usage error (exit 1).
- **`quay task list --format json`**: alias for `--json`, identical output
  content (CB-021). Previously silently fell through to human-readable
  output with no error. Any other `--format` value is now a usage error
  (exit 1), not a silent no-op.
- **`quay task list --page-size <N>`**: now functional in CLI table mode,
  JSON/`--format json` mode (the `printJson(sorted)` bug — it previously
  always printed the full unfiltered array regardless of `--page-size`),
  and the Web UI list page (`?pageSize=N`, with a 10/20/50/100 selector)
  (CB-006, CB-022). Invalid values (`0`, negative, non-numeric) now emit a
  hard error/warning instead of silently falling back to "show everything"
  (UQ-048).

#### Packaging / distribution

- `packages/quay/package.json` gains a `files` field (`README.md`,
  `CHANGELOG.md`, `LICENSE.md`, `bin`, `src` — no ghost entries) and a
  `license: "MIT"` field (PKG-003/004/006/007/008).
- `packages/quay/{README,CHANGELOG,LICENSE}.md` created (PKG-003..008,
  DOC-001..006) — the npm-published artifact previously shipped with none
  of these.
- Root `README.md` and `packages/quay/README.md` both gain a section
  documenting the Node SEA single-file-executable distribution path
  (DOC-006) — the M-DIST milestone's (v0.3.0, below) headline deliverable
  was previously undocumented anywhere in the repo.

### v0.3.0 (2026-07-18) — Node SEA single-file executables + CI release (M01-dist)

- **Single-file executables** (no separately-installed Node.js runtime
  required): `packages/quay/scripts/build-sea.sh` and
  `packages/quay-native/scripts/build-sea.sh` build platform-specific Node
  SEA binaries for Core and the native Provider respectively.
- **Release CI**: `.github/workflows/release.yml`'s `sea-release` job builds
  and publishes `quay-sea-<version>-<platform>.{tar.gz,zip}` archives
  (linux-x64, macos-arm64, windows-x64) on every `v*` tag push, bundling
  both binaries plus a packaged `.quay/config.yml`.
- **Independent Node-free verification**: the `sea-verify-node-free` CI job
  downloads the just-published Linux archive into a `debian:stable-slim`
  container that has never had Node.js installed and runs the extracted
  binary directly, proving the executable is genuinely self-contained.

## v0.2.0 (2026-07-17) — Quay Core: CLI/MCP/Web UI capability expansion + packaging

### New features

- **`quay task list --search <query>`**: full-text title + body search (CB-007, CB-016, CB-017)
- **`quay task list --sort updated`**: sort by last-modified time descending (CB-004)
- **`quay task list --prefix <X>`**: filter by task-id prefix (CB-001)
- **`quay task list --label <L>`** (repeatable): AND-join multi-label filter (CB-013)
- **Web UI search** (`?q=`): full-text search with result banner and pagination indicator
- **Web UI label nav**: frequency-sorted labels, active-label pinning, expand hidden labels
- **Web UI sort by time**: "Updated ↓" sort option
- **Web UI action buttons**: Advance task status inline from the list page (CB-003)
- **MCP `task_list` pagination**: `page`/`pageSize` parameters (CB-010)
- **MCP `task_list` search**: `search` parameter with heading exclusion (CB-014)
- **MCP `task_list` multi-label filter**: array form for AND-join (CB-015)
- **GitHub Actions release workflow**: `npm pack` artifact on `v*` tags (CB-008)

<!-- MD-001 (M04-discover) correction, applied at M08-merge-recover: this
     entry previously ALSO claimed "quay task list --page-size <N>" (CB-006),
     "quay --version / quay -V" (UQ-047), and "quay task list --json /
     --format json" (CB-020 alias) as shipped here. Live re-verification at
     M04-discover (and again at M08's it0) confirmed none of the three ever
     actually reached master — they existed only on unmerged exp4 branches.
     Removed from this entry; see the v0.3.5 entry above, where they are
     genuinely landing for the first time. -->

### Improvements

- CLI: `--help` now shows full usage guide, subcommand docs, and examples (UQ-001/002)
- CLI: timestamp "updated" column in non-JSON list output (UQ-004)
- CLI: "No tasks found." message on empty filter results (UQ-020)
- Web UI: mobile-responsive table (role/labels columns hidden at ≤600px) (UQ-012)
- Web UI: sticky "Advance" actions column at mobile viewport (UQ-011)
- Web UI: back link from task detail preserves filter context (UQ-009)
- Web UI: gate-fail feedback with `?error=` redirect instead of silent refresh (UQ-013)
- Web UI: filter-scoped label counts (UQ-034)
- Web UI: search form positioned above label nav on mobile (UQ-030)
- Web UI: "No tasks found." row when filter yields zero results (UQ-038)
- `packages/quay/package.json` `engines.node` = `>=20.0.0` enforced on install (CB-019)
- `packages/quay/package.json` `files` field added — test files excluded from npm artifact (PKG-003)

### Bug fixes

- CLI: `--prefix` with no value no longer crashes with TypeError (SH-001)
- CLI: `--sort updated` no longer silently ignored (CB-012)
- MCP/Web UI: `stripHeadings()` correctly skips `#` lines inside fenced code blocks (SH-003/SH-005)
- Web UI: open-redirect guard rejects `//evil.com` protocol-relative URLs (SH-002)
- Release: artifact glob changed to `quay-*.tgz` to work across version bumps (CB-008)

---

## 2026-07-16 — Manda operational findings (quay-core-bootstrap experiment 2)

### Manda hub address convention

The manda daemon's actual address is stored in `.manda/hub.addr`. Always read
this file to obtain the correct address — do not assume a fixed port number.

```bash
MANDA_ADDR=$(cat .manda/hub.addr)
curl -s "$MANDA_ADDR/healthz"   # {"root":"..."} = daemon live
```

**Port-discovery finding**: iterations 0-3 of the quay-core-bootstrap experiment
probed `http://localhost:28912/healthz` and received connection-refused, concluding
the daemon was unreachable. The daemon was live at `http://localhost:46215` (the
address in `.manda/hub.addr`) throughout those iterations. The probe address was
wrong, not the daemon. See `.manda/NOTES.md` for the full account (cross-reference:
QC-005, iteration 4).

### Manda Agent reliability envelope — three confirmed tiers

`mcp__plugin_manda_manda__Agent` (routed via the `cord` monitor channel) has been
probed at three complexity levels. All three succeeded on their first attempt:

| Tier | Task description | Timeout | Result | Iteration |
|---|---|---|---|---|
| Trivial | Single-word echo ("PONG") | 90s | SUCCESS (1/1) | 4 |
| Medium | Single-file read + structured JSON response | 150s | SUCCESS (1/1) | 5 |
| Complex | Multi-file read + adversarial analysis + structured verdict | 150s | SUCCESS (1/1) | 6 |

**Constraints**: this primitive is conditional — it requires (a) the manda daemon
live at the address in `.manda/hub.addr`, and (b) a `manda monitor cord` broker
running in a session other than the caller's own session (DIR-020: the calling
session must not own the broker, or a self-deadlock results). The primitive is not
unconditional; these preconditions must be verified before each call.
