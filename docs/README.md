# docs/ — what's in here

This directory holds four different registers of material. They are not interchangeable, and a
reader coming from the root `README.md` only needs the first row.

| Directory | Register | Audience | Status |
|---|---|---|---|
| [`proposals/`](proposals/) | Design proposals | Anyone evaluating quay's architecture | Mixed — a handful are canonical (below), most are dated BAIME-experiment proposals. Not individually marked live/historical; open one and check for a retirement banner before citing it as current. |
| [`plans/`](plans/) | Per-milestone implementation plans | Historical — cited by old `tasks/*.md`/`milestones/*/iterations/*.md` | **Entirely historical.** All 66 files plan work under the classic milestone loop, retired by ADR-022 (2026-08-03). See [`plans/README.md`](plans/README.md). |
| [`analysis/`](analysis/) | Research notebook | The BAIME methodology experiment itself | Live, growing. One-off investigations, baselines, session handoffs — primary-source research exhaust, not curated reference material. |
| [`references/`](references/) | Load-bearing reference docs | Anyone implementing against quay's schema/ABI, or reading the GIT theoretical framework | Live. `task-schema-canonical.md` and `repo-ground-truth.md` are operational references; the two Chinese-language essays are the deeper theoretical track behind `adr/ADR-006`. |

## Where to actually start

- **Using quay**: the root [`README.md`](../README.md) is self-contained; you don't need anything in this directory.
- **quay's architecture**: [`proposals/quay-proposal.md`](proposals/quay-proposal.md) (Core/Provider-ABI design) and [`proposals/quay-native-design.md`](proposals/quay-native-design.md) (the native Provider), plus [`proposals/glossary.md`](proposals/glossary.md) for terminology.
- **quay's own development methodology (BAIME)**: [`proposals/quay-perpetual-stream-experiment-v5.md`](proposals/quay-perpetual-stream-experiment-v5.md) is the current protocol; `experiments/quay-perpetual-stream/` holds its running state.
- **Refactoring a package/module (ownership-first + `branch:true` Goal verification)**: [`references/ownership-first-refactoring-methodology.md`](references/ownership-first-refactoring-methodology.md) — validated via GOAL-030 and GOAL-031's real pilots (ArchGuard before/after, negative control, branch self-host proof).
- **Why a rule exists**: [`epistemology-casebook.md`](epistemology-casebook.md) — the forensic record behind `CLAUDE.md`'s "认识论硬规则" table (dates, incidents, cost). Not auto-injected into any session; read it when a rule's one-line summary in `CLAUDE.md` isn't enough context.
- **The Web UI**: [`webui-guide.md`](webui-guide.md).

## Not yet indexed

`proposals/` (48 files) and `analysis/` (56 files) are flat directories with no per-file live/historical marking beyond whatever banner each file happens to carry. Treat anything in them as dated project history unless the root README or `CLAUDE.md` names it canonical.
