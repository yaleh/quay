# Simulated User: New user from README — Iteration 18

## Overall README quality

The `packages/quay/README.md` is concise, well-organized, and covers the full user journey from install through CLI, Web UI, MCP setup, and configuration. A first-time user can follow it end-to-end without prior knowledge of the tool. One minor flag inconsistency exists (`--format json` vs `--json`) but the README documents both. The update and configuration sections are a useful addition that the root README handles differently.

## Completeness check

### What quay is
PASS — The opening line ("Provider-agnostic task management: CLI, Web UI, and MCP server over the Provider ABI") is terse but sufficient for a user deciding whether to proceed. It does not explain what "Provider ABI" means or that tasks are stored as markdown files — deeper context is omitted intentionally, which is fine for a package-level README.

### Installation instructions
PASS — Both methods are present. Option A (global install from `.tgz`) includes the `npm install -g` command and a `quay --version` verification step. Option B (from source) covers `git clone`, `npm install`, and `npm link`. Node.js >= 20.0.0 requirement is stated. Minor gap: Option A says "download the latest quay-*.tgz from the GitHub releases page" without providing the actual URL (root README includes `https://github.com/yaleh/quay/releases`); a first-time user would need to find this manually.

### CLI flags documented
PASS — All major flags are present and accurate against the source (`bin/quay.js`):
- `--prefix` — present, with example
- `--status` — present
- `--label` (repeatable, AND-join) — present, AND-join semantics explicitly called out
- `--search` — present
- `--sort updated` — present (and the actual implementation supports `id|status|updated`)
- `--page-size` — present, note that it applies to JSON output too
- `--json` — present
- `--format json` — present (as an alias shown in one example: `--format json | jq '...'`); the source code confirms this alias exists (QX-048)
- `--version` — present
- `--help` — present
- `--provider` — NOT documented in the CLI section; the source supports `--provider <id>` for multi-provider workspaces. A single-provider user won't miss this, but it is a real omission for advanced use.

### MCP setup section
PASS — The `.claude/mcp.json` config snippet is accurate. The `command: "quay"`, `args: ["mcp"]`, and `cwd` fields match how the MCP server is launched. The "or `~/.claude/mcp.json`" note is a useful clarification. The table of available MCP tools (`task_list`, `task_get`, `task_write`, `task_check`) matches the actual server implementation. The `task_list` parameter table is complete and matches the MCP server's Zod schema. The staleness-detection note (`_version` field) is accurate and genuinely useful. No inaccuracies found.

## Gaps found

1. **No GitHub releases URL in Option A.** The root README links directly to `https://github.com/yaleh/quay/releases`; the package README just says "GitHub releases page" with no link. A new user installing from npm docs or a forwarded link has to find the URL themselves.

2. **`--provider` flag undocumented in CLI section.** The binary supports `--provider <id>` for selecting a non-default provider in multi-provider configs; this is absent from the CLI usage block. Low impact for single-provider users; real gap for anyone with `github:` enabled.

3. **`action list` / `action run` commands absent.** The root README's usage line includes `quay action list` and `quay action run`; the package README CLI section omits them entirely. A user who wants to trigger workflow actions will not know these exist.

4. **`quay task view` / `quay task edit` commands not shown.** The CLI section shows only `task list`. `task view <id>` and `task edit <id> --status <s>` are real commands with distinct purposes; omitting them leaves a gap for anyone who wants to inspect or update a task.

5. **No mention of `.quay/config.yml` being required before `quay task list` works.** The Configuration section appears after all the usage examples, but a new user following top-to-bottom will run `quay task list` before creating a config and get an error. A short "Prerequisites / quick setup" callout would prevent this.

6. **Web UI `quay serve --host` default is listed as `0.0.0.0`.** This is technically correct per the source but is an unusual default (binds to all interfaces). No security note is given; may surprise users on shared machines.

## vs. project root README

Different in useful ways — not straightforwardly better or worse; they serve different audiences:

- The **root README** is richer on architecture (the three-package model, Provider ABI design, quay-native vs quay-github), includes live command output samples, links to `docs/proposals/`, and explains the BAIME bootstrap experiment context. It is better for contributors, researchers, or anyone evaluating whether to trust/adopt the project.

- The **package README** is tighter for a first-time installer: it leads with install steps, covers MCP setup with a concrete config snippet, documents the Web UI options, and adds the "Updating quay" / "Configuration" sections clearly. The root README's "Updating quay" section is less precise (it says "restart the Claude Code session" rather than stop/reinstall/restart processes).

- Key differences: the package README adds the MCP tools table and `task_list` parameter reference (not in root README); the root README adds `--provider`, `task view`, `task edit`, `action list/run`, live output samples, and the releases URL. Neither is a strict superset of the other.

## Overall verdict

PARTIAL — The README is good enough for a motivated new user to install and run basic `task list` queries and set up MCP. The MCP section is accurate and detailed. The main gaps (missing `--provider`, `task view/edit`, `action list/run`, config-first prerequisite, no releases URL) mean an advanced first-time user will hit undocumented surfaces and need to run `--help` to discover them. Not a blocking failure, but the README is incomplete relative to the actual CLI surface.
