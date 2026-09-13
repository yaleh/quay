// Type declarations for the byte-identical copy ./pty-frame.mjs (see PROVENANCE.md).
//
// WHY THIS FILE EXISTS: the root tsconfig sets `allowJs` + `checkJs`, so a `.mjs` pulled in by an
// import is TYPE-CHECKED as part of the program. The four primitives are frozen copies — ⛔ adding a
// `// @ts-nocheck` line or any other annotation would break the byte-identity that
// plugin/scripts/primitives-drift-check.ts enforces. A sibling `.d.mts` is the supported way to say
// "the types of this module are declared here" without touching the implementation: TypeScript maps
// the specifier `./pty-frame.mjs` onto `pty-frame.d.mts` and stops inferring from the body.

/** `UInt32BE(payloadLen) | UInt8(tag) | payload`. */
export declare function encodeFrame(tag: number, payload: Buffer | string | Uint8Array): Buffer;
/** `encodeFrame(1, JSON.stringify(obj))`. */
export declare function encodeCtrl(obj: unknown): Buffer;
/** `encodeFrame(0, bytes)` — raw bytes, no transformation. */
export declare function encodeData(bytes: Buffer | string | Uint8Array): Buffer;
/**
 * Decode as many complete frames as `buffer` currently holds. Never throws on a short buffer:
 * an incomplete tail comes back as `rest` for the caller to prepend to the next chunk.
 */
export declare function decodeFrames(
  buffer: Buffer,
): { frames: Array<{ tag: number; payload: Buffer }>; rest: Buffer<ArrayBufferLike> };
