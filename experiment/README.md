# Quay-Native Bootstrap — BAIME Experiment

- **Status:** In progress; NOT CONVERGED — see the highest-numbered report in `experiment/iterations/` for the most recent full state and iteration count, and `ls tasks/QN-*.md | wc -l` for the current allocated native task ID count (native + GitHub Providers both built and running). (Fixed hardcoded counts here were found stale on a recurring basis — QN-049/050/051/053/054/056 — so this line is now phrased to always point at its own source of truth instead of needing a per-iteration re-edit.)
- **Date:** 2026-07-15
- **Owner:** Yale Huang
- **Protocol:** [`../docs/proposals/quay-bootstrap-experiment.md`](../docs/proposals/quay-bootstrap-experiment.md) (authoritative — this file operationalizes it, it does not redefine it)
- **Related:** [`quay-proposal.md`](../docs/proposals/quay-proposal.md) · [`quay-native-design.md`](../docs/proposals/quay-native-design.md) · [`glossary.md`](../docs/proposals/glossary.md)
- **Iteration prompts:** [`ITERATION-PROMPTS.md`](./ITERATION-PROMPTS.md)

> Frozen vocabulary applies (see `glossary.md`). Do not rename Provider, Skill, status, lane, action button, capability, run, task.

---

## 1. Domain

This experiment runs the development of **quay-native** (the reference Provider: task store + Skills + ABI + gates) as a BAIME (Bootstrapped AI Methodology Engineering) experiment, driven by the `methodology-bootstrapping` skill. It is a **self-hosting bootstrap**, not an ordinary BAIME domain — see protocol §2 for the full identity argument.

### Instance objective (Agent layer)

Implement **quay-native**: a Claude-Code-first task Provider —

- a markdown + frontmatter task store (one file per task, canonical view-model per `quay-native-design.md` §2, §7.1 of the proposal),
- a two-layer Skill set (Layer 1 operation Skills: `write-proposal`, `review-proposal`, `write-plan`, `review-plan`, `implement`, `adjudicate`; Layer 2 orchestration Skills: `quay:author`, `quay:execute`),
- a data-only MCP ABI (`task_list` / `task_get` / `task_write` / `task_check` / `provider://manifest`),
- a machine-checkable `quay-native task check` gate asserting the `todo → ready` (author) and `ready → done` (execute) transitions.

### Meta objective (Meta-Agent layer)

quay-native's own Skills, once they exist, must progressively take over **authoring and executing quay-native's own remaining backlog**. The deliverable *is* the methodology:

```
M(Q) = Q
```

"Use the methodology to build the artifact" = "use quay-native to build quay-native." The meta goal is a **distinguished subgoal** of the instance goal — quay-native's own development backlog is one of the task backends quay-native must successfully drive to `done` (protocol §2, §2.1).

### The identity: instance ⊇ meta, but never collapsed

| Situation | Meaning |
|---|---|
| V_instance high, V_meta low | A working, ABI-symmetric, gate-passing quay-native exists — but it was hand-built (seed-driven), not self-built. |
| V_meta high | The closed loop holds: features authored + executed by quay-native itself, gated by its own gate, seed withdrawn. |

Both layers are scored **independently** every iteration (protocol §5). Collapsing them destroys the signal — see guardrail G2.

---

## 2. Baseline (repo state at iteration 0 start)

The repository currently contains only:

```
docs/proposal/           # glossary, proposal, native design, this experiment's protocol
.manda/                  # manda workspace config (daemon armed for this workspace)
```

No code, no `.quay/`, no `tasks/`, no Skills exist yet. **Iteration 0 starts from zero** — this is expected and correct (protocol §9): the baseline is a seed-driven v0 walking skeleton, not a mature system. Low baseline V_meta (~0.15–0.25) is normal and honest, not a failure.

---

## 3. The bootstrap ladder (σ)

The convergence variable is **σ** — the fraction of quay-native's own tasks whose `{author_by, execute_by, gate_by}` provenance triple is fully `{native, native, native}`. σ is counted **per task** (decision §10.1 of the protocol — one task = one provenance record), never asserted, always computed from `provenance.md`.

| Stage | σ | Driver | Deliverable |
|---|---|---|---|
| **0 — seed** | 0 | BAIME + epicd Skills (`authoring-convergence`, `fixpoint-convergence`, `adjudicate`) via manda + human review | v0 walking skeleton: `.quay/config.yml` enables native → `quay-native mcp` → `quay serve` list/detail → action button → Claude Code session runs a `quay:*` Skill → task reaches `done` |
| **1** | small | `quay:author` (initial port) self-hosts authoring; execution still seed-driven | quay-native stores its own backlog as tasks; `data.write` capability |
| **2..k** | rising | `quay:author` + `quay:execute` + gate self-host; epicd seed retired **per-Skill**; quay-native starts driving the build of the GitHub Provider | v1: native + GitHub Provider both run |
| **fixpoint** | → 1 | next increment built with zero seed involvement | self-hosting achieved, subject to **human** fixpoint sign-off |

Seed retirement is **per-Skill**, not all-or-nothing: `quay:author` self-hosts first (author-side seed retires before execute-side). Intermediate provenance states such as `{native, seed, native}` are expected and valid (protocol §10.2).

---

## 4. Dual-layer value functions

Both target **≥ 0.80**. Scores are evidence-based; low baseline scores are expected and acceptable.

### V_instance — does quay-native work?

```
V_instance = skeleton × abi_symmetry × gate_correctness × skill_convergence
```

| Component | Evidence source |
|---|---|
| `skeleton` | The v0 loop runs end-to-end (`config → mcp → serve → action → Skill → done`). |
| `abi_symmetry` | `quay-native task … --json` emits the same schema as the corresponding MCP tool result; CLI is the golden test harness. |
| `gate_correctness` | `quay-native task check <id>` correctly asserts the `author → ready` and `execute → done` gates. |
| `skill_convergence` | `quay:author` / `quay:execute` drive real tasks to a green gate within bounded rounds. |

### V_meta — does quay-native build quay-native?

```
V_meta = completeness × effectiveness × reusability × validation
```

| Component | Measured as | Held-out discipline |
|---|---|---|
| `completeness` | Methodology (Skills + gates + decomposition rule) fully documented and self-contained. | — |
| `effectiveness` | Speedup building feature N+1 *via quay-native* vs. ad-hoc / seed. | Measured on the **marginal increment only**, against the **measured** stage-0 seed pace (not a guess). |
| `reusability` | The methodology transfers to a **second Provider: GitHub issues** — v1 only, no third toy backend. | Measured on the **transfer target only**, never the accumulated artifact. |
| `validation` | Self-host proof: σ and the provenance log. | Corroborated by out-of-band audit (adjudicate co-sign + human fixpoint sign-off). |

**Guardrail G2 (critical):** V_meta is measured on the marginal increment and the transfer target — **never** on the cumulative artifact. A mediocre methodology that happens to yield a working cumulative tool must not score high on both layers.

---

## 5. Held-out declaration

The **GitHub Provider** is the experiment's held-out reusability target (protocol §5.2, §10.4):

- Building it is itself supposed to be **driven by quay-native** once σ is high enough on the native side — one action, two proofs: instance ABI-stability (native + GitHub both run) and meta transfer (methodology reused unmodified on a second backend).
- No third toy backend is in scope until the ABI is declared stable (proposal §14).
- The project is published to GitHub; the GitHub Provider is built against **this repository's own issues** during stages 2..k (protocol §10.1). `gh` (authenticated, user `yaleh`, scopes `repo`+`workflow`) is the CLI substrate — a **stage-2 precondition**, not required before then.

---

## 6. Guardrails (bind every iteration — see protocol §6)

| # | Guardrail | Mechanism |
|---|---|---|
| G1 | The seed cannot be hidden | Per-task provenance log (`experiment/provenance.md`); σ computed from it, never asserted |
| G2 | Metric collapse hides regressions | V_meta measured only on marginal increment + GitHub transfer target |
| G3 | The gate is both contestant and judge | Independent epicd `adjudicate` co-signs every σ lift; written to `experiment/audits/` |
| G4 | Fixpoint ≠ correctness (Trusting Trust) | Human fixpoint sign-off is a separate, mandatory gate — reproduction proves stability, not quality |
| G5 | Walking-skeleton discipline | Iteration 0 ships the seed-driven v0 loop before any self-hosting begins |
| G6 | manda is a precondition, not background | manda daemon live + workspace monitor attached, required from iteration 0 onward |

---

## 7. Convergence criteria (all must hold — protocol §7)

1. **Dual threshold** — V_instance ≥ 0.80 AND V_meta ≥ 0.80.
2. **Self-hosting fixpoint** — σ → 1: next increment built with zero seed, Skill set + gate stable across builds.
3. **Contract proven** — native + GitHub Provider both run.
4. **Out-of-band audit passed** — adjudicate co-sign on every lift + human fixpoint sign-off (separate from criterion 2).
5. **Diminishing returns** — ΔV < 0.02 for 2+ iterations.

---

## 8. Experiment layout

```
experiment/
├─ README.md                  # this file
├─ ITERATION-PROMPTS.md       # iteration prompts encoding the σ ladder
├─ provenance.md              # G1: per-task {author_by, execute_by, gate_by}; source of σ
├─ audits/                    # G3/G4: out-of-band sign-off per σ lift (adjudicate + human)
└─ iterations/
   └─ iteration-N.md          # BAIME 10-section report per iteration
```

`provenance.md` and `iterations/iteration-0.md` are created **during** iteration 0 execution — they do not exist yet.

---

## 9. Preconditions

- **manda daemon live** for this workspace; monitor attached (`http://localhost:28912`) — required from iteration 0 (G6).
- **`gh` CLI authenticated** (user `yaleh`, scopes `repo` + `workflow`) — required only from stage 2 onward (GitHub Provider work), not before.
