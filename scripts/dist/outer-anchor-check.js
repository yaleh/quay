import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

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
var EXIT_NOT_EVALUATED = 2;
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
export {
  DECISION_WORDS,
  EXIT_NOT_EVALUATED,
  EXIT_OK,
  EXIT_VIOLATED,
  INNER_ANCHOR_BEGIN_MARK,
  INNER_ANCHOR_END_MARK,
  LAYERS,
  byteDiff,
  checkAnchor,
  extractCanonical,
  formatDiffContext,
  gitUncommitted,
  pointerFormFindings
};
