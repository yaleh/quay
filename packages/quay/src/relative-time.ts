// relative-time.ts — the ONE definition of the human-readable "X ago" string
// every surface shares.
//
// gap-routine-semantic-dedup-scan-relative-time-mirror: the same algorithm
// lived under two names, statement-for-statement identical — serve-render.ts's
// `relativeTime` and cli/flags.ts's `relativeTimeCli`. flags.ts documented its
// copy as a DELIBERATE mirror ("kept self-contained here to avoid importing
// serve.js, which starts an HTTP server as a side effect"), but that rationale
// does not apply to a pure leaf: nothing here touches http/config/connectProvider,
// so flags.ts's light-module constraint (it must stay free of the provider graph —
// see flags.test.mjs's spawn-floor guard) is preserved by importing THIS module
// rather than serve machinery. One definition, two re-exports, so a future fix
// (e.g. a bucket change) can no longer reach one name and miss the other.
//
// Semantics are byte-for-byte the two copies it replaces: future timestamps
// clamp to "just now" (elapsed < 0), then the s/m/h/d buckets.
export function relativeTime(ts: number): string {
  const elapsed = Date.now() - ts;
  if (elapsed < 0) return "just now";
  const seconds = Math.floor(elapsed / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
