# Changelog

## v0.6.0 (2026-08-20) — productization pipeline close-out (AC104-119) + Web UI gap fixes

Closes the productization/verification pipeline (AC104-119): the version-bump step, current-tgz
build, cross-host and cross-project verification, and release/status-writeback all became wired
steps. Also lands a batch of Web UI fixes found by that verification.

#### Added

- **Version-bump automation (AC104)**: one `version: bump 0.5.0 -> 0.6.0` commit updates all 8
  version-bearing files (4 `package.json` + `plugin.json` + 2 `marketplace.json` + vendored copy,
  plus `plugin/VERSION`) — the first step of the productization pipeline.
- **Build/verify steps wired (AC105-107)**: build the current-version tgz, run a real
  `dist-verify` on it, and a cross-host mechanized verification (`verify-deliver-coldstart.sh`
  gains `--build-root` tgz persistence and a complete B/C dual-machine three-step cold-start run).
- **Third-party / cross-project verification (AC118/AC119)**: the delivery mechanism verified
  against a real third-party project (meta-cc on machine B) and the Web UI across projects.
- **verification-round write-path wiring**: `verification-round.jsonl`'s three fields now written
  by the real round-record path.
- **Web UI fixes**: `/board` server-side pagination + status/label filtering, `/sessions`
  rendered by layer (Manager/Outer/Inner) without mixing, and the Journal page reading fresh
  tick-log sections.

#### Identified (fix filed)

- **CSS asset missing from the release tarball**: AC119 cross-project Web UI verification found
  `serve` returning 200 but an empty `<style>` — `webui-modernist.css` was placed under `src/` in
  the tgz while the bundle read it from a same-directory path. A fix task was filed
  (AC108/109 pipeline close-out) for the following release.

## v0.5.0 (2026-08-16) — AC85-93 productization chain (cross-host verify, version consistency, plugin dist)

The largest autonomous-development release to date (3286 non-merge commits): lands the AC85-93
productization chain, a large gap backlog of mechanism fixes, and the Web UI redesign groundwork.

#### Added

- **Productization build/verification chain (AC85-89)**: Node-floor dist verification
  (`dist-verify-node-floor`), `verify-deliver-coldstart.sh` three-step cold-start verification
  (isolated `.tgz` install → in-project `quay-init --loop` → two-layer outer+inner cold-start
  liveness), and a `productization-verification.jsonl` record carrier.
- **Version consistency across all four distribution chains (AC93)**: unified to 0.5.0 across the
  root marketplace, `quay-native`/`quay-github`/`backlog` packages, and the plugin vendored copy;
  the plugin-install chain is now triggerable on the develop push path.
- **Delivery-surface guards (AC90-92)**: fast-mode copy drift gate (`normalized-byte`), the
  delivery execution core no longer points at undelivered files, and `deliver-verify-usage.sh`
  asserts the verified surface intersects the actually-used surface.
- **Web UI redesign groundwork**: the improved Web UI design spec written up, with the next-stage
  AC94-99 tasks filed.
- **Autonomous-loop hardening**: `execute-suite-fix` dropped the `CPUQuota=400%` literal
  (host-dependent limit → genuinely unconstrained), and fan-in-execute auto-closes telemetry
  brackets.

## v0.4.0 (2026-08-06) — plugin bundle in the release + two-line branch model (develop/integration) + ADR crystallization

#### Added

- **Plugin bundle now ships in the release (AC16)**: the Claude Code plugin bundle (`plugin/`) —
  the third install path alongside npm and SEA — is included in released artifacts.
- **Two-line branch model (develop/integration)**: dispatch forks from `develop` by default
  (`fork_baseline:develop`), merges target the two-line model, and `develop` becomes the
  authoritative line holding all task work plus record commits.
- **ADR crystallization (ADR-020..032)**: adaptive methodology budget (ADR-021), retirement of the
  classic milestone loop in favor of the two-layer fast mode (ADR-022), axes as first-class ADR
  records (ADR-025), and rulings traceability (ADR-024), among others.
- **Mechanism hardening**: supervisor base layer, a pure-append checker-cost ledger, and
  cross-machine regression fixes (ready-pool arity, heavy-op token lease units).

## v0.3.x — M08-merge-recover (dated per-item below; see git log for exact commit dates)

### v0.3.12 (2026-07-24) — distribution discipline: version-consistency gate + delivery-manifest assertion + plugin concurrent-batch scripts

No user-facing CLI/MCP/Web-UI behavior changes versus v0.3.11; this release ships the
distribution/release-pipeline hardening landed since v0.3.11 (M126–M134 + DIR-049).

#### Added
- **version-consistency gate** (M126/M132): a fail-closed `version-consistency-check` now runs in CI;
  all 8 version sources (4 `package.json` + `plugin.json` + 2 `marketplace.json` + the vendored copy)
  must agree — prevents the silent multi-way version drift that had accumulated through v0.3.11.
- **delivery-manifest** (M129): `delivery-manifest.json` is now the single source of truth for the
  release artifact-set; `release.yml` asserts its output matches it exactly (no more, no less).
- **plugin concurrent-batch scripts vendored** (DIR-049, `29f9eea`): the DIR-044 concurrent-batch
  scheduler scripts now ship inside the plugin (`plugin/scripts/`), so a consumer workspace can run a
  genuine 2-wide concurrent batch instead of silently falling back to serial.

#### Fixed
- `loadbearing-test-gate` now recognizes `.test.ts` files (M134) — it previously ignored the migrated
  TypeScript tests, understating load-bearing coverage.

### v0.3.11 (2026-07-23) — Windows SEA archive was missing `.quay/config.yml` (M122)

Caught by the v0.3.10 release run of the new `sea-verify-node-free-cross-platform` job (see below):
the Windows SEA archive's `.quay/config.yml` (and the whole `.quay/` directory) was silently missing
from every past Windows release — `release.yml`'s archiving step used a bare bash `*` glob
(`./dist-sea-release/*`), which does not match dotfiles/dotdirs, while the Linux/macOS archiving path
(`tar -C dist-sea-release .`) does. The archive looked complete (`quay.exe`/`quay-native.exe` present)
but `quay serve` (and most commands) crashed at runtime with "no .quay/config.yml found" — a real,
previously-undetected latent bug, never caught because no job ever runtime-smoked the Windows archive
before this milestone.

#### Fixed

- `shopt -s dotglob` before the `7z a` archive step, so the Windows zip includes `.quay/` like the
  tar-based Linux/macOS archives already did.

### v0.3.10 (2026-07-23) — cross-platform SEA runtime-smoke CI coverage (M122)

`release.yml`'s `sea-verify-node-free` job (the only runtime-smoke verification of the SEA binaries)
covered Linux only — `sea-release`'s macOS/Windows matrix legs proved those SEA builds succeed, but
never that they *run* without crashing. No functional code change; CI-only.

#### Added

- New `sea-verify-node-free-cross-platform` job (macos-latest/windows-latest matrix): downloads the
  same-run `sea-release` archive for each platform, strips every PATH directory containing a
  `node`/`node.exe` binary (GitHub's macOS/Windows runners can't use the Linux job's `container:`
  isolation), confirms `command -v node` genuinely fails under the stripped PATH, then runs
  `--help`/`serve` — the same coverage the Linux job already has.

### v0.3.9 (2026-07-23) — SEA binary startup crash fix (M121, DIR-004)

The quay Core SEA (Single Executable Application) binary crashed at startup for any gate-touching
command — `packages/quay/src/gate/registry.ts` computed `__dirname` via
`fileURLToPath(import.meta.url)`, which is `undefined` when esbuild bundles the module to CJS for the
SEA build (Node SEA does not support ESM main modules). Pre-existing since the M84 TS migration,
silently unexercised for ~30 milestones until the M116 due-diligence SEA smoke test caught it.

#### Fixed

- **`registry.ts`'s `__dirname` computation is now dual-mode safe**: prefers the real CJS `__dirname`
  binding present in the SEA/esbuild-CJS bundle context, falls back to
  `fileURLToPath(import.meta.url)` in the normal ESM (`node bin/quay.ts`) path — mirrors the existing
  `src/version.ts` / `scripts/version-sea-shim.js` dual-mode precedent (M01-dist). `--version`,
  `task list`, `gate`, and every other gate-touching command now run without crashing on the SEA
  binary.
- Confirmed the SEA build's D1 `doc-*` gate (`docs-managed/`-dependent) degrades gracefully (a clear
  `FAIL — no such document` reason) rather than crashing, when that repo-relative directory is
  unavailable in the distributed single-file binary — documented, not a silent gap.

### v0.3.8 (2026-07-23) — Node-floor distribution regression fix (M120, DIR-060)

The M116 `bin/*.js`→`bin/*.ts` migration made every CLI entrypoint a `.ts` file run directly via
shebang, which only Node's native type-stripping (>=23) can execute — but this project declares and
CI/release pin a Node >=20 floor. A real v0.3.5 release attempt failed on exactly this
(`ERR_UNKNOWN_FILE_EXTENSION ".ts"` on Node 20). The v0.3.6 tag's release run then exposed a second,
separate pre-existing bug (the "Run tests" step included 2 live-GitHub-hitting suites that hung past
the job timeout) — v0.3.6's SEA assets published successfully but its npm-pack artifact did not. The
v0.3.7 tag fixed that but exposed a THIRD live-GitHub-hitting file
(`cli-edit-parity-conformance.test.mjs`, which does live mutating writes needing broader org perms
than CI's default token) that failed the release job for real (exit 1, not a timeout) — v0.3.7's SEA
assets published successfully but its npm-pack artifact again did not. This release (v0.3.8) completes
the fix with all three issues resolved.

#### Fixed

- **The published npm-pack tarball's `bin` field now points at a bundled, self-contained ESM
  `dist/quay.js`** (built by a new `scripts/build-dist.mjs`/`build-dist.sh`, the sibling of the
  existing SEA build's `esbuild-sea.mjs`), which runs on Node >=20 unmodified — restoring the
  declared floor for the actual distributed artifact. `engines` stays `>=20.0.0` (unchanged);
  `package.json`'s `exports` map is unchanged (still points at source `.ts`, consumed only by the
  in-workspace `quay-native` package, never by an end user of the distributed CLI).
- **The Claude Code plugin's vendored Core copy** (`plugin/vendor/quay/`) now vendors the same
  built `dist/quay.js` (self-contained, zero `node_modules` needed at runtime) instead of a stale,
  broken raw-source copy that predated the M116 rename.
- **CI now has a dedicated Node-20 floor-verification job** (`release.yml` and `ci.yml`) that
  actually builds, installs, and runs the packaged CLI under Node 20 — the mechanical guard that
  would have caught this regression before a real release attempt did.

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
