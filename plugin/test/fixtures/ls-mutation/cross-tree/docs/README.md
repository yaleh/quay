# `cross-tree` fixture — negative control

This top-level entry is NEVER imported by `packages/quay/src/target.mjs` or
`packages/quay/test/check-cross-tree.mjs`. It exists so the test can assert the sandbox stages what is
REACHABLE and not the whole tree (`reachableTopLevels` must not contain `docs`).
