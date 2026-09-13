// The pty.sock wire protocol (design §A.2, task
// fleet-agent-sessions-keys-endpoint's Plan): `frame = UInt32BE(payloadLen) |
// UInt8(tag) | payload`. `tag 0` = DATA (raw terminal bytes, injected exactly
// as typed — includes control bytes like 0x03/SIGINT, never stripped or
// re-encoded). `tag 1` = CTRL (a JSON payload) — auth handshake, resize,
// kill, and server->client ping/pong/hello/live/exit/auth-required all ride
// this tag.
//
// Pure module — no I/O, no socket, no fs. `decodeFrames` is written to be
// fed a growing, possibly-partial buffer (as real socket reads deliver
// bytes): it never assumes a whole frame arrived in one chunk, and it never
// throws on a truncated tail — it just reports what's not decodable yet as
// `rest` so the caller can keep buffering and try again on the next chunk.

const HEADER_LEN = 5; // UInt32BE length + UInt8 tag

/**
 * Encode one frame: `UInt32BE(payload.length) | UInt8(tag) | payload`.
 */
export function encodeFrame(tag, payload) {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const header = Buffer.alloc(HEADER_LEN);
  header.writeUInt32BE(buf.length, 0);
  header.writeUInt8(tag, 4);
  return Buffer.concat([header, buf]);
}

/** `encodeFrame(1, ...)` for a CTRL frame — payload is `JSON.stringify(obj)`. */
export function encodeCtrl(obj) {
  return encodeFrame(1, Buffer.from(JSON.stringify(obj)));
}

/** `encodeFrame(0, ...)` for a DATA frame — raw bytes, no transformation. */
export function encodeData(bytes) {
  return encodeFrame(0, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
}

/**
 * Decode as many complete frames as `buffer` currently holds. Returns
 * `{ frames, rest }`: `frames` is every `{tag, payload}` fully present in
 * `buffer` in order, and `rest` is whatever incomplete tail is left over
 * (a partial header, or a header whose declared payload length hasn't
 * fully arrived yet) — the caller is expected to prepend `rest` to the next
 * chunk it reads and call `decodeFrames` again. Never throws on a short
 * buffer; a buffer with zero complete frames yields `{ frames: [], rest:
 * buffer }` unchanged.
 */
export function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;
  while (buffer.length - offset >= HEADER_LEN) {
    const payloadLen = buffer.readUInt32BE(offset);
    const tag = buffer.readUInt8(offset + 4);
    const frameEnd = offset + HEADER_LEN + payloadLen;
    if (frameEnd > buffer.length) break; // payload not fully arrived yet
    const payload = buffer.subarray(offset + HEADER_LEN, frameEnd);
    frames.push({ tag, payload });
    offset = frameEnd;
  }
  return { frames, rest: buffer.subarray(offset) };
}
