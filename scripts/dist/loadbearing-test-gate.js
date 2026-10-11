import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/loadbearing-test-gate.ts
import fs from "node:fs";
import path2 from "node:path";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import path from "node:path";
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/loadbearing-test-gate.ts
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
function parseArgs(argv) {
  const cfg = { scriptsDir: null, testDir: null, importSearchRoots: [], registryFile: null, outerLoopFile: null };
  let allowEmpty = false;
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--scripts") cfg.scriptsDir = args[++i];
    else if (a === "--tests") cfg.testDir = args[++i];
    else if (a === "--import-root") cfg.importSearchRoots.push(args[++i]);
    else if (a === "--registry") cfg.registryFile = args[++i];
    else if (a === "--outer-loop") cfg.outerLoopFile = args[++i];
    else if (a === "--allow-empty") allowEmpty = true;
    else return { error: `unknown argument: ${a}` };
  }
  return { cfg, allowEmpty };
}
function main(argv) {
  const { cfg, allowEmpty, error } = parseArgs(argv);
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
