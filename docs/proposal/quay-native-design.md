# quay-native — Design

- **Status:** Draft (pre-implementation)
- **Date:** 2026-07-15
- **Scope:** The built-in **native** Provider only. See [`quay-proposal.md`](./quay-proposal.md) for the whole system and [`glossary.md`](./glossary.md) for frozen terms.

---

## 1. Purpose & principles

`quay-native` is the reference Provider: a *path + markdown-format convention* plus a two-layer Skill set. It defines the canonical task view-model and doubles as the ABI conformance reference.

**P1 — Claude-Code-first.** `quay-native` is designed for **Claude Code sessions**, consumed through **MCP** and **CLI**. It is the moat (the agentic layer), not a board.

**P2 — No Web concern.** `quay-native` contains **no Web UI design input**. Web is a *Core* concern. The Provider declares **semantics** (there is a `status` field, its allowed values, which are terminal, the `lane`); the Core owns **presentation** (columns, badges, colors). This resolves "no Web concern" vs "Core can still render a good board": the Provider never emits styling, only semantic facts.

**P3 — CLI/MCP symmetry.** Apart from functional subcommands like `mcp`, every task-handling capability exists **identically** in CLI and MCP, so the whole ABI can be driven and asserted from a shell. See §6.

**P4 — Extreme restraint on status.** The stored status set is as small as possible (§3). Anything derivable (epic-ness, "in progress", "awaiting children") is **derived, not stored**.

**P5 — action is a peripheral trigger edge, not core.** See §7. The core of `quay-native` is **tasks + Skills**; action is a thin, decoupled interface between quay (outside a session) and a Claude Code session (inside).

---

## 2. Task model

- **One markdown file per task.** All state attributes live in the YAML frontmatter (following epicd's task-md structure). The body carries the authored artifacts.
- **Mandatory artifacts — every task has all four:**
  - **Proposal** — what/why (the approach).
  - **Plan** — how (phases/stages).
  - **AC** (Acceptance Criteria) — the machine-checkable end-state.
  - **DoD** (Definition of Done) — the standard checklist; `defaults ∪ task-specific`.
- **Frontmatter fields:**

```yaml
id:        TASK-123
title:     ...
status:    todo | ready | done | needs-human      # §3
labels:    [ ... ]                                  # opaque, general-purpose
parent:    TASK-100?                                # relations
children:  [ TASK-124, TASK-125 ]                   # presence ⇒ compound (derived)
```

- **`labels`** are **opaque strings** to `quay-native` — stored and filterable, no built-in semantics. They are reserved for broader use by projects that adopt quay.
- **`role` is derived, never stored:** `children` non-empty ⇒ compound (epic); else primitive (leaf). Re-derived every run, which is what makes late decomposition free (§4).

---

## 3. Status model (4 states, no more)

| status | state meaning | applicable operation | actor |
|---|---|---|---|
| **`todo`** | created; proposal/plan/AC/DoD not yet authored & passed | author | machine (on trigger) |
| **`ready`** | all four artifacts present & reviewed; ready to execute; human gate | execute | human / trigger |
| **`done`** | terminal | — | none |
| **`needs-human`** | soft stop; no machine operation applies (any state may drop here) | — | human |

**Why no `doing`:** leaf execution is **idempotent** — a crashed run leaves the task at `ready` and is simply re-run to resume. "In progress" and "awaiting children" are **derived** (from run state / children), not stored.

**The four artifacts are the gates (machine-checkable, CLI-assertable):**

- **`author → ready`** ⟺ proposal ∧ plan ∧ AC ∧ DoD are all present and passed review.
- **`execute → done`** ⟺ AC satisfied ∧ DoD passed (integration acceptance for epics).

Convergence is therefore a *fact* asserted by `quay-native task check <id>`, not a feeling. This is the runnable meter (ADR-019 lineage), and it is the same surface Skills and tests use (§6).

**status ↔ Skill.** Each machine-actionable status maps to exactly one orchestration Skill: `todo → quay:author`, `ready → quay:execute`. `done` / `needs-human` have no auto Skill. This `status → orchestration-skill` table is the whole "lightweight status convention + Skill set." Note: this mapping is **logical**; how a trigger is *delivered* is a separate, environment-dependent concern (§7).

---

## 4. Epic decomposition

**Where & with what:** decomposition is a **planning** decision — you cannot converge a plan without deciding "one deliverable vs many." So the decompose test lives **inside `review-plan`** (a step of `quay:author`). Test (from epicd): declare an epic only if you can name **≥2 independently mergeable deliverables** whose combined size has real margin over the single-PR ceiling.

**Primary path — decide at authoring:**
- Leaf: plan describes a single deliverable → task reaches `ready`.
- Epic: plan names ≥2 deliverables → at the `author → ready` boundary, create N **`todo`** child tasks linked as `children`; the epic's own AC/DoD rise to **integration level** ("the assembled system satisfies X").

**Late path — decide during execution:** a leaf that `execute` discovers is oversized creates children **in place**. It thereby becomes compound (role re-derived), and its next `execute` run takes the epic branch. **No new status is needed** — this is exactly why `role` is derived and re-checked each run.

**Execution process (epic and children):**

```
epic @ ready → quay:execute  (derived role = compound):
  1. ensure children exist (created at authoring, or created now on a late split)
  2. drive/await each child to done:
       child:  todo → quay:author → ready → quay:execute → done   (same lifecycle, recursive)
       driven by nested dispatch, or by independent triggers
  3. integration acceptance: run epic-level AC + DoD against the assembled system
  4. pass → epic done ;  fail → needs-human (or continue)
```

Child execution is identical to any leaf; recursion is natural. The epic itself carries **no epic-specific stored status** — "awaiting children" is derived from children not all being `done`.

---

## 5. Skills (two layers)

**Layer 1 — operation Skills** (reusable, single-purpose): `write-proposal`, `review-proposal`, `write-plan`, `review-plan`, `implement`, `adjudicate`, … Each runs in its **own subagent (fresh context)** to avoid contamination.

**Layer 2 — orchestration Skills** (one per machine-actionable status): e.g. `quay:author` sequentially dispatches `write-proposal → review-proposal → write-plan → review-plan`, iterating **until the convergence gate (§3) is green**; `quay:execute` implements and self-audits to the `done` gate, and takes the epic branch when compound.

**Contract (write into every Skill):**

- **Orchestration explicitly dispatches operation Skills as subagents.** Fresh context per operation is required (isolation + review independence).
- **Whether the orchestration Skill itself runs in a subagent is the outer environment's call**, not the Skill's. manda already supports subagent nesting; the Skill must not assume it is depth-0. (This supersedes the earlier "orchestrator must be top-level" constraint — that nesting cap was temporary/local.)
- **Environment-capability dependence.** Because orchestration *dispatches*, it requires a **dispatch-capable environment**. A Skill declares the environment capability it needs and defines a degraded fallback for environments without it (§7).
- **Review independence (no self-certification).** `review-*` / `adjudicate` run in subagents **independent of** the corresponding `write-*` / `implement`. The reviewer reads only the artifact + diff and issues a verdict; the author never grades its own homework.
- **Convergence criteria are CLI-assertable** (§3, §6). "Iterate until convergence" must terminate on a machine-checkable condition (e.g. review passes with no new findings for N rounds), assertable via `quay-native task check`.

Skills obviously must know the Provider's status set and the four mandatory artifacts — they read/write task state through the ABI (CLI or MCP), which is the reason symmetry (§6) matters: **Skills and tests share one surface.**

---

## 6. CLI/MCP symmetry & testability

**One core, two thin bindings.** The `task list/get/edit/check` logic is implemented once; the CLI subcommands and the MCP tools are both adapters over it. Neither has logic the other lacks.

**Identical result schema.** `quay-native task … --json` emits **the same schema** as the corresponding MCP tool's structured result. Tests assert on that JSON; the **CLI is the golden test harness** — the entire ABI is driven and checked from a shell.

**Shared locking.** CLI and MCP mutate the same markdown through the **same file lock**; symmetry of interface must not become asymmetry of data integrity.

**Native as conformance reference.** Because native's CLI and MCP are provably symmetric, native is the **ABI conformance target**: the same semantic test suite can later be run against other Providers (which offer only MCP).

**Surfaces (symmetric pairs):**

| capability | CLI | MCP tool |
|---|---|---|
| list | `quay-native task list` | `task_list` |
| get | `quay-native task get <id>` | `task_get` |
| write/edit | `quay-native task edit <id> …` | `task_write` |
| gate check | `quay-native task check <id>` | `task_check` |
| — (functional, not symmetric) | `quay-native mcp` | — (this *is* the MCP server) |

---

## 7. Action — a peripheral, decoupled trigger edge

**Definition.** An **action** is a lightweight **message sent from outside a Claude Code session into one**, causing a Claude Code action (typically invoking a Skill). It is a **dumb pipe**.

**Decoupled from status and Skill.** The message *payload* may reference a Skill and a task (e.g. `/quay:author TASK-123`), but the action primitive is agnostic — it neither derives from nor depends on the status model. The `status → Skill` table (§3) is a **logical** convenience for *composing* a payload; it is **not** part of the action mechanism.

**Peripheral, not core.** Action is the **interface between quay (host: Web/CLI, outside the session) and a Claude Code session (inside)**. The **core** of `quay-native` remains **tasks + Skills**. For a file backend there are essentially no backend side-effects beyond editing the markdown (which is `task_write`), so native's actions are **purely trigger-messages**.

**Environment binding (the host owns this, not the Provider).** The same logical trigger renders to different transports by detected capability:

| environment | delivery |
|---|---|
| manda present | send a manda message / dispatch into a (possibly new) **background worker session** — async |
| Claude Code session, no manda | run inline in the current session, or spawn one subagent — sync |
| plain CLI, no agent | degrade: print the command for the user to run, or disable |

`quay-native` **does not know about manda**; it only declares logical triggers. The **host** detects the environment and binds. This is why the manda-present vs manda-absent difference does not leak into the Provider.

**Action buttons (UI).** Just preset messages the host can send: `{ label, payload, whenStatus? }`. The Provider may ship defaults, but they are **peripheral config**, not core semantics. Clicking a button = deliver `payload` into a session via the environment-bound transport. Intent is fired; task state is never optimistically mutated — progress is reflected by the backend + a board refresh.

---

## 8. Open decisions

**Status update (QN-050, iteration 39):** all five items below were, at
the time this document was first drafted, genuinely open questions. Over
the course of this experiment's subsequent iterations, each was resolved —
by its own recommended option, in every case — and has been shipped and
exercised in the actual codebase for many iterations. This section
originally never recorded that; QN-050 closes that documentation gap. The
original question framing is kept below (so the resolved answer can be
read against what was actually being asked), with each item's resolution
and concrete evidence added inline.

1. **native storage format** — track backlog.md frontmatter (recommended, ecosystem-compatible) vs. a fresh minimal schema.
   **RESOLVED: markdown+frontmatter** (the recommended option). See §2's
   own description; every task under `tasks/` is a `.md` file with YAML
   frontmatter (e.g. `tasks/QN-049.md`), implemented in
   `packages/quay-native/src/store.js`.
2. **`needs-human`** — keep as a status (recommended: it suppresses auto-operations) vs. demote to a label.
   **RESOLVED: kept as a first-class status** (the recommended option).
   `packages/quay-native/src/store.js`'s `VALID_STATUSES` includes
   `"needs-human"` as a real status value, exercised repeatedly as a
   genuine terminal soft-stop (see `packages/quay-native/skills/execute/
   SKILL.md`'s own Gaps section for the QN-017, QN-020/021, and
   QN-022/023 exercises).
3. **manda-absent fallback for a trigger** — default to **sync inline run** vs. **print command for manual run**.
   **RESOLVED: both, layered.** `packages/quay/src/action.js`'s own
   header comment documents and implements the full fallback chain (manda
   present → dispatch; Claude Code session, no manda → inline/subagent;
   plain CLI, no agent → print-degrade), exercised across iterations
   13-18 (DIR-004/DIR-005) and extended with the QN-042/DIR-009 mock-log
   mode.
4. **`quay:execute` epic branch** — actively dispatch children (nested manda) and await, vs. only wait for independently-triggered children, vs. support both (recommended: both; the epic's `done` gate is "all children done + integration passes" regardless of who drove them).
   **RESOLVED: both** (the recommended option). `packages/quay-native/
   skills/execute/SKILL.md`'s `executeEpic` pseudocode actively drives
   each child (`driveEach: [driveChildToDone(c, provider) |
   c <- task.children]`); its own Gaps section documents this branch
   genuinely exercised at iterations 5, 8, 9, and 27 (the last closing
   the "epic-level recursive orchestration itself" residual gap).
5. **operation-Skill roster** — exact Layer-1 set (is `decompose` its own Skill or folded into `review-plan`? recommended: folded).
   **RESOLVED: folded** (the recommended option). `packages/quay-native/
   skills/author/SKILL.md` step 4 (`review-plan`) explicitly states "this
   is also where the decompose test lives" and implements it inline; no
   standalone `decompose` Skill file exists anywhere in `packages/
   quay-native/skills/`.

---

## 9. Consistency note

**Action** is a **peripheral trigger edge owned by the host**, not a core Provider ABI capability. `quay-proposal.md` has been aligned to this model (§6.4 defines the trigger edge; §7's ABI is data-only). The core ABI is `task_list / task_get / task_write / task_check + provider://manifest`; triggering is handled at the host boundary (manda-present vs absent binding), never inside the Provider.
