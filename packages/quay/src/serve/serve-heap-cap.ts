// serve-heap-cap.ts — THE single implementation of the serve host's in-memory ceiling
// (`NODE_OPTIONS=--max-old-space-size=…`).
//
// THE DEFECT THIS CLOSES (`.quay/routine-findings.jsonl` finding `serveheapcapmb-cross-layer-copy`,
// routine `semantic-dedup-scan`, runId `semantic-dedup-scan-1791821278116`, 2026-10-12): the unified
// serve host has TWO spawn sites and each carried a byte-identical copy of this derivation —
//
//   spawn site                                     copy
//   ───────────────────────────────────────────    ─────────────────────────────────────────
//   packages/quay/src/cli/server.ts   spawnHost    serveHeapCapMb + withServeHeapCap
//   plugin/scripts/start-drivers.ts   startServe   serveHeapCapMb + withServeHeapCap
//
// Two copies of a POLICY is the drift (⛔ this is not a leaf constant: `4096`/`512`/`5` are the
// incident-derived numbers from the 2026-09-17 global-OOM remediation, so a future retune of either
// ceiling silently lands on one spawn site only). Same defect shape, and same fix, as
// gap-server-host-spawn-discards-stdio-while-start-drivers-logs-to-serve-log — whose resolution
// (`serve-log.ts`) is this file's template. 硬规则 5b: the fix is the shared source, not a second
// correct-looking copy that agrees today and drifts later.
//
// ⛔ WHY NOT THE OBVIOUS TARGET — measured, not argued. The finding's `suggestedAction` was
// "start-drivers.ts should import withServeHeapCap from packages/quay/src/cli/server.ts". That one
// import edge buys the constant and pays for the WHOLE host: `cli/server.ts` statically reaches
// serve.ts + serve-handlers.ts + serve-board.ts + serve-dashboard.ts + observation.ts +
// control-plane-http.ts + config.ts + provider-client.ts, and esbuild (`bundle: true`, see
// packages/quay/scripts/build-plugin-dist.mjs) INLINES that closure into the shipped
// `plugin/scripts/dist/start-drivers.js`. Measured on this host 2026-10-13 by bundling both variants
// with the real config: 32,143 B → 784,043 B (24×) — i.e. the entire Web UI host inlined into the
// driver-startup script, for a two-line function.
//
// ── WHY A CORE LEAF (the established pattern: serve-log.ts / serve-binding.ts / systemd-scope.ts)
//   ① Core (`cli/server.ts`) may NOT statically import `plugin/**` (import-graph-check's reverseEdges
//      ratchet), so the shared implementation cannot live on the kernel side.
//   ② `plugin/` → `packages/` IS the accepted direction, and esbuild inlines this module into the
//      shipped `dist/start-drivers.js` — "the installed bundle is self-contained" and "there is one
//      implementation" are not in conflict.
//   ③ ⛔ LEAF DISCIPLINE (same rule as serve-log.ts): node builtins only. This module is imported
//      from BOTH sides of the kernel↔target boundary, so an import edge of its own would put cycle
//      risk on import-graph-check's zero-SCC baseline for no benefit.
//
// ⛔ NOT A LITERAL (硬规则 4 推论二): the ceiling is DERIVED from the host's MemTotal, so it stays a
// real ceiling (or a real absence of one) on a different machine instead of silently meaning
// something else there. Floor 512 MB so a small host still boots; cap 4 GB so a huge host cannot let
// one instance eat the box.
//
// A host that trips this aborts ITSELF (V8 OOM) instead of dragging the kernel into an
// unattributable global OOM — a loud, attributable failure instead of an unattributable one.

import os from "node:os";

/** The serve host's heap ceiling in MB: a fifth of MemTotal, clamped to [512, 4096].
 *  ⛔ Both spawn sites take this from HERE (see the file header) — never a second copy. */
export function serveHeapCapMb(): number {
  return Math.min(4096, Math.max(512, Math.round(os.totalmem() / (1024 * 1024) / 5)));
}

/** The `NODE_OPTIONS` value for a spawned serve host: preserve whatever the caller already set
 *  (⛔ never clobber a pre-existing flag) and append the host-derived heap ceiling. */
export function withServeHeapCap(existing: string | undefined): string {
  return [existing, `--max-old-space-size=${serveHeapCapMb()}`].filter(Boolean).join(" ");
}
