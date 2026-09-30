// serve-binding.ts — THE single definition point for the `quay serve` web binding (host + port).
//
// THE DEFECT THIS CLOSES (measured 2026-09-30,
// gap-serve-binding-defaults-three-copies-to-one-definition-point): the same quantity — the web
// server's bind default — had THREE definition points, and the host half DISAGREED between them:
//
//   entry                                   host default        port default
//   ─────────────────────────────────────   ─────────────────   ─────────────────────────────
//   packages/quay/src/serve.ts              all-interfaces        kernel-assigned (0)
//   packages/quay/src/cli/server.ts         loopback              (omitted ⇒ 0)
//   plugin/scripts/start-drivers.ts         all-interfaces        0, WRITTEN into every cmdline
//
// The last row is the mechanism behind the seventeen `…criterion-cmdline-port-literal-stale`
// gaps (2026-09-23, all resolved one symptom at a time): each criterion derived a live address
// from the spawned host's `--port` cmdline literal, which was structurally ALWAYS `0` ⇒ a
// permanently-false reading (`addr=…:0`, curl always fails) while the mechanism itself was fine.
//
// ⛔ LEAF DISCIPLINE (same rule as plugin/scripts/code-span-strip.ts): this module imports
// NOTHING. It is reached by serve.ts, cli/help.ts and serve-render.ts, and its predicate is read
// by the static checker, so an import edge here would put cycle risk on import-graph-check's
// zero-SCC baseline for no benefit — every function below is pure and every constant a literal.
//
// PRECEDENCE: an explicit CLI flag > `.quay/config.yml`'s `serve:` section > the fallback below.
// THREE-VALUED OUTPUT (硬规则 3b): a malformed value resolves to `not-evaluated`, NEVER silently
// to the fallback — otherwise 「配错了」 and 「没配」 would be the same reading, and a typo'd
// `serve.port` would bind an arbitrary kernel port looking exactly like "no constraint".

export interface ServeBindingFallback {
  readonly host: string;
  readonly port: number;
}

/** The ONE fallback. Every reader goes through `resolveServeBinding`; this is the only
 *  double-quoted bind-default literal in the serve entry set, enforced by
 *  `plugin/scripts/serve-binding-literal-check.ts`.
 *
 *  serve-default-fallback: the host a `quay serve` host binds when neither `--host` nor
 *  `.quay/config.yml` `serve.host` says otherwise. All-interfaces (⛔ not loopback) because the
 *  LAN/tailscale reachability `gap-ac250-web-observe-tailscale-progress-record` records is a real
 *  usage; tightening the web leg to loopback is a behaviour change needing its own ruling (人
 *  2026-09-30: 默认收敛到 0.0.0.0). `port: 0` = 「不设约束」 in the mechanism, not as a literal
 *  sentinel (硬规则 4 推论二): the kernel assigns an ephemeral port, read back from the handle. */
export const SERVE_BINDING_FALLBACK: ServeBindingFallback = { host: "0.0.0.0", port: 0 };

export type ServeBindingSource = "cli" | "config" | "fallback";

export interface ServeBindingResolved {
  kind: "resolved";
  host: string;
  port: number;
  /** The highest-precedence source that supplied ANY of the two values (`cli` > `config` >
   *  `fallback`). Per-field provenance is in `detail`, for a reader that needs the exact split. */
  source: ServeBindingSource;
  /** `host=<src>, port=<src>` — which field came from where. */
  detail: string;
}

export interface ServeBindingNotEvaluated {
  kind: "not-evaluated";
  /** Why the binding could not be resolved. ⛔ Never a fallback value, never a thrown stack. */
  reason: string;
}

export type ServeBindingRead = ServeBindingResolved | ServeBindingNotEvaluated;

export interface ServeBindingInput {
  /** `--host` as given on the command line (undefined = not given). */
  cliHost?: string;
  /** `--port` as given on the command line, ALREADY numeric (`Number(flag)`; NaN for a non-numeric
   *  flag — that is a bad value, resolved as `not-evaluated`). */
  cliPort?: number;
  /** The parsed `.quay/config.yml` document — the `config` half of `loadConfig()`. */
  config?: unknown;
}

/** A non-blank string, or null (the value is present but unusable). */
function asNonEmptyString(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

/** An integer port in [0, 65535], or null. `0` is legal and means "no constraint". */
function asPort(v: unknown): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 65535 ? v : null;
}

/** Render a bad value for the refusal reason without ever throwing on exotic input. */
function describeValue(v: unknown): string {
  if (typeof v === "string") return JSON.stringify(v);
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  if (typeof v === "object") return "an object";
  return String(v);
}

/** Resolve the web binding from (CLI flags, `.quay/config.yml` `serve:` section, fallback).
 *
 *  Pure and non-throwing: a bad value — a malformed `serve:` mapping, a non-integer/out-of-range
 *  port, a blank host — is reported as `kind: "not-evaluated"` with a reason. Callers MUST refuse
 *  to start on that arm (fail-closed), which is what keeps 「配错了」 distinguishable from 「没配」. */
export function resolveServeBinding(input: ServeBindingInput = {}): ServeBindingRead {
  // ── the config face ──────────────────────────────────────────────────────────────────────────
  let cfgHost: string | undefined;
  let cfgPort: number | undefined;
  const root = input.config;
  if (root !== undefined && root !== null) {
    if (typeof root !== "object" || Array.isArray(root)) {
      return { kind: "not-evaluated", reason: `config must be a mapping, got ${describeValue(root)}` };
    }
    const section = (root as Record<string, unknown>).serve;
    if (section !== undefined && section !== null) {
      if (typeof section !== "object" || Array.isArray(section)) {
        return { kind: "not-evaluated", reason: `config.serve must be a mapping, got ${describeValue(section)}` };
      }
      const s = section as Record<string, unknown>;
      // ⛔ `serveHost` / `servePort` are the ONE read of each `serve:` key, and their names + form are
      // a contract: `plugin/scripts/config-wiring-check.ts` looks for the BINDING `const serve<Cap> =`
      // to answer "does this declared config field have a reader?" — so commenting one of these lines
      // out is exactly what makes that checker report NO_READER for that key (AC7b). Keep ONE binding
      // per key: a second `const serveHost = …` would make the predicate ambiguous.
      const serveHost = s.host;
      const servePort = s.port;
      if (serveHost !== undefined && serveHost !== null) {
        const h = asNonEmptyString(serveHost);
        if (h === null) return { kind: "not-evaluated", reason: `config.serve.host must be a non-empty string, got ${describeValue(serveHost)}` };
        cfgHost = h;
      }
      if (servePort !== undefined && servePort !== null) {
        const p = asPort(servePort);
        if (p === null) return { kind: "not-evaluated", reason: `config.serve.port must be an integer in [0, 65535], got ${describeValue(servePort)}` };
        cfgPort = p;
      }
    }
  }

  // ── the CLI face ─────────────────────────────────────────────────────────────────────────────
  let cliHost: string | undefined;
  let cliPort: number | undefined;
  if (input.cliHost !== undefined) {
    const h = asNonEmptyString(input.cliHost);
    if (h === null) return { kind: "not-evaluated", reason: `--host must be a non-empty string, got ${describeValue(input.cliHost)}` };
    cliHost = h;
  }
  if (input.cliPort !== undefined) {
    const p = asPort(input.cliPort);
    if (p === null) return { kind: "not-evaluated", reason: `--port must be an integer in [0, 65535], got ${describeValue(input.cliPort)}` };
    cliPort = p;
  }

  // ── precedence: CLI flag > config > fallback (per field) ─────────────────────────────────────
  const hostSource: ServeBindingSource = cliHost !== undefined ? "cli" : cfgHost !== undefined ? "config" : "fallback";
  const portSource: ServeBindingSource = cliPort !== undefined ? "cli" : cfgPort !== undefined ? "config" : "fallback";
  const source: ServeBindingSource = hostSource === "cli" || portSource === "cli"
    ? "cli"
    : hostSource === "config" || portSource === "config"
      ? "config"
      : "fallback";

  return {
    kind: "resolved",
    host: cliHost ?? cfgHost ?? SERVE_BINDING_FALLBACK.host,
    port: cliPort ?? cfgPort ?? SERVE_BINDING_FALLBACK.port,
    source,
    detail: `host=${hostSource}, port=${portSource}`,
  };
}
