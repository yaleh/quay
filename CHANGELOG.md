# Changelog

## v0.2.0 (2026-07-17) — Quay Core: CLI/MCP/Web UI capability expansion + packaging

### New features

- **`quay task list --search <query>`**: full-text title + body search (CB-007, CB-016, CB-017)
- **`quay task list --sort updated`**: sort by last-modified time descending (CB-004)
- **`quay task list --prefix <X>`**: filter by task-id prefix (CB-001)
- **`quay task list --label <L>`** (repeatable): AND-join multi-label filter (CB-013)
- **`quay task list --page-size <N>`**: configurable page size (CB-006)
- **`quay --version` / `quay -V`**: print version string and exit (UQ-047)
- **`quay task list --json` / `--format json`**: JSON output mode (CB-020 alias)
- **Web UI search** (`?q=`): full-text search with result banner and pagination indicator
- **Web UI page size** (`?pageSize=N`): configurable page size with 10/20/50/100 nav
- **Web UI label nav**: frequency-sorted labels, active-label pinning, expand hidden labels
- **Web UI sort by time**: "Updated ↓" sort option
- **Web UI action buttons**: Advance task status inline from the list page (CB-003)
- **MCP `task_list` pagination**: `page`/`pageSize` parameters (CB-010)
- **MCP `task_list` search**: `search` parameter with heading exclusion (CB-014)
- **MCP `task_list` multi-label filter**: array form for AND-join (CB-015)
- **GitHub Actions release workflow**: `npm pack` artifact on `v*` tags (CB-008)

### Improvements

- CLI: `--help` now shows full usage guide, subcommand docs, and examples (UQ-001/002)
- CLI: timestamp "updated" column in non-JSON list output (UQ-004)
- CLI: "No tasks found." message on empty filter results (UQ-020)
- CLI: `--format JSON` (uppercase) normalized; unknown `--format` warns on stderr (UQ-041/044)
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
