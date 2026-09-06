// quay-native provider: goal-store RE-EXPORT SHIM (SPEC-goal-mechanism-2026-09-06.md §5.2,
// tasks/gap-goal-store-abi-encapsulation-provider-backed).
//
// The goal store's generic implementation lives in Core (`packages/quay/src/goal-store.ts`),
// exactly like adr-store / document-store — a generic filesystem-frontmatter store with no
// dependency on quay-native's task vocabulary. The native Provider exposes goals over the
// Provider ABI by importing that store back here, the SAME declared-direction pattern as
// `quay/adr-store` (a Provider depending on Core's generic utility library, NOT the reverse
// — Core reaching into a Provider's internals by relative path is the ABI-violating direction
// and breaks Core's standalone npm-pack bundle, which ships only packages/quay + plugin).
//
// This file FORWARDS the library surface; the single goal-id/AC-id regex definitions stay in
// Core — no mirror drift (hard rule: one definition, the re-export never copies them).
//
// The goal is PROVIDER-BACKED in the ABI sense (spec §5.2): Core reads/writes goals through
// the provider client (`goal_list` / `goal_get` / `goal_write` / `goal_gate` MCP verbs
// registered in this provider's mcp-server.ts), never by direct store access in the CLI/web
// surface. `goal_gate` runs the record's `criterion` through Core's acceptance runner.

export {
  createGoalStore,
  readGoalConfig,
  VALID_GOAL_STATUSES,
  isGoalId,
  isCriterionId,
} from "../../quay/src/goal-store.ts";
export type { DisposeOld } from "../../quay/src/goal-store.ts";
