## Invariant: invariant-ownership-manifest
- **Rule:** The invariant-ownership manifest is the single source of truth for invariant-to-owner assignment.
- **Authoritative owner:** `experiments/quay-perpetual-stream/invariant-ownership.md` `[authoritative]`
- **Other occurrences:**
  - `plugin/invariant-ownership.md` `[compatibility-adapter]` -- distribution copy for plugin installs

## Invariant: invariant-ownership-enforcement
- **Rule:** The invariant-ownership enforcement script validates the manifest structurally on every DoD check.
- **Authoritative owner:** `experiments/quay-perpetual-stream/scripts/workflow-invariant-ownership.mjs` `[authoritative]`
- **Other occurrences:**
  - `plugin/scripts/workflow-invariant-ownership.mjs` `[compatibility-adapter]` -- distribution copy for plugin installs
