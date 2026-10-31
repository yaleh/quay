import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/loadbearing-test-gate.ts
import fs from "node:fs";
import path2 from "node:path";

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/gate-script-base.ts
import path from "node:path";
function helpExit(usage) {
  process.stdout.write(usage.endsWith("\n") ? usage : usage + "\n");
  process.exit(0);
}
function parseArgs(argv, spec) {
  const result = { args: [], flags: {} };
  const raw = argv.slice(2);
  const flagDefs = spec.flags || {};
  const unknownMode = spec.unknown ?? (spec.strict ? "reject" : "accept");
  const scriptName = path.basename(argv[1] || "script");
  if (raw.includes("--help") || raw.includes("-h")) {
    if (spec.help === "return") {
      result.help = true;
      return result;
    }
    helpExit(`usage: ${scriptName} ${spec.usage}`);
  }
  const usageError = (message) => {
    if (spec.errors === "return") {
      result.error = message;
      return result;
    }
    console.error(message);
    process.exit(2);
  };
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a.startsWith("--")) {
      const eqIdx = a.indexOf("=");
      const name = eqIdx >= 0 ? a.slice(2, eqIdx) : a.slice(2);
      const def = flagDefs[name];
      if (!def && unknownMode === "reject") return usageError(`unknown argument: --${name}`);
      if (!def && unknownMode === "skip") continue;
      if (def?.type === "boolean") {
        result.flags[name] = true;
      } else if (def?.type === "string[]") {
        if (!result.lists) result.lists = {};
        const list = result.lists[name] ??= [];
        if (eqIdx >= 0) list.push(a.slice(eqIdx + 1));
        else if (def.greedy) {
          while (i + 1 < raw.length && !raw[i + 1].startsWith("--")) list.push(raw[++i]);
        } else if (i + 1 < raw.length) list.push(raw[++i]);
      } else if (eqIdx >= 0) {
        result.flags[name] = a.slice(eqIdx + 1);
      } else if (i + 1 < raw.length) {
        result.flags[name] = raw[++i];
      } else {
        result.flags[name] = "";
      }
    } else {
      result.args.push(a);
    }
  }
  const minArgs = spec.minArgs ?? 1;
  if (result.args.length < minArgs) {
    return usageError(`Usage: ${scriptName} ${spec.usage}`);
  }
  return result;
}
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/loadbearing-test-gate.ts
function basenameOf(file) {
  return path2.basename(file);
}
function enumerateScripts(scriptsDir) {
  let entries;
  try {
    entries = fs.readdirSync(scriptsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isFile() && (e.name.endsWith(".ts") || e.name.endsWith(".mjs")) && !e.name.endsWith(".test.mjs") && !e.name.endsWith(".test.ts")).map((e) => path2.resolve(scriptsDir, e.name)).sort();
}
function readAllMjs(roots) {
  const out = [];
  for (const root of roots) {
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.endsWith(".mjs") && !e.name.endsWith(".ts")) continue;
      const file = path2.resolve(root, e.name);
      let text = "";
      try {
        text = fs.readFileSync(file, "utf8");
      } catch {
        text = "";
      }
      out.push({ file, text });
    }
  }
  return out;
}
function detectImported(name, importSearchRoots) {
  const specRe = /from\s+["']([^"']*)["']/g;
  const stem = name.replace(/\.(ts|mjs)$/, "");
  for (const { file, text } of readAllMjs(importSearchRoots)) {
    const fileStem = basenameOf(file).replace(/\.(ts|mjs)$/, "");
    if (fileStem === stem) continue;
    let m;
    while ((m = specRe.exec(text)) !== null) {
      const importedStem = basenameOf(m[1]).replace(/\.(ts|mjs)$/, "");
      if (importedStem === stem) return true;
    }
    specRe.lastIndex = 0;
  }
  return false;
}
function detectRegistered(name, registryFile) {
  let text;
  try {
    text = fs.readFileSync(registryFile, "utf8");
  } catch {
    return false;
  }
  const stem = name.replace(/\.(ts|mjs)$/, "");
  return text.includes(name) || text.includes(`${stem}.mjs`) || text.includes(`${stem}.ts`);
}
function splitBulletBlocks(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let cur = null;
  const isBulletStart = (l) => /^\s*[-*]\s/.test(l);
  for (const line of lines) {
    if (isBulletStart(line)) {
      if (cur !== null) blocks.push(cur.join("\n"));
      cur = [line];
    } else if (cur !== null) {
      if (/^\s+\S/.test(line) || line.trim() === "") cur.push(line);
      else {
        blocks.push(cur.join("\n"));
        cur = null;
      }
    }
  }
  if (cur !== null) blocks.push(cur.join("\n"));
  return blocks;
}
function detectCounterGate(name, outerLoopFile) {
  let text;
  try {
    text = fs.readFileSync(outerLoopFile, "utf8");
  } catch {
    return false;
  }
  const stem = name.replace(/\.(ts|mjs)$/, "");
  for (const block of splitBulletBlocks(text)) {
    if ((block.includes(name) || block.includes(`${stem}.mjs`) || block.includes(`${stem}.ts`)) && /milestone_counter\s*\+\+/.test(block)) return true;
  }
  return false;
}
function hasSiblingTest(name, testDir, scriptsDir) {
  const stem = name.replace(/\.(ts|mjs)$/, "");
  const candidates = [path2.join(testDir, `${stem}.test.mjs`), path2.join(testDir, `${stem}.test.ts`)];
  if (scriptsDir) {
    candidates.push(path2.join(scriptsDir, `${stem}.test.mjs`), path2.join(scriptsDir, `${stem}.test.ts`));
  }
  return candidates.some((p) => fs.existsSync(p));
}
function classifyScript(file, cfg) {
  const name = basenameOf(file);
  const reasons = [];
  if (detectImported(name, cfg.importSearchRoots || [])) reasons.push("imported");
  if (cfg.registryFile && detectRegistered(name, cfg.registryFile)) reasons.push("registered");
  if (cfg.outerLoopFile && detectCounterGate(name, cfg.outerLoopFile)) reasons.push("counter-gate");
  const loadBearing = reasons.length > 0;
  const hasTest = hasSiblingTest(name, cfg.testDir, cfg.scriptsDir);
  let verdict;
  if (!loadBearing) verdict = "N/A";
  else verdict = hasTest ? "PASS" : "FAIL";
  return { file, loadBearing, reasons, hasTest, verdict };
}
function checkTree(cfg) {
  const scripts = enumerateScripts(cfg.scriptsDir);
  const results = scripts.map((f) => classifyScript(f, cfg));
  const pass = results.filter((r) => r.verdict === "PASS").length;
  const fail = results.filter((r) => r.verdict === "FAIL").length;
  const na = results.filter((r) => r.verdict === "N/A").length;
  return {
    verdict: fail > 0 ? "FAIL" : "PASS",
    results,
    pass,
    fail,
    na
  };
}
function parseArgs2(argv) {
  const parsed = parseArgs(argv, {
    minArgs: 0,
    usage: "--scripts <dir> [--tests <dir>] [--import-root <dir> ...] [--registry <file>] [--outer-loop <file>] [--allow-empty]",
    help: "return",
    errors: "return",
    unknown: "reject",
    flags: {
      scripts: { type: "string" },
      tests: { type: "string" },
      "import-root": { type: "string[]" },
      registry: { type: "string" },
      "outer-loop": { type: "string" },
      "allow-empty": { type: "boolean" }
    }
  });
  if (parsed.help) return { help: true };
  if (parsed.error) return { error: parsed.error };
  if (parsed.args.length > 0) return { error: `unknown argument: ${parsed.args[0]}` };
  const str = (v) => typeof v === "string" ? v : void 0;
  const cfg = {
    scriptsDir: str(parsed.flags.scripts),
    testDir: str(parsed.flags.tests) ?? null,
    importSearchRoots: parsed.lists?.["import-root"] ?? [],
    registryFile: str(parsed.flags.registry) ?? null,
    outerLoopFile: str(parsed.flags["outer-loop"]) ?? null
  };
  return { cfg, allowEmpty: parsed.flags["allow-empty"] === true };
}
function main(argv) {
  const { cfg, allowEmpty, error, help } = parseArgs2(argv);
  if (help) {
    console.log("usage: node loadbearing-test-gate.ts --scripts <dir> [--tests <dir>] [--import-root <dir> ...] [--registry <file>] [--outer-loop <file>] [--allow-empty]");
    return 0;
  }
  if (error) {
    console.error(`ERROR: ${error}`);
    return 2;
  }
  if (!cfg.scriptsDir) {
    console.error("usage: node loadbearing-test-gate.ts --scripts <dir> [--tests <dir>] [--import-root <dir> ...] [--registry <file>] [--outer-loop <file>] [--allow-empty]");
    return 2;
  }
  if (!cfg.testDir) cfg.testDir = path2.resolve(cfg.scriptsDir, "..", "test");
  if (cfg.importSearchRoots.length === 0) cfg.importSearchRoots = [cfg.scriptsDir];
  const rep = checkTree(cfg);
  if (rep.results.length === 0 && !allowEmpty) {
    console.log(`FAIL: 0 scripts to gate \u2014 the scripts directory ${cfg.scriptsDir} has no *.ts/*.mjs, so this gate verified nothing (fail-closed: 'no problems' must not be indistinguishable from 'never looked'; pass --allow-empty to waive)`);
    return 1;
  }
  console.log(`load-bearing test-gate \u2014 scripts=${cfg.scriptsDir}`);
  for (const r of rep.results) {
    const name = basenameOf(r.file);
    if (r.verdict === "N/A") {
      console.log(`  [N/A] ${name} \u2014 not load-bearing (no import/registry/counter-gate trigger)`);
    } else if (r.verdict === "PASS") {
      console.log(`  [PASS] ${name} \u2014 load-bearing (${r.reasons.join(",")}) + sibling test present`);
    } else {
      console.log(`  [FAIL] ${name} \u2014 load-bearing (${r.reasons.join(",")}) but NO sibling ${name.replace(/\.(ts|mjs)$/, "")}.test.mjs`);
    }
  }
  console.log("");
  console.log(`${rep.results.length} total, ${rep.pass} pass, ${rep.na} N/A, ${rep.fail} fail`);
  if (rep.fail > 0) {
    console.log(`FAIL: ${rep.fail} load-bearing script(s) lack a sibling *.test.mjs (ADR-001 Decision clause 2)`);
    return 1;
  }
  console.log("PASS: every load-bearing script has a sibling *.test.mjs");
  return 0;
}
var isDirect = isDirectEntry(import.meta, process.argv[1], "loadbearing-test-gate");
if (isDirect) {
  process.exit(main(process.argv));
}
export {
  basenameOf,
  checkTree,
  classifyScript,
  detectCounterGate,
  detectImported,
  detectRegistered,
  enumerateScripts,
  hasSiblingTest,
  splitBulletBlocks
};
