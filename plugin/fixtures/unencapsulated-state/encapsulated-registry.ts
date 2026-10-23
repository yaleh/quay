// FIXTURE — the ENCAPSULATED-REGISTRY false positive of the unencapsulated-state concern (task
// gap-unencapsulated-state-clue-judge-e2e, GOAL-911 AC-924).
//
// PROVENANCE: two live shapes are mirrored here —
//   1. `DashboardSnapshotStore` (the class that COLLECTED the cluster vendored in true-state-cluster.ts):
//      private `#` fields plus lifecycle methods, i.e. the state exists but has exactly one owner and no
//      reachable inconsistent intermediate;
//   2. frozen registries such as `CONCERN_KIND_REGISTRY` / `CONCERN_KIND_STATES` in
//      docs/analysis/ownership-active-limited-proposal.mjs — an `Object.freeze` table is immutable by
//      construction and is not state at all.
//
// WHY IT IS HERE: a `#entries = new Map()` field fills the clue reader's "mutable collection in a class"
// slot, so the mechanical layer reports a candidate. Only the semantic layer can see that the mutations
// are private and lifecycle-guarded.
//
// ⛔ Do not "fix" this file: the encapsulation is the thing under test. Never imported by production.

export interface RegistryEntry {
  readonly id: string;
  readonly kind: string;
}

/** State with a single owner: private field + lifecycle methods. */
export class EncapsulatedRegistry {
  readonly #entries = new Map<string, RegistryEntry>();

  register(entry: RegistryEntry): void {
    this.#entries.set(entry.id, entry);
  }

  unregister(id: string): void {
    this.#entries.delete(id);
  }

  get(id: string): RegistryEntry | undefined {
    return this.#entries.get(id);
  }

  size(): number {
    return this.#entries.size;
  }
}

/** An immutable table — never mutated, so it is not state at all. */
export const CONCERN_KIND_REGISTRY_FIXTURE = Object.freeze([
  Object.freeze({ id: "package-cycle", kind: "package-cycle" }),
  Object.freeze({ id: "unencapsulated-state", kind: "unencapsulated-state" }),
]);
