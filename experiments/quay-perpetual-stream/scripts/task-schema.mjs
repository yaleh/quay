// task-schema.mjs — re-export shim for it0-dod-check.mjs (GATE-HASH-REF pinned, Batch 4).
// it0-dod-check.mjs imports extractSection from "./task-schema.mjs"; after the Batch 3
// .mjs→.ts rename, this shim keeps the import path alive by re-exporting from the canonical .ts
// source. Node 25 auto-strips types so this works without a build step (M106/M107 precedent).
export * from "./task-schema.ts";
