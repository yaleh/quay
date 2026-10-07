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

// Mirrors the Core CLI's own allowlist (packages/quay/src/cli/init.ts): every option THIS surface
// declares. The retired-option guard checks argv against it, so the rejection is "this option is not
// one we declare" rather than a hand-kept list of bad spellings. ⛔ Only exports/fields that already
// existed may be used here — see the note inside the `init` handler.
const KNOWN_INIT_FLAGS: ReadonlySet<string> = new Set([
  "help",
  "h",
  "root",
  "dry-run",
  "drop-incompatible",
]);

// The five carrier-dir resolvers used to live here as private functions. They moved to
// src/carrier-dirs.ts (gap-quay-init-omits-adr-goal-meta-dir-env-third-party-leak) so the
// resolution that decides WHICH workspace's adr/goal/meta store this process reads and writes is
// importable and directly unit-testable — this bin calls main() unconditionally at import, so a
// test could never reach them here. Read that module's header for the invariant and for the
// third-party-store-collision defect it exists to prevent.
import {
  findRepoRoot,
  resolveTasksDir,
  resolveAdrDir,
  resolveDocsDir,
  resolveGoalDir,
  resolveMetaDir,
} from "../src/carrier-dirs.ts";

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

// gap-quay-native-adr-cli-looser-bypass-of-core-validation: `quay-native adr` calls
// createAdrStore() IN-PROCESS (line ~118), so it never passes through Core's `quay adr`
// command nor the MCP adr_write validation layer (packages/quay/src/cli/adr.ts). The
// finding named this a second, looser, UN-DECLARED entrance to the same ADR store. This text
// is the short-term action: DECLARE the bypass (and steer normal use to `quay adr`) rather
// than leaving it a silent back door. `new`/`edit` gain the title guard and the lifecycle
// verbs are mirrored so the two surfaces agree (the finding's long-term action).
const ADR_HELP = `quay-native adr — Provider-internal ADR access.
⚠ BYPASS CHANNEL: this CLI calls createAdrStore() in-process and does NOT go through Core's
validation layer (the MCP adr_write path that \`quay adr\` uses). Treat it as internal /
escape-hatch only. For normal use prefer Core:
    quay adr list|show|new|accept|deprecate|reject|supersede

Subcommands (raw store surface):
    list    [--status <s>] [--tag <t>] [--applies-to <path>] [--json]
    get     <id> [--json]
    write   <id> [--title T] [--status S] [--date D] [--supersedes a,b] [--superseded-by a,b]
                 [--tags a,b] [--body B | --body-file F] [--json]
            raw read-modify-write primitive — no title guard (store-level access)
    new     <id> --title T [same fields as write]   --title is REQUIRED, like \`quay adr new\`
    edit    <id> [same fields as write]             result must carry a non-empty title
    accept | deprecate | reject  <id>               → status accepted | deprecated | rejected
    supersede  <id> --by <newId>                    link both records (id → superseded)

Files live in $QUAY_NATIVE_ADR_DIR (default: <repo>/.quay/adr).`;

async function main() {
  const [, , cmd, sub, ...rest] = process.argv;

  if (cmd === "mcp") {
    const { startMcpServer } = await import("../src/mcp-server.ts");
    // DIR-047: load and validate the per-provider default_task_status from
    // .quay/config.yml, then pass it to the MCP server so task_write (status
    // omitted on a new task) uses the same configured default as the CLI.
    const defaultStatus = loadDefaultStatus();
    await startMcpServer({ tasksDir: resolveTasksDir(), adrDir: resolveAdrDir(), goalDir: resolveGoalDir(), metaDir: resolveMetaDir(), defaultStatus });
    return;
  }

  if (cmd === "adr") {
    const adrStore = createAdrStore(resolveAdrDir());
    const { flags, positional } = parseFlags(rest);

    // gap-…-looser-bypass-of-core-validation AC1: `--help` / `-h` (and bare `adr`) print the
    // declaration that this surface bypasses Core's validation, then exit 0.
    if (sub === undefined || sub === "--help" || sub === "-h") {
      console.log(ADR_HELP);
      return;
    }

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
      if (!id) { console.error(`quay-native adr ${sub}: missing required <id>`); process.exitCode = 1; return; }
      // AC2: `new`/`edit` carry the same title-required guard Core's cli/adr.ts enforces on
      // `new`. `new` must be given a non-empty --title; `edit` must RESULT in a non-empty title
      // (either the flag or the title already on the record) — closing the create-through-edit
      // path that would otherwise write a titleless ADR. `write` stays the raw store-level
      // primitive (declared as such in `adr --help`), so it keeps its ungated behavior.
      if (sub === "new" || sub === "edit") {
        const effective = flags.title !== undefined
          ? (typeof flags.title === "string" ? flags.title.trim() : "")
          : (sub === "edit" ? adrStore.get(id)?.title : undefined);
        if (typeof effective !== "string" || effective.trim() === "") {
          console.error(`quay-native adr ${sub}: --title <title> is required`);
          process.exitCode = 1;
          return;
        }
      }
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
    // AC3: the decision-lifecycle verbs Core's cli/adr.ts owns, mirrored here so the two
    // surfaces agree (the finding's long-term action). Status values are the store's own
    // VALID_ADR_STATUSES; `supersede` links BOTH records, exactly as Core does.
    if (sub === "accept" || sub === "deprecate" || sub === "reject") {
      const statusMap = { accept: "accepted", deprecate: "deprecated", reject: "rejected" };
      const id = positional[0];
      if (!id) { console.error(`quay-native adr ${sub}: missing required <id>`); process.exitCode = 1; return; }
      const a = adrStore.write(id, { status: statusMap[sub] });
      if (flags.json) printJson(a);
      else console.log(`${id} → ${statusMap[sub]}`);
      return;
    }
    if (sub === "supersede") {
      const id = positional[0];
      const by = flags.by;
      if (!id || typeof by !== "string") { console.error("quay-native adr supersede <id> --by <newId>"); process.exitCode = 1; return; }
      adrStore.write(id, { status: "superseded", supersededBy: [by] });
      const target = adrStore.get(by);
      const supersedes = [...new Set([...(target?.supersedes ?? []), id])];
      adrStore.write(by, { supersedes });
      if (flags.json) printJson({ id, status: "superseded", supersededBy: [by] });
      else console.log(`${id} superseded by ${by}`);
      return;
    }
    console.error(`unknown adr subcommand: ${sub} (try: list, get, new, edit, write, accept, deprecate, reject, supersede)`);
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
  quay-native init [--drop-incompatible] [--dry-run] [--root <path>]

⛔ There is no overwrite flag and no reconcile selector: the target's STATE decides.
     absent config      ⇒ write a fresh one
     parseable config   ⇒ upgrade it in place (comment-preserving, validated before write)
     unreadable config  ⇒ rebuild it from this version's defaults, preserving the broken
                           bytes beside the new file as config.yml.corrupt-<timestamp>

Flags:
  --drop-incompatible
               When the upgraded config does not validate, delete the user values the
               validator rejects and retry; without it such a value fails the upgrade and
               your config is left byte-identical.
  --dry-run    Report what would happen without writing to disk.
  --root <path>  Scaffold at <path> instead of the current working directory.

Description:
  Creates .quay/config.yml (with all 3 sections: providers, gates, loop) and
  a tasks/ directory at the project root. Auto-detects project type (Node.js /
  Go) to suggest appropriate gate defaults.

  If .quay/config.yml already exists it is UPGRADED in place; an unreadable one is rebuilt
  from this version's defaults with the broken bytes preserved beside it.

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
        "(.quay/config.yml + tasks/); run `quay-native init --help` for its flags.\n" +
        "\n" +
        "To lay the full quay loop mechanism into an existing project, the canonical\n" +
        "path is the /quay:init skill inside a Claude Code session:\n" +
        "\n" +
        "    /quay:init --all --loop"
      );
      process.exitCode = 1;
      return;
    }

    // The same RETIRED-OPTION guard as the Core CLI (AC-330): a caller still passing the removed
    // overwrite/reconcile selectors is TOLD, never silently obeyed with different semantics.
    const unknownFlags = Object.keys(initFlags).filter((k) => !KNOWN_INIT_FLAGS.has(k));
    if (unknownFlags.length > 0) {
      console.error(
        `quay-native init: unrecognized option${unknownFlags.length > 1 ? "s" : ""}: ` +
        unknownFlags.map((k) => `--${k}`).join(", ") + "\n" +
        "The state of the target decides what init does — an absent config is written, a parseable\n" +
        "one is upgraded in place, an unreadable one is rebuilt with the broken bytes preserved\n" +
        "beside it. There is no overwrite mode and no reconcile selector any more; re-run without\n" +
        "the option.\n" +
        "Run `quay-native init --help` for the current surface."
      );
      process.exitCode = 1;
      return;
    }

    const targetRoot = typeof initFlags.root === "string" ? initFlags.root : process.cwd();
    const dryRun = initFlags["dry-run"] === true;
    const dropIncompatible = initFlags["drop-incompatible"] === true;
    const say = (line: string) => console.log(line);

    try {
      // ⛔ ONLY `InitOptions` fields that already existed — no new ones. `quay-native` reaches this
      // module through the bare specifier `quay/init`, which resolves through the shared
      // `node_modules` symlink to the MAIN checkout's `src/init.ts`; a field or export that exists
      // only on a task branch would therefore be missing at runtime for the whole life of that
      // branch (see the note on the native arm in packages/quay/test/init.test.mjs). The command-line
      // surface (`--json`, `--project`) is the Core CLI's, not this one's.
      const result = runInit({ root: targetRoot, dryRun, dropIncompatible });

      if (result.outcome === "skipped") {
        // LEGACY outcome — the single upgrade engine (GOAL-029) upgrades an existing config
        // instead of refusing it. Defensive arm only.
        console.error(
          `.quay/config.yml already exists at ${result.configPath} and was not upgraded. Re-run init.`
        );
        process.exitCode = 1;
        return;
      }

      // The upgraded candidate failed validation ⇒ nothing was written (validate-before-write).
      if (result.outcome === "upgrade-invalid") {
        console.error(
          `${result.configPath}: upgrade REFUSED — the upgraded config did not validate, ` +
            "so nothing was written (your config is byte-identical)."
        );
        for (const i of result.upgradeIssues ?? []) {
          console.error(`  ${i.severity}: ${i.field} — ${i.message}`);
          if (i.suggestion) console.error(`    suggestion: ${i.suggestion}`);
        }
        console.error("  (pass --drop-incompatible to delete the offending values, or edit them by hand)");
        process.exitCode = 1;
        return;
      }

      if (result.outcome === "reconciled" || result.outcome === "unchanged") {
        const r = result.upgrade;
        if (result.outcome === "unchanged") {
          say(`${result.configPath}: already current for this version of quay — not rewritten.`);
        } else {
          say(`${result.configPath}: upgraded to this version's defaults.`);
          for (const k of r?.added ?? []) say(`  filled loop.${k} (was absent)`);
          for (const m of r?.migrated ?? []) say(`  migrated loop.${m}`);
          for (const k of r?.removed ?? []) say(`  removed ${k} (retired key)`);
          for (const k of r?.pinned ?? []) say(`  pinned providers.native.env.${k} (carrier dir pin)`);
          for (const k of r?.dropped ?? []) say(`  dropped ${k} (--drop-incompatible: it did not validate)`);
        }
        for (const k of r?.unknownKeys ?? []) console.error(`  warning: unrecognized top-level config key "${k}" — kept as-is`);
        return;
      }

      if (result.outcome === "dry-run") {
        say(result.content);
        say(`\n# Dry run — nothing written to disk.`);
        say(`# Would create: ${result.configPath}`);
        say(`# Would create: ${result.tasksDir}/`);
        say(`# Would create: ${result.launchSettingsPath}`);
        say(`# Would create: ${result.profilesPath}`);
        return;
      }

      say(`Created ${result.configPath}`);
      if (result.corruptReason) say(`  ${result.corruptReason}`);
      say(`Created ${result.tasksDir}/ (or already existed)`);
      say(`Created ${result.launchSettingsPath}`);
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
      // gap-cli-write-surface-lacks-toplevel-fields: top-level `depends_on`/`goal_ac` (the same
      // first-class fields the native MCP task_write zod schema accepts) get their CLI surface.
      if (flags["depends-on"] !== undefined) patch.depends_on = String(flags["depends-on"]).split(",").filter(Boolean);
      if (flags["goal-ac"] !== undefined) patch.goal_ac = flags["goal-ac"];
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
      // gap-cli-write-surface-lacks-toplevel-fields: same top-level fields as `task edit`.
      if (flags["depends-on"] !== undefined) patch.depends_on = String(flags["depends-on"]).split(",").filter(Boolean);
      if (flags["goal-ac"] !== undefined) patch.goal_ac = flags["goal-ac"];
      // gap-quay-native-task-create-duplicate-id-prepends-frontmatter: `create` is NOT `edit`.
      // Without `{ create: true }` this call fell through to write()'s ordinary read-modify-write,
      // so re-creating an existing id exited 0 while silently re-statusing the task (a settled
      // `done` became whatever `--status` said) and, when a body was supplied, leaving the original
      // document below a second `---` block. Fail closed instead: non-zero exit, zero write, and the
      // message names the id. Mirrors the sibling CAS branch below (`err.name === "ConflictError"`)
      // rather than instanceof, matching this file's existing style.
      let t;
      try {
        t = store.write(id, patch, { create: true });
      } catch (err) {
        if (err && err.name === "AlreadyExistsError") {
          console.error(`task create: ${err.message}`);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
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
