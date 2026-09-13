// cli/server.ts — `quay server status [--json]` (GOAL-017 / AC-251, SPEC §6.8 CLI-first).
//
// WHAT THIS COMMAND IS: the reader half of the unified server's state carrier. It answers ONE
// question — "is the single process that hosts the Web UI and the MCP control plane up, and are
// BOTH of its services actually answering?" — from OUTSIDE that process, using only the carrier
// plus two independent live probes (see server-state.ts). It is the machine criterion of SPEC §7
// stage A2 ("web + control 合入一个进程"): the JSON reports `services[].pid`, and stage A2 is
// landed exactly when `web.pid === control.pid` and both are the live host process.
//
// SCOPE (⛔ deliberately narrow): only `status`. SPEC §6.9's `start` / `add` / `stop` verbs are
// stage B (AC-254) and are NOT implemented here — inventing them now would make stage A introduce a
// new user-visible capability, which §8 criterion 9 forbids. `quay serve`'s own flag surface is
// likewise unchanged (the control-plane port is an env override, not a new flag).
//
// ── 三分法（exit code 是这条命令的契约，不是装饰）────────────────────────────────────────────────
//   0  running       carrier present, host pid alive, web+control both carry that pid, both probes
//                    answered a reading we understand
//   1  not-running   no carrier, or the carrier names a pid that is not alive (the killed-server
//                    case), or the host is alive but a service is not (degraded — §8 criterion 8's
//                    "进程活着" vs "某个服务已停摆" distinction, reported as its own status)
//   3  not-evaluated the carrier exists but could not be read/parsed (硬规则 3b: 读不懂 ≠ 未达成)
// `--json` ALWAYS emits a parseable JSON document on stdout for every one of the three outcomes —
// the exit code carries the verdict, never the absence of output.

import fs from "node:fs";
import path from "node:path";
import { findConfig } from "../config.ts";
import {
  readServerState,
  pidAlive,
  probeWebService,
  probeControlService,
  serverStatePath,
  type ServiceProbe,
} from "../server-state.ts";
import type { CliCtx } from "./context.ts";

/** The two services stage A2 merges; both must be present and carry the host pid for `running`. */
const REQUIRED_SERVICES = ["web", "control"] as const;

export const EXIT_RUNNING = 0;
export const EXIT_NOT_RUNNING = 1;
export const EXIT_NOT_EVALUATED = 3;

interface ServiceReport {
  name: string;
  pid: number | null;
  host: string;
  port: number;
  liveness: ServiceProbe;
}

/** Resolve the workspace root the way every other workspace-scoped command does: `--root` when
 *  given, else an upward walk from the process cwd. Fail-closed — a directory without
 *  `.quay/config.yml` is never silently replaced by cwd (gap-task-list-root-does-not-scope-
 *  config-lookup). Returns null after printing the error (caller exits non-zero). */
function resolveWorkspaceRoot(rootFlag: unknown): string | null {
  const startDir = typeof rootFlag === "string" && rootFlag.length > 0 ? path.resolve(rootFlag) : process.cwd();
  const configPath = findConfig(startDir);
  if (!configPath) {
    process.stderr.write(
      `Error: no .quay/config.yml found (searched from ${startDir} upward) — point --root at a quay workspace root.\n`,
    );
    return null;
  }
  return path.dirname(path.dirname(configPath));
}

/** Non-evaluated liveness for a service whose host process is gone: the probe is NOT run (there is
 *  nothing to probe), and the reading says so rather than reporting a bare `false`. */
function unevaluated(reason: string): ServiceProbe {
  return { evaluated: false, alive: null, source: null, detail: reason };
}

export async function handleServer({ sub, flags, wantsJson }: CliCtx) {
  if (sub !== "status") {
    process.stderr.write(
      `usage: quay server status [--json] [--root <path>]\n` +
        `Run \`quay --help\` for full usage documentation.\n`,
    );
    process.exitCode = EXIT_NOT_RUNNING;
    return;
  }

  const workspaceRoot = resolveWorkspaceRoot(flags.root);
  if (workspaceRoot === null) {
    process.exitCode = EXIT_NOT_RUNNING;
    return;
  }

  const carrierPath = serverStatePath(workspaceRoot);
  const read = readServerState(workspaceRoot);

  let status: "running" | "degraded" | "not-running" | "not-evaluated";
  let reason: string;
  let hostPid: number | null = null;
  let startedAt: string | null = null;
  let services: ServiceReport[] = [];

  if (read.kind === "unreadable") {
    // Carrier present but unreadable / wrong shape — NOT-EVALUATED (硬规则 3b).
    status = "not-evaluated";
    reason = read.reason;
  } else if (read.kind === "absent") {
    status = "not-running";
    reason = read.reason;
  } else {
    hostPid = read.state.pid;
    startedAt = read.state.startedAt;
    if (!pidAlive(hostPid)) {
      status = "not-running";
      reason = `${carrierPath} names pid ${hostPid}, which is not alive (stale carrier — the server was killed without a graceful close)`;
      // Keep the per-service rows (§6.10: 每服务一行) but with NO integer pid — a dead host cannot
      // legitimately report a live service, and `pid:null` is what keeps AC-251's "二者 pid 相同"
      // reading from going green on a corpse.
      services = read.state.services.map((s) => ({
        name: s.name,
        pid: null,
        host: s.host,
        port: s.port,
        liveness: unevaluated(reason),
      }));
    } else {
      const probes = await Promise.all(
        read.state.services.map(async (s): Promise<ServiceReport> => ({
          name: s.name,
          pid: s.pid,
          host: s.host,
          port: s.port,
          liveness:
            s.name === "control"
              ? await probeControlService(s.host, s.port)
              : await probeWebService(s.host, s.port),
        })),
      );
      services = probes;
      const problems: string[] = [];
      for (const name of REQUIRED_SERVICES) {
        if (!probes.some((p) => p.name === name)) problems.push(`service "${name}" is absent from the carrier`);
      }
      for (const p of probes) {
        if (p.pid !== hostPid) problems.push(`service "${p.name}" reports pid ${p.pid}, not the host pid ${hostPid}`);
        if (!p.liveness.evaluated) problems.push(`service "${p.name}" liveness NOT-EVALUATED: ${p.liveness.detail}`);
        else if (p.liveness.alive !== true) problems.push(`service "${p.name}" is not answering: ${p.liveness.detail}`);
      }
      status = problems.length === 0 ? "running" : "degraded";
      reason =
        problems.length === 0
          ? `pid ${hostPid} hosts ${probes.map((p) => p.name).join(" + ")} on one process`
          : problems.join("; ");
    }
  }

  const exitCode =
    status === "running" ? EXIT_RUNNING : status === "not-evaluated" ? EXIT_NOT_EVALUATED : EXIT_NOT_RUNNING;

  if (wantsJson) {
    process.stdout.write(
      JSON.stringify(
        {
          schemaVersion: 1,
          status,
          reason,
          workspaceRoot,
          carrierPath,
          carrier: read.kind,
          pid: hostPid,
          startedAt,
          services,
        },
        null,
        2,
      ) + "\n",
    );
  } else {
    process.stdout.write(`quay server: ${status.toUpperCase()} — ${reason}\n`);
    process.stdout.write(`  workspace ${workspaceRoot}\n`);
    if (services.length === 0) {
      process.stdout.write(`  (no service rows: the carrier records none)\n`);
    }
    for (const s of services) {
      const liveness = s.liveness.evaluated
        ? s.liveness.alive === true
          ? "alive"
          : "DOWN"
        : "not-evaluated";
      process.stdout.write(
        `  ${s.name.padEnd(8)} pid ${String(s.pid ?? "—").padEnd(8)} ${s.host}:${s.port}  ${liveness} (${s.liveness.source ?? "no probe"}) — ${s.liveness.detail}\n`,
      );
    }
  }

  process.exitCode = exitCode;
}

/** Exported for the test's own teardown bookkeeping — the carrier is runtime state, never tracked. */
export function carrierExists(workspaceRoot: string): boolean {
  return fs.existsSync(serverStatePath(workspaceRoot));
}
