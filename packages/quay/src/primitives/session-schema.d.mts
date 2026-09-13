// Type declarations for the byte-identical copy ./session-schema.mjs (see PROVENANCE.md).
// See pty-frame.d.mts for why a sibling declaration file exists instead of in-body annotations.

/** Never throws — callers assert on `.valid` and inspect `.errors` to see why a record was rejected. */
export declare function validateSessionRecord(record: unknown): { valid: boolean; errors: string[] };
