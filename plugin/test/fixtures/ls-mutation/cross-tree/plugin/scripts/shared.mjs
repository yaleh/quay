// The CROSS-TREE module of the `cross-tree` fixture (see target.mjs / check-cross-tree.mjs).
// It lives one top-level entry away from the target and the check, which is the whole point: a sandbox
// that stages only `top = rel.split('/')[0]` of the two NAMED paths copies `packages/` and not
// `plugin/`, so the child dies with ERR_MODULE_NOT_FOUND before any behaviour is observed.
export function double(x) {
  return x * 2;
}
