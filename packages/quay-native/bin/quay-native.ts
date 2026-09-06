#!/usr/bin/env node
// @ts-nocheck — TS gradual-adoption ramp list (ADR-012): tsc --noEmit real-checked this file and found pre-existing untyped-JS structural diagnostics; fixing them means real JSDoc typing / a product-code touch, out of the tooling-only phase that introduced this gate. Remove this line once this file is migrated/annotated.
// quay-native — the native Provider's binary (glossary.md).
//   `quay-native task …` — raw local file operations (convenience / internal impl).
//   `quay-native mcp`    — starts the MCP server, the formal ABI transport.
// CLI/MCP symmetry (design §6): this file and src/mcp-server.js both call
// into src/store.js — neither has logic the other lacks.

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { createStore, resolveDefaultStatus } from "../src/store.ts";
// ADR/document/contract-validator are generic filesystem-frontmatter stores
// with no dependency on quay-native's task vocabulary (store.js) — they now
// live in `quay` (Core), which needs them standalone for its gate registry
// (ADR-013 / DIR-035-A). quay-native imports them back as a declared
// workspace dependency (`quay` in package.json) — a Provider depending on
// Core's generic utility library, NOT the ABI-violating direction (Core
// reaching into a Provider's task-store internals by relative path).
import { createAdrStore } from "quay/adr-store";
import { createDocumentStore } from "quay/document-store";
import { validateContracts } from "quay/contract-validator";
import { readManifest } from "../src/manifest.ts";
// DIR-098: quay init — workspace scaffolding (shared with Core CLI)
import { runInit, printNextSteps } from "quay/init";

function findRepoRoot(startDir) {
  // Walk upward looking for the workspace marker (.quay/config.yml) so the
  // default tasks dir resolves to the repo root's `tasks/`, not to whatever
  // directory `quay-native` happened to be invoked from. This fixes the
  // CWD-resolution footgun flagged by the independent audit in iteration 2
  // and reconfirmed in iteration 3 (experiments/quay-native-bootstrap/audits/iteration-3-independent-
  // adjudicate.md "New bugs found" #1): omitting QUAY_NATIVE_TASKS_DIR while
  // running from packages/quay-native/ silently resolved tasks from
  // packages/quay-native/tasks/ (a near-empty stray directory) instead of the
  // real repo-root tasks/, producing confusing "not found" gate failures.
  let dir = startDir;
  for (;;) {
    if (fs.existsSync(path.join(dir, ".quay", "config.yml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function resolveTasksDir() {
  // v0: resolve relative to CWD's .quay/config.yml if present, else ./tasks
  // (kept minimal per G5 — a real config loader is `quay` Core's job, not
  // quay-native's; quay-native itself just needs *a* tasks dir).
  const envDir = process.env.QUAY_NATIVE_TASKS_DIR;
  if (envDir) return path.resolve(envDir);
  const repoRoot = findRepoRoot(process.cwd());
  if (repoRoot) return path.resolve(repoRoot, "tasks");
  return path.resolve(process.cwd(), "tasks");
}

function resolveAdrDir() {
  // ADRs live in a directory that SHARES a common parent with tasks/ (a repo-root
  // sibling by default). Env override QUAY_NATIVE_ADR_DIR, else repo-root ./adr.
  const envDir = process.env.QUAY_NATIVE_ADR_DIR;
  if (envDir) return path.resolve(envDir);
  const repoRoot = findRepoRoot(process.cwd());
  if (repoRoot) return path.resolve(repoRoot, "adr");
  return path.resolve(process.cwd(), "adr");
}

function resolveDocsDir() {
  // D1 (exp5-M-CRYST-D1): managed documents live in a directory that SHARES a
  // common parent with tasks/ and adr/ (a repo-root sibling by default), same
  // resolution shape as resolveAdrDir(). Env override QUAY_NATIVE_DOCS_DIR,
  // else repo-root ./docs-managed.
  const envDir = process.env.QUAY_NATIVE_DOCS_DIR;
  if (envDir) return path.resolve(envDir);
  const repoRoot = findRepoRoot(process.cwd());
  if (repoRoot) return path.resolve(repoRoot, "docs-managed");
  return path.resolve(process.cwd(), "docs-managed");
}

function resolveGoalDir() {
  // Goals (SPEC-goal-mechanism-2026-09-06.md §5.2) are now provider-backed: they
  // live in a directory that SHARES a common parent with tasks/ (a repo-root
  // sibling by default, like adr/). Env override QUAY_NATIVE_GOAL_DIR, else
  // repo-root ./goals.
  const envDir = process.env.QUAY_NATIVE_GOAL_DIR;
  if (envDir) return path.resolve(envDir);
  const repoRoot = findRepoRoot(process.cwd());
  if (repoRoot) return path.resolve(repoRoot, "goals");
  return path.resolve(process.cwd(), "goals");
}

/**
 * DIR-047: load the per-provider `default_task_status` from .quay/config.yml.
 * Walks upward from CWD using the same root-finding logic as resolveTasksDir().
 * Returns the validated default status string, or undefined when the key is
 * absent (callers fall back to "todo" via createStore's own storeDefaultStatus
 * logic — one fallback, not two, per ADR-004).
 * Throws a clear error when the key is present but its value is not valid.
 */
function loadDefaultStatus() {
  const repoRoot = findRepoRoot(process.cwd());
  if (!repoRoot) return undefined;
  const configPath = path.join(repoRoot, ".quay", "config.yml");
  if (!fs.existsSync(configPath)) return undefined;
  const raw = fs.readFileSync(configPath, "utf8");
  const cfg = YAML.parse(raw);
  const providers = cfg?.providers ?? {};
  // Find the enabled provider (mirrors activeProvider() in quay/src/config.js).
  const enabledKey = Object.keys(providers).find((k) => providers[k].enabled);
  if (!enabledKey) return undefined;
  const raw_default = providers[enabledKey]?.default_task_status;
  if (raw_default === undefined || raw_default === null) return undefined;
  // resolveDefaultStatus() throws a clear error on illegal values — fail closed.
  return resolveDefaultStatus(String(raw_default));
}

function printJson(obj) {
  process.stdout.write(JSON.stringify(obj, null, 2) + "\n");
}

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

async function main() {
  const [, , cmd, sub, ...rest] = process.argv;

  if (cmd === "mcp") {
    const { startMcpServer } = await import("../src/mcp-server.ts");
    // DIR-047: load and validate the per-provider default_task_status from
    // .quay/config.yml, then pass it to the MCP server so task_write (status
    // omitted on a new task) uses the same configured default as the CLI.
    const defaultStatus = loadDefaultStatus();
    await startMcpServer({ tasksDir: resolveTasksDir(), adrDir: resolveAdrDir(), goalDir: resolveGoalDir(), defaultStatus });
    return;
  }

  if (cmd === "adr") {
    const adrStore = createAdrStore(resolveAdrDir());
    const { flags, positional } = parseFlags(rest);

    if (sub === "list") {
      // E3: `--applies-to <path>` is the consult surface — filter to ADRs
      // whose `applies-to` glob(s) match the given repo-relative path (see
      // adr-store.js#appliesToMatches). Composable with --status/--tag.
      const adrs = adrStore.list({ status: flags.status, tag: flags.tag, appliesTo: flags["applies-to"] });
      if (flags.json) printJson(adrs);
      else for (const a of adrs) console.log(`${a.id}\t${a.status}\t${a.title}`);
      return;
    }
    if (sub === "get") {
      const a = adrStore.get(positional[0]);
      if (!a) { console.error(`no such ADR: ${positional[0]}`); process.exitCode = 1; return; }
      if (flags.json) printJson(a);
      else { console.log(`${a.id}: ${a.title} [${a.status}]`); console.log(a.body); }
      return;
    }
    if (sub === "write" || sub === "new" || sub === "edit") {
      const id = positional[0];
      const patch = {};
      if (flags.title !== undefined) patch.title = flags.title;
      if (flags.status !== undefined) patch.status = flags.status;
      if (flags.date !== undefined) patch.date = flags.date;
      if (flags.supersedes !== undefined) patch.supersedes = String(flags.supersedes).split(",").filter(Boolean);
      if (flags["superseded-by"] !== undefined) patch.supersededBy = String(flags["superseded-by"]).split(",").filter(Boolean);
      if (flags.tags !== undefined) patch.tags = String(flags.tags).split(",").filter(Boolean);
      if (flags["body-file"] !== undefined) patch.body = fs.readFileSync(flags["body-file"], "utf8");
      else if (flags.body !== undefined) patch.body = flags.body;
      const a = adrStore.write(id, patch);
      if (flags.json) printJson(a);
      else console.log(`wrote ${id}`);
      return;
    }
    console.error(`unknown adr subcommand: ${sub}`);
    process.exitCode = 1;
    return;
  }

  if (cmd === "doc") {
    const docStore = createDocumentStore(resolveDocsDir());
    const { flags, positional } = parseFlags(rest);

    if (sub === "list") {
      const docs = docStore.list({ status: flags.status, kind: flags.kind });
      if (flags.json) printJson(docs);
      else for (const d of docs) console.log(`${d.id}\t${d.status}\t${d.kind}\t${d.title}`);
      return;
    }
    if (sub === "get") {
      const d = docStore.get(positional[0]);
      if (!d) { console.error(`no such document: ${positional[0]}`); process.exitCode = 1; return; }
      if (flags.json) printJson(d);
      else { console.log(`${d.id}: ${d.title} [${d.status}]`); console.log(d.body); }
      return;
    }
    if (sub === "write" || sub === "new" || sub === "edit") {
      const id = positional[0];
      const patch = {};
      if (flags.title !== undefined) patch.title = flags.title;
      if (flags.status !== undefined) patch.status = flags.status;
      if (flags.kind !== undefined) patch.kind = flags.kind;
      if (flags.contracts !== undefined) patch.contracts = JSON.parse(flags.contracts);
      if (flags["body-file"] !== undefined) patch.body = fs.readFileSync(flags["body-file"], "utf8");
      else if (flags.body !== undefined) patch.body = flags.body;
      const d = docStore.write(id, patch);
      if (flags.json) printJson(d);
      else console.log(`wrote ${id}`);
      return;
    }
    if (sub === "validate") {
      // D1 Stage 5: the consult surface for contract-validator.js — prints the
      // per-assertion pass/fail table (or the raw {ok, results} JSON), exits
      // 0/1 the SAME way `task check`/gate fns do (fail-closed on a missing
      // document, mirrored from `doc get`'s own not-found branch).
      const id = positional[0];
      const d = docStore.get(id);
      if (!d) {
        if (flags.json) printJson({ ok: false, results: [{ ok: false, reason: `no such document: ${id}` }] });
        else console.error(`no such document: ${id}`);
        process.exitCode = 1;
        return;
      }
      const { ok, results } = validateContracts(d);
      if (flags.json) {
        printJson({ ok, results });
      } else {
        for (const r of results) {
          const verdict = r.ok ? "PASS" : "FAIL";
          const label = r.description ?? r.pattern ?? "(unlabeled)";
          console.log(`${verdict}\t${r.type ?? "?"}\t${label}${r.ok ? "" : `\t${r.reason ?? ""}`}`);
        }
        console.log(`${id}: ${ok ? "PASS" : "FAIL"}`);
      }
      process.exitCode = ok ? 0 : 1;
      return;
    }
    console.error(`unknown doc subcommand: ${sub}`);
    process.exitCode = 1;
    return;
  }

  if (cmd === "manifest") {
    printJson(readManifest());
    return;
  }

  // DIR-098: quay init — scaffold a new workspace (.quay/config.yml + tasks/ dir).
  // No existing config required (that is the whole point of `init`).
  if (cmd === "init") {
    const { flags: initFlags } = parseFlags([sub, ...rest].filter((a) => a !== undefined));

    // --help / -h for init subcommand
    if (sub === "--help" || sub === "-h" || initFlags.help) {
      console.log(`quay-native init — scaffold a new quay workspace

Usage:
  quay-native init [--force] [--dry-run] [--root <path>]

Flags:
  --force      Overwrite existing .quay/config.yml if present.
  --dry-run    Print the generated config to stdout without writing to disk.
  --root <path>  Scaffold at <path> instead of the current working directory.

Description:
  Creates .quay/config.yml (with all 3 sections: providers, gates, loop) and
  a tasks/ directory at the project root. Auto-detects project type (Node.js /
  Go) to suggest appropriate gate defaults.

  If .quay/config.yml already exists, refuses to overwrite unless --force.

  This command only scaffolds a brand-new EMPTY task store. It does NOT lay
  down the loop mechanism — the canonical path for onboarding an existing
  project onto quay-driven development is the /quay:init skill inside a Claude
  Code session (/quay:init --all --loop). CLI init has no --loop flag.
`);
      return;
    }

    // Collision guard (gap-cli-quay-init-collides-with-the-canonical-slash-quay-init):
    // same silent-swallow defect as Core `quay init` — reject --loop and point at
    // the /quay:init skill (the canonical loop-laydown path) instead of exiting 0.
    if (initFlags.loop) {
      console.error(
        "quay-native init: unrecognized option --loop.\n" +
        "This command only scaffolds a brand-new EMPTY quay task store\n" +
        "(.quay/config.yml + tasks/); it accepts only --force / --dry-run / --root.\n" +
        "\n" +
        "To lay the full quay loop mechanism into an existing project, the canonical\n" +
        "path is the /quay:init skill inside a Claude Code session:\n" +
        "\n" +
        "    /quay:init --all --loop"
      );
      process.exitCode = 1;
      return;
    }

    const targetRoot = typeof initFlags.root === "string" ? initFlags.root : process.cwd();
    const force = initFlags.force === true;
    const dryRun = initFlags["dry-run"] === true;

    try {
      const result = runInit({ root: targetRoot, force, dryRun });

      if (result.outcome === "skipped") {
        console.error(
          `.quay/config.yml already exists at ${result.configPath}. ` +
          "Use --force to overwrite, or --dry-run to preview."
        );
        process.exitCode = 1;
        return;
      }

      if (result.outcome === "dry-run") {
        console.log(result.content);
        console.log(`\n# Dry run — nothing written to disk.`);
        console.log(`# Would create: ${result.configPath}`);
        console.log(`# Would create: ${result.tasksDir}/`);
        console.log(`# Would create: ${result.launchSettingsPath}`);
        console.log(`# Would create: ${result.profilesPath}`);
        return;
      }

      console.log(`Created ${result.configPath}`);
      console.log(`Created ${result.tasksDir}/ (or already existed)`);
      console.log(`Created ${result.launchSettingsPath}`);
      console.log(`Created ${result.profilesPath}`);
      printNextSteps("native", result.tasksDir);
    } catch (err) {
      console.error(`quay-native init: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
    return;
  }

  if (cmd === "task") {
    // DIR-047: load the per-provider default_task_status from .quay/config.yml
    // (validated; throws a clear error on illegal values) and pass it to the
    // store as a single-source default (ADR-004). Undefined when key is absent
    // — createStore falls back to "todo", preserving backward compatibility.
    const defaultStatus = loadDefaultStatus();
    const store = createStore(resolveTasksDir(), { defaultStatus });
    const { flags, positional } = parseFlags(rest);

    if (sub === "list") {
      const tasks = store.list({ status: flags.status, label: flags.label });
      if (flags.json) {
        printJson(tasks);
      } else {
        for (const t of tasks) {
          console.log(`${t.id}\t${t.status}\t${t.role}\t${t.title}`);
        }
      }
      return;
    }

    if (sub === "get") {
      const id = positional[0];
      const t = store.get(id);
      if (!t) {
        console.error(`no such task: ${id}`);
        process.exitCode = 1;
        return;
      }
      if (flags.json) {
        printJson(t);
      } else {
        console.log(`${t.id}: ${t.title} [${t.status}]`);
        console.log(t.body);
      }
      return;
    }

    if (sub === "edit") {
      const id = positional[0];
      if (!id || typeof id !== "string" || id.trim() === "") {
        console.error("task edit: missing required <id> positional argument");
        process.exitCode = 1;
        return;
      }
      const patch = {};
      if (flags.title !== undefined) patch.title = flags.title;
      if (flags.status !== undefined) patch.status = flags.status;
      if (flags.labels !== undefined) patch.labels = String(flags.labels).split(",").filter(Boolean);
      if (flags.parent !== undefined) patch.parent = flags.parent;
      if (flags.body !== undefined) patch.body = flags.body;
      if (flags.children !== undefined) patch.children = String(flags.children).split(",").filter(Boolean);
      if (flags.extra !== undefined) patch.extra = JSON.parse(flags.extra);
      // QN-015: --expect-status wires the CAS option through the CLI path
      // (design §6 symmetry — must match the MCP task_write inputSchema
      // identically). Omitted entirely => patch.expectedStatus stays
      // undefined => store.write()'s existing, unaffected behavior.
      if (flags["expect-status"] !== undefined) patch.expectedStatus = flags["expect-status"];
      if (flags["append-notes"] !== undefined) {
        const t = store.appendNote(id, flags["append-notes"]);
        if (flags.json) printJson(t);
        else console.log(`appended note to ${id}`);
        return;
      }
      try {
        const t = store.write(id, patch);
        if (flags.json) printJson(t);
        else console.log(`updated ${id}`);
      } catch (err) {
        if (err && err.name === "ConflictError") {
          if (flags.json) printJson({ error: "ConflictError", message: err.message, id: err.id, expectedStatus: err.expectedStatus, actualStatus: err.actualStatus });
          else console.error(`CAS conflict: ${err.message}`);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
      return;
    }

    if (sub === "create") {
      const id = positional[0];
      if (!id || typeof id !== "string" || id.trim() === "") {
        console.error("task create: missing required <id> positional argument");
        process.exitCode = 1;
        return;
      }
      const patch = {
        title: flags.title ?? id,
        // DIR-047: omit status when not supplied — the store applies
        // storeDefaultStatus (from .quay/config.yml default_task_status, or
        // "todo" when absent) for new tasks, so there is no ?? "todo" here.
        // An explicit --status flag always wins (undefined → store default,
        // a real string → that string, validated by store.write()).
        status: flags.status,
        labels: flags.labels ? String(flags.labels).split(",").filter(Boolean) : [],
        parent: flags.parent,
        body: flags.body ?? "",
      };
      const t = store.write(id, patch);
      if (flags.json) printJson(t);
      else console.log(`created ${id}`);
      return;
    }

    if (sub === "check") {
      const id = positional[0];
      const result = store.check(id);
      if (flags.json) {
        printJson(result);
      } else {
        console.log(`${result.id}: ${result.ok ? "PASS" : "FAIL"} — ${result.reason}`);
      }
      process.exitCode = result.ok ? 0 : 1;
      return;
    }

    console.error(`unknown task subcommand: ${sub}`);
    process.exitCode = 1;
    return;
  }

  console.error(`usage: quay-native <init|task|mcp|manifest> ...`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err.stack || String(err));
  process.exitCode = 1;
});
