// word-count.ts — ADR-012 TS-migration-tooling-phase demonstrator module.
//
// Purpose: a trivial, leaf, standalone-behavior .ts module (NOT a rewrite of
// any existing product file) whose only job is to PROVE, with a real command
// + real captured output, that:
//   1. Node 25's native TypeScript type-stripping runs a `.ts` module
//      directly via `node` with NO separate build/transpile step (see the
//      milestone's ABSORB entry for the captured `node` invocation), and
//   2. `node --test` runs a sibling `.test.ts` file directly, same guarantee.
// P1+ (still human-steered, out of this milestone's scope) is where real
// product leaf modules get migrated the same way.
export function wordCount(input: string): number {
  const trimmed = input.trim();
  if (trimmed === "") return 0;
  return trimmed.split(/\s+/).length;
}
