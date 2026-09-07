// quay-native provider: meta-store RE-EXPORT SHIM (gap-meta-records-should-be-a-first-class-store-kind-not-a-task-label).
//
// The meta store's generic implementation lives in Core (`packages/quay/src/meta-store.ts`),
// exactly like goal-store / adr-store / document-store — a generic filesystem-frontmatter store
// with no dependency on quay-native's task vocabulary. The native Provider exposes META records
// over the Provider ABI by importing that store back here, the SAME declared-direction pattern as
// `quay/goal-store` (a Provider depending on Core's generic utility library, NOT the reverse —
// Core reaching into a Provider's internals by relative path is the ABI-violating direction and
// breaks Core's standalone npm-pack bundle, which ships only packages/quay + plugin).
//
// This file FORWARDS the library surface; the single meta-id regex and valid-status set stay in
// Core — no mirror drift (hard rule: one definition, the re-export never copies them).

export { createMetaStore, VALID_META_STATUSES } from "../../quay/src/meta-store.ts";
