// Shared provider-env resolution (QN-045, closing the gap named in
// DESIGN.md §4.4 / DIR-010's honestly-flagged-but-not-fixed asymmetry).
//
// Resolves a provider's declared `env` map (proposal §10's `.quay/config.yml`
// shape) against the workspace root. Values that look like a relative path
// (start with "./" or "../") are resolved to absolute paths; anything else
// (e.g. "owner/repo") is passed through verbatim. This is what makes adding
// a second, heterogeneous Provider (github) require zero changes to this
// file beyond config — the env-building logic is provider-agnostic.
//
// Previously this logic was duplicated byte-identically in bin/quay.js and
// src/mcp-server.js, while src/serve.js used a THIRD, narrower path: it read
// only `provider.tasks_dir` directly and built a single-key env object
// (`QUAY_NATIVE_TASKS_DIR`), ignoring `provider.env` entirely. A workspace
// config that set `tasks_dir` and `env` to different values would silently
// serve a different task store to the Web UI than to the CLI/MCP legs (named,
// not fixed, in DESIGN.md §4.4 at iteration 33). This module is the single
// shared implementation all three Core bindings now call, closing that gap.

import path from "node:path";

export function resolveProviderEnv(cfg, provider) {
  const env = {};
  for (const [key, value] of Object.entries(provider.env ?? {})) {
    if (typeof value === "string" && (value.startsWith("./") || value.startsWith("../"))) {
      env[key] = path.resolve(cfg.workspaceRoot, value);
    } else {
      env[key] = value;
    }
  }
  return env;
}
