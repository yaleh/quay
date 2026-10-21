// canonical-buckets.ts — the ONE canonical bucket set (`P`/`S`/`M`) and its string form, a kernel leaf.
//
// WHY IT LIVES IN THE KERNEL (SPEC §2 P1: 共享原语落点 `packages/quay/src/kernel/`):
// the same three-line body — `BUCKET_ORDER.filter((b) => buckets.has(b)).join("+")` with the
// `size === 0 ⇒ "UNRESOLVED"` guard — plus the same private `BUCKET_ORDER` array existed in TWO
// layers: the methodology-side attribution judge `plugin/scripts/suite-bucket-attribution.ts` and
// the product-side page renderer `packages/quay/src/serve/serve-tests.ts` (routine `semantic-dedup-scan`
// finding `canonical-buckets`, task
// gap-routine-semantic-dedup-scan-canonical-buckets). A third spelling of the same array
// (`BUCKET_ARTIFACT_ORDER` in `plugin/scripts/suite-bucket-select.ts`) documented itself as "same
// order as attribution's BUCKET_ORDER" — the same hand-maintained mirror the regex-escape family
// carried before it was made structural.
//
// The kernel is the only placement both sides can reach. The direction must be plugin → kernel:
// `packages/**` importing `plugin/**` is a REVERSE EDGE (import-graph-check's `reverseEdges`
// ratchet, baselined at 0), so the product-side page cannot import the methodology-side judge.
// This is the same reachability argument that moved `escapeRegExp` to `kernel/regex-escape.ts`.
//
// ⛔ The bucket JUDGMENT (which file belongs to which bucket) is deliberately NOT here. That
// judgment is dispatch-side and travels to the page through the `.quay/suite-bucket-effective.jsonl`
// artifact (see `serve-tests.ts`'s SINGLE-SOURCE-OF-TRUTH note); only the canonical ORDER and the
// string form are shared, because both sides must render/record the same token for the same set.
//
// KERNEL BOUNDARY (import-graph-check 第四规则): this file imports NOTHING. It is a leaf, so it can
// never participate in a value or type cycle.
//
// NOT A CHECKER, NOT AN INSTRUMENT: it answers no question of its own and is deliberately absent
// from the capability catalog's QUESTION table — it is a primitive consumed by instruments that do.

/** The three suite buckets: P = product/deliverable, S = suite infrastructure, M = other mechanism. */
export type Bucket = "P" | "S" | "M";

/** Canonical bucket order for the string form and the dispatch-written artifact (P first, the deliverable). */
export const BUCKET_ORDER: readonly Bucket[] = ["P", "S", "M"];

/**
 * Canonical string form of a bucket set: `P | S | M | P+S | P+M | S+M | P+S+M | UNRESOLVED`.
 * Order is `BUCKET_ORDER`'s, never insertion order; an empty set is `UNRESOLVED` (硬规则 3b: an
 * unreadable attribution must not look like a bucket).
 */
export function canonicalBuckets(buckets: ReadonlySet<Bucket>): string {
  if (buckets.size === 0) return "UNRESOLVED";
  return BUCKET_ORDER.filter((b) => buckets.has(b)).join("+");
}
