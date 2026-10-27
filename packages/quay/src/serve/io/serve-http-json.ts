// serve-http-json.ts — the ONE JSON-response helper shared by the serve-* route modules.
//
// semantic-dedup-scan (routine finding p015, runId semantic-dedup-scan-1790592211995) found
// `writeJson` as two byte-identical 4-line private definitions in the same package and the same
// HTTP-handler idiom — serve-git.ts and serve-sessions.ts (both bodies hashed to the same
// sha256:86a6e7621e716e40). Extracted here so the status/Content-Type/stringify pairing has a single
// source: a second copy is a second decision table, and only one of them would get a future fix.
//
// ⛔ Do NOT re-inline this in a serve-* module. The sites that look similar but are NOT this helper
// are the three that pair the JSON content type with something else — `serve.ts` (GET /health),
// `serve-dashboard.ts` (the two /cards endpoints, which additionally send `Cache-Control: no-store`)
// — see the AC record in the task for why they stay as they are.

import type { ServerResponse } from "node:http";

/** Send `obj` as a JSON response: write `status` with the JSON content type, then the serialized body. */
export function writeJson(res: ServerResponse, status: number, obj: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}
