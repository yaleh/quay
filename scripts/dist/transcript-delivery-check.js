#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/transcript-delivery-check.ts
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
function helpExit(usage) {
  process.stdout.write(usage.endsWith("\n") ? usage : usage + "\n");
  process.exit(0);
}
function createSelftest(opts) {
  const { flavor, label, verb = "selftest", collectFailures = false, dumpFailuresJson = false } = opts;
  let pass = 0;
  let fail = 0;
  let allPassed = true;
  const failures = [];
  const check = (name, condition, detail) => {
    if (condition) {
      pass++;
      if (flavor !== "counters") console.log(`SELFTEST PASS: ${name} \u2014 ${detail}`);
      return;
    }
    fail++;
    allPassed = false;
    if (flavor === "counters") {
      console.error(`FAIL: ${name}${detail ? ` \u2014 ${detail}` : ""}`);
      return;
    }
    console.error(`SELFTEST FAIL: ${name} \u2014 ${detail}`);
    if (collectFailures) failures.push({ name, detail });
  };
  const report = () => {
    if (flavor === "counters") {
      console.log(`
${label} --${verb}: ${pass} passed, ${fail} failed`);
      return fail === 0;
    }
    if (flavor === "cases-period") {
      if (allPassed) {
        console.log("SELFTEST: all fixture cases PASS.");
        return true;
      }
      console.error("SELFTEST: one or more fixture cases FAILED.");
      return false;
    }
    console.log(`
SELFTEST: ${allPassed ? "all fixture cases PASS" : "SOME FIXTURES FAILED"}`);
    if (dumpFailuresJson && !allPassed) console.log(JSON.stringify({ ok: false, failures }));
    return allPassed;
  };
  return {
    check,
    get pass() {
      return pass;
    },
    get fail() {
      return fail;
    },
    get allPassed() {
      return allPassed;
    },
    get failures() {
      return failures;
    },
    report
  };
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/transcript-delivery-check.ts
var MAX_MATCHED_LINE = 300;
function extractUserTextCandidates(transcriptFragment) {
  const out = [];
  for (const rawLine of transcriptFragment.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const rec = parsed;
    if (rec.type !== "user") continue;
    if (rec.message?.role !== "user") continue;
    const content = rec.message.content;
    const texts = [];
    if (typeof content === "string") {
      texts.push(content);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        if (block && typeof block === "object") {
          const b = block;
          if (b.type === "text" && typeof b.text === "string") texts.push(b.text);
        }
      }
    }
    for (const t of texts) out.push({ text: t, line });
  }
  return out;
}
function textFromContent(content) {
  const texts = [];
  if (typeof content === "string") {
    texts.push(content);
  } else if (Array.isArray(content)) {
    for (const block of content) {
      if (block && typeof block === "object") {
        const b = block;
        if (b.type === "text" && typeof b.text === "string") texts.push(b.text);
      }
    }
  }
  return texts;
}
function trimmedLine(line) {
  return line.length > MAX_MATCHED_LINE ? line.slice(0, MAX_MATCHED_LINE) + "\u2026" : line;
}
function extractDeliveryEvidence(transcriptFragment) {
  const out = [];
  for (const rawLine of transcriptFragment.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== "object" || parsed === null) continue;
    const rec = parsed;
    if (rec.type === "user") {
      const msg = rec.message;
      if (msg?.role === "user") {
        for (const t of textFromContent(msg.content)) {
          if (t) out.push({ source: "user", text: t, line });
        }
      }
      continue;
    }
    if (rec.type === "attachment") {
      if (rec.isSidechain === true) continue;
      const att = rec.attachment;
      if (att && typeof att === "object") {
        const texts = [];
        if (typeof att.prompt === "string") texts.push(att.prompt);
        else if (att.prompt !== void 0) texts.push(...textFromContent(att.prompt));
        texts.push(...textFromContent(att.content));
        for (const t of texts) {
          if (t) out.push({ source: "attachment", text: t, line });
        }
      }
      continue;
    }
    if (rec.type === "queue-operation") {
      const op = rec.operation;
      if (op !== "enqueue" && op !== "remove") continue;
      if (typeof rec.content === "string" && rec.content.length > 0) {
        out.push({
          source: op === "enqueue" ? "queue-operation-enqueue" : "queue-operation-remove",
          text: rec.content,
          line
        });
      }
      continue;
    }
  }
  return out;
}
function checkTranscriptDelivered(transcriptFragment, sentText) {
  const needle = (sentText ?? "").trim();
  const unconfirmed = () => ({ state: "unknown", delivered: false, failed: false, unknown: true });
  if (!needle) return unconfirmed();
  const evidence = extractDeliveryEvidence(transcriptFragment);
  for (const e of evidence) {
    if ((e.source === "user" || e.source === "attachment") && e.text.includes(needle)) {
      return { state: "delivered", delivered: true, failed: false, unknown: false, matchedLine: trimmedLine(e.line) };
    }
  }
  for (const e of evidence) {
    if (e.source === "queue-operation-remove" && e.text.includes(needle)) {
      return { state: "failed", delivered: false, failed: true, unknown: false, matchedLine: trimmedLine(e.line) };
    }
  }
  return unconfirmed();
}
function hasUserMessages(transcriptFragment) {
  return extractUserTextCandidates(transcriptFragment).length > 0;
}
function tailFromByteOffset(fullText, startBytes) {
  if (startBytes <= 0) return fullText;
  const out = [];
  let pos = 0;
  for (const line of fullText.split("\n")) {
    if (pos >= startBytes) out.push(line);
    pos += Buffer.byteLength(line, "utf8") + 1;
  }
  return out.join("\n");
}
function usageError(message) {
  console.error(`transcript-delivery-check: ${message}`);
  console.error("usage: transcript-delivery-check.ts --check <transcript.jsonl> [--start <bytes>] --text <sent-text> [--remote <host>]");
  console.error("       transcript-delivery-check.ts --is-fresh <transcript.jsonl> [--remote <host>]");
  console.error("exit: 0 = delivered / fresh \xB7 1 = failed (clear discard evidence) \xB7 2 = usage/IO error \xB7 3 = unknown (no evidence \u2014 check first)");
  return 2;
}
function readJsonlTail(jsonlPath, startBytes) {
  let full;
  try {
    full = fs.readFileSync(jsonlPath, "utf8");
  } catch (e) {
    return { ok: false, error: `cannot read transcript ${jsonlPath}: ${e.message}` };
  }
  return { ok: true, fragment: tailFromByteOffset(full, startBytes) };
}
function remoteCat(host, jsonlPath) {
  const sshBin = process.env.SUPERVISOR_DELIVER_SSH || "ssh";
  const r = spawnSync(sshBin, [host, "cat", jsonlPath], { encoding: "utf8" });
  if (r.status === 0) return { ok: true, stdout: r.stdout ?? "" };
  if (r.status === 255) {
    return { ok: false, error: `cannot reach remote host ${host} (ssh exit 255): ${(r.stderr ?? "").trim()}` };
  }
  return { ok: false, error: `cannot cat remote transcript ${host}:${jsonlPath}: ${(r.stderr ?? `ssh exit ${r.status}`).trim()}` };
}
function readJsonlTailRemote(host, jsonlPath, startBytes) {
  const got = remoteCat(host, jsonlPath);
  if (!got.ok) return { ok: false, error: got.error };
  return { ok: true, fragment: tailFromByteOffset(got.stdout, startBytes) };
}
function main(argv) {
  const args = argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) helpExit("usage: transcript-delivery-check.ts --check <transcript.jsonl> [--start <bytes>] --text <sent-text> [--remote <host>] | --is-fresh <transcript.jsonl> [--remote <host>]");
  let jsonlPath;
  let sentText;
  let startBytes = 0;
  let remoteHost;
  let mode;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--check") {
      mode = "check";
      jsonlPath = args[i + 1];
      i++;
    } else if (args[i] === "--is-fresh") {
      mode = "is-fresh";
      jsonlPath = args[i + 1];
      i++;
    } else if (args[i] === "--start") {
      startBytes = Number.parseInt(args[i + 1], 10);
      if (Number.isNaN(startBytes) || startBytes < 0) return usageError(`bad --start byte offset: ${args[i + 1]}`);
      i++;
    } else if (args[i] === "--text") {
      sentText = args[i + 1];
      i++;
    } else if (args[i] === "--remote") {
      remoteHost = args[i + 1];
      i++;
    }
  }
  if (!jsonlPath) return usageError("missing --check/--is-fresh <transcript.jsonl>");
  if (mode === "is-fresh") {
    if (remoteHost) {
      const got = remoteCat(remoteHost, jsonlPath);
      if (got.ok) {
        const fresh2 = !hasUserMessages(got.stdout);
        console.log(`fresh: ${fresh2}`);
        return fresh2 ? 0 : 1;
      }
      if (got.error.startsWith("cannot reach remote host")) {
        console.error(`transcript-delivery-check: ${got.error}`);
        return 2;
      }
      console.log("fresh: true");
      return 0;
    }
    let full;
    try {
      full = fs.readFileSync(jsonlPath, "utf8");
    } catch (e) {
      const err = e;
      if (err.code === "ENOENT") {
        console.log("fresh: true");
        return 0;
      }
      console.error(`transcript-delivery-check: cannot read transcript ${jsonlPath}: ${err.message}`);
      return 2;
    }
    const fresh = !hasUserMessages(full);
    console.log(`fresh: ${fresh}`);
    return fresh ? 0 : 1;
  }
  if (sentText === void 0) return usageError("missing --text <sent-text>");
  const read = remoteHost ? readJsonlTailRemote(remoteHost, jsonlPath, startBytes) : readJsonlTail(jsonlPath, startBytes);
  if (!read.ok) {
    console.error(`transcript-delivery-check: ${read.error}`);
    return 2;
  }
  const verdict = checkTranscriptDelivered(read.fragment, sentText);
  console.log(`state: ${verdict.state}`);
  console.log(`delivered: ${verdict.delivered}`);
  if (verdict.matchedLine) console.log(`matched_line: ${verdict.matchedLine}`);
  if (verdict.state === "delivered") return 0;
  if (verdict.state === "failed") return 1;
  return 3;
}
function selfcheck() {
  const st = createSelftest({ flavor: "counters", label: "transcript-delivery-check", verb: "selfcheck" });
  const check = st.check;
  const green = `{"type":"user","message":{"role":"user","content":"send-keys-marker-123 hello"}}
{"type":"assistant","message":{"role":"assistant","content":"ok"}}
`;
  check("green-string-content", checkTranscriptDelivered(green, "send-keys-marker-123").state === "delivered");
  check("green-matched-line", (checkTranscriptDelivered(green, "send-keys-marker-123").matchedLine ?? "").includes("send-keys-marker-123"));
  const greenArray = `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"echo hello"}]}}
`;
  check("green-array-text-block", checkTranscriptDelivered(greenArray, "echo hello").state === "delivered");
  const greenQueueAttach = [
    `{"type":"queue-operation","operation":"enqueue","timestamp":"2026-08-08T05:39:23.157Z","sessionId":"s","content":"[\u7BA1\u7406\u8005\u2192\u5916\u5C42] \u4E24\u6761\u6211\u81EA\u5DF1\u7684\u9519 long-paste-marker-901"}`,
    `{"type":"queue-operation","operation":"remove","timestamp":"2026-08-08T05:39:42.590Z","sessionId":"s","content":"[\u7BA1\u7406\u8005\u2192\u5916\u5C42] \u4E24\u6761\u6211\u81EA\u5DF1\u7684\u9519 long-paste-marker-901"}`,
    `{"type":"attachment","isSidechain":false,"attachment":{"type":"queued_command","prompt":"[\u7BA1\u7406\u8005\u2192\u5916\u5C42] \u4E24\u6761\u6211\u81EA\u5DF1\u7684\u9519 long-paste-marker-901","commandMode":"task-notification","timestamp":"2026-08-08T05:39:42.726Z"},"type":"attachment"}`
  ].join("\n");
  check("green-queue-operation+attachment", checkTranscriptDelivered(greenQueueAttach, "long-paste-marker-901").state === "delivered");
  const redDiscard = `{"type":"queue-operation","operation":"enqueue","timestamp":"2026-08-08T05:50:01.000Z","sessionId":"s","content":"discard-marker-777"}
{"type":"queue-operation","operation":"remove","timestamp":"2026-08-08T05:50:04.000Z","sessionId":"s","content":"discard-marker-777"}
`;
  const redDiscardV = checkTranscriptDelivered(redDiscard, "discard-marker-777");
  check("red-discard-remove-without-materialization-is-failed", redDiscardV.state === "failed" && redDiscardV.failed === true);
  const pendingEnqueue = `{"type":"queue-operation","operation":"enqueue","timestamp":"2026-08-08T05:50:01.000Z","sessionId":"s","content":"pending-marker-555"}
`;
  const pendingV = checkTranscriptDelivered(pendingEnqueue, "pending-marker-555");
  check("enqueue-only-is-unknown-not-failed", pendingV.state === "unknown" && pendingV.failed === false);
  const redEmpty = "";
  check("red-empty", checkTranscriptDelivered(redEmpty, "anything").delivered === false);
  const redMismatch = `{"type":"user","message":{"role":"user","content":"hello world"}}
`;
  check("red-mismatch", checkTranscriptDelivered(redMismatch, "unique-marker-XYZ").delivered === false);
  const redAssistantOnly = `{"type":"assistant","message":{"role":"assistant","content":"unique-marker-XYZ"}}
`;
  check("red-assistant-only", checkTranscriptDelivered(redAssistantOnly, "unique-marker-XYZ").delivered === false);
  const redToolResultOnly = `{"type":"user","message":{"role":"user","content":[{"type":"tool_result","content":"unique-marker-XYZ"}]}}
`;
  check("red-tool-result-only", checkTranscriptDelivered(redToolResultOnly, "unique-marker-XYZ").delivered === false);
  check("red-empty-sent-text", checkTranscriptDelivered("anything", "   ").delivered === false);
  const malformed = `not json
{"type":"user","message":{"role":"user","content":"real marker here"}}
`;
  check("malformed-skipped", checkTranscriptDelivered(malformed, "real marker here").delivered === true);
  check("tail-byte-offset-keeps-appended", tailFromByteOffset('{"a":1}\n{"b":2}\n', '{"a":1}\n'.length).includes('"b":2'));
  check("fresh-empty-transcript", hasUserMessages("") === false);
  check("fresh-assistant-only", hasUserMessages(redAssistantOnly) === false);
  check("fresh-tool-result-only-is-not-typed-input", hasUserMessages(redToolResultOnly) === false);
  check("fresh-real-user-message", hasUserMessages(green) === true);
  return st.report();
}
var isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) && path.basename(process.argv[1]).replace(/.(?:js|ts|mjs)$/, "") === "transcript-delivery-check";
if (isDirect) {
  if (process.argv.includes("--selfcheck")) process.exit(selfcheck() ? 0 : 1);
  process.exit(main(process.argv));
}
export {
  checkTranscriptDelivered,
  extractDeliveryEvidence,
  extractUserTextCandidates,
  hasUserMessages,
  main,
  selfcheck,
  tailFromByteOffset
};
