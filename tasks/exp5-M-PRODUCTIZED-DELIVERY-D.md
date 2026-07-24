---
id: exp5-M-PRODUCTIZED-DELIVERY-D
title: "Productized delivery child D [human-steered: touches foreign workspace]:
  foreign-workspace Provider-install mechanism + real archguard E2E — an
  observed real Provider-ABI task-status GateEvent flips S3
  External-validation-reach"
status: done
labels:
  - milestone-candidate
  - human-steered
parent: exp5-M-PRODUCTIZED-DELIVERY
children: []
extra:
  schema: v1
---
## Proposal

SPLIT-OR-COMMIT child 4 of [[exp5-M-PRODUCTIZED-DELIVERY]] (DIR-061), attacking chart-2 **S3
External-validation-reach** (`cov = drivable-workspaces-registry workspaces with an observed real ABI
task-status GateEvent / target set`, currently 0.10). Provide a runnable mechanism for a clean FOREIGN
workspace (archguard, the real registered downstream consumer) to install the Provider entrypoints Core
needs to spawn, then prove a real Provider-ABI task-status transition end-to-end from that foreign workspace.

**`human-steered`**: touches a foreign workspace (`/home/yale/work/archguard`) and depends on real installable
published artifacts. Per DIR-027, drive the foreign workspace via the tmux/remote channel and read the RESULT
from the filesystem/`git`/gate-log — never assert it. Depends on [[exp5-M-PRODUCTIZED-DELIVERY-C]] (needs the
real published install path). Registers a real S3 chart-2 Δv.

## Plan
N/A — resolved via a `human-steered` milestone that installs into a real foreign workspace and observes a
real ABI GateEvent. Design surface (bundle providers in the plugin vs. a documented runnable install step)
is a genuine DIR-061 decision — settle it minimally here.

## Acceptance Criteria
- [ ] In a clean foreign workspace (archguard or equivalent), `quay --provider native task list` resolves the
  Provider MCP and returns tasks — output pasted.
- [ ] A real task-status transition is observed via `quay gate-log`/`task get` — the actual GateEvent pasted
  (not "should transition").
- [ ] The install mechanism is stated (bundled-in-plugin OR documented runnable step) and actually run in the
  foreign workspace — the run pasted.
- [ ] DIR-064-A's S3 cov calculator, re-run, counts the newly-validated registry workspace — before/after pasted.

## Definition of Done
Standard inherited-core DoD clauses apply, incl. escrow-Δv and audit-independence. Per DIR-026 Reading A:
"should work" is not done — done ONLY when a real GateEvent from the real foreign workspace exists.
- [ ] Real observed Provider-ABI GateEvent in the real foreign workspace (a real object, read from the
  filesystem/git/gate-log, not TUI-parsed).
- [ ] Real S3 chart-2 Δv registered in a real checkpoint/dashboard entry.
- [ ] Authored `human-steered` (foreign-workspace drive per DIR-027/ADR-016), independently adversarial-audited.
- [ ] it0 DoD meta-enforcer passes all clauses.
- [ ] On landing, [[exp5-M-PRODUCTIZED-DELIVERY]]'s parent DoD (all 5 AC satisfied collectively) is re-checked;
  DIR-061 dispositioned `applied` if complete.
