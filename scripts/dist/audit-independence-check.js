import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
import path from "node:path";
function helpExit(usage) {
  process.stdout.write(usage.endsWith("\n") ? usage : usage + "\n");
  process.exit(0);
}
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/audit-independence-check.ts
var ID_LINE_RE = /^\s*(?:\*\*)?audit session id(?:\*\*)?\s*:\s*(.+)$/im;
function extractSessionId(fullText) {
  if (typeof fullText !== "string") return null;
  const m = fullText.match(ID_LINE_RE);
  if (!m) return null;
  const value = m[1].trim().replace(/^[`*_]+/, "").replace(/[`*_]+$/, "").trim();
  return value === "" ? null : value;
}
function parseDispatchRecord(fullText) {
  if (typeof fullText !== "string") return /* @__PURE__ */ new Set();
  const ids = fullText.split("\n").map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("#"));
  return new Set(ids);
}
function isCorroborated(artifactId, dispatchRecordIds) {
  if (artifactId == null || artifactId === "") return false;
  if (dispatchRecordIds == null) return false;
  const set = dispatchRecordIds instanceof Set ? dispatchRecordIds : new Set(dispatchRecordIds);
  return set.has(artifactId);
}
function evaluateIndependence(artifactId, orchestratorId, options = {}) {
  const { dispatchRecordIds = null, allowUncorroborated = false } = options;
  if (artifactId == null || artifactId === "") {
    return {
      verdict: "FAIL",
      reason: "audit artifact carries NO recorded session/agent id (absent) \u2014 fail-closed; an audit with no independence evidence is treated as a self-audit, never a silent pass"
    };
  }
  if (orchestratorId == null || orchestratorId === "") {
    return {
      verdict: "FAIL",
      reason: "no orchestrator session/agent id supplied to compare against (set --orchestrator-id or QUAY_ORCHESTRATOR_SESSION_ID) \u2014 fail-closed; cannot prove independence without both ids"
    };
  }
  if (artifactId === orchestratorId) {
    return {
      verdict: "FAIL",
      reason: `audit artifact's session id ("${artifactId}") EQUALS the orchestrator's own id \u2014 self-audit, not independent`
    };
  }
  if (allowUncorroborated) {
    return {
      verdict: "PASS",
      reason: `audit artifact's session id ("${artifactId}") is distinct from the orchestrator's own id ("${orchestratorId}") \u2014 genuinely independent (UNCORROBORATED \u2014 allowUncorroborated escape hatch in effect, pre-DIR-034 behavior; this should not be the default path)`
    };
  }
  if (dispatchRecordIds == null) {
    return {
      verdict: "FAIL",
      reason: `audit artifact's session id ("${artifactId}") is distinct from the orchestrator's own id, but NO dispatch-record was supplied to corroborate it (set --dispatch-record <file> or pass dispatchRecordIds) \u2014 fail-closed per DIR-034: a bare distinct string is forgeable and is treated as BLOCKING, not a pass`
    };
  }
  if (!isCorroborated(artifactId, dispatchRecordIds)) {
    return {
      verdict: "FAIL",
      reason: `audit artifact's session id ("${artifactId}") is distinct from the orchestrator's own id, but is NOT found in the supplied dispatch-record (no matching independent dispatch-side entry) \u2014 treated as a FABRICATED distinct string, fail-closed per DIR-034's anti-forgery requirement`
    };
  }
  return {
    verdict: "PASS",
    reason: `audit artifact's session id ("${artifactId}") is distinct from the orchestrator's own id ("${orchestratorId}") AND is corroborated by the independent dispatch-record \u2014 genuinely independent (DIR-034 anti-forgery check satisfied)`
  };
}
function checkArtifact(fullText, orchestratorId, options = {}) {
  const artifactId = extractSessionId(fullText);
  const { verdict, reason } = evaluateIndependence(artifactId, orchestratorId, options);
  return { artifactId, orchestratorId: orchestratorId ?? null, verdict, reason };
}
async function main(argv) {
  const fs = await import("node:fs");
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit("usage: node audit-independence-check.ts [--orchestrator-id <id>] [--orchestrator-env <name>] [--dispatch-record <file>] [--allow-uncorroborated] <audit-artifact.md>");
  let orchestratorEnvName = "QUAY_ORCHESTRATOR_SESSION_ID";
  let orchestratorId;
  let dispatchRecordPath = process.env.QUAY_DISPATCH_RECORD_FILE;
  let allowUncorroborated = false;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--orchestrator-env") {
      orchestratorEnvName = args[++i];
      continue;
    }
    if (args[i] === "--orchestrator-id") {
      orchestratorId = args[++i];
      continue;
    }
    if (args[i] === "--dispatch-record") {
      dispatchRecordPath = args[++i];
      continue;
    }
    if (args[i] === "--allow-uncorroborated") {
      allowUncorroborated = true;
      continue;
    }
    files.push(args[i]);
  }
  if (orchestratorId === void 0) {
    orchestratorId = process.env[orchestratorEnvName];
  }
  if (files.length !== 1) {
    console.error(
      "usage: node audit-independence-check.ts [--orchestrator-id <id>] [--orchestrator-env <name>] [--dispatch-record <file>] [--allow-uncorroborated] <audit-artifact.md>"
    );
    return 2;
  }
  let text;
  try {
    text = fs.readFileSync(files[0], "utf8");
  } catch (e) {
    console.error(`ERROR: cannot read file: ${files[0]} (${e.message})`);
    return 2;
  }
  let dispatchRecordIds = null;
  if (dispatchRecordPath) {
    let recordText;
    try {
      recordText = fs.readFileSync(dispatchRecordPath, "utf8");
    } catch (e) {
      console.error(`ERROR: cannot read dispatch-record file: ${dispatchRecordPath} (${e.message})`);
      return 2;
    }
    dispatchRecordIds = parseDispatchRecord(recordText);
  }
  const rep = checkArtifact(text, orchestratorId, { dispatchRecordIds, allowUncorroborated });
  console.log(`Audit-independence check \u2014 ${files[0]}`);
  console.log(`artifact session id: ${rep.artifactId ?? "(absent)"}`);
  console.log(`orchestrator session id: ${rep.orchestratorId ?? "(none supplied)"}`);
  console.log(`dispatch-record: ${dispatchRecordPath ? `${dispatchRecordPath} (${dispatchRecordIds.size} id(s))` : "(none supplied)"}${allowUncorroborated ? " [--allow-uncorroborated escape hatch active]" : ""}`);
  console.log("");
  console.log(`${rep.verdict}: ${rep.reason}`);
  return rep.verdict === "PASS" ? 0 : 1;
}
var isDirect = isDirectEntry(import.meta, process.argv[1], "audit-independence-check");
if (isDirect) {
  main(process.argv).then((code) => process.exit(code));
}
export {
  checkArtifact,
  evaluateIndependence,
  extractSessionId,
  isCorroborated,
  main,
  parseDispatchRecord
};
