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

## Subagent dispatch mechanisms (added by DIR-012, iteration 65)

Two distinct mechanisms exist for spawning a fresh-context subagent inside
this experiment's own sessions. Prior text in `experiments/quay-native-bootstrap/` used the bare
word "subagent" for both, which produced a real terminology gap (a human
expectation about one mechanism was initially read as applying to the
other — see `experiments/quay-native-bootstrap/directives/archive/
DIR-012-nested-subagent-terminology-and-audit-requirement.md`). Use these
two explicit terms, never bare "subagent," wherever the distinction
matters:

| Term | Mechanism | Used by |
|---|---|---|
| **native subagent** | The platform's own `Agent`/Task tool: a fresh-context spawn within the same top-level session/orchestrator invocation, no manda involved. | This experiment's G3 out-of-band audit dispatch, today (`experiments/quay-native-bootstrap/ITERATION-PROMPTS.md` §5 OUT-OF-BAND AUDIT). |
| **manda nested subagent** | A subagent that reaches back out to a live broker session via manda's own cap-request mechanism (`mcp__plugin_manda_manda__Agent`), relayed over a `cap-requests-<name>` channel to a parent-broker session that is actively watching it. See `experiments/quay-native-bootstrap/directives/archive/DIR-011-manda-agent-live-verified-tool-name-latency.md` for the live-verified tool name and latency profile. | Not currently used by any mechanism this repository's protocol depends on for its own gate or audit steps (per DIR-011's own Resolution, part b). |

Do not call the manda mechanism a "nested subagent" without the "manda"
qualifier, and do not call the platform's own `Agent`/Task tool a
"subagent" without the "native" qualifier, in any `experiments/quay-native-bootstrap/` document
where the two could be confused.

## Reserved for the future

| Name | For |
|---|---|
| **Harbor** / **Port** | The public relay service (deferred, opt-in). |
