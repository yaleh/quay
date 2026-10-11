#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/quay-entry-base.ts
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
var defaultExec = (command, argv, opts) => {
  const res = spawnSync(command, argv, { cwd: opts.cwd, env: opts.env, encoding: "utf8" });
  return { status: res.status ?? 1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
};
function buildSpawn(spec, args, scriptDir) {
  const target = path.join(scriptDir, spec.file);
  if (spec.kind === "bash") return { command: "bash", argv: [target, ...args] };
  return { command: process.execPath, argv: ["--no-warnings", "--experimental-strip-types", target, ...args] };
}
function createEntryPoint(group, members) {
  const byName = new Map(members.map((m) => [m.name, m]));
  const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name));
  const entry2 = {
    GROUP: group,
    MEMBERS: members,
    list() {
      return members.map((m) => ({ ...m }));
    },
    has(name) {
      return byName.has(name);
    },
    run(name, args, opts = { scriptDir: "" }) {
      const spec = byName.get(name);
      if (!spec) {
        return {
          status: 2,
          stdout: "",
          stderr: `${group}: no such instrument "${name}" (known: ${sorted.map((m) => m.name).join(", ")})`
        };
      }
      const scriptDir = opts.scriptDir || path.dirname(fileURLToPath(import.meta.url));
      const resolved = spec.resolve ? spec.resolve(args) : spec;
      const eff = { ...spec, file: resolved.file, kind: resolved.kind };
      const { command, argv } = buildSpawn(eff, args, scriptDir);
      const exec = opts.exec ?? defaultExec;
      return exec(command, argv, { cwd: opts.cwd ?? scriptDir, env: opts.env });
    },
    runCli(argv, metaUrl) {
      const raw = argv.slice(2);
      if (raw.length === 0) {
        console.error(`${group}: usage \u2014 plugin/scripts/${group}.ts <instrument> [args...]`);
        console.error(`known instruments: ${sorted.map((m) => `${m.name}(${m.kind})`).join(", ")}`);
        return 2;
      }
      const [name, ...rest] = raw;
      if (name === "list" || name === "--list") {
        for (const m of sorted) console.log(`${m.name}	${m.kind}	${m.description}`);
        return 0;
      }
      if (name === "--help" || name === "-h" || name === "help") {
        console.log(`${group}: grouped instrument entry (SPEC AC12) \u2014 ${sorted.length} instruments`);
        console.log(`usage: plugin/scripts/${group}.ts <instrument> [args...]   |   plugin/scripts/${group}.ts list`);
        return 0;
      }
      const scriptDir = path.dirname(fileURLToPath(metaUrl));
      const result = entry2.run(name, rest, { scriptDir, cwd: process.cwd() });
      if (result.stdout) process.stdout.write(result.stdout);
      if (result.stderr) process.stderr.write(result.stderr);
      return result.status;
    }
  };
  return entry2;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import path2 from "node:path";
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry2 = argv1 || process.argv[1];
  if (!entry2) return false;
  return path2.basename(entry2).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/quay-session.ts
var GROUP = "quay-session";
var MEMBERS = [
  { name: "quay-launch", file: "quay-launch.sh", kind: "bash", description: "\u542F\u52A8 quay \u4F1A\u8BDD" },
  { name: "manager-tick-readings", file: "manager-tick-readings.ts", kind: "ts", description: "\u7BA1\u7406\u8005 tick \u673A\u68B0\u8BFB\u6570\uFF08\u4E09\u9879\u76EE\u72B6\u6001/\u8D44\u6E90/\u5916\u5C42\u5B58\u6D3B/tick\u65E5\u5FD7/\u76D1\u89C6\u5668\u7248\u672C\uFF0C\u5355\u547D\u4EE4\u4EA7\u51FA\uFF09" }
];
var entry = createEntryPoint(GROUP, MEMBERS);
var list = entry.list;
var has = entry.has;
var run = entry.run;
var runCli = entry.runCli;
if (isDirectEntry(import.meta, void 0, "quay-session")) {
  process.exitCode = runCli(process.argv, import.meta.url);
}
export {
  GROUP,
  MEMBERS,
  has,
  list,
  run,
  runCli
};
