// run-cli.mjs — shared CLI-runner helper for quay tests (人 2026-08-12 裁定② + root-cause analysis 修 A1).
//
// WHY: 43 test files copied `return { status: err.status ?? 1, ... }` — when execFileSync's child is
// killed by SIGKILL (cgroup OOM) / SIGTERM (parent tree killed) / fork: EAGAIN (TasksMax cap),
// err.status is null and `?? 1` collapses THREE environment failures into "product exited 1",
// so the assertion reports `expected exit 7, got 1` — a false message pointing at the product.
// This helper ENUMERATES the failure sources (never collapses to a boolean status:1), and does NOT
// inherit the parent's stderr (stdio ignore/pipe/pipe) so a CLI's stderr can't leak into the suite log.
//
// A thrown error whose message starts with ENV_FAIL_MARKER means the process NEVER RAN to a product
// verdict — the full-suite-runner's ABORT_PATTERNS matches it and classifies the round as
// reason=infra-error (environment), NOT a product red (no stop-dispatch).

import { execFileSync } from "node:child_process";

export const ENV_FAIL_MARKER = "__ENVFAIL__";

/**
 * Run a quay CLI entry (node <bin> <args>…) and return its outcome. A real numeric exit status is
 * the ONLY thing returned as a product result; environment failures (killed / spawn EAGAIN/ENOMEM /
 * no exit status) THROW an Error tagged with ENV_FAIL_MARKER instead of folding into status:1.
 *
 * @param {string} bin   path to the CLI entry .ts/.mjs (run under `node` — same as the tests do)
 * @param {string[]} args
 * @param {{ timeout?: number, env?: Record<string,string>, cwd?: string }} [opts]
 * @returns {{ status: number, signal: null, stdout: string, stderr: string }}
 */
export function runCli(bin, args = [], opts = {}) {
  try {
    const stdout = execFileSync("node", [bin, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"], // do NOT inherit parent stderr (修 A1 第二半)
      ...opts,
    });
    return { status: 0, signal: null, stdout, stderr: "" };
  } catch (err) {
    // 枚举，不折叠（硬规则 3）：三种互斥来源分开报，绝不折叠成 status:1。
    if (err.signal) throw new Error(`${ENV_FAIL_MARKER} killed by ${err.signal}: ${bin} ${args.join(" ")}`);
    if (err.code === "EAGAIN" || err.code === "ENOMEM")
      throw new Error(`${ENV_FAIL_MARKER} spawn ${err.code}: ${bin} ${args.join(" ")}`);
    if (err.status == null) throw new Error(`${ENV_FAIL_MARKER} no exit status (${err.code ?? "unknown"}): ${bin}`);
    return { status: err.status, signal: null, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}
