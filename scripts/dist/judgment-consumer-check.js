#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/judgment-consumer-check.ts
import fs from "node:fs";
import path2 from "node:path";

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/gate-script-base.ts
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

// .tmp-dist-publish-worktrees/publish-3UCaVR/scripts/judgment-consumer-check.ts
var JUDGMENT_CONSUMERS = [
  {
    judgment: "deficit",
    producer: "plugin/scripts/ready-pool-check.ts",
    consumer: "promotion-driver \u5E38\u9A7B\u5FAA\u73AF\u2014\u2014\u6BCF\u8F6E `ready-pool-check --apply` \u5168\u6C60\u5224\u5B9A + \u5408\u683C\u664B\u5347\uFF08AC130/131\uFF09\uFF1B\u539F B9 \u7B2C\u4E09\u89E6\u53D1\u5668\u968F A22 \u9000\u5F79\uFF08AC135\uFF09",
    verify: [
      { file: "plugin/scripts/promotion-driver.ts", pattern: "ready-pool-check|--apply", expect: "present" },
      { file: "plugin/scripts/ready-pool-check.ts", pattern: "--apply|shouldApply", expect: "present" }
    ],
    status: "wired",
    instance: "instance-3 (22:0x deficit \u6BCF\u8F6E\u7B97\u51FA\u65E0\u89E6\u53D1\u5668\u8BFB, \u5DF2\u4FEE B9)",
    note: "outer 77f17d95 \u63A5\u7EBF\u539F B9 \u7B2C\u4E09\u89E6\u53D1\u5668\uFF082026-08-10\uFF09\uFF1BAC135 \u8D77\u6D88\u8D39\u65B9\u4E3A promotion-driver\u3002"
  },
  {
    judgment: "not-yet-flipped",
    producer: "plugin/scripts/ready-pool-check.ts",
    consumer: "slot-refill \u7B2C 4 \u9879 step-4 \u68C0\u67E5 `isNotYetFlippedSkip`\u2014\u2014\u5DF2 fan-in \u5F85\u7FFB done \u7684\u4EFB\u52A1\u4E0D\u8FDB\u63A8\u8350\u5019\u9009",
    verify: [{ file: "plugin/scripts/slot-refill.ts", pattern: "not-yet-flipped|excluded", expect: "present" }],
    status: "wired",
    instance: "instance-1 (18:4x not-yet-flipped \u7B97\u51FA\u672A\u63A5\u63A8\u8350\u8DEF\u5F84, \u5DF2\u4FEE)",
    note: "gap-slot-refill-repeats-done-eligible-recommendations \u5DF2\u4FEE\uFF082026-08-10\uFF09\u3002"
  },
  {
    judgment: "self-touch-scan",
    producer: "plugin/scripts/touches-orthogonality-check.ts",
    consumer: "slot-refill step-4 check 5 C8 \u9010\u5019\u9009\u95E8\u5DF2\u63A5\u7EBF\uFF08\u7F3A self-touch \u21D2 defer \u62D2\u6D3E\u53D1\uFF09\uFF1BC8 \u62D2\u540E\u4ECE\u6392\u5E8F\u66F4\u540E\u56DE\u586B\u8865\u4F4D\uFF08gap-slot-refill-c8-reject-no-backfill 84a64047\uFF09",
    verify: [
      { file: "plugin/scripts/touches-orthogonality-check.ts", pattern: "--self-touch-scan", expect: "present" },
      { file: "plugin/loop/fast-mode-tick-core.md", pattern: "--self-touch", expect: "present" },
      // wired proof: slot-refill 的 C8 逐候选门 + 回填（selfTouchCheck / self-touch-missing-c8 defer）已在。
      { file: "plugin/scripts/slot-refill.ts", pattern: "selfTouchCheck|self-touch-missing-c8|backfill", expect: "present" }
    ],
    status: "wired",
    instance: "instance-2 (21:4x self-touch-scan \u5019\u9009\u88AB C8 \u62D2\u540E\u4E0D\u56DE\u586B, \u5DF2\u4FEE 84a64047)",
    note: "\u6B62\u8840 791a8909\uFF085 \u4EFB\u52A1\u8865 self-touch\uFF09\uFF1B\u7ED3\u6784\u89E3\uFF08\u56DE\u586B\uFF0984a64047 \u5DF2\u63A5\u7EBF\u3002"
  },
  {
    judgment: "dispatchable_disjoint\uFF08\u53CC\u7B97\u5BA1\u8BA1\uFF09",
    producer: "plugin/scripts/ready-pool-check.ts",
    consumer: "slot-refill `should_refill = slots_free > 0 && dispatchable_disjoint >= 1`\uFF1B`criterion_met` \u900F\u4F20 slot-refill \u8F93\u51FA",
    verify: [{ file: "plugin/scripts/slot-refill.ts", pattern: "dispatchable_disjoint", expect: "present" }],
    status: "wired",
    note: "\u5BA1\u8BA1\u7ED3\u8BBA\uFF1Adispatchable_disjoint\uFF08\u5224\u636E\uFF09\u4E0E criterion_met\uFF08\u6D3E\u751F\u5E03\u5C14\uFF09\u5747\u6709\u6D88\u8D39\u65B9\uFF0C\u65E0\u53CC\u7B97\u6B8B\u7559\u3002"
  },
  {
    judgment: "obligation \u53F0\u8D26",
    producer: "plugin/scripts/obligation-ledger.ts",
    consumer: "obligation-ledger-check \u5B8C\u6574\u6027\u5BA1\u8BA1\uFF08wired \u8FDB run_static_checks\uFF09+ \u53F0\u8D26 shape \u6D4B\u8BD5",
    verify: [{ file: "plugin/scripts/runner-static-gate.ts", pattern: "obligation-ledger-check", expect: "present" }],
    status: "wired",
    note: "runner-static-gate.ts run_static_checks \u6709 obligation-ledger-check \u68C0\u67E5\u5668\uFF08gap-ac128 hub \u62C6\u5206\u81EA scripts/test.sh \u8FC1\u5165\uFF09\u3002"
  },
  {
    judgment: "closure-lag \u4FE1\u53F7",
    producer: "plugin/scripts/closure-lag-check.sh",
    consumer: "A10 \u6BCF tick \u62A5 WARN + \u5347\u7EA7\uFF08orchestrator-tick-core\uFF09\uFF1BB2 --record \u5199 trace",
    verify: [{ file: "orchestration/orchestrator-tick-core.md", pattern: "closure-lag-check", expect: "present" }],
    status: "wired",
    note: "orchestrator-tick-core A10/B2 \u662F\u6D88\u8D39\u65B9\u3002"
  }
];
function auditEntry(entry, root) {
  const failures = [];
  for (const v of entry.verify) {
    const abs = path2.join(root, v.file);
    let actual;
    if (!fs.existsSync(abs)) {
      actual = "missing-file";
    } else {
      const src = fs.readFileSync(abs, "utf8");
      actual = new RegExp(v.pattern).test(src) ? "present" : "absent";
    }
    const ok = v.expect === "present" ? actual === "present" : actual === "absent";
    if (!ok) failures.push({ file: v.file, pattern: v.pattern, expect: v.expect, actual });
  }
  return {
    judgment: entry.judgment,
    status: entry.status,
    verified: failures.length === 0,
    failures,
    hasConsumer: Boolean(entry.consumer && entry.consumer.trim())
  };
}
function auditAll(root) {
  const entries = JUDGMENT_CONSUMERS.map((e) => auditEntry(e, root));
  const wired = entries.filter((e) => e.status === "wired").length;
  const unfinished = entries.filter((e) => e.status === "unfinished" || e.status === "wired" && !e.verified).map((e) => e.judgment);
  const drift = entries.some((e) => !e.verified);
  return { mode: "judgment-consumer-audit", judgments_total: entries.length, wired, unfinished, drift, entries };
}
function listPlain() {
  console.log("judgment-consumer-check \u2014 \u5224\u636E\u2192\u6D88\u8D39\u52A8\u4F5C registry\uFF08\u6BCF\u4E2A\u673A\u68B0\u5224\u636E\u5FC5\u987B\u6709\u6D88\u8D39\u5B83\u7684\u52A8\u4F5C\uFF09");
  console.log("");
  for (const e of JUDGMENT_CONSUMERS) {
    const mark = e.status === "wired" ? "wired      " : "UNFINISHED ";
    console.log(`${mark} ${e.judgment}`);
    console.log(`          producer: ${e.producer}`);
    console.log(`          consumer: ${e.consumer}`);
    for (const v of e.verify) {
      console.log(`          verify[${v.expect}] ${v.file} ~/${v.pattern}/`);
    }
    if (e.pendingTask) console.log(`          pending: ${e.pendingTask}`);
    if (e.note) console.log(`          note: ${e.note}`);
    console.log("");
  }
}
function reportText(r) {
  console.log(`judgment-consumer-check \u2014 ${r.judgments_total} \u5224\u636E\uFF08registry \u5355\u4E00\u6B63\u672C\uFF09`);
  console.log(`wired: ${r.wired} \xB7 unfinished: ${r.unfinished.length}`);
  for (const e of r.entries) {
    const mark = e.verified ? "ok  " : "FAIL";
    console.log(`  [${mark}] ${e.status} ${e.judgment}`);
    for (const f of e.failures) {
      console.log(`        consumer NOT wired: ${f.file} expect:${f.expect} got:${f.actual} ~/${f.pattern}/`);
    }
  }
  if (r.unfinished.length > 0) {
    console.log("UNFINISHED\uFF08\u65E0\u6D88\u8D39\u65B9\u5224\u636E\uFF0C\u5217\u672A\u5B8C\u6210\uFF0C\u4E0D\u9759\u9ED8\u7EFF\uFF09:");
    for (const u of r.unfinished) console.log(`  - ${u}`);
  }
  if (r.drift) {
    console.log("RESULT: FAIL \u2014 \u6709\u5224\u636E\u58F0\u660E wired \u800C\u6D88\u8D39\u52A8\u4F5C\u7F3A\u5931\uFF08\u5224\u636E\u7B97\u51FA\u6CA1\u63A5\u52A8\u4F5C\uFF09\uFF0C\u6216 unfinished \u72B6\u6001\u5DF2\u8FC7\u671F\u3002");
  } else {
    console.log("RESULT: PASS \u2014 \u6BCF\u4E2A wired \u5224\u636E\u7684\u6D88\u8D39\u52A8\u4F5C\u53EF grep \u9A8C\u8BC1\uFF1Bunfinished \u5224\u636E\u5982\u5B9E\u5217\u51FA\u3002");
  }
}
function judgeEntry(entryJson, root) {
  let entry;
  try {
    entry = JSON.parse(entryJson);
  } catch {
    console.error("judgment-consumer-check: --judge-entry must be a JSON object");
    return { report: null, status: 2 };
  }
  const report = auditEntry(entry, root);
  const ok = report.verified;
  if (ok) {
    console.log(`judgment-consumer-check --judge-entry ${entry.judgment}: clean (${report.status} verified)`);
  } else {
    console.log(`judgment-consumer-check --judge-entry ${entry.judgment}: VIOLATION`);
    for (const f of report.failures) {
      console.log(`  ${f.file} expect:${f.expect} got:${f.actual} ~/${f.pattern}/`);
    }
  }
  return { report, status: ok ? 0 : 1 };
}
function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit("usage: node judgment-consumer-check.ts [--root <dir>] [--json | --list | --judge-entry <json>]");
  const asJson = args.includes("--json");
  const asList = args.includes("--list");
  const rootArg = args.indexOf("--root");
  const root = path2.resolve(rootArg !== -1 ? args[rootArg + 1] : process.cwd());
  const judgeIdx = args.indexOf("--judge-entry");
  const judgeJson = judgeIdx !== -1 ? args[judgeIdx + 1] : void 0;
  if (!fs.existsSync(root)) {
    console.error(`ERROR: audit root not found: ${root}`);
    return 2;
  }
  if (judgeJson !== void 0) {
    const { status } = judgeEntry(judgeJson, root);
    return status;
  }
  if (asList) {
    listPlain();
    return 0;
  }
  const report = auditAll(root);
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    reportText(report);
  }
  return report.drift ? 1 : 0;
}
if (isDirectEntry(import.meta, void 0, "judgment-consumer-check")) {
  process.exit(main(process.argv));
}
export {
  JUDGMENT_CONSUMERS,
  auditAll,
  auditEntry,
  judgeEntry,
  main
};
