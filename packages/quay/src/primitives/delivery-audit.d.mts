// Type declarations for the byte-identical copy ./delivery-audit.mjs (see PROVENANCE.md).
// See pty-frame.d.mts for why a sibling declaration file exists instead of in-body annotations.

/** Append one record to the audit ledger. Creates the parent directory when needed. */
export declare function appendAuditRecord(auditLogPath: string, record: unknown): void;
/**
 * length + short content hash + bounded first-line preview — never the full payload.
 * A Buffer is hashed/measured over its actual bytes, never routed through JSON.stringify/utf8 first.
 */
export declare function summarizePayload(
  payload: Buffer | string | unknown,
): { length: number; sha256_12: string; firstLine: string };
/** One delivery attempt over a unix socket; the audit record is appended on EVERY exit path. */
export declare function deliver(opts: {
  level: "L1" | "L2";
  who: string;
  target: string;
  socketPath: string;
  payload: string | Buffer | unknown;
  auditLogPath: string;
  timeoutMs?: number;
}): Promise<Record<string, unknown>>;
/** One L2 (keys) delivery over a pty.sock using this module's own frame codec + ledger. */
export declare function deliverKeys(opts: {
  who: string;
  target: string;
  socketPath: string;
  authToken: string;
  bytes: Buffer | string;
  auditLogPath: string;
  timeoutMs?: number;
  authGraceMs?: number;
}): Promise<Record<string, unknown>>;
/** Append a follow-up record correlating a prior delivery with a first observed status change. */
export declare function recordStatusChangeObserved(
  auditLogPath: string,
  deliveryId: string,
  observedAt: string,
): void;
/** Every audit record (initial + any follow-up) for one delivery id. Absent ledger ⇒ []. */
export declare function readAuditTrail(
  auditLogPath: string,
  deliveryId: string,
): Array<Record<string, unknown>>;
