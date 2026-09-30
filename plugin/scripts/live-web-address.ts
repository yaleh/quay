// live-web-address.ts — THE single definition point for "what is this root's live web address".
//
// WHY THIS FILE EXISTS (gap-criterion-live-web-address-derivation-17-copies-to-one). A step that
// derives a reachable `host:port` for a RUNNING `quay.ts serve` used to be INLINED in 17 goal
// criteria (`goals/AC-17?`, `AC-28?..AC-303-*`), and it had already split into THREE semantically
// different variants:
//
//   · `up === false` (a carrier with NO `up` field PASSES) vs `up !== true` (it does not) — the two
//     answer the SAME missing field in OPPOSITE directions (hard rule 6: a missing value is "not
//     checked", never "false");
//   · a `require()`-based copy that dropped the `schemaVersion` gate, the host/port validation and
//     the try/catch entirely, so a corrupt carrier threw a stack instead of reporting a readable
//     refusal (hard rule 3b: "cannot read it" must not share a shape with "read it, fine");
//   · a copy that reused exit code 3 — THIS REPO'S convention for NOT-EVALUATED — to mean
//     "carrier-pid-mismatch".
//
// 5h40m after the first wave, a SECOND wave of 4 tasks had to re-anchor the same step (one of them
// is still `needs-human`), which is the measurement that the per-instance fix does not converge
// (hard rule 5b: the defects are clustered; fixing the one that was reported is not fixing them).
//
// So the derivation lives here ONCE and the criteria CALL it. The carrier is read as the DIRECT
// measurement of the live host's own state (hard rule 4b: `.quay/server.json` is written by the
// running `packages/quay/src/serve.ts`, whose read contract is `packages/quay/src/server-state.ts`);
// ⛔ the workspace config is the EXPECTED state and is deliberately NOT consulted here.
//
// THREE-STATE OUTPUT (hard rule 3b). The caller must be able to tell "the carrier is not
// evaluable here" from "the carrier reads fine and says the web service is down":
//
//   exit 0  stdout `<host>:<port>`   — evaluable; the address the carrier names.
//   exit 3  stderr `<sub-state>`     — NOT-EVALUATED (this repo's `checker-mechanical-spine-check`
//                                      word list: 0=pass / 1=fail / 2=usage / 3=not-evaluated).
//                                      Sub-states: carrier-absent / carrier-unreadable /
//                                      carrier-pid-mismatch / carrier-no-web-service /
//                                      carrier-web-up-absent / carrier-web-address-unusable.
//   exit 1  stderr `carrier-web-down`— the carrier is well-formed AND explicitly marks the web
//                                      service down: a REAL false, not an unknown. The caller
//                                      decides whether that is a refusal of its own.
//   exit 2  stderr `<usage>`         — usage error (bad argv).
//
// The host is emitted VERBATIM from the carrier (no `0.0.0.0` → `127.0.0.1` rewriting here): this
// helper answers "what does the live host say", and a caller that wants a probe-ready address does
// its own normalization. Keeping the raw value is also what makes `expect`-style byte comparison
// against `quay server status --json` meaningful.
//
// Usage (the criteria invoke it exactly this way):
//   node --experimental-strip-types <repo>/plugin/scripts/live-web-address.ts <root> [<expected-pid>]
//
// ⛔ Keep this file a LEAF (node builtins only) — it is spawned by 17 criteria and must not drag a
// dependency graph behind it. The pure function is exported so `plugin/test/live-web-address.test.mjs`
// can drive it directly; the CLI wrapper below is the ONLY caller of `process.exit`.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The carrier's path, relative to the workspace root. The writer is `packages/quay/src/serve.ts`;
 *  the read contract (shape + the three-way read outcome) is `packages/quay/src/server-state.ts`. */
export const CARRIER_RELATIVE_PATH = path.join(".quay", "server.json");

/** Every NOT-EVALUATED sub-state this helper can report. Enumerated (⛔ not a boolean "ok/not-ok")
 *  so a caller can name the exact reason, and so the exit-3 word list can never collapse two
 *  different unreadabilities into one string (hard rule 3b). */
export type LiveWebAddressSubState =
  | "carrier-absent"
  | "carrier-unreadable"
  | "carrier-pid-mismatch"
  | "carrier-no-web-service"
  | "carrier-web-up-absent"
  | "carrier-web-address-unusable";

/** The discriminated outcome. `state` is the three-state field (hard rule 3b): `address` (exit 0),
 *  `not-evaluated` (exit 3) and `web-down` (exit 1) are three DIFFERENT values — a caller that only
 *  handled "ok" and "not ok" would fold the last two together, which is exactly the defect this
 *  file removes. */
export type LiveWebAddressResult =
  | { state: "address"; address: string }
  | { state: "not-evaluated"; subState: LiveWebAddressSubState }
  | { state: "web-down"; subState: "carrier-web-down" };

/** Derive `<root>`'s live web address for `expectedPid` (omit the pid to skip the owner check).
 *
 *  PURE with respect to the workspace: it reads ONE file, never spawns, never touches the network.
 *  The verdict about the PAGE is the caller's (the criteria fetch the address over HTTP); this
 *  function answers only "what address does the live host's own carrier name". */
export function deriveLiveWebAddress(root: string, expectedPid?: string | null): LiveWebAddressResult {
  const carrierPath = path.join(root, CARRIER_RELATIVE_PATH);

  let raw: string;
  try {
    raw = fs.readFileSync(carrierPath, "utf8");
  } catch {
    // Absent and unreadable-but-present are DIFFERENT sub-states: a missing carrier is "no live
    // host here", an unreadable one is "something is there and I could not read it". Collapsing
    // them would make a permissions/ENOSPC fault indistinguishable from a clean no-instance root.
    return { state: "not-evaluated", subState: fs.existsSync(carrierPath) ? "carrier-unreadable" : "carrier-absent" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: "not-evaluated", subState: "carrier-unreadable" };
  }

  // Schema gate: the shape `server-state.ts` owns. A carrier that does not carry the current
  // schemaVersion is not "an old-but-usable address" — it is an input this helper cannot read.
  if (parsed === null || typeof parsed !== "object") return { state: "not-evaluated", subState: "carrier-unreadable" };
  const carrier = parsed as { schemaVersion?: unknown; pid?: unknown; services?: unknown };
  if (carrier.schemaVersion !== 1 || !Array.isArray(carrier.services)) {
    return { state: "not-evaluated", subState: "carrier-unreadable" };
  }

  // Owner gate: a carrier is only trustworthy for the pid it names (a stale carrier from a previous
  // instance would otherwise hand back a dead address that looks as good as a live one).
  if (expectedPid !== undefined && expectedPid !== null && String(carrier.pid) !== String(expectedPid)) {
    return { state: "not-evaluated", subState: "carrier-pid-mismatch" };
  }

  const web = (carrier.services as unknown[]).find(
    (s): s is { name?: unknown; host?: unknown; port?: unknown; up?: unknown } =>
      s !== null && typeof s === "object" && (s as { name?: unknown }).name === "web",
  );
  if (!web) return { state: "not-evaluated", subState: "carrier-no-web-service" };

  // THE missing-field semantic, unified: `up` absent (or not a boolean) is NOT "down" — a missing
  // value is "not checked" (hard rule 6). Only an explicit `false` is a real false. The three
  // inlined variants disagreed here, which is the reason this file exists.
  if (web.up === false) return { state: "web-down", subState: "carrier-web-down" };
  if (web.up !== true) return { state: "not-evaluated", subState: "carrier-web-up-absent" };

  const host = web.host;
  const port = web.port;
  if (
    typeof host !== "string" || host === "" ||
    typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535
  ) {
    return { state: "not-evaluated", subState: "carrier-web-address-unusable" };
  }

  return { state: "address", address: `${host}:${port}` };
}

/** CLI wrapper. Returns the process exit code (the caller is `main`). Kept separate from the pure
 *  function so a test can drive either the function or the real spawned CLI. */
export function runLiveWebAddressCli(argv: readonly string[]): number {
  const [root, expectedPid] = argv;
  if (!root) {
    process.stderr.write("usage: live-web-address.ts <workspace-root> [<expected-pid>]\n");
    return 2;
  }
  const result = deriveLiveWebAddress(root, expectedPid ?? null);
  if (result.state === "address") {
    process.stdout.write(result.address);
    return 0;
  }
  process.stderr.write(result.subState + "\n");
  return result.state === "web-down" ? 1 : 3;
}

/** `isMain` guard: importing this module (the test does) must never exit the importing process.
 *  ⚠️ `fileURLToPath(import.meta.url)` is the REALPATH (Node resolves symlinks), so the argv side is
 *  `fs.realpathSync`d too — the house convention compares `path.resolve(argv[1])`, which is FALSE
 *  whenever the caller spells the script through a symlinked directory (`/home/…` → `/data/…` on
 *  this host) and would silently turn every CLI invocation into a no-op exit 0. The realpath
 *  comparison is the shape that cannot fail that way. */
function isMain(): boolean {
  const argv1 = process.argv[1];
  if (!argv1) return false;
  const self = fileURLToPath(import.meta.url);
  try {
    return fs.realpathSync(argv1) === self;
  } catch {
    return path.resolve(argv1) === self;
  }
}

if (isMain()) {
  process.exit(runLiveWebAddressCli(process.argv.slice(2)));
}
