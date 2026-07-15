# Quay — Glossary (frozen vocabulary)

Use these terms **verbatim** in all tasks, Skills, code, and docs. This exists to prevent naming drift and to resolve deliberate collisions with the Claude Code / MCP ecosystem.

## Core objects

| Term | Definition | Do NOT call it |
|---|---|---|
| **Quay** | The project, and the **Core** (host: web + CLI + MCP projection). | — |
| **Core** | The thin, provider-agnostic host. Contains no backend-specific logic. | "the engine" |
| **Provider** | A bundle adapting **one** task backend: a data-only ABI (data + manifest, over MCP) plus shipped Skills. Triggering is a host-owned edge, not a Provider ABI capability. | ~~plugin~~, ~~connector~~ |
| **capability** | A discrete face a Provider may implement; negotiated by the Core with graceful degradation. | ~~face~~, ~~facet~~ |
| **task** | The canonical work-item (markdown + frontmatter view-model). | — (never use "task" for a dispatch) |
| **run** | An execution instance — a dispatched agentic run over a task (via manda). | ~~task~~ (for the execution side) |
| **Skill** | A Claude Code Skill (`SKILL.md`), shipped by a Provider under `quay:*`. **It literally is a Claude Code Skill.** | — (do not rename) |
| **action button** | A preset trigger message (`{label, payload, whenStatus?}`) the host sends into a Claude Code session. Host-owned edge, decoupled from status/skill; **not** a Provider ABI capability. | bare "action" (esp. near GitHub) |
| **lane** | Coarse label for "which Skill set applies" (authoring / execution / exploration). Replaces `pipeline_id`. | ~~pipeline~~ |
| **status** | Coarse persisted checkpoint of a task. Replaces `phase`. | ~~phase~~ |
| **manifest** | A Provider's static self-declaration file: `provider.yml`. | ~~descriptor~~, ~~profile~~ (in prose) |

## Binaries & files

| Name | Role |
|---|---|
| **`quay`** | Core CLI. `serve` / `task` / `action`. MCP **client**. Provider-agnostic. The word "CLI" in docs = this. |
| **`quay-native`** | The native Provider's binary. `task` (raw file ops) · `mcp` (ABI transport). Pattern: `quay-<providerId>`. |
| **`provider.yml`** | Per-Provider manifest (static declaration + entry points). Travels with the Provider. |
| **`.quay/config.yml`** | Per-workspace config (enabled Providers + storage paths / credentials). Travels with the user's project. |
| **`quay:*`** | Claude Code Skill namespace for Quay Skills. |

## The ABI (over MCP)

| Surface | Meaning | Capability |
|---|---|---|
| `provider://manifest` | Static declaration resource (or Core reads `provider.yml`). | required |
| `task_list`, `task_get` | Data read. | `data.read` (required) |
| `task_write` | Data write. | `data.write` (optional) |
| `task_check` | Assert the `ready`/`done` gates. | `gate` (optional) |

The ABI is **data-only**. Triggering (actions) is a host-owned edge, not part of the ABI.

## Deliberate collision resolutions

- **plugin → Provider.** Avoids Claude Code "plugin"; a Provider *contains* Claude Code Skills. Also avoid **Connector** — Anthropic calls remote MCP servers "connectors".
- **skill → kept.** It is a Claude Code Skill; do not invent a synonym.
- **task → kept for the work-item; run/job for execution.** Avoids Claude Code Task tool / manda `TaskCreate` confusion.
- **action → "action button".** Avoids GitHub Actions confusion.
- **face/facet → capability.**
- **Two CLIs, named apart:** `quay` (Core) vs `quay-native` (Provider). "CLI" alone means `quay`; a Provider's executable is a "provider binary".

## Reserved for the future

| Name | For |
|---|---|
| **Harbor** / **Port** | The public relay service (deferred, opt-in). |
