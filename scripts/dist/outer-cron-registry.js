import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/outer-cron-registry.ts
import fs2 from "node:fs";
import path3 from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync as execFileSync2 } from "node:child_process";
import { fileURLToPath } from "node:url";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/outer-anchor-check.ts
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

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/outer-anchor-check.ts
import { execFileSync } from "node:child_process";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/driver-result.ts
function verified(value, verifiedBy) {
  return { state: "verified", value, verifiedBy };
}
function notEvaluated(reason) {
  return { state: "not-evaluated", reason };
}
function failed(reason) {
  return { state: "failed", reason };
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/checker-io.ts
function driverResultToExit(result) {
  switch (result.state) {
    case "verified":
      return 0;
    case "failed":
      return 1;
    case "not-evaluated":
      return 2;
  }
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/outer-anchor-check.ts
var EXIT_OK = 0;
var EXIT_VIOLATED = 1;
var INNER_ANCHOR_BEGIN_MARK = "AC80-INNER-ANCHOR-BEGIN";
var INNER_ANCHOR_END_MARK = "AC80-INNER-ANCHOR-END";
var LAYERS = {
  inner: {
    canonicalRel: "plugin/loop/fast-mode-loop-tick.md",
    requiredPointers: [
      "orchestration/fast-mode-tick-core.md",
      "docs/analysis/fast-mode-loop-tick.md",
      "inner-tick-log.jsonl",
      "orchestration/manager-phase-goal.md"
    ],
    requireSentinel: true
  },
  outer: {
    canonicalRel: "orchestration/outer-tick-prompt.txt",
    requiredPointers: ["orchestrator-tick-core.md"],
    requireSentinel: false
  }
};
var ISO_DATE_RE = /20\d\d-\d\d-\d\d/;
var COMMIT_HASH_RE = /\b[0-9a-f]{7,40}\b/;
var TASK_NAME_RE = /gap-[a-z][a-z0-9-]{5,}/;
var DECISION_WORDS = ["\u672C\u8F6E\u91CD\u70B9", "\u4F18\u5148", "\u5148\u505A", "\u6682\u505C", "\u8DF3\u8FC7", "\u6D3E\u53D1"];
function extractCanonical(text, layer) {
  if (layer === "outer") {
    return text.replace(/\n$/, "");
  }
  const beginIdx = text.indexOf(INNER_ANCHOR_BEGIN_MARK);
  if (beginIdx < 0) return null;
  const contentStart = text.indexOf("\n", beginIdx);
  if (contentStart < 0) return null;
  const endMarkPos = text.indexOf(INNER_ANCHOR_END_MARK);
  if (endMarkPos < 0) return null;
  const endLineStart = text.lastIndexOf("\n", endMarkPos);
  const endIdx = endLineStart <= contentStart ? endMarkPos : endLineStart;
  if (endIdx <= contentStart) return null;
  const content = text.slice(contentStart + 1, endIdx);
  return content.replace(/\n$/, "");
}
function pointerFormFindings(canonical, layer) {
  const cfg = LAYERS[layer];
  const bad = [];
  for (const p of cfg.requiredPointers) {
    if (!canonical.includes(p)) bad.push(`\u7F3A\u6307\u5411 ${p}`);
  }
  if (cfg.requireSentinel) {
    if (!canonical.includes("CronList")) bad.push("\u7F3A\u54E8\u5175\u6E05\u626B\u89C4\u5219\uFF08CronList\uFF09");
    if (!canonical.includes("\u6E05\u626B")) bad.push("\u7F3A\u54E8\u5175\u6E05\u626B\u89C4\u5219\uFF08\u6E05\u626B\uFF09");
  }
  if (ISO_DATE_RE.test(canonical)) bad.push("\u542B ISO \u65E5\u671F\uFF08\u72B6\u6001\u6E17\u5165\uFF09");
  if (COMMIT_HASH_RE.test(canonical)) bad.push("\u542B\u63D0\u4EA4\u53F7\uFF08\u72B6\u6001\u6E17\u5165\uFF09");
  if (TASK_NAME_RE.test(canonical)) bad.push("\u542B\u4EFB\u52A1\u540D\uFF08\u72B6\u6001\u6E17\u5165\uFF09");
  for (const w of DECISION_WORDS) {
    if (canonical.includes(w)) bad.push(`\u542B\u51B3\u7B56\u8BCD\u300C${w}\u300D`);
  }
  return bad;
}
function gitUncommitted(root, relPath) {
  try {
    const out = execFileSync("git", ["status", "--porcelain", "--", relPath], {
      cwd: root,
      encoding: "utf8"
    });
    return out.trim();
  } catch (err) {
    return `git-error: ${String(err)}`;
  }
}
function byteDiff(actual, expected) {
  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.equals(b)) return { match: true, actualBytes: a.length, expectedBytes: b.length, firstDiffByte: -1 };
  let first = Math.min(a.length, b.length);
  for (let i = 0; i < first; i++) {
    if (a[i] !== b[i]) {
      first = i;
      break;
    }
  }
  return { match: false, actualBytes: a.length, expectedBytes: b.length, firstDiffByte: first };
}
function formatDiffContext(canonical, live, firstDiffByte) {
  const a = Buffer.from(canonical, "utf8");
  const b = Buffer.from(live, "utf8");
  const start = Math.max(0, firstDiffByte - 24);
  const ctxA = a.subarray(start, start + 80).toString("utf8").replace(/\n/g, "\\n");
  const ctxB = b.subarray(start, start + 80).toString("utf8").replace(/\n/g, "\\n");
  return `  canonical(${a.length}b): \u2026${ctxA}\u2026
  live    (${b.length}b): \u2026${ctxB}\u2026
  first differing byte at ${firstDiffByte}`;
}
function checkAnchor(opts) {
  const { layer, root, cronPrompt } = opts;
  const cfg = LAYERS[layer];
  const canonicalPath = opts.canonicalFileOverride ? opts.canonicalFileOverride : path2.join(root, cfg.canonicalRel);
  const relPath = opts.canonicalFileOverride ? canonicalPath : cfg.canonicalRel;
  if (!fs.existsSync(canonicalPath)) {
    const driverResult2 = notEvaluated(
      `MISSING-\u6B63\u672C: ${relPath} \u4E0D\u5B58\u5728\uFF08\u8BE5\u5C42\u6B63\u672C\u5C1A\u672A\u843D\u5730\uFF1B\u91CD\u6302 cron \u65F6\u65E0\u5BF9\u7167\u7269\u53EF diff\uFF09`
    );
    return {
      ok: false,
      code: driverResultToExit(driverResult2),
      reason: driverResult2.reason,
      layer,
      canonicalPath,
      canonical: null,
      canonicalBytes: -1,
      findings: [],
      pointerForm: { ok: false, findings: ["MISSING-\u6B63\u672C"] },
      byteCompare: {
        evaluated: false,
        ok: false,
        canonicalBytes: -1,
        liveBytes: -1,
        firstDiffByte: -1,
        notEvaluatedReason: "\u6B63\u672C\u7F3A\u5931"
      },
      uncommitted: "",
      driverResult: driverResult2
    };
  }
  const canonical = extractCanonical(fs.readFileSync(canonicalPath, "utf8"), layer);
  if (canonical === null) {
    const driverResult2 = notEvaluated(
      `MISSING-\u6B63\u672C: ${relPath} \u5185\u672A\u627E\u5230 ${INNER_ANCHOR_BEGIN_MARK}\u2026${INNER_ANCHOR_END_MARK} \u6BB5\uFF08inner \u6B63\u672C\u6BB5\u5C1A\u672A\u843D\u5730\uFF09`
    );
    return {
      ok: false,
      code: driverResultToExit(driverResult2),
      reason: driverResult2.reason,
      layer,
      canonicalPath,
      canonical: null,
      canonicalBytes: -1,
      findings: [],
      pointerForm: { ok: false, findings: ["MISSING-\u6B63\u672C\uFF08\u63D0\u53D6\u6807\u8BB0\u672A\u627E\u5230\uFF09"] },
      byteCompare: {
        evaluated: false,
        ok: false,
        canonicalBytes: -1,
        liveBytes: -1,
        firstDiffByte: -1,
        notEvaluatedReason: "\u6B63\u672C\u6BB5\u7F3A\u5931"
      },
      uncommitted: "",
      driverResult: driverResult2
    };
  }
  const pointerFindings = pointerFormFindings(canonical, layer);
  const uncommitted = opts.canonicalFileOverride ? "" : gitUncommitted(root, relPath);
  if (uncommitted) pointerFindings.push(`\u6B63\u672C\u6709\u672A\u63D0\u4EA4\u6539\u52A8\uFF08\u6F02\u79FB\u672A\u7ECF\u5BA1\u9605\uFF09: ${uncommitted}`);
  const live = cronPrompt === null ? null : cronPrompt;
  const byteCompare = live === null ? {
    evaluated: false,
    ok: false,
    canonicalBytes: Buffer.byteLength(canonical, "utf8"),
    liveBytes: -1,
    firstDiffByte: -1,
    notEvaluatedReason: "\u672A\u63D0\u4F9B\u6D3B prompt\uFF08--cron-prompt/--stdin\uFF09\u2014\u2014\u5224\u636E3 \u65E0\u6CD5\u8BC4\u4F30"
  } : (() => {
    const d = byteDiff(canonical, live);
    return {
      evaluated: true,
      ok: d.match,
      canonicalBytes: d.actualBytes,
      liveBytes: d.expectedBytes,
      firstDiffByte: d.firstDiffByte
    };
  })();
  const findings = [...pointerFindings];
  if (byteCompare.evaluated && !byteCompare.ok) {
    findings.push(`\u5224\u636E3: \u6B63\u672C vs \u6D3B prompt \u9010\u5B57\u8282\u4E0D\u4E00\u81F4\uFF08canonical ${byteCompare.canonicalBytes}b vs live ${byteCompare.liveBytes}b\uFF09`);
    if (live !== null) {
      const liveForm = pointerFormFindings(live, layer);
      if (liveForm.length > 0) {
        findings.push(
          `\u5224\u636E3 \u8BCA\u65AD: \u6D3B prompt \u672C\u8EAB\u975E\u5408\u683C\u6307\u9488\uFF08${liveForm.join(" / ")}\uFF09\u2014\u2014\u6D3B\u503C\u7591\u4F3C\u624B\u5DE5\u7F29\u5199/\u65E7\u7248\uFF0C\u5FC5\u987B\u9010\u5B57\u7B49\u4E8E cron \u5B8C\u6574 prompt\uFF08CronList \u663E\u793A\u622A\u65AD\uFF0C\u4E0D\u53EF\u4F5C\u6D3B\u503C\uFF09`
        );
      }
    }
  }
  const driverResult = findings.length > 0 ? failed(findings.join(" / ")) : !byteCompare.evaluated ? notEvaluated(byteCompare.notEvaluatedReason ?? "\u672A\u63D0\u4F9B\u6D3B prompt") : verified(canonical, "\u6B63\u672C\u5B58\u5728 + \u6307\u9488\u5F62\u5F0F\u5408\u683C + \u5224\u636E3 \u9010\u5B57\u8282\u4E00\u81F4");
  const code = driverResultToExit(driverResult);
  let reason = "OK";
  if (driverResult.state === "failed") {
    reason = "VIOLATED: " + driverResult.reason;
  } else if (driverResult.state === "not-evaluated") {
    reason = "NOT-EVALUATED: \u6307\u9488\u5F62\u5F0F\u5408\u683C\uFF0C\u4F46\u5224\u636E3 \u672A\u8BC4\u4F30\u2014\u2014" + driverResult.reason;
  }
  return {
    ok: code === EXIT_OK,
    code,
    reason,
    layer,
    canonicalPath,
    canonical,
    canonicalBytes: Buffer.byteLength(canonical, "utf8"),
    findings,
    pointerForm: { ok: pointerFindings.length === 0, findings: pointerFindings },
    byteCompare,
    uncommitted,
    driverResult
  };
}
var USAGE = `outer-anchor-check.ts \u2014 AC80 \u4E09\u5C42 prompt \u6B63\u672C + \u4E0D\u53D8\u5F0F\u68C0\u67E5\u5668\uFF08outer/inner \u7684 CronCreate \u951A\uFF09

  node --no-warnings --experimental-strip-types plugin/scripts/outer-anchor-check.ts \\
      --layer inner|outer [--root <repo>] [--canonical-file <path>] [--cron-prompt <text>|--stdin] [--json]

  --layer <inner|outer>   \u5FC5\u9009\uFF1Ainner=fast-mode-loop-tick.md \u5185 AC80 \u6BB5\uFF1Bouter=orchestration/outer-tick-prompt.txt
  --root <dir>            \u4ED3\u5E93\u6839\uFF08\u9ED8\u8BA4 cwd\uFF09
  --canonical-file <path> \u8986\u76D6\u6B63\u672C\u6765\u6E90\uFF08\u6D4B\u8BD5\u63A5\u7F1D\uFF1B\u8DF3\u8FC7\u5DE5\u4F5C\u6811\u68C0\u67E5\uFF09
  --cron-prompt <text>    \u6D3B CronList prompt \u5B8C\u6574\u503C\uFF08\u811A\u672C\u65E0\u6CD5\u8C03\u7528 CronList\uFF0C\u7531\u8C03\u7528\u65B9\u4F20\u5165\uFF1B\u7EDD\u4E0D\u89E3\u6790 CronList \u622A\u65AD\u663E\u793A\uFF09
  --stdin                 \u4ECE stdin \u8BFB\u5B8C\u6574\u6D3B prompt\uFF08\u53D6\u4EE3 --cron-prompt\uFF09
  --json                  \u673A\u5668\u53EF\u8BFB\u8F93\u51FA

  \u9000\u51FA\u7801: 0=OK\uFF08\u6B63\u672C\u5B58\u5728+\u6307\u9488\u5F62\u5F0F\u5408\u683C+\u9010\u5B57\u8282\u4E00\u81F4\uFF09  1=VIOLATED\uFF08\u4EFB\u4E00\u68C0\u67E5\u5931\u8D25\uFF09  2=NOT-EVALUATED\uFF08\u6B63\u672C\u7F3A\u5931/\u672A\u63D0\u4F9B\u6D3B prompt\uFF09`;
function parseArgs(argv) {
  const out = {
    layer: "",
    root: process.cwd(),
    canonicalFile: null,
    cronPrompt: null,
    stdin: false,
    json: false,
    help: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--layer") out.layer = argv[++i] ?? "";
    else if (a === "--root") out.root = argv[++i] ?? out.root;
    else if (a === "--canonical-file") out.canonicalFile = argv[++i] ?? null;
    else if (a === "--cron-prompt") out.cronPrompt = argv[++i] ?? null;
    else if (a === "--stdin") out.stdin = true;
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}
if (isDirectEntry(import.meta, void 0, "outer-anchor-check")) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE + "\n");
    process.exit(0);
  }
  if (args.layer !== "inner" && args.layer !== "outer") {
    process.stderr.write("outer-anchor-check: --layer \u5FC5\u987B\u4E3A inner \u6216 outer\n" + USAGE + "\n");
    process.exit(2);
  }
  let cronPrompt = args.cronPrompt;
  if (args.stdin) {
    cronPrompt = fs.readFileSync(0, "utf8").replace(/\n$/, "");
  }
  const result = checkAnchor({
    layer: args.layer,
    root: args.root,
    canonicalFileOverride: args.canonicalFile ?? void 0,
    cronPrompt
  });
  if (args.json) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: result.ok,
          code: result.code,
          reason: result.reason,
          layer: result.layer,
          canonicalPath: result.canonicalPath,
          canonicalBytes: result.canonicalBytes,
          findings: result.findings,
          pointerForm: result.pointerForm,
          byteCompare: result.byteCompare
        },
        null,
        2
      ) + "\n"
    );
  } else {
    const tag = result.code === EXIT_OK ? "PASS" : result.code === EXIT_VIOLATED ? "VIOLATED" : "NOT-EVALUATED";
    process.stdout.write(`outer-anchor-check: ${tag} \u2014 ${result.reason}
`);
    if (result.code === EXIT_OK) {
      process.stdout.write(
        `  layer=${result.layer} canonical=${path2.basename(result.canonicalPath)} bytes=${result.canonicalBytes} \u5224\u636E3 byte-identical
`
      );
    } else if (result.code === EXIT_VIOLATED) {
      if (result.pointerForm.findings.length > 0) {
        process.stdout.write(`  pointer-form: ${result.pointerForm.findings.join(" / ")}
`);
      }
      if (result.byteCompare.evaluated && !result.byteCompare.ok) {
        process.stdout.write(
          formatDiffContext(result.canonical ?? "", cronPrompt ?? "", result.byteCompare.firstDiffByte) + "\n"
        );
      }
    }
  }
  process.exit(result.code);
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/outer-cron-registry.ts
var EXIT_OK2 = 0;
var EXIT_VIOLATED2 = 1;
var EXIT_NOT_EVALUATED = 2;
function globalDir(env) {
  return env ?? process.env.QUAY_GLOBAL_DIR ?? path3.join(os.homedir(), ".quay-global");
}
function repoSlug(root) {
  return String(root).replace(/\//g, "-");
}
function canonicalRepoRoot(root) {
  try {
    const out = execFileSync2(
      "git",
      ["-C", root, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 1e4 }
    );
    const commonDir = out.trim();
    if (commonDir) return path3.dirname(commonDir);
  } catch {
  }
  return path3.resolve(root);
}
function registryBaseFor(root, env) {
  return path3.join(globalDir(env), repoSlug(canonicalRepoRoot(root)));
}
function registryFileFor(root, layer, base) {
  return path3.join(base ?? registryBaseFor(root), layer, "loop-registry.txt");
}
function auditFileFor(root, base) {
  return path3.join(base ?? registryBaseFor(root), "cron-registry-events.jsonl");
}
var SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1e3;
var CRITICAL_REMAINING_MS = 24 * 60 * 60 * 1e3;
function sha256Hex(s) {
  return crypto.createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
}
function parseRegistryText(text) {
  const kv = {};
  for (const line of String(text).split("\n")) {
    const m = line.match(/^([A-Za-z][A-Za-z0-9]*)=(.*)$/);
    if (m) kv[m[1]] = m[2].trim();
  }
  if (!kv.cronId) return null;
  return {
    cronId: kv.cronId,
    cronExpr: kv.cronExpr ?? "",
    promptSha256: kv.promptSha256 ?? "",
    promptBytes: kv.promptBytes ? Number(kv.promptBytes) : void 0,
    createdAt: kv.createdAt ?? "",
    verifiedAt: kv.verifiedAt ?? ""
  };
}
function serializeRegistryText(rec) {
  return [
    `cronId=${rec.cronId}`,
    `cronExpr=${rec.cronExpr}`,
    `promptSha256=${rec.promptSha256}`,
    `promptBytes=${rec.promptBytes ?? ""}`,
    `createdAt=${rec.createdAt}`,
    `verifiedAt=${rec.verifiedAt}`
  ].join("\n") + "\n";
}
function loadRegistry(root, base) {
  const layers = {};
  for (const layer of Object.keys(LAYERS)) {
    try {
      const rec = parseRegistryText(fs2.readFileSync(registryFileFor(root, layer, base), "utf8"));
      if (rec) layers[layer] = rec;
    } catch {
    }
  }
  if (Object.keys(layers).length === 0) return null;
  return {
    version: 1,
    note: "AC81 \u6CE8\u518C\u8868\u6536\u636E\uFF08\u5168\u5C40 per-layer\uFF1A~/.quay-global/<repo-root-slug>/{outer,inner}/loop-registry.txt\uFF1B\u4EFB\u4F55 worktree \u8BFB\u5F53\u524D\u771F\u503C\uFF0C\u975E fork \u5FEB\u7167\uFF09",
    layers
  };
}
function writeRegistryRecord(root, layer, rec, base) {
  const p = registryFileFor(root, layer, base);
  fs2.mkdirSync(path3.dirname(p), { recursive: true });
  fs2.writeFileSync(p, serializeRegistryText(rec), "utf8");
  return p;
}
function appendAuditLine(root, layer, event, base) {
  const p = auditFileFor(root, base);
  fs2.mkdirSync(path3.dirname(p), { recursive: true });
  const line = JSON.stringify({ ts: (/* @__PURE__ */ new Date()).toISOString(), layer, ...event }) + "\n";
  fs2.appendFileSync(p, line, "utf8");
  return p;
}
function recordLayer(root, layer, rec, base) {
  if (!rec.cronId || !rec.cronExpr) {
    return { ok: false, reason: "record \u7F3A cron-id/cron-expr" };
  }
  if (rec.canonicalPrompt === null) {
    return { ok: false, reason: "record \u62D2\u7EDD\uFF1A\u8BE5\u5C42\u6B63\u672C\u7F3A\u5931\uFF0C\u65E0\u6CD5\u8BA1\u7B97 promptSha256\uFF08\u6536\u636E\u5FC5\u987B\u53EF\u88AB\u5224\u636E\u2463\u6838\u5B9E\uFF09" };
  }
  const nowMs = rec.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const full = {
    cronId: rec.cronId,
    cronExpr: rec.cronExpr,
    promptSha256: sha256Hex(rec.canonicalPrompt),
    promptBytes: Buffer.byteLength(rec.canonicalPrompt, "utf8"),
    createdAt: nowIso,
    verifiedAt: nowIso
  };
  const file = writeRegistryRecord(root, layer, full, base);
  const auditFile = appendAuditLine(root, layer, {
    event: "anchor-rebuild",
    cronId: full.cronId,
    cronExpr: full.cronExpr,
    promptSha256: full.promptSha256,
    promptBytes: full.promptBytes,
    createdAt: full.createdAt,
    verifiedAt: full.verifiedAt
  }, base);
  return { ok: true, reason: `recorded ${layer} cronId=${full.cronId}\uFF08sha256=${full.promptSha256.slice(0, 12)}\u2026\uFF09`, file, auditFile };
}
function parseCronList(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const arr = Array.isArray(data) ? data : [data];
  if (arr.length === 0) return [];
  const jobs = [];
  for (const j of arr) {
    if (typeof j !== "object" || j === null) return null;
    const o = j;
    const id = typeof o.id === "string" ? o.id : typeof o.name === "string" ? o.name : typeof o.cronId === "string" ? o.cronId : null;
    if (id === null) return null;
    jobs.push({ id });
  }
  return jobs;
}
function cronListExactlyOne(jobs) {
  return jobs !== null && jobs.length === 1;
}
function remainingLifetimeMs(createdAt, nowMs) {
  const createdMs = Date.parse(createdAt);
  if (Number.isNaN(createdMs)) return null;
  return createdMs + SEVEN_DAYS_MS - nowMs;
}
function cronMinuteSet(expr) {
  const fields = expr.trim().split(/\s+/);
  if (fields.length < 5) return null;
  const minuteField = fields[fields.length - 5];
  const out = /* @__PURE__ */ new Set();
  for (const part of minuteField.split(",")) {
    const p = part.trim();
    if (p === "") return null;
    let lo;
    let hi;
    let step = 1;
    if (p === "*") {
      lo = 0;
      hi = 59;
    } else if (/^\*\/(\d+)$/.test(p)) {
      lo = 0;
      hi = 59;
      step = Number(p.slice(2));
    } else if (/^(\d+)\/(\d+)$/.test(p)) {
      const m = /^(\d+)\/(\d+)$/.exec(p);
      lo = Number(m[1]);
      hi = 59;
      step = Number(m[2]);
    } else if (/^(\d+)-(\d+)$/.test(p)) {
      const m = /^(\d+)-(\d+)$/.exec(p);
      lo = Number(m[1]);
      hi = Number(m[2]);
    } else if (/^\d+$/.test(p)) {
      lo = Number(p);
      hi = Number(p);
    } else {
      return null;
    }
    if (!Number.isInteger(step) || step < 1 || lo < 0 || hi > 59 || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}
function cronExprsEquivalent(a, b) {
  if (a === b) return true;
  const fa = a.trim().split(/\s+/);
  const fb = b.trim().split(/\s+/);
  if (fa.length !== fb.length || fa.length < 5) return false;
  const ma = cronMinuteSet(a);
  const mb = cronMinuteSet(b);
  if (ma === null || mb === null) return false;
  if (ma.length !== mb.length) return false;
  for (let i = 0; i < ma.length; i++) if (ma[i] !== mb[i]) return false;
  for (let i = 0; i < fa.length; i++) {
    if (i === fa.length - 5) continue;
    if (fa[i] !== fb[i]) return false;
  }
  return true;
}
function checkVerify(opts) {
  const { layer, registry, cronListRaw, canonicalPrompt } = opts;
  const nowMs = opts.nowMs ?? Date.now();
  const staleSeconds = opts.staleSeconds ?? 7 * 24 * 60 * 60;
  const findings = [];
  const result = {
    ok: false,
    code: EXIT_NOT_EVALUATED,
    layer,
    reason: "",
    criteria: {
      cronListExactlyOne: { ok: false, reason: "NOT-EVALUATED" },
      idMatches: { ok: false, reason: "NOT-EVALUATED" },
      registryVerified: { ok: false, reason: "NOT-EVALUATED" },
      anchorMatches: { ok: false, reason: "NOT-EVALUATED", evaluated: false }
    },
    cronExprMatch: null,
    remaining: {
      createdAt: null,
      remainingMs: null,
      remainingHours: null,
      critical: false,
      expired: false
    },
    findings
  };
  if (registry === null) {
    result.reason = "NOT-EVALUATED: \u6CE8\u518C\u8868\u7F3A\u5931/\u4E0D\u53EF\u89E3\u6790\uFF08\u5168\u5C40 per-layer ~/.quay-global/<repo-root-slug>/{outer,inner}/loop-registry.txt\uFF09";
    result.findings.push("registry-missing");
    return result;
  }
  const rec = registry.layers?.[layer];
  if (!rec) {
    result.reason = `NOT-EVALUATED: \u6CE8\u518C\u8868\u65E0\u8BE5\u5C42\u8BB0\u5F55\uFF08layer=${layer}\uFF09`;
    result.findings.push(`registry-missing-layer:${layer}`);
    return result;
  }
  const remainingMs = remainingLifetimeMs(rec.createdAt, nowMs);
  result.remaining.createdAt = rec.createdAt;
  result.remaining.remainingMs = remainingMs;
  result.remaining.remainingHours = remainingMs === null ? null : Math.floor(remainingMs / (60 * 60 * 1e3));
  result.remaining.expired = remainingMs !== null && remainingMs <= 0;
  result.remaining.critical = remainingMs !== null && remainingMs < CRITICAL_REMAINING_MS;
  if (result.remaining.expired) {
    findings.push("\u5224\u636E5: \u951A\u5DF2\u8FC7\u671F\uFF08createdAt+7d \u5DF2\u8FC7\uFF09\u2014\u2014\u6CE8\u518C\u8868\u6536\u636E\u8FD8\u5728\uFF0Ccron \u5E94\u5DF2\u81EA\u52A8\u5220\u9664");
  } else if (result.remaining.critical) {
    findings.push(
      `\u5224\u636E5: \u951A\u5269\u4F59\u5BFF\u547D < 24h\uFF08\u5269 ${result.remaining.remainingHours}h\uFF09\u2014\u2014CronCreate 7 \u5929\u81EA\u52A8\u8FC7\u671F\u5C06\u81F3\uFF0C\u9700\u6E05\u626B\u91CD\u5EFA`
    );
  }
  if (cronListRaw === null || cronListRaw === "") {
    result.reason = "NOT-EVALUATED: \u672A\u63D0\u4F9B --cron-list\uFF08\u5224\u636E\u2460\u2461 \u65E0\u6CD5\u8BC4\u4F30\uFF09";
    result.findings.push("cron-list-missing");
    result.criteria.cronListExactlyOne = { ok: false, reason: "NOT-EVALUATED: \u65E0 --cron-list" };
    result.criteria.idMatches = { ok: false, reason: "NOT-EVALUATED: \u65E0 --cron-list" };
    return result;
  }
  const jobs = parseCronList(cronListRaw);
  const c1 = cronListExactlyOne(jobs);
  result.criteria.cronListExactlyOne = c1 ? { ok: true, reason: `CronList \u6070\u4E00\u6761\uFF08id=${jobs[0].id}\uFF09` } : { ok: false, reason: jobs === null ? "CronList \u65E0\u6CD5\u89E3\u6790" : `CronList \u6761\u6570=${jobs.length}\uFF08\u987B\u6070\u4E00\u6761\uFF09` };
  if (!c1) findings.push(`\u5224\u636E\u2460: ${result.criteria.cronListExactlyOne.reason}`);
  const c2 = c1 && jobs !== null && jobs[0].id === rec.cronId;
  result.criteria.idMatches = c2 ? { ok: true, reason: `id==\u6CE8\u518C\u8868\uFF08${rec.cronId}\uFF09` } : {
    ok: false,
    reason: c1 ? `CronList id\uFF08${jobs[0].id}\uFF09\u2260 \u6CE8\u518C\u8868\uFF08${rec.cronId}\uFF09` : "\u2461 \u4F9D\u9644\u4E8E\u2460\uFF08CronList \u975E\u6070\u4E00\u6761\uFF09"
  };
  if (c1 && !c2) findings.push(`\u5224\u636E\u2461: ${result.criteria.idMatches.reason}`);
  const vAtMs = Date.parse(rec.verifiedAt ?? "");
  const fresh = Number.isNaN(vAtMs) ? false : vAtMs <= nowMs && nowMs - vAtMs <= staleSeconds * 1e3;
  result.criteria.registryVerified = fresh ? { ok: true, reason: `registry-verified\uFF08verifiedAt=${rec.verifiedAt}\uFF09` } : {
    ok: false,
    reason: Number.isNaN(vAtMs) ? "registry-not-verified: \u7F3A verifiedAt \u6536\u636E" : vAtMs > nowMs ? "registry-not-verified: verifiedAt \u5728\u672A\u6765\uFF08\u65F6\u949F\u504F\u79FB\uFF09" : `registry-not-verified: \u6536\u636E\u8FC7\u671F\uFF08verifiedAt=${rec.verifiedAt}\uFF0C>${staleSeconds}s\uFF09`
  };
  if (!fresh) findings.push(`\u5224\u636E\u2462: ${result.criteria.registryVerified.reason}`);
  let c4;
  if (canonicalPrompt === null) {
    result.criteria.anchorMatches = { ok: false, reason: "NOT-EVALUATED: \u6B63\u672C\u7F3A\u5931", evaluated: false };
    const c123Fail = !c1 || !c2 || !fresh;
    if (c123Fail) {
      result.ok = false;
      result.code = EXIT_VIOLATED2;
      result.reason = "VIOLATED: " + (findings.length > 0 ? findings.join(" / ") : "\u5224\u636E\u2463 \u6B63\u672C\u7F3A\u5931");
    } else {
      result.ok = false;
      result.code = EXIT_NOT_EVALUATED;
      result.reason = "NOT-EVALUATED: \u2460-\u2462 \u5168\u771F\uFF0C\u4F46\u5224\u636E\u2463 \u6B63\u672C\u7F3A\u5931\uFF08\u8BE5\u5C42\u6B63\u672C\u5C1A\u672A\u843D\u5730\uFF09";
      result.findings.push("\u5224\u636E\u2463: NOT-EVALUATED\uFF08\u6B63\u672C\u7F3A\u5931\uFF09");
    }
    return result;
  }
  const canonHash = sha256Hex(canonicalPrompt);
  c4 = canonHash === rec.promptSha256;
  result.criteria.anchorMatches = c4 ? { ok: true, reason: `prompt sha256==\u6B63\u672C\uFF08${canonHash.slice(0, 12)}\u2026\uFF09`, evaluated: true } : { ok: false, reason: `prompt sha256\uFF08${canonHash.slice(0, 12)}\u2026\uFF09\u2260 \u6CE8\u518C\u8868\uFF08${rec.promptSha256.slice(0, 12)}\u2026\uFF09`, evaluated: true };
  if (!c4) findings.push(`\u5224\u636E\u2463: ${result.criteria.anchorMatches.reason}`);
  let cronExprMatch = null;
  if (c1 && jobs !== null) {
    const raw = JSON.parse(cronListRaw);
    const entry = Array.isArray(raw) ? raw[0] : raw;
    const expr = typeof entry?.schedule === "string" ? entry.schedule : typeof entry?.cron === "string" ? entry.cron : typeof entry?.expr === "string" ? entry.expr : typeof entry?.interval === "string" ? entry.interval : null;
    cronExprMatch = expr === null ? null : cronExprsEquivalent(expr, rec.cronExpr);
    if (expr !== null && !cronExprsEquivalent(expr, rec.cronExpr)) {
      findings.push(`cron-expr-mismatch: CronList\uFF08${expr}\uFF09\u2260 \u6CE8\u518C\u8868\uFF08${rec.cronExpr}\uFF09`);
    }
  }
  result.cronExprMatch = cronExprMatch;
  const fourOk = c1 && c2 && fresh && c4;
  const fiveOk = !result.remaining.expired && !result.remaining.critical;
  if (fourOk && fiveOk && findings.length === 0) {
    result.ok = true;
    result.code = EXIT_OK2;
    result.reason = "OK: \u56DB\u5224\u636E\u5168\u771F + \u5269\u4F59\u5BFF\u547D\u6B63\u5E38";
  } else if (fourOk && fiveOk) {
    result.ok = false;
    result.code = EXIT_VIOLATED2;
    result.reason = "VIOLATED: " + findings.join(" / ");
  } else if (fourOk && !fiveOk) {
    result.ok = false;
    result.code = EXIT_VIOLATED2;
    result.reason = "VIOLATED: \u56DB\u5224\u636E\u5168\u771F\uFF0C\u4F46\u5224\u636E5 \u5269\u4F59\u5BFF\u547D\u9884\u8B66\u89E6\u53D1";
  } else {
    result.ok = false;
    result.code = EXIT_VIOLATED2;
    result.reason = "VIOLATED: " + findings.join(" / ");
  }
  return result;
}
function readCanonicalPrompt(root, layer, override) {
  if (override) {
    if (!fs2.existsSync(override)) return null;
    return extractCanonical(fs2.readFileSync(override, "utf8"), layer);
  }
  const cfg = LAYERS[layer];
  if (!cfg) return null;
  const p = path3.resolve(root, cfg.canonicalRel);
  if (!fs2.existsSync(p)) return null;
  return extractCanonical(fs2.readFileSync(p, "utf8"), layer);
}
var USAGE2 = `outer-cron-registry.ts \u2014 AC81 \u6CE8\u518C\u8868\u6536\u636E + \u6BCF\u8F6E\u56DB\u5224\u636E\u6838\u5B9E\uFF08outer/inner \u7684 CronCreate \u951A\uFF09
\u6CE8\u518C\u8868\u4F4D\u7F6E\uFF08\u5168\u5C40 per-layer\uFF0C2026-08-17 \u4EBA\u88C1\u5B9A\u65B9\u6848\u2461\uFF09\uFF1A~/.quay-global/<repo-root-slug>/{outer,inner}/loop-registry.txt

  node --no-warnings --experimental-strip-types plugin/scripts/outer-cron-registry.ts --verify \\
      --layer inner|outer [--cron-list '<json>'] [--canonical-file <path>] [--registry-base <dir>] \\
      [--root <dir>] [--stale-seconds <n>] [--json]
  node --no-warnings --experimental-strip-types plugin/scripts/outer-cron-registry.ts --show [--root <dir>] [--json]
  node --no-warnings --experimental-strip-types plugin/scripts/outer-cron-registry.ts --record \\
      --layer inner|outer --cron-id <id> --cron-expr '<expr>' [--canonical-file <path>] \\
      [--registry-base <dir>] [--root <dir>] [--json]

  --verify              \u6838\u5B9E\u6A21\u5F0F\uFF1A\u56DB\u5224\u636E\uFF08\u2460CronList \u6070\u4E00\u6761 \u2461id==\u6CE8\u518C\u8868 \u2462registry-verified \u2463prompt sha256==\u6B63\u672C\uFF09+ \u5224\u636E5\uFF08\u5269\u4F59\u5BFF\u547D<24h \u5373\u62A5\uFF09\u3002
  --record              \u8BB0\u5F55\u6A21\u5F0F\uFF1A\u951A\u91CD\u5EFA\u540E\u628A\u65B0\u6536\u636E\u5199\u8FDB\u8BE5\u5C42\u5168\u5C40\u6CE8\u518C\u8868 + \u8FFD\u52A0\u5BA1\u8BA1 jsonl\uFF08AC5\uFF1B\u66FF\u4EE3\u624B\u6539 git JSON \u5E76\u63D0\u4EA4\uFF09\u3002
  --layer <inner|outer> \u9009\u5B9A\u5C42\u3002
  --cron-id <id>        --record \u7684\u65B0 cron id\uFF08CronCreate \u8FD4\u56DE\u503C / CronList \u6D3B\u503C\uFF09\u3002
  --cron-expr <expr>    --record \u7684 cron \u8868\u8FBE\u5F0F\uFF08\u6295\u8FDB CronCreate \u7684\u8868\u8FBE\u5F0F\uFF09\u3002
  --cron-list <json>    CronList \u6D3B\u89C6\u56FE\uFF08\u811A\u672C\u65E0\u6CD5\u8C03\u7528 CronList\uFF0C\u7531\u8C03\u7528\u65B9\u4F20\u5165\uFF09\uFF1AJSON \u6570\u7EC4\u6216\u5355\u5BF9\u8C61\uFF0C\u6BCF\u6761\u542B id\uFF08id|name|cronId\uFF09\u3002
  --canonical-file <p>  \u8986\u76D6\u6B63\u672C\u6765\u6E90\uFF08\u6D4B\u8BD5\u63A5\u7F1D\uFF09\u3002
  --registry-base <dir> \u8986\u76D6\u6CE8\u518C\u8868\u57FA\u76EE\u5F55\uFF08\u6D4B\u8BD5\u63A5\u7F1D\uFF1B\u9ED8\u8BA4 ~/.quay-global/<repo-root-slug>\uFF09\u3002
  --root <dir>          \u4ED3\u5E93\u6839\uFF08\u9ED8\u8BA4 cwd\uFF1B\u51B3\u5B9A slug\uFF09\u3002
  --stale-seconds <n>   \u5224\u636E\u2462 \u6536\u636E\u65B0\u9C9C\u5EA6\u7A97\u53E3\uFF08\u9ED8\u8BA4 604800 = 7 \u5929\uFF09\u3002
  --show                \u6253\u5370\u4E24\u5C42\u6CE8\u518C\u8868\u6536\u636E\uFF08\u5224\u636E1 \u76F4\u63A5\u53EF\u67E5\uFF09\u3002
  --json                \u673A\u5668\u53EF\u8BFB\u8F93\u51FA\u3002

  \u9000\u51FA\u7801: 0=OK\uFF08\u56DB\u5224\u636E\u5168\u771F+\u5269\u4F59\u5BFF\u547D\u6B63\u5E38\uFF09  1=VIOLATED\uFF08\u4EFB\u4E00\u5224\u636E\u5047\u6216\u5269\u4F59<24h\uFF09  2=NOT-EVALUATED\uFF08\u65E0 --cron-list/\u6CE8\u518C\u8868\u7F3A\u5931/\u6B63\u672C\u7F3A\u5931\uFF09`;
function parseArgs2(argv) {
  const out = {
    verify: false,
    show: false,
    record: false,
    layer: "",
    cronId: null,
    cronExpr: null,
    cronList: null,
    canonicalFile: null,
    registryBase: null,
    root: process.cwd(),
    staleSeconds: 7 * 24 * 60 * 60,
    json: false,
    help: false
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--verify") out.verify = true;
    else if (a === "--show") out.show = true;
    else if (a === "--record") out.record = true;
    else if (a === "--layer") out.layer = argv[++i] ?? "";
    else if (a === "--cron-id") out.cronId = argv[++i] ?? null;
    else if (a === "--cron-expr") out.cronExpr = argv[++i] ?? null;
    else if (a === "--cron-list") out.cronList = argv[++i] ?? null;
    else if (a === "--canonical-file") out.canonicalFile = argv[++i] ?? null;
    else if (a === "--registry-base") out.registryBase = argv[++i] ?? null;
    else if (a === "--root") out.root = argv[++i] ?? out.root;
    else if (a === "--stale-seconds") out.staleSeconds = Number(argv[++i] ?? 604800);
    else if (a === "--json") out.json = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}
function formatShow(registry, layer) {
  if (registry === null) return "registry-missing";
  const layers = layer ? [layer] : Object.keys(registry.layers);
  const lines = [];
  for (const l of layers) {
    const r = registry.layers?.[l];
    if (!r) {
      lines.push(`${l}: registry-missing-layer`);
      continue;
    }
    lines.push(
      `${l}: cronId=${r.cronId} cronExpr=${r.cronExpr} promptSha256=${r.promptSha256.slice(0, 16)}\u2026 createdAt=${r.createdAt} verifiedAt=${r.verifiedAt}`
    );
  }
  return lines.join("\n");
}
if (process.argv[1] && path3.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs2(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(USAGE2 + "\n");
    process.exit(0);
  }
  const registry = loadRegistry(args.root, args.registryBase ?? void 0);
  if (args.show) {
    if (args.json) {
      process.stdout.write(JSON.stringify(registry ?? { error: "registry-missing" }, null, 2) + "\n");
    } else {
      process.stdout.write(`outer-cron-registry: ${formatShow(registry)}
`);
    }
    process.exit(registry === null ? 1 : 0);
  }
  if (args.record) {
    if (args.layer !== "inner" && args.layer !== "outer") {
      process.stderr.write("outer-cron-registry: --record \u9700 --layer inner|outer\n" + USAGE2 + "\n");
      process.exit(2);
    }
    const canonicalPrompt2 = readCanonicalPrompt(args.root, args.layer, args.canonicalFile ?? void 0);
    const rec = recordLayer(args.root, args.layer, {
      cronId: args.cronId ?? "",
      cronExpr: args.cronExpr ?? "",
      canonicalPrompt: canonicalPrompt2
    }, args.registryBase ?? void 0);
    if (args.json) {
      process.stdout.write(JSON.stringify(rec, null, 2) + "\n");
    } else {
      process.stdout.write(rec.ok ? `outer-cron-registry: ${rec.reason}
` : `outer-cron-registry: ERROR \u2014 ${rec.reason}
`);
    }
    process.exit(rec.ok ? 0 : 2);
  }
  if (!args.verify) {
    process.stderr.write("outer-cron-registry: \u9700 --verify / --show / --record\n" + USAGE2 + "\n");
    process.exit(2);
  }
  if (args.layer !== "inner" && args.layer !== "outer") {
    process.stderr.write("outer-cron-registry: --layer \u5FC5\u987B\u4E3A inner \u6216 outer\n" + USAGE2 + "\n");
    process.exit(2);
  }
  const canonicalPrompt = readCanonicalPrompt(args.root, args.layer, args.canonicalFile ?? void 0);
  const result = checkVerify({
    layer: args.layer,
    registry,
    cronListRaw: args.cronList,
    canonicalPrompt,
    staleSeconds: args.staleSeconds
  });
  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } else {
    const tag = result.code === EXIT_OK2 ? "PASS" : result.code === EXIT_VIOLATED2 ? "VIOLATED" : "NOT-EVALUATED";
    process.stdout.write(`outer-cron-registry: ${tag} \u2014 ${result.reason}
`);
    for (const c of ["cronListExactlyOne", "idMatches", "registryVerified", "anchorMatches"]) {
      const cr = result.criteria[c];
      process.stdout.write(`  \u5224\u636E ${c}: ${cr.ok ? "\u771F" : "\u5047"} \u2014 ${cr.reason}
`);
    }
    process.stdout.write(
      `  \u5224\u636E5 \u5269\u4F59\u5BFF\u547D: ${result.remaining.remainingHours === null ? "n/a" : result.remaining.remainingHours + "h"}\uFF08createdAt=${result.remaining.createdAt}\uFF09` + (result.remaining.critical ? " \u2014 CRITICAL <24h\uFF0C\u9700\u6E05\u626B\u91CD\u5EFA\n" : result.remaining.expired ? " \u2014 \u5DF2\u8FC7\u671F\n" : " \u2014 \u6B63\u5E38\n")
    );
  }
  process.exit(result.code);
}
export {
  CRITICAL_REMAINING_MS,
  EXIT_NOT_EVALUATED,
  EXIT_OK2 as EXIT_OK,
  EXIT_VIOLATED2 as EXIT_VIOLATED,
  SEVEN_DAYS_MS,
  appendAuditLine,
  auditFileFor,
  canonicalRepoRoot,
  checkVerify,
  cronExprsEquivalent,
  cronListExactlyOne,
  cronMinuteSet,
  formatShow,
  globalDir,
  loadRegistry,
  parseArgs2 as parseArgs,
  parseCronList,
  parseRegistryText,
  recordLayer,
  registryBaseFor,
  registryFileFor,
  remainingLifetimeMs,
  repoSlug,
  serializeRegistryText,
  sha256Hex,
  writeRegistryRecord
};
