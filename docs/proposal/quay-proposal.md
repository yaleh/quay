# Quay — Proposal

- **Status:** Draft (pre-implementation)
- **Date:** 2026-07-15
- **Owner:** Yale Huang
- **Supersedes/relates:** epicd (see §11 "Relationship to epicd")

---

## 1. Summary

**Quay** is a thin, agent-first task workbench. It is a small **Core** (web service + CLI + MCP surface) that hosts pluggable **Providers**. Each Provider adapts one task backend (a local file store, GitHub issues, backlog.md, …) and brings the *know-how* to drive that backend with agents: **Skills**, **action buttons**, and a declared vocabulary of **capabilities / statuses / lanes**.

The Core renders task lists, detail, and markdown editing, and executes provider-declared actions — but it contains **no backend-specific business logic**. Everything backend-specific lives in a Provider. Providers speak to the Core over a single, uniform transport: **MCP**.

Quay ships one built-in **native** Provider — essentially a *path + markdown-format convention* plus a Skill set — so a user can deploy and start driving tasks immediately, with zero backend setup. That built-in also serves as the **reference implementation** and the definition of the canonical task view-model.

The valuable, differentiating part of Quay is **not** board rendering (commodity) — it is the **agentic layer**: the Skills, action buttons, and manda dispatch that let agents drive a backend to completion.

---

## 2. Motivation

### 2.1 Where this comes from

Quay is the "lightweight route" that emerged from a design discussion about epicd's future. epicd evolved an opinionated, autonomous **phase-driven engine**: a central supervisor scans tasks, matches `(pipeline_id, phase)`, and dispatches machine actions. In parallel, higher-level **convergence Skills** (`authoring-convergence`, `fixpoint-convergence`) *also* drive phase transitions. Two drivers coexist and overlap.

The direction users actually want is:

- Work concentrates on **discussion before a task exists**, and on **launching high-level convergence Skills** on existing tasks — mostly in **background worker sessions**.
- Low-level phase Skills are rarely called directly; they are invoked *by* the high-level convergence Skills. Many phases become invisible to the user.
- Triggering is done by **user action** (an action button) or by a **high-level Skill**, dispatched through **manda's messaging + trigger mechanism** — **not** by a phase/status-bound monitor.

Two complementary simplifications follow:

1. **Vertical:** collapse the persisted state machine. Once dispatch is no longer driven by a central scan, `phase`'s only remaining job is a *recoverable checkpoint* — which is exactly a `status`. `pipeline_id`'s only remaining job is *which Skill set / lane applies* — which is a `tag`/`label`. Fine-grained phase knowledge retreats into the Skills. The result is a lightweight **status convention + Skill set** on top of a backlog.md-like store.
2. **Horizontal:** generalize over many backends via a thin UI + a Provider plugin mechanism.

Quay is those two simplifications realized as a **new project**, rather than a risky in-place teardown of epicd. Greenfield is thin *by construction*: it never grows the phase/pipeline machinery in the first place. What we carry over from epicd is the **Skills** and the **action-button/manda integration** (the moat); what we drop is the **engine** (interpreter/driver/supervisor/pipeline).

### 2.2 Why "thin UI + Providers" and not "one universal tracker"

The graveyard of universal issue-tracker abstractions is large; they die on the lowest-common-denominator problem. Quay avoids it by **not competing on board rendering**. Quay's value is a uniform **agent driving surface** across backends. The Provider's storage-read is commodity; its Skills/actions are the differentiator. Invest accordingly.

---

## 3. Goals / Non-goals

### Goals

- A **Core** that renders task list / detail / markdown editing and executes provider-declared action buttons, with **zero backend-specific logic**.
- A **Provider** plugin model with a **multi-faceted ABI** (data, action, skill, manifest), consumed by the Core uniformly over **MCP**.
- A built-in **native** Provider (file/markdown convention + Skill set) for instant deployment; it doubles as the reference implementation and canonical schema.
- **Three sibling front-ends** over the same Provider ABI: **Web UI**, **Core CLI (`quay`)**, and an **MCP projection** for agents — one capability set, three bindings.
- Reuse of epicd's convergence **Skills** and the **manda** dispatch/action integration.
- A path to a **second real backend** (GitHub issues) that proves the ABI without touching the consumer layer.

### Non-goals (for v0)

- Reproducing epicd's autonomous phase engine (interpreter/driver/supervisor/pipeline).
- Rich, backend-semantic rendering baked into the Core (kanban business logic, AC checkboxes hardcoded per backend, etc.). The Core stays "dumb" (see §6.3).
- The **public relay service** (see §13). It is deferred and opt-in; it is a deployment/security concern, not a v0 architecture concern.
- A universal write model. Write-back is capability-gated and backend-specific.

---

## 4. Terminology (see also `glossary.md`)

| Term | Meaning |
|---|---|
| **Core** | The thin host: web service + `quay` CLI + MCP projection. Provider-agnostic. Also the project name: **Quay**. |
| **Provider** | A bundle adapting **one** task backend. Multi-faceted ABI (data / action / skill / manifest). *Renamed from "plugin"* to avoid collision with Claude Code plugins — a Provider **contains** Claude Code Skills. |
| **capability** | A discrete face a Provider may implement (e.g. `task.write`, `action.run`). The Core negotiates capabilities and degrades gracefully. |
| **task** | The canonical work-item (a markdown doc + frontmatter in the view-model). The domain object. |
| **run** | An execution instance — a dispatched agentic run over a task (e.g. via manda). **Never** call a dispatch a "task"; reserve "task" for the work-item. |
| **action button** | A preset trigger message the host sends into a Claude Code session (`{label, payload, whenStatus?}`). A host-owned edge, not a Provider ABI capability (§6.4). |
| **Skill** | A Claude Code Skill (`SKILL.md`). *Not renamed* — it literally is a Claude Code Skill. Shipped by a Provider under the `quay:*` namespace. |
| **lane** | A coarse label for "which Skill set applies" (authoring / execution / exploration). The lightweight replacement for `pipeline_id`. |
| **status** | The coarse, persisted checkpoint of a task (the lightweight replacement for `phase`). |
| **manifest** | A Provider's static self-declaration: `provider.yml` (capabilities, statuses, lanes, action_buttons, entry points). |

Naming collisions we deliberately resolved:

- `plugin` → **Provider** (avoid Claude Code "plugin"; avoid "Connector" too — Anthropic already calls remote MCP servers "connectors").
- `skill` → **kept** (it *is* a Claude Code Skill).
- `task` → **kept** for the work-item; **`run`/`job`** for the execution side (avoid collision with Claude Code Task tool / manda `TaskCreate`).
- `action` → always **"action button"** (avoid GitHub Actions confusion near a GitHub backend).
- `face/facet` → **capability**.
- The two CLIs are named distinctly: **`quay`** (Core) vs **`quay-native`** (native Provider). The word "CLI" in docs refers to `quay`; a Provider's executable is a "provider binary".

---

## 5. Architecture

```
Consumer layer  (Core = quay ; all are MCP clients over the Provider ABI)
┌───────────────┬────────────────┬──────────────────────┐
│    Web UI     │   quay  CLI    │   MCP projection→Agent │
└───────────────┴───────┬────────┴──────────────────────┘
                        │  provider ABI over MCP
        ┌───────────────┴────────────────┐
   provider: native                  provider: github
   (quay-native mcp)                 (github MCP server)
   task_list / task_get / task_write   task_list / task_get / …
   task_check                          task_check
   provider://manifest                 provider://manifest
```

Note: **triggering is not on this diagram.** Delivering a trigger into a Claude Code session (an *action*) is a **host-owned edge**, not a Provider ABI capability — see §6.4 and §12.

Two layers, never conflated:

- **Consumer layer (Core, `quay`)** — Web UI, `quay` CLI, and the MCP projection for agents are **siblings**: three bindings of the *same* Provider ABI. The Core is an **MCP client** to Providers.
- **Provider / transport layer** — each Provider fulfills the ABI by exposing an **MCP server**. The native Provider ships `quay-native mcp`; a GitHub Provider ships a GitHub MCP server. Adding a Provider is "add an MCP server"; the consumer layer needs **zero** changes.

**Implementation status (iteration 26, DIR-007, `quay-bootstrap-experiment`):** the "MCP projection → Agent" binding is now real, not merely a design claim. `quay mcp` (`packages/quay/bin/quay.js`'s `mcp` subcommand, backed by `packages/quay/src/mcp-server.js`) is a genuine MCP **server** an Agent connects to once; internally it is simultaneously an MCP **client** that fans out, per enabled Provider in `.quay/config.yml`, via the pre-existing `provider-client.js#connectProvider()` (zero changes to that file were needed). Multi-Provider disambiguation is resolved via an explicit design decision: every proxied tool (`task_list`/`task_get`/`task_write`/`task_check`) takes an **optional `provider` argument** (defaults to the first `enabled: true` Provider) rather than per-Provider tool-name namespacing — chosen so a single-Provider workspace's Agent-side tool calls need zero changes when a second Provider is later enabled. `provider://manifest` is exposed both as a default-Provider alias and per-Provider as `provider://manifest/<id>`. Live-verified end-to-end against both real Providers already in this repo (native + github): `quay mcp`'s proxied `task_list`/`task_get`/`task_check` calls were confirmed byte-identical to calling each Provider's own `mcp` subcommand directly, including against the real, live `yaleh/quay` GitHub repository (see `packages/quay/DESIGN.md` and `experiment/iterations/iteration-26.md` for the full transcript).

### 5.1 The chosen transport: MCP (decision A)

Three transports were considered for how the Core reaches a Provider:

- **A. MCP as the uniform transport** — chosen. One definition, shared by humans (Web/CLI) and agents. Ties directly to "MCP is the projection of the Provider's **data** face onto the agent channel," keeping things DRY. (Triggering is a separate host edge, §6.4.)
- B. Subprocess CLI + JSON protocol — awkward for pure-API backends (GitHub) that have no natural executable.
- C. In-process adapter — fastest, but forces same-language/same-process and loses isolation.

Consequence: the native Provider's `mcp` subcommand is its **formal ABI channel**; its raw `quay-native task …` subcommands are local convenience / internal implementation.

---

## 6. The Provider model

### 6.1 A Provider is one bundle, registered into multiple registries

A Provider is a **single directory** that registers into several places:

- **Provider registry** (the Core) — via `provider.yml` + an MCP entry command.
- **Claude Code skills** — via `SKILL.md` files on disk (namespace `quay:*`).
- **MCP** — the runtime **data** transport (`task_list / task_get / task_write / task_check`).

This keeps the two plugin systems (Claude Code's skill/plugin system vs. Quay's Provider system) from being conflated: one bundle, several registration targets. (Triggering — *actions* — is a separate host-owned edge, §6.4, not part of the Provider's registration.)

### 6.2 Capability model (required core + optional faces)

| Capability | Content | Required? |
|---|---|---|
| **data.read** | `task_list`, `task_get` | **Required** (the UI must show *something*) |
| **manifest** | `provider://manifest` resource (or static `provider.yml`) | **Required** |
| **data.write** | `task_write` | Optional (a read-only Provider is valid) |
| **gate** | `task_check` (assert the `ready`/`done` gates) | Optional (native provides it) |
| **skill** | shipped `quay:*` Skills | Optional (falls back to generic Skills) |

The Core **negotiates** capabilities and **degrades gracefully**: no write → grey out edit; no Skills → fall back to generic ones. Note that **action is not a Provider capability** — see §6.4.

### 6.3 How "dumb" is the UI — the Provider declares semantics, the Core owns presentation

The Core renders: task list, task detail, markdown body editing, and (host-bound) action buttons. It contains no `if backend === 'github'`. To still allow a decent board, the Provider declares **semantics** — which field is `status`, its allowed values, which are terminal, and the `lane` — but **never presentation** (no columns, colors, badges, custom components). The Core maps those semantics to presentation itself. This is how "the Provider carries no Web concern" and "the Core can still render a good board" both hold. The invariant: *no backend branch in the Core; no styling in the Provider*.

### 6.4 Action is a host-owned trigger edge, not a Provider capability

An **action** is a lightweight **message sent from outside a Claude Code session into one**, causing a Claude Code action (typically invoking a Skill) — a **dumb pipe**, decoupled from `status` and Skill. It is the interface between quay (host) and a Claude Code session; it is **peripheral, not a Provider ABI capability**.

- The Provider declares only the **logical** `status → Skill` mapping (a convenience for *composing* a trigger payload). It does **not** implement action execution and **does not know about manda**.
- The **host** owns **environment binding**: manda present → dispatch the payload into a background worker session (async); a Claude Code session without manda → run inline / spawn one subagent (sync); plain CLI without an agent → print the command or disable.
- **Action buttons** are preset messages the host sends: `{ label, payload, whenStatus? }`. The Provider may ship defaults, but they are peripheral config, not core semantics. Clicking fires **intent**; task state is never optimistically mutated.

See [`quay-native-design.md`](./quay-native-design.md) §7 for the full treatment.

---

## 7. The Provider ABI over MCP (central contract)

Every Provider exposes an MCP server. Tools/resources, capability-gated:

| Face | MCP surface | Required? |
|---|---|---|
| Static declaration | resource `provider://manifest` (or Core reads `provider.yml`) | Required |
| Data · read | tool `task_list`, `task_get` | Required |
| Data · write | tool `task_write` | Optional (`data.write`) |
| Gate check | tool `task_check` (assert the `ready`/`done` gates) | Optional (`gate`) |

The ABI is **data-only**. **Triggering (actions) is not part of it** — it is a host-owned edge (§6.4). This keeps every Provider a plain data surface and pushes the manda-present-vs-absent variability entirely into the host.

**Static vs runtime split:**

- `provider.yml` (on disk, ships with the Provider) — the Core reads it to render UI chrome, know how to launch the Provider's MCP, register Skills, and read the logical `status → Skill` mapping used to compose triggers.
- **MCP tools** — runtime data read / write / gate-check only.

### 7.1 Canonical task view-model

The native Provider's format defines the canonical view-model other Providers normalize toward. Deliberately minimal-but-complete:

```
id           string
title        string
body         markdown
status       string        # coarse checkpoint (lane-scoped set)
lane         string        # authoring | execution | exploration (or a label)
labels       string[]
parent       id?           # relations
children     id[]
extra        object        # escape hatch for backend-specific fields
```

Too rich → other backends can't fill it (LCD problem returns). Too thin → UI/Skills can't do anything. Keep the core small; push specifics into `extra`.

---

## 8. The built-in native Provider

- **Storage:** a *path + markdown-format convention* — markdown files with frontmatter, in a directory (e.g. `tasks/*.md`). No engine, no pipeline. The Skills provide the workflow.
- **Its format is the reference schema** (see §7.1), not an afterthought.
- **`quay-native` binary:**
  - `quay-native task …` — raw local file operations (convenience / internal impl).
  - `quay-native mcp` — starts the MCP server that *is* its ABI transport.
- **Ships:** `quay:*` Skills, default `action_buttons`, and `provider.yml`.

Recommended default: **track the backlog.md frontmatter convention** as the starting view-model (ecosystem compatibility, zero-cost migration). *(Open decision — see §14.)*

---

## 9. Core CLI (`quay`) and Web UI

`quay` is the Core CLI — **provider-agnostic**, an MCP client, sibling to the Web UI:

```
quay serve                          # start Web + provider host
quay task list                      # via ABI, across the active provider(s)
quay task view <id>
quay action list <id>               # triggers available for a task (from status→Skill + presets)
quay action run <id> <actionId>     # deliver the trigger via the host's environment binding
```

`quay action run` is the CLI face of the host-owned trigger edge (§6.4): it composes a payload and delivers it into a Claude Code session using whatever binding the environment offers (manda / inline / print). It is **not** a call to a Provider MCP tool.

The Web UI is the same capability set with a web binding, optimized separately for desktop and mobile.

---

## 10. Configuration

- **`provider.yml`** (per Provider, on disk) — the Provider's **self-declaration**: capabilities, statuses, lanes, `action_buttons`, Skills path, and the MCP launch entry.
- **`.quay/config.yml`** (per workspace) — which Providers are **enabled**, plus storage paths / credentials / launch bindings.

Keep them separate: `provider.yml` travels with the Provider code; `.quay/config.yml` travels with the user's project. Merging them tangles the moment a second Provider is added.

Example workspace layout:

```
<user-project>/
├─ .quay/config.yml     # enabled providers + storage paths / credentials
└─ tasks/*.md           # native provider's task files (md + frontmatter)
```

---

## 11. Relationship to epicd

- **Carry over:** the convergence **Skills** (`authoring-convergence`, `fixpoint-convergence`, `primitive-executor`, `adjudicate`) and the **action-button / manda** integration.
- **Drop:** the **engine** (interpreter / driver / supervisor / pipeline). This is precisely what the lightweight route rejects.
- **epicd's fate:** epicd's engine is set aside. If its engine semantics are ever wanted again, epicd can be wrapped as *one more* Provider behind Quay — optional and later.
- **Self-host / fixpoint rebasing:** the fixpoint / bootstrap story re-bases onto Quay — "a worker session runs `quay:fixpoint-convergence`, triggered via manda, and drives Quay's own backlog to done." This uses the *same* mechanism real users use (Skills + manda), which is a more honest dogfood than a bespoke engine loop. The heavy investment in epicd's engine self-host is deliberately retired; this trade-off is owned explicitly.

---

## 12. Relationship to manda

manda provides the **messaging + trigger** substrate that the **host** binds an action to (§6.4). In Quay:

- An action button (Web or `quay action run`) fires **intent** — it never optimistically mutates task state.
- When manda is present, the host delivers the trigger as a manda dispatch of a `quay:*` Skill over a task — a **run**, typically in a background worker session. When manda is absent, the host degrades (inline / print).
- Progress is reflected by the backend + a board refresh, not by the trigger.
- **The Provider never touches manda.** manda-awareness lives only in the host's binding layer, so the Provider ABI stays data-only and portable.

manda's own `TaskCreate/Dispatch` vocabulary maps to Quay's **run** side; do not conflate manda's "task" with Quay's work-item **task**.

---

## 13. Deliverables (with names)

| Deliverable | Name | Notes |
|---|---|---|
| Core / project | **Quay** | Web + `quay` CLI + MCP projection — three sibling front-ends |
| Core CLI | **`quay`** | `serve` / `task` / `action`; MCP client; provider-agnostic |
| Built-in provider | **native** | reference schema implementation |
| Provider CLI | **`quay-native`** | `task` (raw) · `mcp` (ABI transport) |
| ABI transport contract | **provider ABI over MCP** | data-only: `task_list/get/write/check` · `provider://manifest` |
| Skills namespace | **`quay:*`** | registers into Claude Code |
| Trigger edge | **action** (host-owned) | message into a CC session; bound to manda/inline by the host, not the Provider |
| Action config key | **`action_buttons:`** | preset trigger messages `{label, payload, whenStatus?}`; peripheral config |
| Provider manifest | **`provider.yml`** | static declaration + entry points |
| Workspace config | **`.quay/config.yml`** | enablement + bindings |
| (Future) public relay | **Harbor / Port** | deferred; see §14 |

---

## 14. Roadmap (walking skeleton first)

Greenfield tempts gold-plating; enforce a walking skeleton, then add faces.

**v0 — end-to-end minimal loop**

> `.quay/config.yml` enables native → `quay-native mcp` starts the data transport → `quay serve` starts Web + list/detail → click an action button → the host delivers the trigger into a Claude Code session, which runs a `quay:*` Skill (e.g. a ported single-task convergence) → the task reaches done.

**v1 — write + prove the contract**

- `task_write` (data.write capability).
- **Second real Provider: GitHub issues.** The heterogeneous backend is the mirror that exposes every shortcut in view-model normalization and write-back. **Do not declare the ABI stable until native + GitHub both run.** Do not write a third Provider before then.

**v2 — agent surface + ergonomics**

- MCP projection for agents (Claude Code drives Quay via the same ABI).
- TUI / richer CLI.

**Later / opt-in**

- Public **relay** (Harbor/Port) for internet access to local Quay instances — a separate, security-heavy scope; design not started.

Dogfood from day one: use the ported epicd Skills to drive Quay's own backlog.

---

## 15. Open decisions

1. **native storage format** — track backlog.md frontmatter (ecosystem-compatible, recommended) vs. a fresh minimal schema.
2. **UI dumbness** — resolved (§6.3): the Provider declares **semantics** (status enum, terminal flags, lane), the Core owns presentation. Remaining sub-question: exactly which semantic fields the Core needs to render a good board.
3. **manifest source of truth** — static `provider.yml` read by the Core vs. a live `provider://manifest` MCP resource vs. both (yml on disk, resource derived).
4. **exploration lane** — keep as a distinct lane, or collapse to a plain label.
5. **status set** — how close to backlog.md's classic To Do / In Progress / Done (+ a couple of gates like `backlog`/`needs-human`).
6. **second validation backend** — GitHub issues (recommended, strongest contract test) vs. raw backlog.md (fast, weak test).
7. **project narrative** — accept the reframing from "opinionated task engine" to "universal agent driving surface"; this shapes how every task/AC is worded.

---

## 16. Risks

- **Fat "generic" Core.** The failure mode of every universal-tracker attempt. Mitigation: the invariant *no backend branch in the Core*; push specifics into Providers and `extra`.
- **Normalization cost.** Each backend is real work (view-model mapping, write-back semantics, auth). Budget it per Provider; don't pretend one write model fits files and GitHub REST.
- **Contract designed in the abstract.** Mitigation: *extract, don't design* — bootstrap the ABI from the native reference, then validate against GitHub before generalizing.
- **Relay scope creep.** Multi-tenant auth, tunneling, privacy (task content through a third party). Mitigation: strictly deferred and opt-in.
- **Losing the epicd self-host investment.** Owned explicitly (§11); the rebased dogfood is arguably stronger.
- **MCP as a UI data layer.** Base MCP has no subscriptions; live boards use resources + polling. Accept "poll to refresh," not "push."

---

## 17. Appendix — glossary

See [`glossary.md`](./glossary.md) for the frozen vocabulary. Use those terms verbatim in all subsequent tasks, Skills, and docs to prevent drift.
