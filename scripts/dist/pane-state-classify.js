#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/pane-state-classify.ts
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { spawnSync } from "node:child_process";

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/gate-script-base.ts
function flagValue(argv, name) {
  const idx = argv.indexOf(name);
  return idx === -1 ? void 0 : argv[idx + 1];
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

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/pane-state-classify.ts
function runtimeTmux(args) {
  const host = process.env.SUPERVISOR_DELIVER_HOST || "";
  const sshBin = process.env.SUPERVISOR_DELIVER_SSH || "ssh";
  if (host) {
    const remote = `tmux ${args.map(shellQuoteArg).join(" ")}`;
    const r2 = spawnSync(sshBin, [host, remote], { encoding: "utf8" });
    return { status: r2.status ?? 1, stdout: r2.stdout ?? "", stderr: r2.stderr ?? "" };
  }
  const r = spawnSync("tmux", args, { encoding: "utf8" });
  return { status: r.status ?? 1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
function shellQuoteArg(arg) {
  if (/^[A-Za-z0-9_\-:.%+=,]+$/.test(arg)) return arg;
  return `"${arg.replace(/(["\\$`])/g, "\\$1")}"`;
}
var DEFAULT_BOTTOM_LINES = 10;
function bottomRegion(paneText, lines = DEFAULT_BOTTOM_LINES) {
  let split = paneText.split("\n");
  while (split.length && split[split.length - 1].trim() === "") split = split.slice(0, -1);
  return split.slice(Math.max(0, split.length - lines)).join("\n");
}
var PERMISSION_PROMPT_RE = new RegExp(
  "Do you want to proceed|Quick safety check|trust this folder|Enter to confirm|Y\\/n\\b|Grant access[^\\n]*\\?|Allow\\b[^\\n]*\\bDeny\\b|Deny\\b[^\\n]*\\bAllow\\b|Allow\\b[^\\n]*\\n[^\\n]*\\bDeny\\b|Deny\\b[^\\n]*\\n[^\\n]*\\bAllow\\b|^\\s*[\u276F\u203A>]?\\s*(?:1\\.\\s*)?Allow\\b|^\\s*[\u276F\u203A>]?\\s*(?:1\\.\\s*)?Deny\\b",
  "im"
);
var DISMISSABLE_PROMPT_RE = /\(optional\)|Dismiss|How is Claude doing this session/i;
var BUSY_RE = /esc to interr/i;
var PANEL_BUSY_RE = /ctrl\+t to hide tasks/i;
var AGENT_LIST_LINE_RE = /^\s*[●◯]\s/;
var CLAUDE_PANE_CHROME_RE = new RegExp(
  "\u276F|\u23F5\u23F5|bypass permissions|esc to interr|ctrl\\+t to hide tasks|\u2193 to manage|\u2190\\s*\\d+\\s+agents?|\\d+\\s+monitors?",
  "i"
);
function statusArea(region) {
  const lines = region.split("\n").filter((l) => l.trim() !== "" && !AGENT_LIST_LINE_RE.test(l));
  return lines.slice(-2).join("\n");
}
var ERROR_BANNER_RE = /isApiErrorMessage|an error occurred|something went wrong|isApiError|connection error|unable to reach/i;
var INPUT_PROMPT_RE = /❯/;
function classifyPaneState(paneText, opts = {}) {
  const region = bottomRegion(paneText, opts.lines ?? DEFAULT_BOTTOM_LINES);
  if (PERMISSION_PROMPT_RE.test(region) && !DISMISSABLE_PROMPT_RE.test(region)) {
    return { state: "permission-prompt", confidence: 0.85, region, raw: region };
  }
  const statusAreaText = statusArea(region);
  if (BUSY_RE.test(statusAreaText) || PANEL_BUSY_RE.test(statusAreaText)) {
    return { state: "busy", confidence: 0.9, region, raw: region };
  }
  if (ERROR_BANNER_RE.test(region)) {
    return { state: "error-banner", confidence: 0.75, region, raw: region };
  }
  if (INPUT_PROMPT_RE.test(region)) {
    return { state: "waiting-input", confidence: 0.6, region, raw: region };
  }
  return { state: "unknown", confidence: 0, region, raw: region };
}
function regionLooksLikeClaudePane(region) {
  if (INPUT_PROMPT_RE.test(region)) return true;
  if (region.split("\n").some((l) => AGENT_LIST_LINE_RE.test(l))) return true;
  return CLAUDE_PANE_CHROME_RE.test(region);
}
function paneShowsWorkInFlight(region) {
  if (region.split("\n").some((l) => AGENT_LIST_LINE_RE.test(l))) return true;
  const m = region.match(/←\s*(\d+)\s+agents?/i);
  return m !== null && Number(m[1]) > 0;
}
function classifyPaneStateOrthogonal(paneText, opts = {}) {
  const region = bottomRegion(paneText, opts.lines ?? DEFAULT_BOTTOM_LINES);
  const work_in_flight = paneShowsWorkInFlight(region);
  let input_state;
  if (PERMISSION_PROMPT_RE.test(region) && !DISMISSABLE_PROMPT_RE.test(region)) {
    input_state = "permission-prompt";
  } else {
    const statusAreaText = statusArea(region);
    if (BUSY_RE.test(statusAreaText) || PANEL_BUSY_RE.test(statusAreaText)) {
      input_state = "busy";
    } else if (ERROR_BANNER_RE.test(region)) {
      input_state = "error-banner";
    } else if (regionLooksLikeClaudePane(region)) {
      input_state = "waiting-input";
    } else {
      input_state = "unknown";
    }
  }
  return { input_state, work_in_flight, region, raw: region };
}
var DEFAULT_CAN_RECEIVE_WAIT_S = 30;
var DEFAULT_CAN_RECEIVE_POLL_S = 2;
function canReceiveInput(paneText, opts = {}) {
  return classifyPaneStateOrthogonal(paneText, opts).input_state === "waiting-input";
}
function isMessageRecord(line) {
  return line.includes('"type":"assistant"') || line.includes('"type":"user"');
}
function transcriptLastMessageType(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!isMessageRecord(line)) continue;
    if (line.includes('"type":"user"')) return "user-input";
    if (line.includes('"type":"tool_use"')) return "pending-tool-use";
    return "pure-text";
  }
  return "unknown";
}
function trailingApiErrorCount(lines, window = 200) {
  const tail = lines.slice(-window);
  let n = 0;
  for (let i = tail.length - 1; i >= 0; i--) {
    const line = tail[i];
    if (!isMessageRecord(line)) continue;
    if (/"isApiErrorMessage"\s*:\s*true/.test(line)) n++;
    else break;
  }
  return n;
}
function transcriptCacheReadTokens(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].match(/"cache_read_input_tokens":(\d+)/);
    if (m) return Number(m[1]);
  }
  return null;
}
function lastMessageIsUnansweredInput(lines) {
  return transcriptLastMessageType(lines) === "user-input";
}
function transcriptContextSaturation(lines, saturationTokens) {
  const cache = transcriptCacheReadTokens(lines);
  if (cache === null) return "unknown";
  if (cache >= saturationTokens) {
    return lastMessageIsUnansweredInput(lines) ? "saturated" : "unsaturated";
  }
  return "unsaturated";
}
function lastUserInputEpoch(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.includes('"type":"user"')) {
      const m = line.match(/"timestamp":"([^"]+)"/);
      if (m) {
        const ms = Date.parse(m[1]);
        if (!Number.isNaN(ms)) return Math.floor(ms / 1e3);
      }
      return null;
    }
  }
  return null;
}
function transcriptBusyFromMessageType(ttype) {
  return ttype === "pending-tool-use" || ttype === "user-input";
}
function fusedIdle(paneBusy, transcriptBusy) {
  return !(paneBusy || transcriptBusy);
}
function idleReportReady(p) {
  return p.idle && p.idleConsec >= p.debounceRounds && !p.idleReported && p.rounds > 1;
}
function resumedReportReady(p) {
  return p.resumePending && p.busyConsec >= p.debounceRounds && p.rounds > 1;
}
function permPromptWarnVerdict(rounds, txAge, opts = {}) {
  const warnRounds = opts.warnRounds ?? 3;
  const txWindow = opts.txWindow ?? 60;
  if (rounds >= warnRounds) {
    if (txAge < 0) return "ok";
    if (txAge > txWindow) return "warn";
    return "ok";
  }
  return "ok";
}
function classifyPaneVerdict(paneText) {
  if (paneText === "") {
    return { state: "unknown", busy: true, intervention: false, work_in_flight: false, region_empty: true };
  }
  const o = classifyPaneStateOrthogonal(paneText);
  let busy = false;
  let intervention = false;
  if (o.input_state === "busy" || o.input_state === "error-banner") {
    busy = true;
  } else if (o.input_state === "permission-prompt") {
    intervention = true;
  }
  const region_empty = o.region === "";
  if (region_empty) busy = true;
  return { state: o.input_state, busy, intervention, work_in_flight: o.work_in_flight, region_empty };
}
var RESIDUE_CLEAR_MAX_DEFAULT = 50;
var ANSI_CSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g;
var NBSP = "\xA0";
function inputLine(paneText, lines) {
  const region = bottomRegion(paneText, lines);
  const regionLines = region.split("\n");
  for (let i = regionLines.length - 1; i >= 0; i--) {
    if (regionLines[i].includes("\u276F")) return regionLines[i];
  }
  return null;
}
function afterPromptContent(paneText, lines) {
  const line = inputLine(paneText, lines);
  if (line === null) return null;
  const idx = line.indexOf("\u276F");
  return line.slice(idx + 1).replace(ANSI_CSI_RE, "").replaceAll(NBSP, "");
}
function classifyInputResidueStatic(paneText, lines) {
  const after = afterPromptContent(paneText, lines);
  if (after === null) return "no-input-line";
  return after.trim() === "" ? "empty" : "has-text";
}
function classifyResidueFromCaptures(captures) {
  if (!captures.length) return { state: "unknown", reason: "no captures to judge" };
  const before = captures[0];
  const staticState = classifyInputResidueStatic(before);
  if (staticState === "empty") return { state: "empty", reason: "input line after \u276F is empty" };
  if (staticState === "no-input-line") {
    return { state: "unknown", reason: "no \u276F prompt line found in the bottom region" };
  }
  for (let i = 1; i < captures.length; i++) {
    if (classifyInputResidueStatic(captures[i]) === "empty") {
      return { state: "real-unsubmitted-text", reason: `C-u cleared the input line at capture ${i}` };
    }
  }
  if (captures.every((c) => c === before)) {
    return { state: "ghost-suggestion-only", reason: "input line byte-identical through all C-u cycles (fault 6)" };
  }
  return { state: "unknown", reason: "input line changed but never emptied \u2014 ambiguous, fail loud" };
}
function probeResidueTarget(target, maxClicks = RESIDUE_CLEAR_MAX_DEFAULT) {
  const captures = [];
  const capture = () => {
    const r = runtimeTmux(["capture-pane", "-p", "-t", target]);
    return { ok: r.status === 0, out: r.stdout ?? "", err: r.stderr ?? "" };
  };
  const send = (keys) => {
    runtimeTmux(["send-keys", "-t", target, keys]);
  };
  const first = capture();
  if (!first.ok) {
    return { state: "unknown", reason: `capture failed for target ${target} (${first.err.trim() || "no such pane"})`, captures: 0 };
  }
  captures.push(first.out);
  if (classifyInputResidueStatic(first.out) === "empty") {
    return { state: "empty", reason: "input line after \u276F is empty (probe: no C-u needed)", captures: captures.length };
  }
  for (let i = 0; i < maxClicks; i++) {
    send("C-u");
    const cur = capture();
    if (!cur.ok) {
      return { state: "unknown", reason: `capture failed mid-probe (${cur.err.trim()})`, captures: captures.length };
    }
    captures.push(cur.out);
    if (classifyInputResidueStatic(cur.out) === "empty") {
      return { state: "real-unsubmitted-text", reason: `C-u cleared the input line at cycle ${i + 1}`, captures: captures.length };
    }
  }
  const verdict = classifyResidueFromCaptures(captures);
  return {
    state: verdict.state,
    reason: `${verdict.reason} (probe ran ${captures.length - 1} C-u cycles, cap ${maxClicks})`,
    captures: captures.length
  };
}
function runCheckResidue(argv) {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const flagArg = (name) => flagValue(argv, name);
  const afterFile = flagArg("--after");
  const maxClicksRaw = flagArg("--max-clicks");
  const maxClicksParsed = maxClicksRaw ? Number.parseInt(maxClicksRaw, 10) : NaN;
  const maxClicks = Number.isFinite(maxClicksParsed) && maxClicksParsed >= 1 ? maxClicksParsed : RESIDUE_CLEAR_MAX_DEFAULT;
  const arg = positional[0];
  const emit = (payload, exitCode) => {
    process.stdout.write(JSON.stringify(payload) + "\n");
    return exitCode;
  };
  if (!arg) {
    process.stderr.write(
      "usage: pane-state-classify.ts --check-residue <pane.txt|target> [--after after.txt] [--max-clicks N]\n"
    );
    return 2;
  }
  if (fs.existsSync(arg)) {
    const before = fs.readFileSync(arg, "utf8");
    const staticState = classifyInputResidueStatic(before);
    if (staticState === "empty") {
      return emit({ state: "empty", reason: "input line after \u276F is empty", staticState, file: arg }, 0);
    }
    if (afterFile && fs.existsSync(afterFile)) {
      const after = fs.readFileSync(afterFile, "utf8");
      const verdict = classifyResidueFromCaptures([before, after]);
      return emit(
        { state: verdict.state, reason: verdict.reason, staticState, file: arg, afterFile },
        verdict.state === "unknown" ? 1 : 0
      );
    }
    return emit(
      {
        state: "unknown",
        reason: "single static snapshot with text cannot distinguish real residue from a ghost suggestion; run against a live target or pass --after <post-C-u capture>",
        staticState,
        file: arg
      },
      1
    );
  }
  const probe = probeResidueTarget(arg, maxClicks);
  return emit({ ...probe, target: arg, maxClicks }, probe.state === "unknown" ? 1 : 0);
}
function runCanReceive(argv) {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const target = positional[0];
  if (!target) {
    process.stderr.write("usage: pane-state-classify.ts --can-receive <tmux\u76EE\u6807>\n");
    return 2;
  }
  const cap = runtimeTmux(["capture-pane", "-p", "-t", target]);
  if (cap.status !== 0 || (cap.stdout ?? "").trim() === "") {
    process.stderr.write(
      `can-receive: \u6355\u83B7\u76EE\u6807 ${target} \u5931\u8D25/\u4E3A\u7A7A\u2014\u2014fail closed\uFF0C\u4E0D\u53D1\u9001\uFF08AC5 \u540C\u6E90\u5B88\u536B\uFF1A\u65E0\u5185\u5BB9\u4E0D\u5224\u53EF\u63A5\u6536\uFF09
`
    );
    process.stdout.write("unknown\n");
    return 1;
  }
  const o = classifyPaneStateOrthogonal(cap.stdout ?? "");
  process.stdout.write(o.input_state + "\n");
  return o.input_state === "waiting-input" ? 0 : 1;
}
function runCanReceiveWait(argv) {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const flagArg = (name) => flagValue(argv, name);
  const target = positional[0];
  if (!target) {
    process.stderr.write(
      "usage: pane-state-classify.ts --can-receive-wait <tmux\u76EE\u6807> [--wait <s>] [--poll <s>]\n"
    );
    return 2;
  }
  const waitRaw = flagArg("--wait");
  const pollRaw = flagArg("--poll");
  const waitS = waitRaw ? Number(waitRaw) : DEFAULT_CAN_RECEIVE_WAIT_S;
  const pollS = pollRaw ? Number(pollRaw) : DEFAULT_CAN_RECEIVE_POLL_S;
  const deadline = Date.now() + waitS * 1e3;
  let lastState = "unknown";
  while (Date.now() < deadline) {
    const cap = runtimeTmux(["capture-pane", "-p", "-t", target]);
    if (cap.status === 0 && (cap.stdout ?? "").trim() !== "") {
      const o = classifyPaneStateOrthogonal(cap.stdout ?? "");
      lastState = o.input_state;
      if (lastState === "waiting-input") {
        process.stdout.write("waiting-input\n");
        return 0;
      }
    }
    if (pollS > 0) spawnSync("sleep", [String(pollS)], { stdio: "ignore" });
  }
  process.stdout.write(lastState + "\n");
  process.stderr.write(
    `can-receive: \u76EE\u6807 ${target} \u5728 ${waitS}s \u5185\u672A\u8F6C\u4E3A waiting-input\uFF08\u6700\u540E\u72B6\u6001 ${lastState}\uFF09\u2014\u2014fail loud \u9700\u4EBA\u5DE5
`
  );
  return 1;
}
function runTranscript(argv) {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const flagArg = (name) => flagValue(argv, name);
  const file = positional[0];
  if (!file) {
    process.stderr.write(
      "usage: pane-state-classify.ts --transcript <transcript.jsonl> [--saturation-tokens N] [--api-error-window N]\n"
    );
    return 2;
  }
  const satRaw = flagArg("--saturation-tokens");
  const winRaw = flagArg("--api-error-window");
  const saturationTokens = satRaw ? Number(satRaw) : 45e4;
  const apiWindow = winRaw ? Number(winRaw) : 200;
  let lines = [];
  try {
    const content = fs.readFileSync(file, "utf8");
    lines = content.split("\n");
    if (lines.length && lines[lines.length - 1] === "") lines.pop();
  } catch {
  }
  const mt = transcriptLastMessageType(lines);
  const n = trailingApiErrorCount(lines, apiWindow);
  const cache = transcriptCacheReadTokens(lines);
  const sat = transcriptContextSaturation(lines, saturationTokens);
  const lep = lastUserInputEpoch(lines);
  process.stdout.write(
    [
      mt,
      String(n),
      cache === null ? "unknown" : String(cache),
      sat,
      lep === null ? "unknown" : String(lep)
    ].join("\n") + "\n"
  );
  return 0;
}
function runPermPromptWarnVerdict(argv) {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const flagArg = (name) => flagValue(argv, name);
  const roundsRaw = positional[0];
  const txAgeRaw = positional[1];
  if (roundsRaw === void 0 || txAgeRaw === void 0) {
    process.stderr.write(
      "usage: pane-state-classify.ts --perm-warn-verdict <rounds> <tx_age_secs|-1> [--warn-rounds N] [--tx-window N]\n"
    );
    return 2;
  }
  const warnRoundsRaw = flagArg("--warn-rounds");
  const txWindowRaw = flagArg("--tx-window");
  const opts = {
    warnRounds: warnRoundsRaw ? Number(warnRoundsRaw) : void 0,
    txWindow: txWindowRaw ? Number(txWindowRaw) : void 0
  };
  process.stdout.write(permPromptWarnVerdict(Number(roundsRaw), Number(txAgeRaw), opts) + "\n");
  return 0;
}
function runPaneVerdict(stdin) {
  const v = classifyPaneVerdict(stdin);
  process.stdout.write(
    [
      `state=${v.state}`,
      `busy=${v.busy ? "1" : "0"}`,
      `intervention=${v.intervention ? "1" : "0"}`,
      `work_in_flight=${v.work_in_flight ? "1" : "0"}`,
      `region_empty=${v.region_empty ? "1" : "0"}`
    ].join("\n") + "\n"
  );
  return 0;
}
function selfcheck() {
  const st = createSelftest({ flavor: "counters", label: "pane-state-classify", verb: "selfcheck" });
  const check = st.check;
  const idle = [
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    "\u276F ",
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    "  \u23F5\u23F5 bypass permissions on \xB7 1 monitor \xB7 \u2190 1 agent \xB7 \u2193 to manage"
  ].join("\n");
  check("green-waiting-input", classifyPaneState(idle).state === "waiting-input");
  const busy = [
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    "\u276F ",
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    "  \u23F5\u23F5 bypass permissions on \xB7 1 monitor \xB7 esc to interrupt \xB7 \u2190 1 agent \xB7 \u2193 to manage"
  ].join("\n");
  check("green-busy", classifyPaneState(busy).state === "busy");
  const truncated67col = "\u23F5\u23F5 bypass permissions on (shift+tab to cycle) \xB7 esc to interru\u2026";
  check("green-truncated-67col-busy", classifyPaneState(truncated67col).state === "busy");
  check("truncated-67col-red-not-waiting", classifyPaneState(truncated67col).state !== "waiting-input");
  check("green-full-text-busy", classifyPaneState(busy).state === "busy");
  const outerPanel = [
    "\u23F5\u23F5 bypass permissions on \xB7 1 monitor \xB7 ctrl+t to hide tasks \xB7 \u2190 1 agent \xB7 \u2193 to manage",
    "\u25EF fan-in-execute  A15 \u2026 28/28 agents done \xB7 1h 0m 59s \xB7 \u2193 2.0m tokens \xB7 \u26A0 Large workflow"
  ].join("\n");
  check("green-outer-panel-busy", classifyPaneState(outerPanel).state === "busy");
  check("outer-panel-red-not-waiting", classifyPaneState(outerPanel).state !== "waiting-input");
  check("ambient-counts-red-not-busy", classifyPaneState(idle).state === "waiting-input");
  const prompt = [
    "Quick safety check: Is this a project you created or one you trust?",
    "\u276F 1. Yes, I trust this folder \u2714",
    "  2. No, exit",
    "Enter to confirm \xB7 Esc to cancel"
  ].join("\n");
  check("green-permission-prompt", classifyPaneState(prompt).state === "permission-prompt");
  const questionnaire = [
    "\u25CF How is Claude doing this session? (optional)",
    "  1: Bad",
    "  2: Fine",
    "  3: Good",
    "  0: Dismiss",
    "  \u2191/\u2193 navigate \xB7 Enter to confirm \xB7 Esc to cancel",
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    "\u276F ",
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    "  \u23F5\u23F5 bypass permissions on \xB7 1 monitor \xB7 \u2190 1 agent \xB7 \u2193 to manage"
  ].join("\n");
  check("green-questionnaire-waiting-input", classifyPaneState(questionnaire).state === "waiting-input");
  check("questionnaire-red-not-permission", classifyPaneState(questionnaire).state !== "permission-prompt");
  check("green-real-permission-still-prompt", classifyPaneState(prompt).state === "permission-prompt");
  const allowThinTitle = [
    "\u25EF general-purpose  Re-running scoped test with --allow-thin   11m 15s \xB7 \u2193193.4k tokens",
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    "\u276F ",
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    "  \u23F5\u23F5 bypass permissions on \xB7 1 monitor \xB7 esc to interrupt \xB7 \u2190 1 agent \xB7 \u2193 to manage"
  ].join("\n");
  check("green-allow-thin-busy", classifyPaneState(allowThinTitle).state === "busy");
  check("allow-thin-red-not-permission", classifyPaneState(allowThinTitle).state !== "permission-prompt");
  const deniedTitle = [
    "\u25EF general-purpose  Task: denied access to tool   9m 20s \xB7 \u2193150.1k tokens",
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    "\u276F ",
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    "  \u23F5\u23F5 bypass permissions on \xB7 1 monitor \xB7 esc to interrupt \xB7 \u2190 1 agent \xB7 \u2193 to manage"
  ].join("\n");
  check("denied-red-not-permission", classifyPaneState(deniedTitle).state !== "permission-prompt");
  const allowDenyDialog = [
    "Do you want to proceed?",
    "\u276F Allow",
    "  Deny",
    "  Enter to confirm \xB7 Esc to cancel"
  ].join("\n");
  check("green-allow-deny-dialog-prompt", classifyPaneState(allowDenyDialog).state === "permission-prompt");
  const agentsBelow = [
    "\u23F5\u23F5 bypass permissions on",
    "  esc to interrupt  \u2190 1 agent",
    "  \u25CF main",
    "  \u25EF general-purpose  running",
    "\u276F"
  ].join("\n");
  check("green-agents-below-busy", classifyPaneState(agentsBelow).state === "busy");
  check("agents-below-red-not-waiting", classifyPaneState(agentsBelow).state !== "waiting-input");
  const grantTitle = [
    "\u25EF general-purpose  Need to grant access to the shared drive   11m 15s \xB7 \u2193193.4k tokens",
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    "\u276F ",
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    "  \u23F5\u23F5 bypass permissions on \xB7 1 monitor \xB7 esc to interrupt \xB7 \u2190 1 agent \xB7 \u2193 to manage"
  ].join("\n");
  check("grant-access-red-not-permission", classifyPaneState(grantTitle).state !== "permission-prompt");
  check("grant-access-green-busy", classifyPaneState(grantTitle).state === "busy");
  const grantDialog = [
    "Grant access to this folder?",
    "Allow  \xB7  Deny",
    "Enter to confirm \xB7 Esc to cancel"
  ].join("\n");
  check("green-grant-dialog-prompt", classifyPaneState(grantDialog).state === "permission-prompt");
  const weird = "a vim help screen\n~ ~ ~\n~ ~ ~\n(1 of 12)   help.txt";
  const r = classifyPaneState(weird);
  check("tier2-unknown", r.state === "unknown");
  check("tier2-raw-passthrough", r.raw === bottomRegion(weird) && r.raw.includes("help.txt"));
  const realPaneStatusLine = "\u23F5\u23F5 bypass permissions on (shift+tab to cycle) \xB7 \u2190 1 agent \xB7 \u2193 to manage";
  const oReal = classifyPaneStateOrthogonal(realPaneStatusLine);
  check("orthogonal-real-input-state", oReal.input_state === "waiting-input");
  check("orthogonal-real-work-in-flight", oReal.work_in_flight === true);
  check("orthogonal-old-unknown-still-unknown", classifyPaneState(realPaneStatusLine).state === "unknown");
  const oRealFull = classifyPaneStateOrthogonal([
    "\u25CF main",
    "\u25EF general-purpose  Reviewing the full diff summary.  17m 13s",
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    "\u276F ",
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    "  " + realPaneStatusLine
  ].join("\n"));
  check("orthogonal-real-full-input-state", oRealFull.input_state === "waiting-input");
  check("orthogonal-real-full-work-in-flight", oRealFull.work_in_flight === true);
  const idleWithAgent = classifyPaneStateOrthogonal(idle);
  check("orthogonal-idle-agent-input-state", idleWithAgent.input_state === "waiting-input");
  check("orthogonal-idle-agent-work-in-flight", idleWithAgent.work_in_flight === true);
  const oBusy = classifyPaneStateOrthogonal(busy);
  check("orthogonal-busy-input-state", oBusy.input_state === "busy");
  check("orthogonal-busy-work-in-flight", oBusy.work_in_flight === true);
  const idleNoAgent = [
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    "\u276F ",
    "\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
    "  \u23F5\u23F5 bypass permissions on \xB7 1 monitor \xB7 \u2193 to manage"
  ].join("\n");
  const oIdleNoAgent = classifyPaneStateOrthogonal(idleNoAgent);
  check("orthogonal-idle-no-agent-input-state", oIdleNoAgent.input_state === "waiting-input");
  check("orthogonal-idle-no-agent-work-in-flight", oIdleNoAgent.work_in_flight === false);
  check("orthogonal-tier2-unknown", classifyPaneStateOrthogonal(weird).input_state === "unknown");
  check("orthogonal-permission-input-state", classifyPaneStateOrthogonal(prompt).input_state === "permission-prompt");
  const upperA = "some upper text\n".repeat(30) + idle;
  const upperB = "completely different upper\n".repeat(30) + idle;
  check("ac6-region-same-verdict", classifyPaneState(upperA).state === classifyPaneState(upperB).state);
  check("residue-empty", classifyResidueFromCaptures([idle]).state === "empty");
  const realBefore = "line above\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\u276F fix the bug report\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n  status line";
  const realAfter = "line above\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\u276F \n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n  status line";
  check("residue-real-cleared", classifyResidueFromCaptures([realBefore, realAfter]).state === "real-unsubmitted-text");
  const ghostPane = 'line above\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n\u276F Try "fix lint errors"\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\n  status line';
  check("residue-ghost-identical", classifyResidueFromCaptures([ghostPane, ghostPane]).state === "ghost-suggestion-only");
  check("residue-red-ghost-not-real", classifyResidueFromCaptures([ghostPane, ghostPane]).state !== "real-unsubmitted-text");
  check("residue-red-real-not-ghost", classifyResidueFromCaptures([realBefore, realAfter]).state !== "ghost-suggestion-only");
  check("residue-unknown-ambiguous", classifyResidueFromCaptures(["\u276F abc", "\u276F ab"]).state === "unknown");
  check("residue-unknown-no-prompt", classifyResidueFromCaptures(["a vim help screen", "~ ~ ~"]).state === "unknown");
  check("residue-static-empty", classifyInputResidueStatic(idle) === "empty");
  check("residue-static-has-text", classifyInputResidueStatic(realBefore) === "has-text");
  return st.report();
}
var isDirect = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]) && // Bundler-friendly (gap-shipped-ts-files-are-not-bundled-80-raw-typescript-in-the-artifact):
// when pane-state-classify is BUNDLED into another tool (inner-blocked-signal), the inlined
// module shares the bundle's import.meta.url, so URL equality would falsely fire. Basename match
// distinguishes running pane-state-classify itself from being inlined into another entry.
path.basename(process.argv[1]).replace(/\.(?:js|ts|mjs)$/, "") === "pane-state-classify";
if (isDirect) {
  const args = process.argv.slice(2);
  if (args[0] === "--classify") {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => {
      input += d;
    });
    process.stdin.on("end", () => {
      if (args.includes("--orthogonal")) {
        const o = classifyPaneStateOrthogonal(input);
        process.stdout.write(o.input_state + "\n" + (o.work_in_flight ? "1" : "0") + "\n" + o.region + "\n");
      } else {
        const r = classifyPaneState(input);
        process.stdout.write(r.state + "\n" + r.region + "\n");
      }
      process.exit(0);
    });
    process.stdin.resume();
  } else if (args[0] === "--pane-text") {
    const text = args[1] ?? "";
    const r = classifyPaneState(text);
    const o = classifyPaneStateOrthogonal(text);
    if (args.includes("--orthogonal")) {
      if (args.includes("--json")) {
        process.stdout.write(JSON.stringify(o) + "\n");
      } else {
        process.stdout.write(o.input_state + "\n" + (o.work_in_flight ? "1" : "0") + "\n" + o.region + "\n");
      }
    } else if (args.includes("--json")) {
      process.stdout.write(JSON.stringify({ ...r, input_state: o.input_state, work_in_flight: o.work_in_flight }) + "\n");
    } else {
      process.stdout.write(r.state + "\n" + r.region + "\n");
    }
    process.exit(0);
  } else if (args[0] === "--can-receive") {
    process.exit(runCanReceive(args.slice(1)));
  } else if (args[0] === "--can-receive-wait") {
    process.exit(runCanReceiveWait(args.slice(1)));
  } else if (args[0] === "--check-residue") {
    process.exit(runCheckResidue(args.slice(1)));
  } else if (args[0] === "--transcript") {
    process.exit(runTranscript(args.slice(1)));
  } else if (args[0] === "--perm-warn-verdict") {
    process.exit(runPermPromptWarnVerdict(args.slice(1)));
  } else if (args[0] === "--pane-verdict") {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (d) => {
      input += d;
    });
    process.stdin.on("end", () => {
      process.exit(runPaneVerdict(input));
    });
    process.stdin.resume();
  } else {
    const ok = selfcheck();
    process.exit(ok ? 0 : 1);
  }
}
export {
  DEFAULT_BOTTOM_LINES,
  DEFAULT_CAN_RECEIVE_POLL_S,
  DEFAULT_CAN_RECEIVE_WAIT_S,
  RESIDUE_CLEAR_MAX_DEFAULT,
  afterPromptContent,
  bottomRegion,
  canReceiveInput,
  classifyInputResidueStatic,
  classifyPaneState,
  classifyPaneStateOrthogonal,
  classifyPaneVerdict,
  classifyResidueFromCaptures,
  fusedIdle,
  idleReportReady,
  inputLine,
  lastMessageIsUnansweredInput,
  lastUserInputEpoch,
  paneShowsWorkInFlight,
  permPromptWarnVerdict,
  probeResidueTarget,
  regionLooksLikeClaudePane,
  resumedReportReady,
  runCanReceive,
  runCanReceiveWait,
  runCheckResidue,
  runPaneVerdict,
  runPermPromptWarnVerdict,
  runTranscript,
  selfcheck,
  trailingApiErrorCount,
  transcriptBusyFromMessageType,
  transcriptCacheReadTokens,
  transcriptContextSaturation,
  transcriptLastMessageType
};
