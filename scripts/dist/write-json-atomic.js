import { createRequire } from "node:module"; const require = createRequire(import.meta.url);

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
export {
  writeJsonAtomic
};
