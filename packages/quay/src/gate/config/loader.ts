// Workspace gate loader — discovers workspace root and reads .quay/gates.yml
// (or .quay/config.yml `gates:` section) to produce the workspace-data-driven
// gate set. Extracted from gate/factories/loader.ts to reduce fanOut.
//
// Imports factories from ../factories/index.ts; types from ../registry.ts
// (type-only, no runtime circular); config types from ./types.ts; Node
// fs/path/YAML.

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import type { GateFn } from "../registry.ts";
import { gateFactories } from "../factories/index.ts";
import { type GateConfig, resolveRunnerOptions } from "./utils.ts";
import type {
  It0Entry,
  FixedEntry,
  TestPassEntry,
  CoverageFloorEntry,
  RedGreenEntry,
  GatesConfig,
  GateSource,
  GateDiagnostic,
} from "./types.ts";
import { findConfig } from "../../config.ts";

// Re-export types so consumers can import from a single module.
export type {
  It0Entry,
  FixedEntry,
  TestPassEntry,
  CoverageFloorEntry,
  RedGreenEntry,
  GatesConfig,
  GateSource,
  GateDiagnostic,
};

// ---------------------------------------------------------------------------
// Workspace root discovery
// ---------------------------------------------------------------------------

export function discoverWorkspaceRoot(startDir) {
  if (startDir === undefined) startDir = process.cwd();
  var configPath = findConfig(startDir);
  if (!configPath) return null;
  return path.dirname(path.dirname(configPath));
}

// ---------------------------------------------------------------------------
// Shared file resolver — single owner of branch-A-terminal precedence
// ---------------------------------------------------------------------------

function resolveGateConfigFile(workspaceRoot) {
  if (!workspaceRoot) return null;
  var p = path.join(workspaceRoot, ".quay", "config.yml");
  if (fs.existsSync(p)) return { file: p, text: fs.readFileSync(p, "utf8") };
  p = path.join(workspaceRoot, ".quay", "gates.yml");
  if (!fs.existsSync(p)) return null;
  return { file: p, text: fs.readFileSync(p, "utf8") };
}

// ---------------------------------------------------------------------------
// Private CST parser (DIR-104 AC3 — file:line provenance)
// ---------------------------------------------------------------------------

function parseGateEntryLines(text, srcFile) {
  var empty = { it0: [], adr: [], fixed: [], testPass: [], coverageFloor: [], redGreen: [], srcFile: srcFile || "" };
  var adrEntries = [];

  var doc;
  var lineCounter = new YAML.LineCounter(text);
  try { doc = YAML.parseDocument(text, { keepSourceTokens: true, lineCounter: lineCounter }); }
  catch (_) { return { config: empty, adrLines: adrEntries }; }

  if (!doc.contents || !YAML.isMap(doc.contents)) return { config: empty, adrLines: adrEntries };
  if (doc.errors && doc.errors.length > 0) return { config: empty, adrLines: adrEntries };

  var gatesMap = null;
  if (doc.contents.has("gates")) {
    var gNode = doc.contents.get("gates", true);
    if (YAML.isMap(gNode)) gatesMap = gNode;
  } else {
    gatesMap = doc.contents;
  }
  if (!gatesMap) return { config: empty, adrLines: adrEntries };

  function lineOf(node) {
    if (!node || !node.range || !node.range[0]) return 0;
    return lineCounter.linePos(node.range[0]).line;
  }

  function entriesFromSection(key) {
    var n = gatesMap.get(key, true);
    if (!n || !YAML.isSeq(n)) return [];
    var result = [];
    for (var i = 0; i < n.items.length; i++) {
      var item = n.items[i];
      var ln = lineOf(item);
      if (YAML.isMap(item)) {
        var data = {};
        for (var j = 0; j < item.items.length; j++) {
          var pair = item.items[j];
          if (YAML.isScalar(pair.key)) {
            var k = String(pair.key.value);
            data[k] = YAML.isScalar(pair.value) ? pair.value.value : null;
          }
        }
        if (Object.keys(data).length > 0) {
          if (srcFile && ln > 0) data.src = { file: srcFile, line: ln };
          result.push(data);
        }
      }
    }
    return result;
  }

  var adrNode = gatesMap.get("adr", true);
  if (adrNode && YAML.isSeq(adrNode)) {
    for (var a = 0; a < adrNode.items.length; a++) {
      var adrItem = adrNode.items[a];
      if (YAML.isScalar(adrItem) && typeof adrItem.value === "string" && adrItem.value.trim() !== "") {
        adrEntries.push({ id: adrItem.value.trim(), line: lineOf(adrItem) });
      }
    }
  }

  var config = {
    it0: entriesFromSection("it0"),
    adr: adrEntries.map(function(e) { return e.id; }),
    fixed: entriesFromSection("fixed"),
    testPass: entriesFromSection("testPass"),
    coverageFloor: entriesFromSection("coverageFloor"),
    redGreen: entriesFromSection("redGreen"),
    srcFile: srcFile || "",
  };

  return { config: config, adrLines: adrEntries };
}

// ---------------------------------------------------------------------------
// gates.yml / config.yml reader (thin wrapper — G3 contract preserved)
// ---------------------------------------------------------------------------

export function readGatesConfig(workspaceRoot) {
  var empty = { it0: [], adr: [], fixed: [], testPass: [], coverageFloor: [], redGreen: [] };
  var resolved = resolveGateConfigFile(workspaceRoot);
  if (!resolved) return empty;
  try {
    var parsed = parseGateEntryLines(resolved.text, resolved.file);
    var cfg = parsed.config;
    if (cfg.it0.length === 0 && cfg.adr.length === 0 && cfg.fixed.length === 0 &&
        cfg.testPass.length === 0 && cfg.coverageFloor.length === 0 && cfg.redGreen.length === 0) {
      return empty;
    }
    return cfg;
  }
  catch (_) { return empty; }
}

// ---------------------------------------------------------------------------
// Per-type detail helpers (DIR-104)
// ---------------------------------------------------------------------------

var DETAIL_FN = {
  it0: function(e) { return "script: " + e.script + " argsKey: " + e.argsKey; },
  fixed: function(e) { return "script: " + e.script; },
  testPass: function(e) { return "command: " + e.command; },
  coverageFloor: function(e) { return "command: " + e.command + " floor: " + e.floor + "%"; },
  redGreen: function(e) { return "red: " + e.red + " green: " + e.green; },
  adr: function(e) { return "adr: " + e.id; },
};

var REQUIRED = {
  it0: ["name", "script", "argsKey"],
  fixed: ["name", "script"],
  testPass: ["name", "command"],
  coverageFloor: ["name", "command", "floor"],
  redGreen: ["name", "red", "green"],
};

function fieldOk(entry, field) {
  var v = entry[field];
  if (field === "name" || field === "script" || field === "argsKey") return Boolean(v);
  if (field === "command" || field === "red" || field === "green") return typeof v === "string";
  if (field === "floor") return typeof v === "number";
  return true;
}

function nameOf(entry) {
  return (typeof entry.name === "string" && entry.name.trim() !== "") ? entry.name : "<unnamed>";
}

// ---------------------------------------------------------------------------
// Workspace gate metadata pass (DIR-104 — provenance + diagnostics)
// ---------------------------------------------------------------------------

export function loadWorkspaceGateMetadata(workspaceRoot) {
  if (!workspaceRoot) return { gates: {}, rows: [], diagnostics: [] };

  var resolved = resolveGateConfigFile(workspaceRoot);
  var diagnostics = [];
  var rows = [];
  var gates = {};

  if (resolved) {
    var parsed;
    try { parsed = parseGateEntryLines(resolved.text, resolved.file); }
    catch (_) { return { gates: {}, rows: [], diagnostics: [] }; }

    var cfg = parsed.config;
    var adrLines = parsed.adrLines;
    var srcFile = cfg.srcFile || resolved.file;

    function srcStr(line) { return line > 0 ? srcFile + ":" + line : srcFile; }

    var configYmlPath = path.join(workspaceRoot, ".quay", "config.yml");
    if (fs.existsSync(configYmlPath)) {
      var legacyPath = path.join(workspaceRoot, ".quay", "gates.yml");
      if (fs.existsSync(legacyPath)) {
        try {
          var legacyParsed = parseGateEntryLines(fs.readFileSync(legacyPath, "utf8"), legacyPath);
          var legacyCfg = legacyParsed.config;
          var registeredNames = {};
          function addNames(arr) {
            for (var i = 0; i < arr.length; i++) { if (arr[i].name) registeredNames[arr[i].name] = true; }
          }
          addNames(cfg.it0); addNames(cfg.fixed); addNames(cfg.testPass);
          addNames(cfg.coverageFloor); addNames(cfg.redGreen);
          for (var a = 0; a < cfg.adr.length; a++) registeredNames[cfg.adr[a]] = true;

          var allLegacy = [].concat(legacyCfg.it0, legacyCfg.fixed, legacyCfg.testPass, legacyCfg.coverageFloor, legacyCfg.redGreen);
          for (var i = 0; i < allLegacy.length; i++) {
            var e = allLegacy[i];
            if (e.name && !registeredNames[e.name]) {
              var legacySrc = e.src;
              var loc = legacySrc ? legacySrc.file + ":" + legacySrc.line : legacyPath;
              diagnostics.push({
                level: "WARNING",
                message: "gate '" + e.name + "' declared in " + loc + " but NOT registered — .quay/config.yml has a `gates:` section that takes precedence (DIR-050). The config.yml gates section does not include an entry for '" + e.name + "'. Fix: add " + e.name + " to config.yml's gates section (removing the config.yml gates: section does NOT restore legacy gates.yml behavior — DIR-120 made branch A terminal, so the legacy file is never re-read when config.yml exists).",
              });
            }
          }
        } catch (_) { /* best-effort */ }
      }
    }

    var gateConfigOf = function(entry) {
      var cwd = undefined;
      if (typeof entry.cwd === "string" && entry.cwd.trim() !== "") {
        cwd = path.isAbsolute(entry.cwd) ? entry.cwd : path.resolve(workspaceRoot, entry.cwd);
      }
      var timeoutMs = (typeof entry.timeoutMs === "number" && entry.timeoutMs > 0) ? entry.timeoutMs : undefined;
      return { cwd: cwd, timeoutMs: timeoutMs };
    };

    function processSection(type, entries, gateFnKey) {
      var req = REQUIRED[type] || [];
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!e) continue;
        var ok = true;
        for (var f = 0; f < req.length; f++) {
          if (!fieldOk(e, req[f])) { ok = false; break; }
        }
        if (!ok) {
          for (var f2 = 0; f2 < req.length; f2++) {
            if (!fieldOk(e, req[f2])) {
              diagnostics.push({
                level: "WARNING",
                message: type + " gate '" + nameOf(e) + "' missing required field '" + req[f2] + "' — gate will not be registered",
              });
            }
          }
          continue;
        }
        var fnKey = gateFnKey || type;
        var scriptPath = e.script;
        if (scriptPath && !path.isAbsolute(scriptPath)) scriptPath = path.resolve(workspaceRoot, scriptPath);
        if (fnKey === "it0") gates[e.name] = gateFactories.it0(scriptPath, e.argsKey, e.name, gateConfigOf(e));
        else if (fnKey === "fixed-script") gates[e.name] = gateFactories["fixed-script"](scriptPath, e.name, gateConfigOf(e));
        else if (fnKey === "test-pass") gates[e.name] = gateFactories["test-pass"](e.command, e.name, gateConfigOf(e));
        else if (fnKey === "coverage-floor") gates[e.name] = gateFactories["coverage-floor"](e.command, e.floor, e.pattern, e.name, gateConfigOf(e));
        else if (fnKey === "red-green") gates[e.name] = gateFactories["red-green"](e.red, e.green, e.name, gateConfigOf(e));
        rows.push({
          name: e.name || "",
          source: srcStr(e.src ? e.src.line : 0),
          type: type,
          detail: DETAIL_FN[type] ? DETAIL_FN[type](e) : "",
        });
      }
    }

    processSection("it0", cfg.it0, "it0");

    var adrDir = path.join(workspaceRoot, "adr");
    for (var a = 0; a < adrLines.length; a++) {
      var al = adrLines[a];
      if (!al.id || al.id.trim() === "") continue;
      gates[al.id.toLowerCase()] = gateFactories.adr(al.id, adrDir);
      rows.push({ name: al.id.toLowerCase(), source: srcStr(al.line), type: "adr", detail: "adr: " + al.id });
    }

    processSection("fixed", cfg.fixed, "fixed-script");
    processSection("testPass", cfg.testPass, "test-pass");
    processSection("coverageFloor", cfg.coverageFloor, "coverage-floor");
    processSection("redGreen", cfg.redGreen, "red-green");
  }

  return { gates: gates, rows: rows, diagnostics: diagnostics };
}

// ---------------------------------------------------------------------------
// Workspace gate set builder (thin wrapper — G3 contract preserved)
// ---------------------------------------------------------------------------

export function loadWorkspaceGates(workspaceRoot) {
  return loadWorkspaceGateMetadata(workspaceRoot).gates;
}
