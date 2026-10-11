import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/runner-state-write.ts
import fs2 from "node:fs";
import path2 from "node:path";

// packages/quay/src/kernel/write-json-atomic.ts
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
function writeJsonAtomic(p, value) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, p);
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/runner-state-write.ts
function readStateRunId(file) {
  try {
    const parsed = JSON.parse(fs2.readFileSync(file, "utf8"));
    return typeof parsed?.runId === "string" && parsed.runId ? parsed.runId : void 0;
  } catch {
    return void 0;
  }
}
function writeStateGuarded(file, state) {
  writeState(file, state, { guard: true });
}
function writeState(file, state, opts) {
  if (opts?.guard && state.runId) {
    const current = readStateRunId(file);
    if (current !== void 0 && current !== state.runId) {
      return;
    }
  }
  writeJsonAtomic(file, state);
}
function appendVerificationRound(stateDir, rec) {
  try {
    const file = path2.join(stateDir, "verification-round.jsonl");
    fs2.mkdirSync(path2.dirname(file), { recursive: true });
    let prior = 0;
    if (fs2.existsSync(file)) {
      const text = fs2.readFileSync(file, "utf8");
      for (const l of text.split("\n")) if (l.trim()) prior++;
    }
    fs2.appendFileSync(file, JSON.stringify({ ...rec, round: rec.round > 0 ? rec.round : prior + 1 }) + "\n", "utf8");
  } catch {
  }
}
export {
  appendVerificationRound,
  readStateRunId,
  writeState,
  writeStateGuarded
};
