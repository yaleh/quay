# Plan — M95 ARCH-M93-004 (ABI boundary violation fix)

**Milestone:** M95
**Task:** ARCH-M93-004
**Plan authored:** 2026-07-22

## Scope clarification

Exactly 4 import sites are affected — all package-specifier style (`"quay/src/X"`), all in quay-native:
- `quay-native/src/mcp-server.ts:13` — `"quay/src/adr-store.ts"`
- `quay-native/bin/quay-native.js:20-22` — `"quay/src/adr-store.ts"`, `"quay/src/document-store.ts"`, `"quay/src/contract-validator.ts"`

Relative path imports (`'../../quay/src/abi.ts'`) in `store.ts`, `manifest.ts`, and `quay-github/` are NOT affected by adding an `"exports"` field (Node.js exports maps only restrict package-specifier imports, not relative-path imports).

## Atomicity constraint

**Stages 1 and 2 MUST be applied and committed as a single atomic unit.** Once `"exports"` is added to `packages/quay/package.json`, any import using the OLD `"quay/src/X"` package specifier that is NOT in the exports map will throw `ERR_PACKAGE_PATH_NOT_EXPORTED`. The executor MUST NOT commit Stage 1 in isolation — apply both file sets together before running tests or committing.

## Stage 1 [code] — packages/quay/package.json: add subpath exports

**Files:** `packages/quay/package.json`

**Current state:** 28-line file, no `"exports"` field. Line 10 closes the `"bin"` block; line 11 starts `"files"`.

**Changes:** Add `"exports"` object between `"bin"` (line 10) and `"files"` (line 11):
```json
"exports": {
  "./adr-store": "./src/adr-store.ts",
  "./document-store": "./src/document-store.ts",
  "./contract-validator": "./src/contract-validator.ts"
},
```

**Note:** `.ts` extension in exports values is correct — the repo runs plain ESM Node ≥20 with no build step, direct source execution. Node resolves the `.ts` specifier via `--experimental-strip-types` or native loader.

**Line budget:** ~6L added

**TDD acceptance (part of atomic Stage 1+2 check):** `node -e "import('quay/adr-store')"` from repo root resolves without error AFTER Stage 2 import sites are updated. Before Stage 2 updates the import strings, this smoke check is the RED baseline confirming the subpath wasn't previously resolving via the old path.

---

## Stage 2 [code] — quay-native import sites: update to subpath specifiers

**Files:** `packages/quay-native/src/mcp-server.ts`, `packages/quay-native/bin/quay-native.js`

**Changes:**

`packages/quay-native/src/mcp-server.ts` — line 13:
- Before: `import { createAdrStore } from "quay/src/adr-store.ts";`
- After:  `import { createAdrStore } from "quay/adr-store";`

`packages/quay-native/bin/quay-native.js` — lines 20–22:
- Before:
  ```js
  import { createAdrStore } from "quay/src/adr-store.ts";
  import { createDocumentStore } from "quay/src/document-store.ts";
  import { validateContracts } from "quay/src/contract-validator.ts";
  ```
- After:
  ```js
  import { createAdrStore } from "quay/adr-store";
  import { createDocumentStore } from "quay/document-store";
  import { validateContracts } from "quay/contract-validator";
  ```

**Line budget:** 4L changed (net zero)

**TDD acceptance:** `grep -rn 'from.*quay/src/' packages/quay-native/` returns zero. Full test suite passes (quay-native has 20 test files — run `node --test $(ls packages/quay-native/test/*.mjs)`). CLI smoke: `node packages/quay-native/bin/quay-native.js --help` exits 0.

---

## Stage 3 [prose] — Update ARCH-M93-004 task body

**Files:** task body (via `mcp__quay__task_write`)

**Changes:** Replace `## Plan` section with execution record. Check the `## Acceptance Criteria` boxes: AC1 (grep returns zero) confirmed by Stage 2 output.

**TDD acceptance (prose branch):** `it0-dod-check.mjs` passes on ARCH-M93-004; AC checkboxes present and checked.

---

## Dependency order

Stages 1+2 are applied together atomically (single commit), Stage 3 after.

---

## Total line budget

~10L total: 6L Stage 1 + 4L Stage 2 + Stage 3 (prose, negligible)

---

## Out-of-scope

- `quay-native/src/store.ts` and `manifest.ts` relative imports (`../../quay/src/abi.ts`) — NOT affected by exports map; correct as-is.
- `packages/quay-github/` relative imports — NOT affected.
- Adding `"."` (main entry) to exports map — not part of this fix; Proposal A's barrel approach was rejected.
