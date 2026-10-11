#!/usr/bin/env node
import { createRequire } from "node:module"; const require = createRequire(import.meta.url);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/yaml/dist/nodes/identity.js
var require_identity = __commonJS({
  "node_modules/yaml/dist/nodes/identity.js"(exports) {
    "use strict";
    var ALIAS = /* @__PURE__ */ Symbol.for("yaml.alias");
    var DOC = /* @__PURE__ */ Symbol.for("yaml.document");
    var MAP = /* @__PURE__ */ Symbol.for("yaml.map");
    var PAIR = /* @__PURE__ */ Symbol.for("yaml.pair");
    var SCALAR = /* @__PURE__ */ Symbol.for("yaml.scalar");
    var SEQ = /* @__PURE__ */ Symbol.for("yaml.seq");
    var NODE_TYPE = /* @__PURE__ */ Symbol.for("yaml.node.type");
    var isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
    var isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
    var isMap = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
    var isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
    var isScalar = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
    var isSeq = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
    function isCollection(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case MAP:
          case SEQ:
            return true;
        }
      return false;
    }
    function isNode(node) {
      if (node && typeof node === "object")
        switch (node[NODE_TYPE]) {
          case ALIAS:
          case MAP:
          case SCALAR:
          case SEQ:
            return true;
        }
      return false;
    }
    var hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor;
    exports.ALIAS = ALIAS;
    exports.DOC = DOC;
    exports.MAP = MAP;
    exports.NODE_TYPE = NODE_TYPE;
    exports.PAIR = PAIR;
    exports.SCALAR = SCALAR;
    exports.SEQ = SEQ;
    exports.hasAnchor = hasAnchor;
    exports.isAlias = isAlias;
    exports.isCollection = isCollection;
    exports.isDocument = isDocument;
    exports.isMap = isMap;
    exports.isNode = isNode;
    exports.isPair = isPair;
    exports.isScalar = isScalar;
    exports.isSeq = isSeq;
  }
});

// node_modules/yaml/dist/visit.js
var require_visit = __commonJS({
  "node_modules/yaml/dist/visit.js"(exports) {
    "use strict";
    var identity = require_identity();
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove node");
    function visit(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = visit_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        visit_(null, node, visitor_, Object.freeze([]));
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    function visit_(key, node, visitor, path19) {
      const ctrl = callVisitor(key, node, visitor, path19);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path19, ctrl);
        return visit_(key, ctrl, visitor, path19);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path19 = Object.freeze(path19.concat(node));
          for (let i2 = 0; i2 < node.items.length; ++i2) {
            const ci = visit_(i2, node.items[i2], visitor, path19);
            if (typeof ci === "number")
              i2 = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i2, 1);
              i2 -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path19 = Object.freeze(path19.concat(node));
          const ck = visit_("key", node.key, visitor, path19);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = visit_("value", node.value, visitor, path19);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    async function visitAsync(node, visitor) {
      const visitor_ = initVisitor(visitor);
      if (identity.isDocument(node)) {
        const cd = await visitAsync_(null, node.contents, visitor_, Object.freeze([node]));
        if (cd === REMOVE)
          node.contents = null;
      } else
        await visitAsync_(null, node, visitor_, Object.freeze([]));
    }
    visitAsync.BREAK = BREAK;
    visitAsync.SKIP = SKIP;
    visitAsync.REMOVE = REMOVE;
    async function visitAsync_(key, node, visitor, path19) {
      const ctrl = await callVisitor(key, node, visitor, path19);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path19, ctrl);
        return visitAsync_(key, ctrl, visitor, path19);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path19 = Object.freeze(path19.concat(node));
          for (let i2 = 0; i2 < node.items.length; ++i2) {
            const ci = await visitAsync_(i2, node.items[i2], visitor, path19);
            if (typeof ci === "number")
              i2 = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i2, 1);
              i2 -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path19 = Object.freeze(path19.concat(node));
          const ck = await visitAsync_("key", node.key, visitor, path19);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = await visitAsync_("value", node.value, visitor, path19);
          if (cv === BREAK)
            return BREAK;
          else if (cv === REMOVE)
            node.value = null;
        }
      }
      return ctrl;
    }
    function initVisitor(visitor) {
      if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) {
        return Object.assign({
          Alias: visitor.Node,
          Map: visitor.Node,
          Scalar: visitor.Node,
          Seq: visitor.Node
        }, visitor.Value && {
          Map: visitor.Value,
          Scalar: visitor.Value,
          Seq: visitor.Value
        }, visitor.Collection && {
          Map: visitor.Collection,
          Seq: visitor.Collection
        }, visitor);
      }
      return visitor;
    }
    function callVisitor(key, node, visitor, path19) {
      if (typeof visitor === "function")
        return visitor(key, node, path19);
      if (identity.isMap(node))
        return visitor.Map?.(key, node, path19);
      if (identity.isSeq(node))
        return visitor.Seq?.(key, node, path19);
      if (identity.isPair(node))
        return visitor.Pair?.(key, node, path19);
      if (identity.isScalar(node))
        return visitor.Scalar?.(key, node, path19);
      if (identity.isAlias(node))
        return visitor.Alias?.(key, node, path19);
      return void 0;
    }
    function replaceNode(key, path19, node) {
      const parent = path19[path19.length - 1];
      if (identity.isCollection(parent)) {
        parent.items[key] = node;
      } else if (identity.isPair(parent)) {
        if (key === "key")
          parent.key = node;
        else
          parent.value = node;
      } else if (identity.isDocument(parent)) {
        parent.contents = node;
      } else {
        const pt = identity.isAlias(parent) ? "alias" : "scalar";
        throw new Error(`Cannot replace node with ${pt} parent`);
      }
    }
    exports.visit = visit;
    exports.visitAsync = visitAsync;
  }
});

// node_modules/yaml/dist/doc/directives.js
var require_directives = __commonJS({
  "node_modules/yaml/dist/doc/directives.js"(exports) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    var escapeChars = {
      "!": "%21",
      ",": "%2C",
      "[": "%5B",
      "]": "%5D",
      "{": "%7B",
      "}": "%7D"
    };
    var escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
    var Directives = class _Directives {
      constructor(yaml, tags) {
        this.docStart = null;
        this.docEnd = false;
        this.yaml = Object.assign({}, _Directives.defaultYaml, yaml);
        this.tags = Object.assign({}, _Directives.defaultTags, tags);
      }
      clone() {
        const copy = new _Directives(this.yaml, this.tags);
        copy.docStart = this.docStart;
        return copy;
      }
      /**
       * During parsing, get a Directives instance for the current document and
       * update the stream state according to the current version's spec.
       */
      atDocument() {
        const res = new _Directives(this.yaml, this.tags);
        switch (this.yaml.version) {
          case "1.1":
            this.atNextDocument = true;
            break;
          case "1.2":
            this.atNextDocument = false;
            this.yaml = {
              explicit: _Directives.defaultYaml.explicit,
              version: "1.2"
            };
            this.tags = Object.assign({}, _Directives.defaultTags);
            break;
        }
        return res;
      }
      /**
       * @param onError - May be called even if the action was successful
       * @returns `true` on success
       */
      add(line, onError) {
        if (this.atNextDocument) {
          this.yaml = { explicit: _Directives.defaultYaml.explicit, version: "1.1" };
          this.tags = Object.assign({}, _Directives.defaultTags);
          this.atNextDocument = false;
        }
        const parts = line.trim().split(/[ \t]+/);
        const name = parts.shift();
        switch (name) {
          case "%TAG": {
            if (parts.length !== 2) {
              onError(0, "%TAG directive should contain exactly two parts");
              if (parts.length < 2)
                return false;
            }
            const [handle, prefix] = parts;
            this.tags[handle] = prefix;
            return true;
          }
          case "%YAML": {
            this.yaml.explicit = true;
            if (parts.length !== 1) {
              onError(0, "%YAML directive should contain exactly one part");
              return false;
            }
            const [version] = parts;
            if (version === "1.1" || version === "1.2") {
              this.yaml.version = version;
              return true;
            } else {
              const isValid = /^\d+\.\d+$/.test(version);
              onError(6, `Unsupported YAML version ${version}`, isValid);
              return false;
            }
          }
          default:
            onError(0, `Unknown directive ${name}`, true);
            return false;
        }
      }
      /**
       * Resolves a tag, matching handles to those defined in %TAG directives.
       *
       * @returns Resolved tag, which may also be the non-specific tag `'!'` or a
       *   `'!local'` tag, or `null` if unresolvable.
       */
      tagName(source, onError) {
        if (source === "!")
          return "!";
        if (source[0] !== "!") {
          onError(`Not a valid tag: ${source}`);
          return null;
        }
        if (source[1] === "<") {
          const verbatim = source.slice(2, -1);
          if (verbatim === "!" || verbatim === "!!") {
            onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
            return null;
          }
          if (source[source.length - 1] !== ">")
            onError("Verbatim tags must end with a >");
          return verbatim;
        }
        const [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
        if (!suffix)
          onError(`The ${source} tag has no suffix`);
        const prefix = this.tags[handle];
        if (prefix) {
          try {
            return prefix + decodeURIComponent(suffix);
          } catch (error) {
            onError(String(error));
            return null;
          }
        }
        if (handle === "!")
          return source;
        onError(`Could not resolve tag: ${source}`);
        return null;
      }
      /**
       * Given a fully resolved tag, returns its printable string form,
       * taking into account current tag prefixes and defaults.
       */
      tagString(tag) {
        for (const [handle, prefix] of Object.entries(this.tags)) {
          if (tag.startsWith(prefix))
            return handle + escapeTagName(tag.substring(prefix.length));
        }
        return tag[0] === "!" ? tag : `!<${tag}>`;
      }
      toString(doc) {
        const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
        const tagEntries = Object.entries(this.tags);
        let tagNames;
        if (doc && tagEntries.length > 0 && identity.isNode(doc.contents)) {
          const tags = {};
          visit.visit(doc.contents, (_key, node) => {
            if (identity.isNode(node) && node.tag)
              tags[node.tag] = true;
          });
          tagNames = Object.keys(tags);
        } else
          tagNames = [];
        for (const [handle, prefix] of tagEntries) {
          if (handle === "!!" && prefix === "tag:yaml.org,2002:")
            continue;
          if (!doc || tagNames.some((tn) => tn.startsWith(prefix)))
            lines.push(`%TAG ${handle} ${prefix}`);
        }
        return lines.join("\n");
      }
    };
    Directives.defaultYaml = { explicit: false, version: "1.2" };
    Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };
    exports.Directives = Directives;
  }
});

// node_modules/yaml/dist/doc/anchors.js
var require_anchors = __commonJS({
  "node_modules/yaml/dist/doc/anchors.js"(exports) {
    "use strict";
    var identity = require_identity();
    var visit = require_visit();
    function anchorIsValid(anchor) {
      if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
        const sa = JSON.stringify(anchor);
        const msg = `Anchor must not contain whitespace or control characters: ${sa}`;
        throw new Error(msg);
      }
      return true;
    }
    function anchorNames(root) {
      const anchors = /* @__PURE__ */ new Set();
      visit.visit(root, {
        Value(_key, node) {
          if (node.anchor)
            anchors.add(node.anchor);
        }
      });
      return anchors;
    }
    function findNewAnchor(prefix, exclude) {
      for (let i2 = 1; true; ++i2) {
        const name = `${prefix}${i2}`;
        if (!exclude.has(name))
          return name;
      }
    }
    function createNodeAnchors(doc, prefix) {
      const aliasObjects = [];
      const sourceObjects = /* @__PURE__ */ new Map();
      let prevAnchors = null;
      return {
        onAnchor: (source) => {
          aliasObjects.push(source);
          prevAnchors ?? (prevAnchors = anchorNames(doc));
          const anchor = findNewAnchor(prefix, prevAnchors);
          prevAnchors.add(anchor);
          return anchor;
        },
        /**
         * With circular references, the source node is only resolved after all
         * of its child nodes are. This is why anchors are set only after all of
         * the nodes have been created.
         */
        setAnchors: () => {
          for (const source of aliasObjects) {
            const ref = sourceObjects.get(source);
            if (typeof ref === "object" && ref.anchor && (identity.isScalar(ref.node) || identity.isCollection(ref.node))) {
              ref.node.anchor = ref.anchor;
            } else {
              const error = new Error("Failed to resolve repeated object (this should not happen)");
              error.source = source;
              throw error;
            }
          }
        },
        sourceObjects
      };
    }
    exports.anchorIsValid = anchorIsValid;
    exports.anchorNames = anchorNames;
    exports.createNodeAnchors = createNodeAnchors;
    exports.findNewAnchor = findNewAnchor;
  }
});

// node_modules/yaml/dist/doc/applyReviver.js
var require_applyReviver = __commonJS({
  "node_modules/yaml/dist/doc/applyReviver.js"(exports) {
    "use strict";
    function applyReviver(reviver, obj, key, val) {
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          for (let i2 = 0, len = val.length; i2 < len; ++i2) {
            const v0 = val[i2];
            const v1 = applyReviver(reviver, val, String(i2), v0);
            if (v1 === void 0)
              delete val[i2];
            else if (v1 !== v0)
              val[i2] = v1;
          }
        } else if (val instanceof Map) {
          for (const k of Array.from(val.keys())) {
            const v0 = val.get(k);
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              val.delete(k);
            else if (v1 !== v0)
              val.set(k, v1);
          }
        } else if (val instanceof Set) {
          for (const v0 of Array.from(val)) {
            const v1 = applyReviver(reviver, val, v0, v0);
            if (v1 === void 0)
              val.delete(v0);
            else if (v1 !== v0) {
              val.delete(v0);
              val.add(v1);
            }
          }
        } else {
          for (const [k, v0] of Object.entries(val)) {
            const v1 = applyReviver(reviver, val, k, v0);
            if (v1 === void 0)
              delete val[k];
            else if (v1 !== v0)
              val[k] = v1;
          }
        }
      }
      return reviver.call(obj, key, val);
    }
    exports.applyReviver = applyReviver;
  }
});

// node_modules/yaml/dist/nodes/toJS.js
var require_toJS = __commonJS({
  "node_modules/yaml/dist/nodes/toJS.js"(exports) {
    "use strict";
    var identity = require_identity();
    function toJS(value, arg, ctx) {
      if (Array.isArray(value))
        return value.map((v, i2) => toJS(v, String(i2), ctx));
      if (value && typeof value.toJSON === "function") {
        if (!ctx || !identity.hasAnchor(value))
          return value.toJSON(arg, ctx);
        const data = { aliasCount: 0, count: 1, res: void 0 };
        ctx.anchors.set(value, data);
        ctx.onCreate = (res2) => {
          data.res = res2;
          delete ctx.onCreate;
        };
        const res = value.toJSON(arg, ctx);
        if (ctx.onCreate)
          ctx.onCreate(res);
        return res;
      }
      if (typeof value === "bigint" && !ctx?.keep)
        return Number(value);
      return value;
    }
    exports.toJS = toJS;
  }
});

// node_modules/yaml/dist/nodes/Node.js
var require_Node = __commonJS({
  "node_modules/yaml/dist/nodes/Node.js"(exports) {
    "use strict";
    var applyReviver = require_applyReviver();
    var identity = require_identity();
    var toJS = require_toJS();
    var NodeBase = class {
      constructor(type) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: type });
      }
      /** Create a copy of this node.  */
      clone() {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** A plain JavaScript representation of this node. */
      toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        if (!identity.isDocument(doc))
          throw new TypeError("A document argument is required");
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc,
          keep: true,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this, "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
    };
    exports.NodeBase = NodeBase;
  }
});

// node_modules/yaml/dist/nodes/Alias.js
var require_Alias = __commonJS({
  "node_modules/yaml/dist/nodes/Alias.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var visit = require_visit();
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var Alias = class extends Node.NodeBase {
      constructor(source) {
        super(identity.ALIAS);
        this.source = source;
        Object.defineProperty(this, "tag", {
          set() {
            throw new Error("Alias nodes cannot have tags");
          }
        });
      }
      /**
       * Resolve the value of this alias within `doc`, finding the last
       * instance of the `source` anchor before this node.
       */
      resolve(doc, ctx) {
        if (ctx?.maxAliasCount === 0)
          throw new ReferenceError("Alias resolution is disabled");
        let nodes;
        if (ctx?.aliasResolveCache) {
          nodes = ctx.aliasResolveCache;
        } else {
          nodes = [];
          visit.visit(doc, {
            Node: (_key, node) => {
              if (identity.isAlias(node) || identity.hasAnchor(node))
                nodes.push(node);
            }
          });
          if (ctx)
            ctx.aliasResolveCache = nodes;
        }
        let found = void 0;
        for (const node of nodes) {
          if (node === this)
            break;
          if (node.anchor === this.source)
            found = node;
        }
        return found;
      }
      toJSON(_arg, ctx) {
        if (!ctx)
          return { source: this.source };
        const { anchors: anchors2, doc, maxAliasCount } = ctx;
        const source = this.resolve(doc, ctx);
        if (!source) {
          const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
          throw new ReferenceError(msg);
        }
        let data = anchors2.get(source);
        if (!data) {
          toJS.toJS(source, null, ctx);
          data = anchors2.get(source);
        }
        if (data?.res === void 0) {
          const msg = "This should not happen: Alias anchor was not resolved?";
          throw new ReferenceError(msg);
        }
        if (maxAliasCount >= 0) {
          data.count += 1;
          if (data.aliasCount === 0)
            data.aliasCount = getAliasCount(doc, source, anchors2);
          if (data.count * data.aliasCount > maxAliasCount) {
            const msg = "Excessive alias count indicates a resource exhaustion attack";
            throw new ReferenceError(msg);
          }
        }
        return data.res;
      }
      toString(ctx, _onComment, _onChompKeep) {
        const src = `*${this.source}`;
        if (ctx) {
          anchors.anchorIsValid(this.source);
          if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
            const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
            throw new Error(msg);
          }
          if (ctx.implicitKey)
            return `${src} `;
        }
        return src;
      }
    };
    function getAliasCount(doc, node, anchors2) {
      if (identity.isAlias(node)) {
        const source = node.resolve(doc);
        const anchor = anchors2 && source && anchors2.get(source);
        return anchor ? anchor.count * anchor.aliasCount : 0;
      } else if (identity.isCollection(node)) {
        let count = 0;
        for (const item of node.items) {
          const c = getAliasCount(doc, item, anchors2);
          if (c > count)
            count = c;
        }
        return count;
      } else if (identity.isPair(node)) {
        const kc = getAliasCount(doc, node.key, anchors2);
        const vc = getAliasCount(doc, node.value, anchors2);
        return Math.max(kc, vc);
      }
      return 1;
    }
    exports.Alias = Alias;
  }
});

// node_modules/yaml/dist/nodes/Scalar.js
var require_Scalar = __commonJS({
  "node_modules/yaml/dist/nodes/Scalar.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Node = require_Node();
    var toJS = require_toJS();
    var isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
    var Scalar = class extends Node.NodeBase {
      constructor(value) {
        super(identity.SCALAR);
        this.value = value;
      }
      toJSON(arg, ctx) {
        return ctx?.keep ? this.value : toJS.toJS(this.value, arg, ctx);
      }
      toString() {
        return String(this.value);
      }
    };
    Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
    Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
    Scalar.PLAIN = "PLAIN";
    Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
    Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";
    exports.Scalar = Scalar;
    exports.isScalarValue = isScalarValue;
  }
});

// node_modules/yaml/dist/doc/createNode.js
var require_createNode = __commonJS({
  "node_modules/yaml/dist/doc/createNode.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var defaultTagPrefix = "tag:yaml.org,2002:";
    function findTagObject(value, tagName, tags) {
      if (tagName) {
        const match = tags.filter((t) => t.tag === tagName);
        const tagObj = match.find((t) => !t.format) ?? match[0];
        if (!tagObj)
          throw new Error(`Tag ${tagName} not found`);
        return tagObj;
      }
      return tags.find((t) => t.identify?.(value) && !t.format);
    }
    function createNode(value, tagName, ctx) {
      if (identity.isDocument(value))
        value = value.contents;
      if (identity.isNode(value))
        return value;
      if (identity.isPair(value)) {
        const map = ctx.schema[identity.MAP].createNode?.(ctx.schema, null, ctx);
        map.items.push(value);
        return map;
      }
      if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) {
        value = value.valueOf();
      }
      const { aliasDuplicateObjects, onAnchor, onTagObj, schema, sourceObjects } = ctx;
      let ref = void 0;
      if (aliasDuplicateObjects && value && typeof value === "object") {
        ref = sourceObjects.get(value);
        if (ref) {
          ref.anchor ?? (ref.anchor = onAnchor(value));
          return new Alias.Alias(ref.anchor);
        } else {
          ref = { anchor: null, node: null };
          sourceObjects.set(value, ref);
        }
      }
      if (tagName?.startsWith("!!"))
        tagName = defaultTagPrefix + tagName.slice(2);
      let tagObj = findTagObject(value, tagName, schema.tags);
      if (!tagObj) {
        if (value && typeof value.toJSON === "function") {
          value = value.toJSON();
        }
        if (!value || typeof value !== "object") {
          const node2 = new Scalar.Scalar(value);
          if (ref)
            ref.node = node2;
          return node2;
        }
        tagObj = value instanceof Map ? schema[identity.MAP] : Symbol.iterator in Object(value) ? schema[identity.SEQ] : schema[identity.MAP];
      }
      if (onTagObj) {
        onTagObj(tagObj);
        delete ctx.onTagObj;
      }
      const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar.Scalar(value);
      if (tagName)
        node.tag = tagName;
      else if (!tagObj.default)
        node.tag = tagObj.tag;
      if (ref)
        ref.node = node;
      return node;
    }
    exports.createNode = createNode;
  }
});

// node_modules/yaml/dist/nodes/Collection.js
var require_Collection = __commonJS({
  "node_modules/yaml/dist/nodes/Collection.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var identity = require_identity();
    var Node = require_Node();
    function collectionFromPath(schema, path19, value) {
      let v = value;
      for (let i2 = path19.length - 1; i2 >= 0; --i2) {
        const k = path19[i2];
        if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
          const a = [];
          a[k] = v;
          v = a;
        } else {
          v = /* @__PURE__ */ new Map([[k, v]]);
        }
      }
      return createNode.createNode(v, void 0, {
        aliasDuplicateObjects: false,
        keepUndefined: false,
        onAnchor: () => {
          throw new Error("This should not happen, please report a bug.");
        },
        schema,
        sourceObjects: /* @__PURE__ */ new Map()
      });
    }
    var isEmptyPath = (path19) => path19 == null || typeof path19 === "object" && !!path19[Symbol.iterator]().next().done;
    var Collection = class extends Node.NodeBase {
      constructor(type, schema) {
        super(type);
        Object.defineProperty(this, "schema", {
          value: schema,
          configurable: true,
          enumerable: false,
          writable: true
        });
      }
      /**
       * Create a copy of this collection.
       *
       * @param schema - If defined, overwrites the original's schema
       */
      clone(schema) {
        const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
        if (schema)
          copy.schema = schema;
        copy.items = copy.items.map((it) => identity.isNode(it) || identity.isPair(it) ? it.clone(schema) : it);
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /**
       * Adds a value to the collection. For `!!map` and `!!omap` the value must
       * be a Pair instance or a `{ key, value }` object, which may not have a key
       * that already exists in the map.
       */
      addIn(path19, value) {
        if (isEmptyPath(path19))
          this.add(value);
        else {
          const [key, ...rest] = path19;
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.addIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
      /**
       * Removes a value from the collection.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path19) {
        const [key, ...rest] = path19;
        if (rest.length === 0)
          return this.delete(key);
        const node = this.get(key, true);
        if (identity.isCollection(node))
          return node.deleteIn(rest);
        else
          throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path19, keepScalar) {
        const [key, ...rest] = path19;
        const node = this.get(key, true);
        if (rest.length === 0)
          return !keepScalar && identity.isScalar(node) ? node.value : node;
        else
          return identity.isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
      }
      hasAllNullValues(allowScalar) {
        return this.items.every((node) => {
          if (!identity.isPair(node))
            return false;
          const n = node.value;
          return n == null || allowScalar && identity.isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
        });
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       */
      hasIn(path19) {
        const [key, ...rest] = path19;
        if (rest.length === 0)
          return this.has(key);
        const node = this.get(key, true);
        return identity.isCollection(node) ? node.hasIn(rest) : false;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path19, value) {
        const [key, ...rest] = path19;
        if (rest.length === 0) {
          this.set(key, value);
        } else {
          const node = this.get(key, true);
          if (identity.isCollection(node))
            node.setIn(rest, value);
          else if (node === void 0 && this.schema)
            this.set(key, collectionFromPath(this.schema, rest, value));
          else
            throw new Error(`Expected YAML collection at ${key}. Remaining path: ${rest}`);
        }
      }
    };
    exports.Collection = Collection;
    exports.collectionFromPath = collectionFromPath;
    exports.isEmptyPath = isEmptyPath;
  }
});

// node_modules/yaml/dist/stringify/stringifyComment.js
var require_stringifyComment = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyComment.js"(exports) {
    "use strict";
    var stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
    function indentComment(comment, indent) {
      if (/^\n+$/.test(comment))
        return comment.substring(1);
      return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
    }
    var lineComment = (str, indent, comment) => str.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str.endsWith(" ") ? "" : " ") + comment;
    exports.indentComment = indentComment;
    exports.lineComment = lineComment;
    exports.stringifyComment = stringifyComment;
  }
});

// node_modules/yaml/dist/stringify/foldFlowLines.js
var require_foldFlowLines = __commonJS({
  "node_modules/yaml/dist/stringify/foldFlowLines.js"(exports) {
    "use strict";
    var FOLD_FLOW = "flow";
    var FOLD_BLOCK = "block";
    var FOLD_QUOTED = "quoted";
    function foldFlowLines(text, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
      if (!lineWidth || lineWidth < 0)
        return text;
      if (lineWidth < minContentWidth)
        minContentWidth = 0;
      const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
      if (text.length <= endStep)
        return text;
      const folds = [];
      const escapedFolds = {};
      let end = lineWidth - indent.length;
      if (typeof indentAtStart === "number") {
        if (indentAtStart > lineWidth - Math.max(2, minContentWidth))
          folds.push(0);
        else
          end = lineWidth - indentAtStart;
      }
      let split = void 0;
      let prev = void 0;
      let overflow = false;
      let i2 = -1;
      let escStart = -1;
      let escEnd = -1;
      if (mode === FOLD_BLOCK) {
        i2 = consumeMoreIndentedLines(text, i2, indent.length);
        if (i2 !== -1)
          end = i2 + endStep;
      }
      for (let ch; ch = text[i2 += 1]; ) {
        if (mode === FOLD_QUOTED && ch === "\\") {
          escStart = i2;
          switch (text[i2 + 1]) {
            case "x":
              i2 += 3;
              break;
            case "u":
              i2 += 5;
              break;
            case "U":
              i2 += 9;
              break;
            default:
              i2 += 1;
          }
          escEnd = i2;
        }
        if (ch === "\n") {
          if (mode === FOLD_BLOCK)
            i2 = consumeMoreIndentedLines(text, i2, indent.length);
          end = i2 + indent.length + endStep;
          split = void 0;
        } else {
          if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
            const next = text[i2 + 1];
            if (next && next !== " " && next !== "\n" && next !== "	")
              split = i2;
          }
          if (i2 >= end) {
            if (split) {
              folds.push(split);
              end = split + endStep;
              split = void 0;
            } else if (mode === FOLD_QUOTED) {
              while (prev === " " || prev === "	") {
                prev = ch;
                ch = text[i2 += 1];
                overflow = true;
              }
              const j = i2 > escEnd + 1 ? i2 - 2 : escStart - 1;
              if (escapedFolds[j])
                return text;
              folds.push(j);
              escapedFolds[j] = true;
              end = j + endStep;
              split = void 0;
            } else {
              overflow = true;
            }
          }
        }
        prev = ch;
      }
      if (overflow && onOverflow)
        onOverflow();
      if (folds.length === 0)
        return text;
      if (onFold)
        onFold();
      let res = text.slice(0, folds[0]);
      for (let i3 = 0; i3 < folds.length; ++i3) {
        const fold = folds[i3];
        const end2 = folds[i3 + 1] || text.length;
        if (fold === 0)
          res = `
${indent}${text.slice(0, end2)}`;
        else {
          if (mode === FOLD_QUOTED && escapedFolds[fold])
            res += `${text[fold]}\\`;
          res += `
${indent}${text.slice(fold + 1, end2)}`;
        }
      }
      return res;
    }
    function consumeMoreIndentedLines(text, i2, indent) {
      let end = i2;
      let start = i2 + 1;
      let ch = text[start];
      while (ch === " " || ch === "	") {
        if (i2 < start + indent) {
          ch = text[++i2];
        } else {
          do {
            ch = text[++i2];
          } while (ch && ch !== "\n");
          end = i2;
          start = i2 + 1;
          ch = text[start];
        }
      }
      return end;
    }
    exports.FOLD_BLOCK = FOLD_BLOCK;
    exports.FOLD_FLOW = FOLD_FLOW;
    exports.FOLD_QUOTED = FOLD_QUOTED;
    exports.foldFlowLines = foldFlowLines;
  }
});

// node_modules/yaml/dist/stringify/stringifyString.js
var require_stringifyString = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyString.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var foldFlowLines = require_foldFlowLines();
    var getFoldOptions = (ctx, isBlock) => ({
      indentAtStart: isBlock ? ctx.indent.length : ctx.indentAtStart,
      lineWidth: ctx.options.lineWidth,
      minContentWidth: ctx.options.minContentWidth
    });
    var containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
    function lineLengthOverLimit(str, lineWidth, indentLength) {
      if (!lineWidth || lineWidth < 0)
        return false;
      const limit = lineWidth - indentLength;
      const strLen = str.length;
      if (strLen <= limit)
        return false;
      for (let i2 = 0, start = 0; i2 < strLen; ++i2) {
        if (str[i2] === "\n") {
          if (i2 - start > limit)
            return true;
          start = i2 + 1;
          if (strLen - start <= limit)
            return false;
        }
      }
      return true;
    }
    function doubleQuotedString(value, ctx) {
      const json = JSON.stringify(value);
      if (ctx.options.doubleQuotedAsJSON)
        return json;
      const { implicitKey } = ctx;
      const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      let str = "";
      let start = 0;
      for (let i2 = 0, ch = json[i2]; ch; ch = json[++i2]) {
        if (ch === " " && json[i2 + 1] === "\\" && json[i2 + 2] === "n") {
          str += json.slice(start, i2) + "\\ ";
          i2 += 1;
          start = i2;
          ch = "\\";
        }
        if (ch === "\\")
          switch (json[i2 + 1]) {
            case "u":
              {
                str += json.slice(start, i2);
                const code = json.substr(i2 + 2, 4);
                switch (code) {
                  case "0000":
                    str += "\\0";
                    break;
                  case "0007":
                    str += "\\a";
                    break;
                  case "000b":
                    str += "\\v";
                    break;
                  case "001b":
                    str += "\\e";
                    break;
                  case "0085":
                    str += "\\N";
                    break;
                  case "00a0":
                    str += "\\_";
                    break;
                  case "2028":
                    str += "\\L";
                    break;
                  case "2029":
                    str += "\\P";
                    break;
                  default:
                    if (code.substr(0, 2) === "00")
                      str += "\\x" + code.substr(2);
                    else
                      str += json.substr(i2, 6);
                }
                i2 += 5;
                start = i2 + 1;
              }
              break;
            case "n":
              if (implicitKey || json[i2 + 2] === '"' || json.length < minMultiLineLength) {
                i2 += 1;
              } else {
                str += json.slice(start, i2) + "\n\n";
                while (json[i2 + 2] === "\\" && json[i2 + 3] === "n" && json[i2 + 4] !== '"') {
                  str += "\n";
                  i2 += 2;
                }
                str += indent;
                if (json[i2 + 2] === " ")
                  str += "\\";
                i2 += 1;
                start = i2 + 1;
              }
              break;
            default:
              i2 += 1;
          }
      }
      str = start ? str + json.slice(start) : json;
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_QUOTED, getFoldOptions(ctx, false));
    }
    function singleQuotedString(value, ctx) {
      if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value))
        return doubleQuotedString(value, ctx);
      const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
      const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent}`) + "'";
      return ctx.implicitKey ? res : foldFlowLines.foldFlowLines(res, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function quotedString(value, ctx) {
      const { singleQuote } = ctx.options;
      let qs;
      if (singleQuote === false)
        qs = doubleQuotedString;
      else {
        const hasDouble = value.includes('"');
        const hasSingle = value.includes("'");
        if (hasDouble && !hasSingle)
          qs = singleQuotedString;
        else if (hasSingle && !hasDouble)
          qs = doubleQuotedString;
        else
          qs = singleQuote ? singleQuotedString : doubleQuotedString;
      }
      return qs(value, ctx);
    }
    var blockEndNewlines;
    try {
      blockEndNewlines = new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
    } catch {
      blockEndNewlines = /\n+(?!\n|$)/g;
    }
    function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
      const { blockQuote, commentString, lineWidth } = ctx.options;
      if (!blockQuote || /\n[\t ]+$/.test(value)) {
        return quotedString(value, ctx);
      }
      const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
      const literal = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.Scalar.BLOCK_FOLDED ? false : type === Scalar.Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
      if (!value)
        return literal ? "|\n" : ">\n";
      let chomp;
      let endStart;
      for (endStart = value.length; endStart > 0; --endStart) {
        const ch = value[endStart - 1];
        if (ch !== "\n" && ch !== "	" && ch !== " ")
          break;
      }
      let end = value.substring(endStart);
      const endNlPos = end.indexOf("\n");
      if (endNlPos === -1) {
        chomp = "-";
      } else if (value === end || endNlPos !== end.length - 1) {
        chomp = "+";
        if (onChompKeep)
          onChompKeep();
      } else {
        chomp = "";
      }
      if (end) {
        value = value.slice(0, -end.length);
        if (end[end.length - 1] === "\n")
          end = end.slice(0, -1);
        end = end.replace(blockEndNewlines, `$&${indent}`);
      }
      let startWithSpace = false;
      let startEnd;
      let startNlPos = -1;
      for (startEnd = 0; startEnd < value.length; ++startEnd) {
        const ch = value[startEnd];
        if (ch === " ")
          startWithSpace = true;
        else if (ch === "\n")
          startNlPos = startEnd;
        else
          break;
      }
      let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
      if (start) {
        value = value.substring(start.length);
        start = start.replace(/\n+/g, `$&${indent}`);
      }
      const indentSize = indent ? "2" : "1";
      let header = (startWithSpace ? indentSize : "") + chomp;
      if (comment) {
        header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
        if (onComment)
          onComment();
      }
      if (!literal) {
        const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
        let literalFallback = false;
        const foldOptions = getFoldOptions(ctx, true);
        if (blockQuote !== "folded" && type !== Scalar.Scalar.BLOCK_FOLDED) {
          foldOptions.onOverflow = () => {
            literalFallback = true;
          };
        }
        const body = foldFlowLines.foldFlowLines(`${start}${foldedValue}${end}`, indent, foldFlowLines.FOLD_BLOCK, foldOptions);
        if (!literalFallback)
          return `>${header}
${indent}${body}`;
      }
      value = value.replace(/\n+/g, `$&${indent}`);
      return `|${header}
${indent}${start}${value}${end}`;
    }
    function plainString(item, ctx, onComment, onChompKeep) {
      const { type, value } = item;
      const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
      if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) {
        return quotedString(value, ctx);
      }
      if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
        return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
      }
      if (!implicitKey && !inFlow && type !== Scalar.Scalar.PLAIN && value.includes("\n")) {
        return blockString(item, ctx, onComment, onChompKeep);
      }
      if (containsDocumentMarker(value)) {
        if (indent === "") {
          ctx.forceBlockIndent = true;
          return blockString(item, ctx, onComment, onChompKeep);
        } else if (implicitKey && indent === indentStep) {
          return quotedString(value, ctx);
        }
      }
      const str = value.replace(/\n+/g, `$&
${indent}`);
      if (actualString) {
        const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str);
        const { compat, tags } = ctx.doc.schema;
        if (tags.some(test) || compat?.some(test))
          return quotedString(value, ctx);
      }
      return implicitKey ? str : foldFlowLines.foldFlowLines(str, indent, foldFlowLines.FOLD_FLOW, getFoldOptions(ctx, false));
    }
    function stringifyString(item, ctx, onComment, onChompKeep) {
      const { implicitKey, inFlow } = ctx;
      const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
      let { type } = item;
      if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
        if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value))
          type = Scalar.Scalar.QUOTE_DOUBLE;
      }
      const _stringify = (_type) => {
        switch (_type) {
          case Scalar.Scalar.BLOCK_FOLDED:
          case Scalar.Scalar.BLOCK_LITERAL:
            return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
          case Scalar.Scalar.QUOTE_DOUBLE:
            return doubleQuotedString(ss.value, ctx);
          case Scalar.Scalar.QUOTE_SINGLE:
            return singleQuotedString(ss.value, ctx);
          case Scalar.Scalar.PLAIN:
            return plainString(ss, ctx, onComment, onChompKeep);
          default:
            return null;
        }
      };
      let res = _stringify(type);
      if (res === null) {
        const { defaultKeyType, defaultStringType } = ctx.options;
        const t = implicitKey && defaultKeyType || defaultStringType;
        res = _stringify(t);
        if (res === null)
          throw new Error(`Unsupported default string type ${t}`);
      }
      return res;
    }
    exports.stringifyString = stringifyString;
  }
});

// node_modules/yaml/dist/stringify/stringify.js
var require_stringify = __commonJS({
  "node_modules/yaml/dist/stringify/stringify.js"(exports) {
    "use strict";
    var anchors = require_anchors();
    var identity = require_identity();
    var stringifyComment = require_stringifyComment();
    var stringifyString = require_stringifyString();
    function createStringifyContext(doc, options) {
      const opt = Object.assign({
        blockQuote: true,
        commentString: stringifyComment.stringifyComment,
        defaultKeyType: null,
        defaultStringType: "PLAIN",
        directives: null,
        doubleQuotedAsJSON: false,
        doubleQuotedMinMultiLineLength: 40,
        falseStr: "false",
        flowCollectionPadding: true,
        indentSeq: true,
        lineWidth: 80,
        minContentWidth: 20,
        nullStr: "null",
        simpleKeys: false,
        singleQuote: null,
        trailingComma: false,
        trueStr: "true",
        verifyAliasOrder: true
      }, doc.schema.toStringOptions, options);
      let inFlow;
      switch (opt.collectionStyle) {
        case "block":
          inFlow = false;
          break;
        case "flow":
          inFlow = true;
          break;
        default:
          inFlow = null;
      }
      return {
        anchors: /* @__PURE__ */ new Set(),
        doc,
        flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
        indent: "",
        indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
        inFlow,
        options: opt
      };
    }
    function getTagObject(tags, item) {
      if (item.tag) {
        const match = tags.filter((t) => t.tag === item.tag);
        if (match.length > 0)
          return match.find((t) => t.format === item.format) ?? match[0];
      }
      let tagObj = void 0;
      let obj;
      if (identity.isScalar(item)) {
        obj = item.value;
        let match = tags.filter((t) => t.identify?.(obj));
        if (match.length > 1) {
          const testMatch = match.filter((t) => t.test);
          if (testMatch.length > 0)
            match = testMatch;
        }
        tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
      } else {
        obj = item;
        tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
      }
      if (!tagObj) {
        const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
        throw new Error(`Tag not resolved for ${name} value`);
      }
      return tagObj;
    }
    function stringifyProps(node, tagObj, { anchors: anchors$1, doc }) {
      if (!doc.directives)
        return "";
      const props = [];
      const anchor = (identity.isScalar(node) || identity.isCollection(node)) && node.anchor;
      if (anchor && anchors.anchorIsValid(anchor)) {
        anchors$1.add(anchor);
        props.push(`&${anchor}`);
      }
      const tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
      if (tag)
        props.push(doc.directives.tagString(tag));
      return props.join(" ");
    }
    function stringify(item, ctx, onComment, onChompKeep) {
      if (identity.isPair(item))
        return item.toString(ctx, onComment, onChompKeep);
      if (identity.isAlias(item)) {
        if (ctx.doc.directives)
          return item.toString(ctx);
        if (ctx.resolvedAliases?.has(item)) {
          throw new TypeError(`Cannot stringify circular structure without alias nodes`);
        } else {
          if (ctx.resolvedAliases)
            ctx.resolvedAliases.add(item);
          else
            ctx.resolvedAliases = /* @__PURE__ */ new Set([item]);
          item = item.resolve(ctx.doc);
        }
      }
      let tagObj = void 0;
      const node = identity.isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
      tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
      const props = stringifyProps(node, tagObj, ctx);
      if (props.length > 0)
        ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
      const str = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : identity.isScalar(node) ? stringifyString.stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
      if (!props)
        return str;
      return identity.isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}
${ctx.indent}${str}`;
    }
    exports.createStringifyContext = createStringifyContext;
    exports.stringify = stringify;
  }
});

// node_modules/yaml/dist/stringify/stringifyPair.js
var require_stringifyPair = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyPair.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyPair({ key, value }, ctx, onComment, onChompKeep) {
      const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
      let keyComment = identity.isNode(key) && key.comment || null;
      if (simpleKeys) {
        if (keyComment) {
          throw new Error("With simple keys, key nodes cannot have comments");
        }
        if (identity.isCollection(key) || !identity.isNode(key) && typeof key === "object") {
          const msg = "With simple keys, collection cannot be used as a key value";
          throw new Error(msg);
        }
      }
      let explicitKey = !simpleKeys && (!key || keyComment && value == null && !ctx.inFlow || identity.isCollection(key) || (identity.isScalar(key) ? key.type === Scalar.Scalar.BLOCK_FOLDED || key.type === Scalar.Scalar.BLOCK_LITERAL : typeof key === "object"));
      ctx = Object.assign({}, ctx, {
        allNullValues: false,
        implicitKey: !explicitKey && (simpleKeys || !allNullValues),
        indent: indent + indentStep
      });
      let keyCommentDone = false;
      let chompKeep = false;
      let str = stringify.stringify(key, ctx, () => keyCommentDone = true, () => chompKeep = true);
      if (!explicitKey && !ctx.inFlow && str.length > 1024) {
        if (simpleKeys)
          throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
        explicitKey = true;
      }
      if (ctx.inFlow) {
        if (allNullValues || value == null) {
          if (keyCommentDone && onComment)
            onComment();
          return str === "" ? "?" : explicitKey ? `? ${str}` : str;
        }
      } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
        str = `? ${str}`;
        if (keyComment && !keyCommentDone) {
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        } else if (chompKeep && onChompKeep)
          onChompKeep();
        return str;
      }
      if (keyCommentDone)
        keyComment = null;
      if (explicitKey) {
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
        str = `? ${str}
${indent}:`;
      } else {
        str = `${str}:`;
        if (keyComment)
          str += stringifyComment.lineComment(str, ctx.indent, commentString(keyComment));
      }
      let vsb, vcb, valueComment;
      if (identity.isNode(value)) {
        vsb = !!value.spaceBefore;
        vcb = value.commentBefore;
        valueComment = value.comment;
      } else {
        vsb = false;
        vcb = null;
        valueComment = null;
        if (value && typeof value === "object")
          value = doc.createNode(value);
      }
      ctx.implicitKey = false;
      if (!explicitKey && !keyComment && identity.isScalar(value))
        ctx.indentAtStart = str.length + 1;
      chompKeep = false;
      if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && identity.isSeq(value) && !value.flow && !value.tag && !value.anchor) {
        ctx.indent = ctx.indent.substring(2);
      }
      let valueCommentDone = false;
      const valueStr = stringify.stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
      let ws = " ";
      if (keyComment || vsb || vcb) {
        ws = vsb ? "\n" : "";
        if (vcb) {
          const cs = commentString(vcb);
          ws += `
${stringifyComment.indentComment(cs, ctx.indent)}`;
        }
        if (valueStr === "" && !ctx.inFlow) {
          if (ws === "\n" && valueComment)
            ws = "\n\n";
        } else {
          ws += `
${ctx.indent}`;
        }
      } else if (!explicitKey && identity.isCollection(value)) {
        const vs0 = valueStr[0];
        const nl0 = valueStr.indexOf("\n");
        const hasNewline = nl0 !== -1;
        const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
        if (hasNewline || !flow) {
          let hasPropsLine = false;
          if (hasNewline && (vs0 === "&" || vs0 === "!")) {
            let sp0 = valueStr.indexOf(" ");
            if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") {
              sp0 = valueStr.indexOf(" ", sp0 + 1);
            }
            if (sp0 === -1 || nl0 < sp0)
              hasPropsLine = true;
          }
          if (!hasPropsLine)
            ws = `
${ctx.indent}`;
        }
      } else if (valueStr === "" || valueStr[0] === "\n") {
        ws = "";
      }
      str += ws + valueStr;
      if (ctx.inFlow) {
        if (valueCommentDone && onComment)
          onComment();
      } else if (valueComment && !valueCommentDone) {
        str += stringifyComment.lineComment(str, ctx.indent, commentString(valueComment));
      } else if (chompKeep && onChompKeep) {
        onChompKeep();
      }
      return str;
    }
    exports.stringifyPair = stringifyPair;
  }
});

// node_modules/yaml/dist/log.js
var require_log = __commonJS({
  "node_modules/yaml/dist/log.js"(exports) {
    "use strict";
    var node_process = __require("process");
    function debug(logLevel, ...messages) {
      if (logLevel === "debug")
        console.log(...messages);
    }
    function warn(logLevel, warning) {
      if (logLevel === "debug" || logLevel === "warn") {
        if (typeof node_process.emitWarning === "function")
          node_process.emitWarning(warning);
        else
          console.warn(warning);
      }
    }
    exports.debug = debug;
    exports.warn = warn;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/merge.js
var require_merge = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/merge.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var MERGE_KEY = "<<";
    var merge = {
      identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
      default: "key",
      tag: "tag:yaml.org,2002:merge",
      test: /^<<$/,
      resolve: () => Object.assign(new Scalar.Scalar(Symbol(MERGE_KEY)), {
        addToJSMap: addMergeToJSMap
      }),
      stringify: () => MERGE_KEY
    };
    var isMergeKey = (ctx, key) => (merge.identify(key) || identity.isScalar(key) && (!key.type || key.type === Scalar.Scalar.PLAIN) && merge.identify(key.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default);
    function addMergeToJSMap(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (identity.isSeq(source))
        for (const it of source.items)
          mergeValue(ctx, map, it);
      else if (Array.isArray(source))
        for (const it of source)
          mergeValue(ctx, map, it);
      else
        mergeValue(ctx, map, source);
    }
    function mergeValue(ctx, map, value) {
      const source = resolveAliasValue(ctx, value);
      if (!identity.isMap(source))
        throw new Error("Merge sources must be maps or map aliases");
      const srcMap = source.toJSON(null, ctx, Map);
      for (const [key, value2] of srcMap) {
        if (map instanceof Map) {
          if (!map.has(key))
            map.set(key, value2);
        } else if (map instanceof Set) {
          map.add(key);
        } else if (!Object.prototype.hasOwnProperty.call(map, key)) {
          Object.defineProperty(map, key, {
            value: value2,
            writable: true,
            enumerable: true,
            configurable: true
          });
        }
      }
      return map;
    }
    function resolveAliasValue(ctx, value) {
      return ctx && identity.isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
    }
    exports.addMergeToJSMap = addMergeToJSMap;
    exports.isMergeKey = isMergeKey;
    exports.merge = merge;
  }
});

// node_modules/yaml/dist/nodes/addPairToJSMap.js
var require_addPairToJSMap = __commonJS({
  "node_modules/yaml/dist/nodes/addPairToJSMap.js"(exports) {
    "use strict";
    var log = require_log();
    var merge = require_merge();
    var stringify = require_stringify();
    var identity = require_identity();
    var toJS = require_toJS();
    function addPairToJSMap(ctx, map, { key, value }) {
      if (identity.isNode(key) && key.addToJSMap)
        key.addToJSMap(ctx, map, value);
      else if (merge.isMergeKey(ctx, key))
        merge.addMergeToJSMap(ctx, map, value);
      else {
        const jsKey = toJS.toJS(key, "", ctx);
        if (map instanceof Map) {
          map.set(jsKey, toJS.toJS(value, jsKey, ctx));
        } else if (map instanceof Set) {
          map.add(jsKey);
        } else {
          const stringKey = stringifyKey(key, jsKey, ctx);
          const jsValue = toJS.toJS(value, stringKey, ctx);
          if (stringKey in map)
            Object.defineProperty(map, stringKey, {
              value: jsValue,
              writable: true,
              enumerable: true,
              configurable: true
            });
          else
            map[stringKey] = jsValue;
        }
      }
      return map;
    }
    function stringifyKey(key, jsKey, ctx) {
      if (jsKey === null)
        return "";
      if (typeof jsKey !== "object")
        return String(jsKey);
      if (identity.isNode(key) && ctx?.doc) {
        const strCtx = stringify.createStringifyContext(ctx.doc, {});
        strCtx.anchors = /* @__PURE__ */ new Set();
        for (const node of ctx.anchors.keys())
          strCtx.anchors.add(node.anchor);
        strCtx.inFlow = true;
        strCtx.inStringifyKey = true;
        const strKey = key.toString(strCtx);
        if (!ctx.mapKeyWarned) {
          let jsonStr = JSON.stringify(strKey);
          if (jsonStr.length > 40)
            jsonStr = jsonStr.substring(0, 36) + '..."';
          log.warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
          ctx.mapKeyWarned = true;
        }
        return strKey;
      }
      return JSON.stringify(jsKey);
    }
    exports.addPairToJSMap = addPairToJSMap;
  }
});

// node_modules/yaml/dist/nodes/Pair.js
var require_Pair = __commonJS({
  "node_modules/yaml/dist/nodes/Pair.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var stringifyPair = require_stringifyPair();
    var addPairToJSMap = require_addPairToJSMap();
    var identity = require_identity();
    function createPair(key, value, ctx) {
      const k = createNode.createNode(key, void 0, ctx);
      const v = createNode.createNode(value, void 0, ctx);
      return new Pair(k, v);
    }
    var Pair = class _Pair {
      constructor(key, value = null) {
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.PAIR });
        this.key = key;
        this.value = value;
      }
      clone(schema) {
        let { key, value } = this;
        if (identity.isNode(key))
          key = key.clone(schema);
        if (identity.isNode(value))
          value = value.clone(schema);
        return new _Pair(key, value);
      }
      toJSON(_, ctx) {
        const pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        return addPairToJSMap.addPairToJSMap(ctx, pair, this);
      }
      toString(ctx, onComment, onChompKeep) {
        return ctx?.doc ? stringifyPair.stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
      }
    };
    exports.Pair = Pair;
    exports.createPair = createPair;
  }
});

// node_modules/yaml/dist/stringify/stringifyCollection.js
var require_stringifyCollection = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyCollection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyCollection(collection, ctx, options) {
      const flow = ctx.inFlow ?? collection.flow;
      const stringify2 = flow ? stringifyFlowCollection : stringifyBlockCollection;
      return stringify2(collection, ctx, options);
    }
    function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
      const { indent, options: { commentString } } = ctx;
      const itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null });
      let chompKeep = false;
      const lines = [];
      for (let i2 = 0; i2 < items.length; ++i2) {
        const item = items[i2];
        let comment2 = null;
        if (identity.isNode(item)) {
          if (!chompKeep && item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
          if (item.comment)
            comment2 = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (!chompKeep && ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
          }
        }
        chompKeep = false;
        let str2 = stringify.stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
        if (comment2)
          str2 += stringifyComment.lineComment(str2, itemIndent, commentString(comment2));
        if (chompKeep && comment2)
          chompKeep = false;
        lines.push(blockItemPrefix + str2);
      }
      let str;
      if (lines.length === 0) {
        str = flowChars.start + flowChars.end;
      } else {
        str = lines[0];
        for (let i2 = 1; i2 < lines.length; ++i2) {
          const line = lines[i2];
          str += line ? `
${indent}${line}` : "\n";
        }
      }
      if (comment) {
        str += "\n" + stringifyComment.indentComment(commentString(comment), indent);
        if (onComment)
          onComment();
      } else if (chompKeep && onChompKeep)
        onChompKeep();
      return str;
    }
    function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
      const { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
      itemIndent += indentStep;
      const itemCtx = Object.assign({}, ctx, {
        indent: itemIndent,
        inFlow: true,
        type: null
      });
      let reqNewline = false;
      let linesAtValue = 0;
      const lines = [];
      for (let i2 = 0; i2 < items.length; ++i2) {
        const item = items[i2];
        let comment = null;
        if (identity.isNode(item)) {
          if (item.spaceBefore)
            lines.push("");
          addCommentBefore(ctx, lines, item.commentBefore, false);
          if (item.comment)
            comment = item.comment;
        } else if (identity.isPair(item)) {
          const ik = identity.isNode(item.key) ? item.key : null;
          if (ik) {
            if (ik.spaceBefore)
              lines.push("");
            addCommentBefore(ctx, lines, ik.commentBefore, false);
            if (ik.comment)
              reqNewline = true;
          }
          const iv = identity.isNode(item.value) ? item.value : null;
          if (iv) {
            if (iv.comment)
              comment = iv.comment;
            if (iv.commentBefore)
              reqNewline = true;
          } else if (item.value == null && ik?.comment) {
            comment = ik.comment;
          }
        }
        if (comment)
          reqNewline = true;
        let str = stringify.stringify(item, itemCtx, () => comment = null);
        reqNewline || (reqNewline = lines.length > linesAtValue || str.includes("\n"));
        if (i2 < items.length - 1) {
          str += ",";
        } else if (ctx.options.trailingComma) {
          if (ctx.options.lineWidth > 0) {
            reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str.length + 2) > ctx.options.lineWidth);
          }
          if (reqNewline) {
            str += ",";
          }
        }
        if (comment)
          str += stringifyComment.lineComment(str, itemIndent, commentString(comment));
        lines.push(str);
        linesAtValue = lines.length;
      }
      const { start, end } = flowChars;
      if (lines.length === 0) {
        return start + end;
      } else {
        if (!reqNewline) {
          const len = lines.reduce((sum, line) => sum + line.length + 2, 2);
          reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
        }
        if (reqNewline) {
          let str = start;
          for (const line of lines)
            str += line ? `
${indentStep}${indent}${line}` : "\n";
          return `${str}
${indent}${end}`;
        } else {
          return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
        }
      }
    }
    function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
      if (comment && chompKeep)
        comment = comment.replace(/^\n+/, "");
      if (comment) {
        const ic = stringifyComment.indentComment(commentString(comment), indent);
        lines.push(ic.trimStart());
      }
    }
    exports.stringifyCollection = stringifyCollection;
  }
});

// node_modules/yaml/dist/nodes/YAMLMap.js
var require_YAMLMap = __commonJS({
  "node_modules/yaml/dist/nodes/YAMLMap.js"(exports) {
    "use strict";
    var stringifyCollection = require_stringifyCollection();
    var addPairToJSMap = require_addPairToJSMap();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    function findPair(items, key) {
      const k = identity.isScalar(key) ? key.value : key;
      for (const it of items) {
        if (identity.isPair(it)) {
          if (it.key === key || it.key === k)
            return it;
          if (identity.isScalar(it.key) && it.key.value === k)
            return it;
        }
      }
      return void 0;
    }
    var YAMLMap = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:map";
      }
      constructor(schema) {
        super(identity.MAP, schema);
        this.items = [];
      }
      /**
       * A generic collection parsing method that can be extended
       * to other node classes that inherit from YAMLMap
       */
      static from(schema, obj, ctx) {
        const { keepUndefined, replacer } = ctx;
        const map = new this(schema);
        const add = (key, value) => {
          if (typeof replacer === "function")
            value = replacer.call(obj, key, value);
          else if (Array.isArray(replacer) && !replacer.includes(key))
            return;
          if (value !== void 0 || keepUndefined)
            map.items.push(Pair.createPair(key, value, ctx));
        };
        if (obj instanceof Map) {
          for (const [key, value] of obj)
            add(key, value);
        } else if (obj && typeof obj === "object") {
          for (const key of Object.keys(obj))
            add(key, obj[key]);
        }
        if (typeof schema.sortMapEntries === "function") {
          map.items.sort(schema.sortMapEntries);
        }
        return map;
      }
      /**
       * Adds a value to the collection.
       *
       * @param overwrite - If not set `true`, using a key that is already in the
       *   collection will throw. Otherwise, overwrites the previous value.
       */
      add(pair, overwrite) {
        let _pair;
        if (identity.isPair(pair))
          _pair = pair;
        else if (!pair || typeof pair !== "object" || !("key" in pair)) {
          _pair = new Pair.Pair(pair, pair?.value);
        } else
          _pair = new Pair.Pair(pair.key, pair.value);
        const prev = findPair(this.items, _pair.key);
        const sortEntries = this.schema?.sortMapEntries;
        if (prev) {
          if (!overwrite)
            throw new Error(`Key ${_pair.key} already set`);
          if (identity.isScalar(prev.value) && Scalar.isScalarValue(_pair.value))
            prev.value.value = _pair.value;
          else
            prev.value = _pair.value;
        } else if (sortEntries) {
          const i2 = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
          if (i2 === -1)
            this.items.push(_pair);
          else
            this.items.splice(i2, 0, _pair);
        } else {
          this.items.push(_pair);
        }
      }
      delete(key) {
        const it = findPair(this.items, key);
        if (!it)
          return false;
        const del = this.items.splice(this.items.indexOf(it), 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const it = findPair(this.items, key);
        const node = it?.value;
        return (!keepScalar && identity.isScalar(node) ? node.value : node) ?? void 0;
      }
      has(key) {
        return !!findPair(this.items, key);
      }
      set(key, value) {
        this.add(new Pair.Pair(key, value), true);
      }
      /**
       * @param ctx - Conversion context, originally set in Document#toJS()
       * @param {Class} Type - If set, forces the returned collection type
       * @returns Instance of Type, Map, or Object
       */
      toJSON(_, ctx, Type) {
        const map = Type ? new Type() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const item of this.items)
          addPairToJSMap.addPairToJSMap(ctx, map, item);
        return map;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        for (const item of this.items) {
          if (!identity.isPair(item))
            throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
        }
        if (!ctx.allNullValues && this.hasAllNullValues(false))
          ctx = Object.assign({}, ctx, { allNullValues: true });
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "",
          flowChars: { start: "{", end: "}" },
          itemIndent: ctx.indent || "",
          onChompKeep,
          onComment
        });
      }
    };
    exports.YAMLMap = YAMLMap;
    exports.findPair = findPair;
  }
});

// node_modules/yaml/dist/schema/common/map.js
var require_map = __commonJS({
  "node_modules/yaml/dist/schema/common/map.js"(exports) {
    "use strict";
    var identity = require_identity();
    var YAMLMap = require_YAMLMap();
    var map = {
      collection: "map",
      default: true,
      nodeClass: YAMLMap.YAMLMap,
      tag: "tag:yaml.org,2002:map",
      resolve(map2, onError) {
        if (!identity.isMap(map2))
          onError("Expected a mapping for this tag");
        return map2;
      },
      createNode: (schema, obj, ctx) => YAMLMap.YAMLMap.from(schema, obj, ctx)
    };
    exports.map = map;
  }
});

// node_modules/yaml/dist/nodes/YAMLSeq.js
var require_YAMLSeq = __commonJS({
  "node_modules/yaml/dist/nodes/YAMLSeq.js"(exports) {
    "use strict";
    var createNode = require_createNode();
    var stringifyCollection = require_stringifyCollection();
    var Collection = require_Collection();
    var identity = require_identity();
    var Scalar = require_Scalar();
    var toJS = require_toJS();
    var YAMLSeq = class extends Collection.Collection {
      static get tagName() {
        return "tag:yaml.org,2002:seq";
      }
      constructor(schema) {
        super(identity.SEQ, schema);
        this.items = [];
      }
      add(value) {
        this.items.push(value);
      }
      /**
       * Removes a value from the collection.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       *
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return false;
        const del = this.items.splice(idx, 1);
        return del.length > 0;
      }
      get(key, keepScalar) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          return void 0;
        const it = this.items[idx];
        return !keepScalar && identity.isScalar(it) ? it.value : it;
      }
      /**
       * Checks if the collection includes a value with the key `key`.
       *
       * `key` must contain a representation of an integer for this to succeed.
       * It may be wrapped in a `Scalar`.
       */
      has(key) {
        const idx = asItemIndex(key);
        return typeof idx === "number" && idx < this.items.length;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       *
       * If `key` does not contain a representation of an integer, this will throw.
       * It may be wrapped in a `Scalar`.
       */
      set(key, value) {
        const idx = asItemIndex(key);
        if (typeof idx !== "number")
          throw new Error(`Expected a valid index, not ${key}.`);
        const prev = this.items[idx];
        if (identity.isScalar(prev) && Scalar.isScalarValue(value))
          prev.value = value;
        else
          this.items[idx] = value;
      }
      toJSON(_, ctx) {
        const seq = [];
        if (ctx?.onCreate)
          ctx.onCreate(seq);
        let i2 = 0;
        for (const item of this.items)
          seq.push(toJS.toJS(item, String(i2++), ctx));
        return seq;
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        return stringifyCollection.stringifyCollection(this, ctx, {
          blockItemPrefix: "- ",
          flowChars: { start: "[", end: "]" },
          itemIndent: (ctx.indent || "") + "  ",
          onChompKeep,
          onComment
        });
      }
      static from(schema, obj, ctx) {
        const { replacer } = ctx;
        const seq = new this(schema);
        if (obj && Symbol.iterator in Object(obj)) {
          let i2 = 0;
          for (let it of obj) {
            if (typeof replacer === "function") {
              const key = obj instanceof Set ? it : String(i2++);
              it = replacer.call(obj, key, it);
            }
            seq.items.push(createNode.createNode(it, void 0, ctx));
          }
        }
        return seq;
      }
    };
    function asItemIndex(key) {
      let idx = identity.isScalar(key) ? key.value : key;
      if (idx && typeof idx === "string")
        idx = Number(idx);
      return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
    }
    exports.YAMLSeq = YAMLSeq;
  }
});

// node_modules/yaml/dist/schema/common/seq.js
var require_seq = __commonJS({
  "node_modules/yaml/dist/schema/common/seq.js"(exports) {
    "use strict";
    var identity = require_identity();
    var YAMLSeq = require_YAMLSeq();
    var seq = {
      collection: "seq",
      default: true,
      nodeClass: YAMLSeq.YAMLSeq,
      tag: "tag:yaml.org,2002:seq",
      resolve(seq2, onError) {
        if (!identity.isSeq(seq2))
          onError("Expected a sequence for this tag");
        return seq2;
      },
      createNode: (schema, obj, ctx) => YAMLSeq.YAMLSeq.from(schema, obj, ctx)
    };
    exports.seq = seq;
  }
});

// node_modules/yaml/dist/schema/common/string.js
var require_string = __commonJS({
  "node_modules/yaml/dist/schema/common/string.js"(exports) {
    "use strict";
    var stringifyString = require_stringifyString();
    var string = {
      identify: (value) => typeof value === "string",
      default: true,
      tag: "tag:yaml.org,2002:str",
      resolve: (str) => str,
      stringify(item, ctx, onComment, onChompKeep) {
        ctx = Object.assign({ actualString: true }, ctx);
        return stringifyString.stringifyString(item, ctx, onComment, onChompKeep);
      }
    };
    exports.string = string;
  }
});

// node_modules/yaml/dist/schema/common/null.js
var require_null = __commonJS({
  "node_modules/yaml/dist/schema/common/null.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var nullTag = {
      identify: (value) => value == null,
      createNode: () => new Scalar.Scalar(null),
      default: true,
      tag: "tag:yaml.org,2002:null",
      test: /^(?:~|[Nn]ull|NULL)?$/,
      resolve: () => new Scalar.Scalar(null),
      stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
    };
    exports.nullTag = nullTag;
  }
});

// node_modules/yaml/dist/schema/core/bool.js
var require_bool = __commonJS({
  "node_modules/yaml/dist/schema/core/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var boolTag = {
      identify: (value) => typeof value === "boolean",
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
      resolve: (str) => new Scalar.Scalar(str[0] === "t" || str[0] === "T"),
      stringify({ source, value }, ctx) {
        if (source && boolTag.test.test(source)) {
          const sv = source[0] === "t" || source[0] === "T";
          if (value === sv)
            return source;
        }
        return value ? ctx.options.trueStr : ctx.options.falseStr;
      }
    };
    exports.boolTag = boolTag;
  }
});

// node_modules/yaml/dist/stringify/stringifyNumber.js
var require_stringifyNumber = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyNumber.js"(exports) {
    "use strict";
    function stringifyNumber({ format, minFractionDigits, tag, value }) {
      if (typeof value === "bigint")
        return String(value);
      const num = typeof value === "number" ? value : Number(value);
      if (!isFinite(num))
        return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
      let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
      if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n) && !n.includes("e")) {
        let i2 = n.indexOf(".");
        if (i2 < 0) {
          i2 = n.length;
          n += ".";
        }
        let d = minFractionDigits - (n.length - i2 - 1);
        while (d-- > 0)
          n += "0";
      }
      return n;
    }
    exports.stringifyNumber = stringifyNumber;
  }
});

// node_modules/yaml/dist/schema/core/float.js
var require_float = __commonJS({
  "node_modules/yaml/dist/schema/core/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str));
        const dot = str.indexOf(".");
        if (dot !== -1 && str[str.length - 1] === "0")
          node.minFractionDigits = str.length - dot - 1;
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// node_modules/yaml/dist/schema/core/int.js
var require_int = __commonJS({
  "node_modules/yaml/dist/schema/core/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    var intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value) && value >= 0)
        return prefix + value.toString(radix);
      return stringifyNumber.stringifyNumber(node);
    }
    var intOct = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^0o[0-7]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
      stringify: (node) => intStringify(node, 8, "0o")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: (value) => intIdentify(value) && value >= 0,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^0x[0-9a-fA-F]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// node_modules/yaml/dist/schema/core/schema.js
var require_schema = __commonJS({
  "node_modules/yaml/dist/schema/core/schema.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.boolTag,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float
    ];
    exports.schema = schema;
  }
});

// node_modules/yaml/dist/schema/json/schema.js
var require_schema2 = __commonJS({
  "node_modules/yaml/dist/schema/json/schema.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var map = require_map();
    var seq = require_seq();
    function intIdentify(value) {
      return typeof value === "bigint" || Number.isInteger(value);
    }
    var stringifyJSON = ({ value }) => JSON.stringify(value);
    var jsonScalars = [
      {
        identify: (value) => typeof value === "string",
        default: true,
        tag: "tag:yaml.org,2002:str",
        resolve: (str) => str,
        stringify: stringifyJSON
      },
      {
        identify: (value) => value == null,
        createNode: () => new Scalar.Scalar(null),
        default: true,
        tag: "tag:yaml.org,2002:null",
        test: /^null$/,
        resolve: () => null,
        stringify: stringifyJSON
      },
      {
        identify: (value) => typeof value === "boolean",
        default: true,
        tag: "tag:yaml.org,2002:bool",
        test: /^true$|^false$/,
        resolve: (str) => str === "true",
        stringify: stringifyJSON
      },
      {
        identify: intIdentify,
        default: true,
        tag: "tag:yaml.org,2002:int",
        test: /^-?(?:0|[1-9][0-9]*)$/,
        resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
        stringify: ({ value }) => intIdentify(value) ? value.toString() : JSON.stringify(value)
      },
      {
        identify: (value) => typeof value === "number",
        default: true,
        tag: "tag:yaml.org,2002:float",
        test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
        resolve: (str) => parseFloat(str),
        stringify: stringifyJSON
      }
    ];
    var jsonError = {
      default: true,
      tag: "",
      test: /^/,
      resolve(str, onError) {
        onError(`Unresolved plain scalar ${JSON.stringify(str)}`);
        return str;
      }
    };
    var schema = [map.map, seq.seq].concat(jsonScalars, jsonError);
    exports.schema = schema;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/binary.js
var require_binary = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/binary.js"(exports) {
    "use strict";
    var node_buffer = __require("buffer");
    var Scalar = require_Scalar();
    var stringifyString = require_stringifyString();
    var binary = {
      identify: (value) => value instanceof Uint8Array,
      // Buffer inherits from Uint8Array
      default: false,
      tag: "tag:yaml.org,2002:binary",
      /**
       * Returns a Buffer in node and an Uint8Array in browsers
       *
       * To use the resulting buffer as an image, you'll want to do something like:
       *
       *   const blob = new Blob([buffer], { type: 'image/jpeg' })
       *   document.querySelector('#photo').src = URL.createObjectURL(blob)
       */
      resolve(src, onError) {
        if (typeof node_buffer.Buffer === "function") {
          return node_buffer.Buffer.from(src, "base64");
        } else if (typeof atob === "function") {
          const str = atob(src.replace(/[\n\r]/g, ""));
          const buffer = new Uint8Array(str.length);
          for (let i2 = 0; i2 < str.length; ++i2)
            buffer[i2] = str.charCodeAt(i2);
          return buffer;
        } else {
          onError("This environment does not support reading binary tags; either Buffer or atob is required");
          return src;
        }
      },
      stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
        if (!value)
          return "";
        const buf = value;
        let str;
        if (typeof node_buffer.Buffer === "function") {
          str = buf instanceof node_buffer.Buffer ? buf.toString("base64") : node_buffer.Buffer.from(buf.buffer).toString("base64");
        } else if (typeof btoa === "function") {
          let s = "";
          for (let i2 = 0; i2 < buf.length; ++i2)
            s += String.fromCharCode(buf[i2]);
          str = btoa(s);
        } else {
          throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
        }
        type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
        if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
          const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
          const n = Math.ceil(str.length / lineWidth);
          const lines = new Array(n);
          for (let i2 = 0, o = 0; i2 < n; ++i2, o += lineWidth) {
            lines[i2] = str.substr(o, lineWidth);
          }
          str = lines.join(type === Scalar.Scalar.BLOCK_LITERAL ? "\n" : " ");
        }
        return stringifyString.stringifyString({ comment, type, value: str }, ctx, onComment, onChompKeep);
      }
    };
    exports.binary = binary;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/pairs.js
var require_pairs = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/pairs.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLSeq = require_YAMLSeq();
    function resolvePairs(seq, onError) {
      if (identity.isSeq(seq)) {
        for (let i2 = 0; i2 < seq.items.length; ++i2) {
          let item = seq.items[i2];
          if (identity.isPair(item))
            continue;
          else if (identity.isMap(item)) {
            if (item.items.length > 1)
              onError("Each pair must have its own sequence indicator");
            const pair = item.items[0] || new Pair.Pair(new Scalar.Scalar(null));
            if (item.commentBefore)
              pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}
${pair.key.commentBefore}` : item.commentBefore;
            if (item.comment) {
              const cn = pair.value ?? pair.key;
              cn.comment = cn.comment ? `${item.comment}
${cn.comment}` : item.comment;
            }
            item = pair;
          }
          seq.items[i2] = identity.isPair(item) ? item : new Pair.Pair(item);
        }
      } else
        onError("Expected a sequence for this tag");
      return seq;
    }
    function createPairs(schema, iterable, ctx) {
      const { replacer } = ctx;
      const pairs2 = new YAMLSeq.YAMLSeq(schema);
      pairs2.tag = "tag:yaml.org,2002:pairs";
      let i2 = 0;
      if (iterable && Symbol.iterator in Object(iterable))
        for (let it of iterable) {
          if (typeof replacer === "function")
            it = replacer.call(iterable, String(i2++), it);
          let key, value;
          if (Array.isArray(it)) {
            if (it.length === 2) {
              key = it[0];
              value = it[1];
            } else
              throw new TypeError(`Expected [key, value] tuple: ${it}`);
          } else if (it && it instanceof Object) {
            const keys = Object.keys(it);
            if (keys.length === 1) {
              key = keys[0];
              value = it[key];
            } else {
              throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
            }
          } else {
            key = it;
          }
          pairs2.items.push(Pair.createPair(key, value, ctx));
        }
      return pairs2;
    }
    var pairs = {
      collection: "seq",
      default: false,
      tag: "tag:yaml.org,2002:pairs",
      resolve: resolvePairs,
      createNode: createPairs
    };
    exports.createPairs = createPairs;
    exports.pairs = pairs;
    exports.resolvePairs = resolvePairs;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/omap.js
var require_omap = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/omap.js"(exports) {
    "use strict";
    var identity = require_identity();
    var toJS = require_toJS();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var pairs = require_pairs();
    var YAMLOMap = class _YAMLOMap extends YAMLSeq.YAMLSeq {
      constructor() {
        super();
        this.add = YAMLMap.YAMLMap.prototype.add.bind(this);
        this.delete = YAMLMap.YAMLMap.prototype.delete.bind(this);
        this.get = YAMLMap.YAMLMap.prototype.get.bind(this);
        this.has = YAMLMap.YAMLMap.prototype.has.bind(this);
        this.set = YAMLMap.YAMLMap.prototype.set.bind(this);
        this.tag = _YAMLOMap.tag;
      }
      /**
       * If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
       * but TypeScript won't allow widening the signature of a child method.
       */
      toJSON(_, ctx) {
        if (!ctx)
          return super.toJSON(_);
        const map = /* @__PURE__ */ new Map();
        if (ctx?.onCreate)
          ctx.onCreate(map);
        for (const pair of this.items) {
          let key, value;
          if (identity.isPair(pair)) {
            key = toJS.toJS(pair.key, "", ctx);
            value = toJS.toJS(pair.value, key, ctx);
          } else {
            key = toJS.toJS(pair, "", ctx);
          }
          if (map.has(key))
            throw new Error("Ordered maps must not include duplicate keys");
          map.set(key, value);
        }
        return map;
      }
      static from(schema, iterable, ctx) {
        const pairs$1 = pairs.createPairs(schema, iterable, ctx);
        const omap2 = new this();
        omap2.items = pairs$1.items;
        return omap2;
      }
    };
    YAMLOMap.tag = "tag:yaml.org,2002:omap";
    var omap = {
      collection: "seq",
      identify: (value) => value instanceof Map,
      nodeClass: YAMLOMap,
      default: false,
      tag: "tag:yaml.org,2002:omap",
      resolve(seq, onError) {
        const pairs$1 = pairs.resolvePairs(seq, onError);
        const seenKeys = [];
        for (const { key } of pairs$1.items) {
          if (identity.isScalar(key)) {
            if (seenKeys.includes(key.value)) {
              onError(`Ordered maps must not include duplicate keys: ${key.value}`);
            } else {
              seenKeys.push(key.value);
            }
          }
        }
        return Object.assign(new YAMLOMap(), pairs$1);
      },
      createNode: (schema, iterable, ctx) => YAMLOMap.from(schema, iterable, ctx)
    };
    exports.YAMLOMap = YAMLOMap;
    exports.omap = omap;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/bool.js
var require_bool2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/bool.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function boolStringify({ value, source }, ctx) {
      const boolObj = value ? trueTag : falseTag;
      if (source && boolObj.test.test(source))
        return source;
      return value ? ctx.options.trueStr : ctx.options.falseStr;
    }
    var trueTag = {
      identify: (value) => value === true,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
      resolve: () => new Scalar.Scalar(true),
      stringify: boolStringify
    };
    var falseTag = {
      identify: (value) => value === false,
      default: true,
      tag: "tag:yaml.org,2002:bool",
      test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
      resolve: () => new Scalar.Scalar(false),
      stringify: boolStringify
    };
    exports.falseTag = falseTag;
    exports.trueTag = trueTag;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/float.js
var require_float2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/float.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var stringifyNumber = require_stringifyNumber();
    var floatNaN = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
      resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
      stringify: stringifyNumber.stringifyNumber
    };
    var floatExp = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "EXP",
      test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
      resolve: (str) => parseFloat(str.replace(/_/g, "")),
      stringify(node) {
        const num = Number(node.value);
        return isFinite(num) ? num.toExponential() : stringifyNumber.stringifyNumber(node);
      }
    };
    var float = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
      resolve(str) {
        const node = new Scalar.Scalar(parseFloat(str.replace(/_/g, "")));
        const dot = str.indexOf(".");
        if (dot !== -1) {
          const f = str.substring(dot + 1).replace(/_/g, "");
          if (f[f.length - 1] === "0")
            node.minFractionDigits = f.length;
        }
        return node;
      },
      stringify: stringifyNumber.stringifyNumber
    };
    exports.float = float;
    exports.floatExp = floatExp;
    exports.floatNaN = floatNaN;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/int.js
var require_int2 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/int.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
    function intResolve(str, offset, radix, { intAsBigInt }) {
      const sign = str[0];
      if (sign === "-" || sign === "+")
        offset += 1;
      str = str.substring(offset).replace(/_/g, "");
      if (intAsBigInt) {
        switch (radix) {
          case 2:
            str = `0b${str}`;
            break;
          case 8:
            str = `0o${str}`;
            break;
          case 16:
            str = `0x${str}`;
            break;
        }
        const n2 = BigInt(str);
        return sign === "-" ? BigInt(-1) * n2 : n2;
      }
      const n = parseInt(str, radix);
      return sign === "-" ? -1 * n : n;
    }
    function intStringify(node, radix, prefix) {
      const { value } = node;
      if (intIdentify(value)) {
        const str = value.toString(radix);
        return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
      }
      return stringifyNumber.stringifyNumber(node);
    }
    var intBin = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "BIN",
      test: /^[-+]?0b[0-1_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 2, opt),
      stringify: (node) => intStringify(node, 2, "0b")
    };
    var intOct = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "OCT",
      test: /^[-+]?0[0-7_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 1, 8, opt),
      stringify: (node) => intStringify(node, 8, "0")
    };
    var int = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      test: /^[-+]?[0-9][0-9_]*$/,
      resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
      stringify: stringifyNumber.stringifyNumber
    };
    var intHex = {
      identify: intIdentify,
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "HEX",
      test: /^[-+]?0x[0-9a-fA-F_]+$/,
      resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
      stringify: (node) => intStringify(node, 16, "0x")
    };
    exports.int = int;
    exports.intBin = intBin;
    exports.intHex = intHex;
    exports.intOct = intOct;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/set.js
var require_set = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/set.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSet = class _YAMLSet extends YAMLMap.YAMLMap {
      constructor(schema) {
        super(schema);
        this.tag = _YAMLSet.tag;
      }
      add(key) {
        let pair;
        if (identity.isPair(key))
          pair = key;
        else if (key && typeof key === "object" && "key" in key && "value" in key && key.value === null)
          pair = new Pair.Pair(key.key, null);
        else
          pair = new Pair.Pair(key, null);
        const prev = YAMLMap.findPair(this.items, pair.key);
        if (!prev)
          this.items.push(pair);
      }
      /**
       * If `keepPair` is `true`, returns the Pair matching `key`.
       * Otherwise, returns the value of that Pair's key.
       */
      get(key, keepPair) {
        const pair = YAMLMap.findPair(this.items, key);
        return !keepPair && identity.isPair(pair) ? identity.isScalar(pair.key) ? pair.key.value : pair.key : pair;
      }
      set(key, value) {
        if (typeof value !== "boolean")
          throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
        const prev = YAMLMap.findPair(this.items, key);
        if (prev && !value) {
          this.items.splice(this.items.indexOf(prev), 1);
        } else if (!prev && value) {
          this.items.push(new Pair.Pair(key));
        }
      }
      toJSON(_, ctx) {
        return super.toJSON(_, ctx, Set);
      }
      toString(ctx, onComment, onChompKeep) {
        if (!ctx)
          return JSON.stringify(this);
        if (this.hasAllNullValues(true))
          return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
        else
          throw new Error("Set items must all have null values");
      }
      static from(schema, iterable, ctx) {
        const { replacer } = ctx;
        const set2 = new this(schema);
        if (iterable && Symbol.iterator in Object(iterable))
          for (let value of iterable) {
            if (typeof replacer === "function")
              value = replacer.call(iterable, value, value);
            set2.items.push(Pair.createPair(value, null, ctx));
          }
        return set2;
      }
    };
    YAMLSet.tag = "tag:yaml.org,2002:set";
    var set = {
      collection: "map",
      identify: (value) => value instanceof Set,
      nodeClass: YAMLSet,
      default: false,
      tag: "tag:yaml.org,2002:set",
      createNode: (schema, iterable, ctx) => YAMLSet.from(schema, iterable, ctx),
      resolve(map, onError) {
        if (identity.isMap(map)) {
          if (map.hasAllNullValues(true))
            return Object.assign(new YAMLSet(), map);
          else
            onError("Set items must all have null values");
        } else
          onError("Expected a mapping for this tag");
        return map;
      }
    };
    exports.YAMLSet = YAMLSet;
    exports.set = set;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/timestamp.js
var require_timestamp = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/timestamp.js"(exports) {
    "use strict";
    var stringifyNumber = require_stringifyNumber();
    function parseSexagesimal(str, asBigInt) {
      const sign = str[0];
      const parts = sign === "-" || sign === "+" ? str.substring(1) : str;
      const num = (n) => asBigInt ? BigInt(n) : Number(n);
      const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num(60) + num(p), num(0));
      return sign === "-" ? num(-1) * res : res;
    }
    function stringifySexagesimal(node) {
      let { value } = node;
      let num = (n) => n;
      if (typeof value === "bigint")
        num = (n) => BigInt(n);
      else if (isNaN(value) || !isFinite(value))
        return stringifyNumber.stringifyNumber(node);
      let sign = "";
      if (value < 0) {
        sign = "-";
        value *= num(-1);
      }
      const _60 = num(60);
      const parts = [value % _60];
      if (value < 60) {
        parts.unshift(0);
      } else {
        value = (value - parts[0]) / _60;
        parts.unshift(value % _60);
        if (value >= 60) {
          value = (value - parts[0]) / _60;
          parts.unshift(value);
        }
      }
      return sign + parts.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
    }
    var intTime = {
      identify: (value) => typeof value === "bigint" || Number.isInteger(value),
      default: true,
      tag: "tag:yaml.org,2002:int",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
      resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
      stringify: stringifySexagesimal
    };
    var floatTime = {
      identify: (value) => typeof value === "number",
      default: true,
      tag: "tag:yaml.org,2002:float",
      format: "TIME",
      test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
      resolve: (str) => parseSexagesimal(str, false),
      stringify: stringifySexagesimal
    };
    var timestamp = {
      identify: (value) => value instanceof Date,
      default: true,
      tag: "tag:yaml.org,2002:timestamp",
      // If the time zone is omitted, the timestamp is assumed to be specified in UTC. The time part
      // may be omitted altogether, resulting in a date format. In such a case, the time part is
      // assumed to be 00:00:00Z (start of day, UTC).
      test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
      resolve(str) {
        const match = str.match(timestamp.test);
        if (!match)
          throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
        const [, year, month, day, hour, minute, second] = match.map(Number);
        const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
        let date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
        const tz = match[8];
        if (tz && tz !== "Z") {
          let d = parseSexagesimal(tz, false);
          if (Math.abs(d) < 30)
            d *= 60;
          date -= 6e4 * d;
        }
        return new Date(date);
      },
      stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
    };
    exports.floatTime = floatTime;
    exports.intTime = intTime;
    exports.timestamp = timestamp;
  }
});

// node_modules/yaml/dist/schema/yaml-1.1/schema.js
var require_schema3 = __commonJS({
  "node_modules/yaml/dist/schema/yaml-1.1/schema.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var binary = require_binary();
    var bool = require_bool2();
    var float = require_float2();
    var int = require_int2();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var set = require_set();
    var timestamp = require_timestamp();
    var schema = [
      map.map,
      seq.seq,
      string.string,
      _null.nullTag,
      bool.trueTag,
      bool.falseTag,
      int.intBin,
      int.intOct,
      int.int,
      int.intHex,
      float.floatNaN,
      float.floatExp,
      float.float,
      binary.binary,
      merge.merge,
      omap.omap,
      pairs.pairs,
      set.set,
      timestamp.intTime,
      timestamp.floatTime,
      timestamp.timestamp
    ];
    exports.schema = schema;
  }
});

// node_modules/yaml/dist/schema/tags.js
var require_tags = __commonJS({
  "node_modules/yaml/dist/schema/tags.js"(exports) {
    "use strict";
    var map = require_map();
    var _null = require_null();
    var seq = require_seq();
    var string = require_string();
    var bool = require_bool();
    var float = require_float();
    var int = require_int();
    var schema = require_schema();
    var schema$1 = require_schema2();
    var binary = require_binary();
    var merge = require_merge();
    var omap = require_omap();
    var pairs = require_pairs();
    var schema$2 = require_schema3();
    var set = require_set();
    var timestamp = require_timestamp();
    var schemas = /* @__PURE__ */ new Map([
      ["core", schema.schema],
      ["failsafe", [map.map, seq.seq, string.string]],
      ["json", schema$1.schema],
      ["yaml11", schema$2.schema],
      ["yaml-1.1", schema$2.schema]
    ]);
    var tagsByName = {
      binary: binary.binary,
      bool: bool.boolTag,
      float: float.float,
      floatExp: float.floatExp,
      floatNaN: float.floatNaN,
      floatTime: timestamp.floatTime,
      int: int.int,
      intHex: int.intHex,
      intOct: int.intOct,
      intTime: timestamp.intTime,
      map: map.map,
      merge: merge.merge,
      null: _null.nullTag,
      omap: omap.omap,
      pairs: pairs.pairs,
      seq: seq.seq,
      set: set.set,
      timestamp: timestamp.timestamp
    };
    var coreKnownTags = {
      "tag:yaml.org,2002:binary": binary.binary,
      "tag:yaml.org,2002:merge": merge.merge,
      "tag:yaml.org,2002:omap": omap.omap,
      "tag:yaml.org,2002:pairs": pairs.pairs,
      "tag:yaml.org,2002:set": set.set,
      "tag:yaml.org,2002:timestamp": timestamp.timestamp
    };
    function getTags(customTags, schemaName, addMergeTag) {
      const schemaTags = schemas.get(schemaName);
      if (schemaTags && !customTags) {
        return addMergeTag && !schemaTags.includes(merge.merge) ? schemaTags.concat(merge.merge) : schemaTags.slice();
      }
      let tags = schemaTags;
      if (!tags) {
        if (Array.isArray(customTags))
          tags = [];
        else {
          const keys = Array.from(schemas.keys()).filter((key) => key !== "yaml11").map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
        }
      }
      if (Array.isArray(customTags)) {
        for (const tag of customTags)
          tags = tags.concat(tag);
      } else if (typeof customTags === "function") {
        tags = customTags(tags.slice());
      }
      if (addMergeTag)
        tags = tags.concat(merge.merge);
      return tags.reduce((tags2, tag) => {
        const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
        if (!tagObj) {
          const tagName = JSON.stringify(tag);
          const keys = Object.keys(tagsByName).map((key) => JSON.stringify(key)).join(", ");
          throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
        }
        if (!tags2.includes(tagObj))
          tags2.push(tagObj);
        return tags2;
      }, []);
    }
    exports.coreKnownTags = coreKnownTags;
    exports.getTags = getTags;
  }
});

// node_modules/yaml/dist/schema/Schema.js
var require_Schema = __commonJS({
  "node_modules/yaml/dist/schema/Schema.js"(exports) {
    "use strict";
    var identity = require_identity();
    var map = require_map();
    var seq = require_seq();
    var string = require_string();
    var tags = require_tags();
    var sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    var Schema = class _Schema {
      constructor({ compat, customTags, merge, resolveKnownTags, schema, sortMapEntries, toStringDefaults }) {
        this.compat = Array.isArray(compat) ? tags.getTags(compat, "compat") : compat ? tags.getTags(null, compat) : null;
        this.name = typeof schema === "string" && schema || "core";
        this.knownTags = resolveKnownTags ? tags.coreKnownTags : {};
        this.tags = tags.getTags(customTags, this.name, merge);
        this.toStringOptions = toStringDefaults ?? null;
        Object.defineProperty(this, identity.MAP, { value: map.map });
        Object.defineProperty(this, identity.SCALAR, { value: string.string });
        Object.defineProperty(this, identity.SEQ, { value: seq.seq });
        this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
      }
      clone() {
        const copy = Object.create(_Schema.prototype, Object.getOwnPropertyDescriptors(this));
        copy.tags = this.tags.slice();
        return copy;
      }
    };
    exports.Schema = Schema;
  }
});

// node_modules/yaml/dist/stringify/stringifyDocument.js
var require_stringifyDocument = __commonJS({
  "node_modules/yaml/dist/stringify/stringifyDocument.js"(exports) {
    "use strict";
    var identity = require_identity();
    var stringify = require_stringify();
    var stringifyComment = require_stringifyComment();
    function stringifyDocument(doc, options) {
      const lines = [];
      let hasDirectives = options.directives === true;
      if (options.directives !== false && doc.directives) {
        const dir = doc.directives.toString(doc);
        if (dir) {
          lines.push(dir);
          hasDirectives = true;
        } else if (doc.directives.docStart)
          hasDirectives = true;
      }
      if (hasDirectives)
        lines.push("---");
      const ctx = stringify.createStringifyContext(doc, options);
      const { commentString } = ctx.options;
      if (doc.commentBefore) {
        if (lines.length !== 1)
          lines.unshift("");
        const cs = commentString(doc.commentBefore);
        lines.unshift(stringifyComment.indentComment(cs, ""));
      }
      let chompKeep = false;
      let contentComment = null;
      if (doc.contents) {
        if (identity.isNode(doc.contents)) {
          if (doc.contents.spaceBefore && hasDirectives)
            lines.push("");
          if (doc.contents.commentBefore) {
            const cs = commentString(doc.contents.commentBefore);
            lines.push(stringifyComment.indentComment(cs, ""));
          }
          ctx.forceBlockIndent = !!doc.comment;
          contentComment = doc.contents.comment;
        }
        const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
        let body = stringify.stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
        if (contentComment)
          body += stringifyComment.lineComment(body, "", commentString(contentComment));
        if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") {
          lines[lines.length - 1] = `--- ${body}`;
        } else
          lines.push(body);
      } else {
        lines.push(stringify.stringify(doc.contents, ctx));
      }
      if (doc.directives?.docEnd) {
        if (doc.comment) {
          const cs = commentString(doc.comment);
          if (cs.includes("\n")) {
            lines.push("...");
            lines.push(stringifyComment.indentComment(cs, ""));
          } else {
            lines.push(`... ${cs}`);
          }
        } else {
          lines.push("...");
        }
      } else {
        let dc = doc.comment;
        if (dc && chompKeep)
          dc = dc.replace(/^\n+/, "");
        if (dc) {
          if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "")
            lines.push("");
          lines.push(stringifyComment.indentComment(commentString(dc), ""));
        }
      }
      return lines.join("\n") + "\n";
    }
    exports.stringifyDocument = stringifyDocument;
  }
});

// node_modules/yaml/dist/doc/Document.js
var require_Document = __commonJS({
  "node_modules/yaml/dist/doc/Document.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var Collection = require_Collection();
    var identity = require_identity();
    var Pair = require_Pair();
    var toJS = require_toJS();
    var Schema = require_Schema();
    var stringifyDocument = require_stringifyDocument();
    var anchors = require_anchors();
    var applyReviver = require_applyReviver();
    var createNode = require_createNode();
    var directives = require_directives();
    var Document = class _Document {
      constructor(value, replacer, options) {
        this.commentBefore = null;
        this.comment = null;
        this.errors = [];
        this.warnings = [];
        Object.defineProperty(this, identity.NODE_TYPE, { value: identity.DOC });
        let _replacer = null;
        if (typeof replacer === "function" || Array.isArray(replacer)) {
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const opt = Object.assign({
          intAsBigInt: false,
          keepSourceTokens: false,
          logLevel: "warn",
          prettyErrors: true,
          strict: true,
          stringKeys: false,
          uniqueKeys: true,
          version: "1.2"
        }, options);
        this.options = opt;
        let { version } = opt;
        if (options?._directives) {
          this.directives = options._directives.atDocument();
          if (this.directives.yaml.explicit)
            version = this.directives.yaml.version;
        } else
          this.directives = new directives.Directives({ version });
        this.setSchema(version, options);
        this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
      }
      /**
       * Create a deep copy of this Document and its contents.
       *
       * Custom Node values that inherit from `Object` still refer to their original instances.
       */
      clone() {
        const copy = Object.create(_Document.prototype, {
          [identity.NODE_TYPE]: { value: identity.DOC }
        });
        copy.commentBefore = this.commentBefore;
        copy.comment = this.comment;
        copy.errors = this.errors.slice();
        copy.warnings = this.warnings.slice();
        copy.options = Object.assign({}, this.options);
        if (this.directives)
          copy.directives = this.directives.clone();
        copy.schema = this.schema.clone();
        copy.contents = identity.isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
        if (this.range)
          copy.range = this.range.slice();
        return copy;
      }
      /** Adds a value to the document. */
      add(value) {
        if (assertCollection(this.contents))
          this.contents.add(value);
      }
      /** Adds a value to the document. */
      addIn(path19, value) {
        if (assertCollection(this.contents))
          this.contents.addIn(path19, value);
      }
      /**
       * Create a new `Alias` node, ensuring that the target `node` has the required anchor.
       *
       * If `node` already has an anchor, `name` is ignored.
       * Otherwise, the `node.anchor` value will be set to `name`,
       * or if an anchor with that name is already present in the document,
       * `name` will be used as a prefix for a new unique anchor.
       * If `name` is undefined, the generated anchor will use 'a' as a prefix.
       */
      createAlias(node, name) {
        if (!node.anchor) {
          const prev = anchors.anchorNames(this);
          node.anchor = // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          !name || prev.has(name) ? anchors.findNewAnchor(name || "a", prev) : name;
        }
        return new Alias.Alias(node.anchor);
      }
      createNode(value, replacer, options) {
        let _replacer = void 0;
        if (typeof replacer === "function") {
          value = replacer.call({ "": value }, "", value);
          _replacer = replacer;
        } else if (Array.isArray(replacer)) {
          const keyToStr = (v) => typeof v === "number" || v instanceof String || v instanceof Number;
          const asStr = replacer.filter(keyToStr).map(String);
          if (asStr.length > 0)
            replacer = replacer.concat(asStr);
          _replacer = replacer;
        } else if (options === void 0 && replacer) {
          options = replacer;
          replacer = void 0;
        }
        const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {};
        const { onAnchor, setAnchors, sourceObjects } = anchors.createNodeAnchors(
          this,
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
          anchorPrefix || "a"
        );
        const ctx = {
          aliasDuplicateObjects: aliasDuplicateObjects ?? true,
          keepUndefined: keepUndefined ?? false,
          onAnchor,
          onTagObj,
          replacer: _replacer,
          schema: this.schema,
          sourceObjects
        };
        const node = createNode.createNode(value, tag, ctx);
        if (flow && identity.isCollection(node))
          node.flow = true;
        setAnchors();
        return node;
      }
      /**
       * Convert a key and a value into a `Pair` using the current schema,
       * recursively wrapping all values as `Scalar` or `Collection` nodes.
       */
      createPair(key, value, options = {}) {
        const k = this.createNode(key, null, options);
        const v = this.createNode(value, null, options);
        return new Pair.Pair(k, v);
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      delete(key) {
        return assertCollection(this.contents) ? this.contents.delete(key) : false;
      }
      /**
       * Removes a value from the document.
       * @returns `true` if the item was found and removed.
       */
      deleteIn(path19) {
        if (Collection.isEmptyPath(path19)) {
          if (this.contents == null)
            return false;
          this.contents = null;
          return true;
        }
        return assertCollection(this.contents) ? this.contents.deleteIn(path19) : false;
      }
      /**
       * Returns item at `key`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      get(key, keepScalar) {
        return identity.isCollection(this.contents) ? this.contents.get(key, keepScalar) : void 0;
      }
      /**
       * Returns item at `path`, or `undefined` if not found. By default unwraps
       * scalar values from their surrounding node; to disable set `keepScalar` to
       * `true` (collections are always returned intact).
       */
      getIn(path19, keepScalar) {
        if (Collection.isEmptyPath(path19))
          return !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents;
        return identity.isCollection(this.contents) ? this.contents.getIn(path19, keepScalar) : void 0;
      }
      /**
       * Checks if the document includes a value with the key `key`.
       */
      has(key) {
        return identity.isCollection(this.contents) ? this.contents.has(key) : false;
      }
      /**
       * Checks if the document includes a value at `path`.
       */
      hasIn(path19) {
        if (Collection.isEmptyPath(path19))
          return this.contents !== void 0;
        return identity.isCollection(this.contents) ? this.contents.hasIn(path19) : false;
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      set(key, value) {
        if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, [key], value);
        } else if (assertCollection(this.contents)) {
          this.contents.set(key, value);
        }
      }
      /**
       * Sets a value in this document. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path19, value) {
        if (Collection.isEmptyPath(path19)) {
          this.contents = value;
        } else if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, Array.from(path19), value);
        } else if (assertCollection(this.contents)) {
          this.contents.setIn(path19, value);
        }
      }
      /**
       * Change the YAML version and schema used by the document.
       * A `null` version disables support for directives, explicit tags, anchors, and aliases.
       * It also requires the `schema` option to be given as a `Schema` instance value.
       *
       * Overrides all previously set schema options.
       */
      setSchema(version, options = {}) {
        if (typeof version === "number")
          version = String(version);
        let opt;
        switch (version) {
          case "1.1":
            if (this.directives)
              this.directives.yaml.version = "1.1";
            else
              this.directives = new directives.Directives({ version: "1.1" });
            opt = { resolveKnownTags: false, schema: "yaml-1.1" };
            break;
          case "1.2":
          case "next":
            if (this.directives)
              this.directives.yaml.version = version;
            else
              this.directives = new directives.Directives({ version });
            opt = { resolveKnownTags: true, schema: "core" };
            break;
          case null:
            if (this.directives)
              delete this.directives;
            opt = null;
            break;
          default: {
            const sv = JSON.stringify(version);
            throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
          }
        }
        if (options.schema instanceof Object)
          this.schema = options.schema;
        else if (opt)
          this.schema = new Schema.Schema(Object.assign(opt, options));
        else
          throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
      }
      // json & jsonArg are only used from toJSON()
      toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
        const ctx = {
          anchors: /* @__PURE__ */ new Map(),
          doc: this,
          keep: !json,
          mapAsMap: mapAsMap === true,
          mapKeyWarned: false,
          maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
        };
        const res = toJS.toJS(this.contents, jsonArg ?? "", ctx);
        if (typeof onAnchor === "function")
          for (const { count, res: res2 } of ctx.anchors.values())
            onAnchor(res2, count);
        return typeof reviver === "function" ? applyReviver.applyReviver(reviver, { "": res }, "", res) : res;
      }
      /**
       * A JSON representation of the document `contents`.
       *
       * @param jsonArg Used by `JSON.stringify` to indicate the array index or
       *   property name.
       */
      toJSON(jsonArg, onAnchor) {
        return this.toJS({ json: true, jsonArg, mapAsMap: false, onAnchor });
      }
      /** A YAML representation of the document. */
      toString(options = {}) {
        if (this.errors.length > 0)
          throw new Error("Document with errors cannot be stringified");
        if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
          const s = JSON.stringify(options.indent);
          throw new Error(`"indent" option must be a positive integer, not ${s}`);
        }
        return stringifyDocument.stringifyDocument(this, options);
      }
    };
    function assertCollection(contents) {
      if (identity.isCollection(contents))
        return true;
      throw new Error("Expected a YAML collection as document contents");
    }
    exports.Document = Document;
  }
});

// node_modules/yaml/dist/errors.js
var require_errors = __commonJS({
  "node_modules/yaml/dist/errors.js"(exports) {
    "use strict";
    var YAMLError = class extends Error {
      constructor(name, pos, code, message) {
        super();
        this.name = name;
        this.code = code;
        this.message = message;
        this.pos = pos;
      }
    };
    var YAMLParseError = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLParseError", pos, code, message);
      }
    };
    var YAMLWarning = class extends YAMLError {
      constructor(pos, code, message) {
        super("YAMLWarning", pos, code, message);
      }
    };
    var prettifyError = (src, lc) => (error) => {
      if (error.pos[0] === -1)
        return;
      error.linePos = error.pos.map((pos) => lc.linePos(pos));
      const { line, col } = error.linePos[0];
      error.message += ` at line ${line}, column ${col}`;
      let ci = col - 1;
      let lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
      if (ci >= 60 && lineStr.length > 80) {
        const trimStart = Math.min(ci - 39, lineStr.length - 79);
        lineStr = "\u2026" + lineStr.substring(trimStart);
        ci -= trimStart - 1;
      }
      if (lineStr.length > 80)
        lineStr = lineStr.substring(0, 79) + "\u2026";
      if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
        let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
        if (prev.length > 80)
          prev = prev.substring(0, 79) + "\u2026\n";
        lineStr = prev + lineStr;
      }
      if (/[^ ]/.test(lineStr)) {
        let count = 1;
        const end = error.linePos[1];
        if (end?.line === line && end.col > col) {
          count = Math.max(1, Math.min(end.col - col, 80 - ci));
        }
        const pointer = " ".repeat(ci) + "^".repeat(count);
        error.message += `:

${lineStr}
${pointer}
`;
      }
    };
    exports.YAMLError = YAMLError;
    exports.YAMLParseError = YAMLParseError;
    exports.YAMLWarning = YAMLWarning;
    exports.prettifyError = prettifyError;
  }
});

// node_modules/yaml/dist/compose/resolve-props.js
var require_resolve_props = __commonJS({
  "node_modules/yaml/dist/compose/resolve-props.js"(exports) {
    "use strict";
    function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
      let spaceBefore = false;
      let atNewline = startOnNewline;
      let hasSpace = startOnNewline;
      let comment = "";
      let commentSep = "";
      let hasNewline = false;
      let reqSpace = false;
      let tab = null;
      let anchor = null;
      let tag = null;
      let newlineAfterProp = null;
      let comma = null;
      let found = null;
      let start = null;
      for (const token of tokens) {
        if (reqSpace) {
          if (token.type !== "space" && token.type !== "newline" && token.type !== "comma")
            onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
          reqSpace = false;
        }
        if (tab) {
          if (atNewline && token.type !== "comment" && token.type !== "newline") {
            onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
          }
          tab = null;
        }
        switch (token.type) {
          case "space":
            if (!flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("	")) {
              tab = token;
            }
            hasSpace = true;
            break;
          case "comment": {
            if (!hasSpace)
              onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
            const cb = token.source.substring(1) || " ";
            if (!comment)
              comment = cb;
            else
              comment += commentSep + cb;
            commentSep = "";
            atNewline = false;
            break;
          }
          case "newline":
            if (atNewline) {
              if (comment)
                comment += token.source;
              else if (!found || indicator !== "seq-item-ind")
                spaceBefore = true;
            } else
              commentSep += token.source;
            atNewline = true;
            hasNewline = true;
            if (anchor || tag)
              newlineAfterProp = token;
            hasSpace = true;
            break;
          case "anchor":
            if (anchor)
              onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
            if (token.source.endsWith(":"))
              onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
            anchor = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          case "tag": {
            if (tag)
              onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
            tag = token;
            start ?? (start = token.offset);
            atNewline = false;
            hasSpace = false;
            reqSpace = true;
            break;
          }
          case indicator:
            if (anchor || tag)
              onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
            if (found)
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`);
            found = token;
            atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
            hasSpace = false;
            break;
          case "comma":
            if (flow) {
              if (comma)
                onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
              comma = token;
              atNewline = false;
              hasSpace = false;
              break;
            }
          // else fallthrough
          default:
            onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
            atNewline = false;
            hasSpace = false;
        }
      }
      const last = tokens[tokens.length - 1];
      const end = last ? last.offset + last.source.length : offset;
      if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "")) {
        onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
      }
      if (tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq"))
        onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
      return {
        comma,
        found,
        spaceBefore,
        comment,
        hasNewline,
        anchor,
        tag,
        newlineAfterProp,
        end,
        start: start ?? end
      };
    }
    exports.resolveProps = resolveProps;
  }
});

// node_modules/yaml/dist/compose/util-contains-newline.js
var require_util_contains_newline = __commonJS({
  "node_modules/yaml/dist/compose/util-contains-newline.js"(exports) {
    "use strict";
    function containsNewline(key) {
      if (!key)
        return null;
      switch (key.type) {
        case "alias":
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          if (key.source.includes("\n"))
            return true;
          if (key.end) {
            for (const st of key.end)
              if (st.type === "newline")
                return true;
          }
          return false;
        case "flow-collection":
          for (const it of key.items) {
            for (const st of it.start)
              if (st.type === "newline")
                return true;
            if (it.sep) {
              for (const st of it.sep)
                if (st.type === "newline")
                  return true;
            }
            if (containsNewline(it.key) || containsNewline(it.value))
              return true;
          }
          return false;
        default:
          return true;
      }
    }
    exports.containsNewline = containsNewline;
  }
});

// node_modules/yaml/dist/compose/util-flow-indent-check.js
var require_util_flow_indent_check = __commonJS({
  "node_modules/yaml/dist/compose/util-flow-indent-check.js"(exports) {
    "use strict";
    var utilContainsNewline = require_util_contains_newline();
    function flowIndentCheck(indent, fc, onError) {
      if (fc?.type === "flow-collection") {
        const end = fc.end[0];
        if (end.indent === indent && (end.source === "]" || end.source === "}") && utilContainsNewline.containsNewline(fc)) {
          const msg = "Flow end indicator should be more indented than parent";
          onError(end, "BAD_INDENT", msg, true);
        }
      }
    }
    exports.flowIndentCheck = flowIndentCheck;
  }
});

// node_modules/yaml/dist/compose/util-map-includes.js
var require_util_map_includes = __commonJS({
  "node_modules/yaml/dist/compose/util-map-includes.js"(exports) {
    "use strict";
    var identity = require_identity();
    function mapIncludes(ctx, items, search) {
      const { uniqueKeys } = ctx.options;
      if (uniqueKeys === false)
        return false;
      const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a, b) => a === b || identity.isScalar(a) && identity.isScalar(b) && a.value === b.value;
      return items.some((pair) => isEqual(pair.key, search));
    }
    exports.mapIncludes = mapIncludes;
  }
});

// node_modules/yaml/dist/compose/resolve-block-map.js
var require_resolve_block_map = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-map.js"(exports) {
    "use strict";
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    var utilMapIncludes = require_util_map_includes();
    var startColMsg = "All mapping items must start at the same column";
    function resolveBlockMap({ composeNode, composeEmptyNode }, ctx, bm, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLMap.YAMLMap;
      const map = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      let offset = bm.offset;
      let commentEnd = null;
      for (const collItem of bm.items) {
        const { start, key, sep, value } = collItem;
        const keyProps = resolveProps.resolveProps(start, {
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: bm.indent,
          startOnNewline: true
        });
        const implicitKey = !keyProps.found;
        if (implicitKey) {
          if (key) {
            if (key.type === "block-seq")
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
            else if ("indent" in key && key.indent !== bm.indent)
              onError(offset, "BAD_INDENT", startColMsg);
          }
          if (!keyProps.anchor && !keyProps.tag && !sep) {
            commentEnd = keyProps.end;
            if (keyProps.comment) {
              if (map.comment)
                map.comment += "\n" + keyProps.comment;
              else
                map.comment = keyProps.comment;
            }
            continue;
          }
          if (keyProps.newlineAfterProp || utilContainsNewline.containsNewline(key)) {
            onError(key ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
          }
        } else if (keyProps.found?.indent !== bm.indent) {
          onError(offset, "BAD_INDENT", startColMsg);
        }
        ctx.atKey = true;
        const keyStart = keyProps.end;
        const keyNode = key ? composeNode(ctx, key, keyProps, onError) : composeEmptyNode(ctx, keyStart, start, null, keyProps, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bm.indent, key, onError);
        ctx.atKey = false;
        if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
          onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
        const valueProps = resolveProps.resolveProps(sep ?? [], {
          indicator: "map-value-ind",
          next: value,
          offset: keyNode.range[2],
          onError,
          parentIndent: bm.indent,
          startOnNewline: !key || key.type === "block-scalar"
        });
        offset = valueProps.end;
        if (valueProps.found) {
          if (implicitKey) {
            if (value?.type === "block-map" && !valueProps.hasNewline)
              onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
            if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024)
              onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : composeEmptyNode(ctx, offset, sep, null, valueProps, onError);
          if (ctx.schema.compat)
            utilFlowIndentCheck.flowIndentCheck(bm.indent, value, onError);
          offset = valueNode.range[2];
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        } else {
          if (implicitKey)
            onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
          if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          map.items.push(pair);
        }
      }
      if (commentEnd && commentEnd < offset)
        onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
      map.range = [bm.offset, offset, commentEnd ?? offset];
      return map;
    }
    exports.resolveBlockMap = resolveBlockMap;
  }
});

// node_modules/yaml/dist/compose/resolve-block-seq.js
var require_resolve_block_seq = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-seq.js"(exports) {
    "use strict";
    var YAMLSeq = require_YAMLSeq();
    var resolveProps = require_resolve_props();
    var utilFlowIndentCheck = require_util_flow_indent_check();
    function resolveBlockSeq({ composeNode, composeEmptyNode }, ctx, bs, onError, tag) {
      const NodeClass = tag?.nodeClass ?? YAMLSeq.YAMLSeq;
      const seq = new NodeClass(ctx.schema);
      if (ctx.atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = bs.offset;
      let commentEnd = null;
      for (const { start, value } of bs.items) {
        const props = resolveProps.resolveProps(start, {
          indicator: "seq-item-ind",
          next: value,
          offset,
          onError,
          parentIndent: bs.indent,
          startOnNewline: true
        });
        if (!props.found) {
          if (props.anchor || props.tag || value) {
            if (value?.type === "block-seq")
              onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
            else
              onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
          } else {
            commentEnd = props.end;
            if (props.comment)
              seq.comment = props.comment;
            continue;
          }
        }
        const node = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
        if (ctx.schema.compat)
          utilFlowIndentCheck.flowIndentCheck(bs.indent, value, onError);
        offset = node.range[2];
        seq.items.push(node);
      }
      seq.range = [bs.offset, offset, commentEnd ?? offset];
      return seq;
    }
    exports.resolveBlockSeq = resolveBlockSeq;
  }
});

// node_modules/yaml/dist/compose/resolve-end.js
var require_resolve_end = __commonJS({
  "node_modules/yaml/dist/compose/resolve-end.js"(exports) {
    "use strict";
    function resolveEnd(end, offset, reqSpace, onError) {
      let comment = "";
      if (end) {
        let hasSpace = false;
        let sep = "";
        for (const token of end) {
          const { source, type } = token;
          switch (type) {
            case "space":
              hasSpace = true;
              break;
            case "comment": {
              if (reqSpace && !hasSpace)
                onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
              const cb = source.substring(1) || " ";
              if (!comment)
                comment = cb;
              else
                comment += sep + cb;
              sep = "";
              break;
            }
            case "newline":
              if (comment)
                sep += source;
              hasSpace = true;
              break;
            default:
              onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
          }
          offset += source.length;
        }
      }
      return { comment, offset };
    }
    exports.resolveEnd = resolveEnd;
  }
});

// node_modules/yaml/dist/compose/resolve-flow-collection.js
var require_resolve_flow_collection = __commonJS({
  "node_modules/yaml/dist/compose/resolve-flow-collection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Pair = require_Pair();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    var utilContainsNewline = require_util_contains_newline();
    var utilMapIncludes = require_util_map_includes();
    var blockMsg = "Block collections are not allowed within flow collections";
    var isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
    function resolveFlowCollection({ composeNode, composeEmptyNode }, ctx, fc, onError, tag) {
      const isMap = fc.start.source === "{";
      const fcName = isMap ? "flow map" : "flow sequence";
      const NodeClass = tag?.nodeClass ?? (isMap ? YAMLMap.YAMLMap : YAMLSeq.YAMLSeq);
      const coll = new NodeClass(ctx.schema);
      coll.flow = true;
      const atRoot = ctx.atRoot;
      if (atRoot)
        ctx.atRoot = false;
      if (ctx.atKey)
        ctx.atKey = false;
      let offset = fc.offset + fc.start.source.length;
      for (let i2 = 0; i2 < fc.items.length; ++i2) {
        const collItem = fc.items[i2];
        const { start, key, sep, value } = collItem;
        const props = resolveProps.resolveProps(start, {
          flow: fcName,
          indicator: "explicit-key-ind",
          next: key ?? sep?.[0],
          offset,
          onError,
          parentIndent: fc.indent,
          startOnNewline: false
        });
        if (!props.found) {
          if (!props.anchor && !props.tag && !sep && !value) {
            if (i2 === 0 && props.comma)
              onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
            else if (i2 < fc.items.length - 1)
              onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
            if (props.comment) {
              if (coll.comment)
                coll.comment += "\n" + props.comment;
              else
                coll.comment = props.comment;
            }
            offset = props.end;
            continue;
          }
          if (!isMap && ctx.options.strict && utilContainsNewline.containsNewline(key))
            onError(
              key,
              // checked by containsNewline()
              "MULTILINE_IMPLICIT_KEY",
              "Implicit keys of flow sequence pairs need to be on a single line"
            );
        }
        if (i2 === 0) {
          if (props.comma)
            onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
        } else {
          if (!props.comma)
            onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
          if (props.comment) {
            let prevItemComment = "";
            loop: for (const st of start) {
              switch (st.type) {
                case "comma":
                case "space":
                  break;
                case "comment":
                  prevItemComment = st.source.substring(1);
                  break loop;
                default:
                  break loop;
              }
            }
            if (prevItemComment) {
              let prev = coll.items[coll.items.length - 1];
              if (identity.isPair(prev))
                prev = prev.value ?? prev.key;
              if (prev.comment)
                prev.comment += "\n" + prevItemComment;
              else
                prev.comment = prevItemComment;
              props.comment = props.comment.substring(prevItemComment.length + 1);
            }
          }
        }
        if (!isMap && !sep && !props.found) {
          const valueNode = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, sep, null, props, onError);
          coll.items.push(valueNode);
          offset = valueNode.range[2];
          if (isBlock(value))
            onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
        } else {
          ctx.atKey = true;
          const keyStart = props.end;
          const keyNode = key ? composeNode(ctx, key, props, onError) : composeEmptyNode(ctx, keyStart, start, null, props, onError);
          if (isBlock(key))
            onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
          ctx.atKey = false;
          const valueProps = resolveProps.resolveProps(sep ?? [], {
            flow: fcName,
            indicator: "map-value-ind",
            next: value,
            offset: keyNode.range[2],
            onError,
            parentIndent: fc.indent,
            startOnNewline: false
          });
          if (valueProps.found) {
            if (!isMap && !props.found && ctx.options.strict) {
              if (sep)
                for (const st of sep) {
                  if (st === valueProps.found)
                    break;
                  if (st.type === "newline") {
                    onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
                    break;
                  }
                }
              if (props.start < valueProps.found.offset - 1024)
                onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
            }
          } else if (value) {
            if ("source" in value && value.source?.[0] === ":")
              onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
            else
              onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
          }
          const valueNode = value ? composeNode(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode(ctx, valueProps.end, sep, null, valueProps, onError) : null;
          if (valueNode) {
            if (isBlock(value))
              onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
          } else if (valueProps.comment) {
            if (keyNode.comment)
              keyNode.comment += "\n" + valueProps.comment;
            else
              keyNode.comment = valueProps.comment;
          }
          const pair = new Pair.Pair(keyNode, valueNode);
          if (ctx.options.keepSourceTokens)
            pair.srcToken = collItem;
          if (isMap) {
            const map = coll;
            if (utilMapIncludes.mapIncludes(ctx, map.items, keyNode))
              onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
            map.items.push(pair);
          } else {
            const map = new YAMLMap.YAMLMap(ctx.schema);
            map.flow = true;
            map.items.push(pair);
            const endRange = (valueNode ?? keyNode).range;
            map.range = [keyNode.range[0], endRange[1], endRange[2]];
            coll.items.push(map);
          }
          offset = valueNode ? valueNode.range[2] : valueProps.end;
        }
      }
      const expectedEnd = isMap ? "}" : "]";
      const [ce, ...ee] = fc.end;
      let cePos = offset;
      if (ce?.source === expectedEnd)
        cePos = ce.offset + ce.source.length;
      else {
        const name = fcName[0].toUpperCase() + fcName.substring(1);
        const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
        onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
        if (ce && ce.source.length !== 1)
          ee.unshift(ce);
      }
      if (ee.length > 0) {
        const end = resolveEnd.resolveEnd(ee, cePos, ctx.options.strict, onError);
        if (end.comment) {
          if (coll.comment)
            coll.comment += "\n" + end.comment;
          else
            coll.comment = end.comment;
        }
        coll.range = [fc.offset, cePos, end.offset];
      } else {
        coll.range = [fc.offset, cePos, cePos];
      }
      return coll;
    }
    exports.resolveFlowCollection = resolveFlowCollection;
  }
});

// node_modules/yaml/dist/compose/compose-collection.js
var require_compose_collection = __commonJS({
  "node_modules/yaml/dist/compose/compose-collection.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var resolveBlockMap = require_resolve_block_map();
    var resolveBlockSeq = require_resolve_block_seq();
    var resolveFlowCollection = require_resolve_flow_collection();
    function resolveCollection(CN, ctx, token, onError, tagName, tag) {
      const coll = token.type === "block-map" ? resolveBlockMap.resolveBlockMap(CN, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq.resolveBlockSeq(CN, ctx, token, onError, tag) : resolveFlowCollection.resolveFlowCollection(CN, ctx, token, onError, tag);
      const Coll = coll.constructor;
      if (tagName === "!" || tagName === Coll.tagName) {
        coll.tag = Coll.tagName;
        return coll;
      }
      if (tagName)
        coll.tag = tagName;
      return coll;
    }
    function composeCollection(CN, ctx, token, props, onError) {
      const tagToken = props.tag;
      const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
      if (token.type === "block-seq") {
        const { anchor, newlineAfterProp: nl } = props;
        const lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
        if (lastProp && (!nl || nl.offset < lastProp.offset)) {
          const message = "Missing newline after block sequence props";
          onError(lastProp, "MISSING_CHAR", message);
        }
      }
      const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
      if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.YAMLSeq.tagName && expType === "seq") {
        return resolveCollection(CN, ctx, token, onError, tagName);
      }
      let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
      if (!tag) {
        const kt = ctx.schema.knownTags[tagName];
        if (kt?.collection === expType) {
          ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
          tag = kt;
        } else {
          if (kt) {
            onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, true);
          } else {
            onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
          }
          return resolveCollection(CN, ctx, token, onError, tagName);
        }
      }
      const coll = resolveCollection(CN, ctx, token, onError, tagName, tag);
      const res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
      const node = identity.isNode(res) ? res : new Scalar.Scalar(res);
      node.range = coll.range;
      node.tag = tagName;
      if (tag?.format)
        node.format = tag.format;
      return node;
    }
    exports.composeCollection = composeCollection;
  }
});

// node_modules/yaml/dist/compose/resolve-block-scalar.js
var require_resolve_block_scalar = __commonJS({
  "node_modules/yaml/dist/compose/resolve-block-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    function resolveBlockScalar(ctx, scalar, onError) {
      const start = scalar.offset;
      const header = parseBlockScalarHeader(scalar, ctx.options.strict, onError);
      if (!header)
        return { value: "", type: null, comment: "", range: [start, start, start] };
      const type = header.mode === ">" ? Scalar.Scalar.BLOCK_FOLDED : Scalar.Scalar.BLOCK_LITERAL;
      const lines = scalar.source ? splitLines(scalar.source) : [];
      let chompStart = lines.length;
      for (let i2 = lines.length - 1; i2 >= 0; --i2) {
        const content = lines[i2][1];
        if (content === "" || content === "\r")
          chompStart = i2;
        else
          break;
      }
      if (chompStart === 0) {
        const value2 = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
        let end2 = start + header.length;
        if (scalar.source)
          end2 += scalar.source.length;
        return { value: value2, type, comment: header.comment, range: [start, end2, end2] };
      }
      let trimIndent = scalar.indent + header.indent;
      let offset = scalar.offset + header.length;
      let contentStart = 0;
      for (let i2 = 0; i2 < chompStart; ++i2) {
        const [indent, content] = lines[i2];
        if (content === "" || content === "\r") {
          if (header.indent === 0 && indent.length > trimIndent)
            trimIndent = indent.length;
        } else {
          if (indent.length < trimIndent) {
            const message = "Block scalars with more-indented leading empty lines must use an explicit indentation indicator";
            onError(offset + indent.length, "MISSING_CHAR", message);
          }
          if (header.indent === 0)
            trimIndent = indent.length;
          contentStart = i2;
          if (trimIndent === 0 && !ctx.atRoot) {
            const message = "Block scalar values in collections must be indented";
            onError(offset, "BAD_INDENT", message);
          }
          break;
        }
        offset += indent.length + content.length + 1;
      }
      for (let i2 = lines.length - 1; i2 >= chompStart; --i2) {
        if (lines[i2][0].length > trimIndent)
          chompStart = i2 + 1;
      }
      let value = "";
      let sep = "";
      let prevMoreIndented = false;
      for (let i2 = 0; i2 < contentStart; ++i2)
        value += lines[i2][0].slice(trimIndent) + "\n";
      for (let i2 = contentStart; i2 < chompStart; ++i2) {
        let [indent, content] = lines[i2];
        offset += indent.length + content.length + 1;
        const crlf = content[content.length - 1] === "\r";
        if (crlf)
          content = content.slice(0, -1);
        if (content && indent.length < trimIndent) {
          const src = header.indent ? "explicit indentation indicator" : "first line";
          const message = `Block scalar lines must not be less indented than their ${src}`;
          onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
          indent = "";
        }
        if (type === Scalar.Scalar.BLOCK_LITERAL) {
          value += sep + indent.slice(trimIndent) + content;
          sep = "\n";
        } else if (indent.length > trimIndent || content[0] === "	") {
          if (sep === " ")
            sep = "\n";
          else if (!prevMoreIndented && sep === "\n")
            sep = "\n\n";
          value += sep + indent.slice(trimIndent) + content;
          sep = "\n";
          prevMoreIndented = true;
        } else if (content === "") {
          if (sep === "\n")
            value += "\n";
          else
            sep = "\n";
        } else {
          value += sep + content;
          sep = " ";
          prevMoreIndented = false;
        }
      }
      switch (header.chomp) {
        case "-":
          break;
        case "+":
          for (let i2 = chompStart; i2 < lines.length; ++i2)
            value += "\n" + lines[i2][0].slice(trimIndent);
          if (value[value.length - 1] !== "\n")
            value += "\n";
          break;
        default:
          value += "\n";
      }
      const end = start + header.length + scalar.source.length;
      return { value, type, comment: header.comment, range: [start, end, end] };
    }
    function parseBlockScalarHeader({ offset, props }, strict, onError) {
      if (props[0].type !== "block-scalar-header") {
        onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
        return null;
      }
      const { source } = props[0];
      const mode = source[0];
      let indent = 0;
      let chomp = "";
      let error = -1;
      for (let i2 = 1; i2 < source.length; ++i2) {
        const ch = source[i2];
        if (!chomp && (ch === "-" || ch === "+"))
          chomp = ch;
        else {
          const n = Number(ch);
          if (!indent && n)
            indent = n;
          else if (error === -1)
            error = offset + i2;
        }
      }
      if (error !== -1)
        onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
      let hasSpace = false;
      let comment = "";
      let length = source.length;
      for (let i2 = 1; i2 < props.length; ++i2) {
        const token = props[i2];
        switch (token.type) {
          case "space":
            hasSpace = true;
          // fallthrough
          case "newline":
            length += token.source.length;
            break;
          case "comment":
            if (strict && !hasSpace) {
              const message = "Comments must be separated from other tokens by white space characters";
              onError(token, "MISSING_CHAR", message);
            }
            length += token.source.length;
            comment = token.source.substring(1);
            break;
          case "error":
            onError(token, "UNEXPECTED_TOKEN", token.message);
            length += token.source.length;
            break;
          /* istanbul ignore next should not happen */
          default: {
            const message = `Unexpected token in block scalar header: ${token.type}`;
            onError(token, "UNEXPECTED_TOKEN", message);
            const ts = token.source;
            if (ts && typeof ts === "string")
              length += ts.length;
          }
        }
      }
      return { mode, indent, chomp, comment, length };
    }
    function splitLines(source) {
      const split = source.split(/\n( *)/);
      const first = split[0];
      const m = first.match(/^( *)/);
      const line0 = m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first];
      const lines = [line0];
      for (let i2 = 1; i2 < split.length; i2 += 2)
        lines.push([split[i2], split[i2 + 1]]);
      return lines;
    }
    exports.resolveBlockScalar = resolveBlockScalar;
  }
});

// node_modules/yaml/dist/compose/resolve-flow-scalar.js
var require_resolve_flow_scalar = __commonJS({
  "node_modules/yaml/dist/compose/resolve-flow-scalar.js"(exports) {
    "use strict";
    var Scalar = require_Scalar();
    var resolveEnd = require_resolve_end();
    function resolveFlowScalar(scalar, strict, onError) {
      const { offset, type, source, end } = scalar;
      let _type;
      let value;
      const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
      switch (type) {
        case "scalar":
          _type = Scalar.Scalar.PLAIN;
          value = plainValue(source, _onError);
          break;
        case "single-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_SINGLE;
          value = singleQuotedValue(source, _onError);
          break;
        case "double-quoted-scalar":
          _type = Scalar.Scalar.QUOTE_DOUBLE;
          value = doubleQuotedValue(source, _onError);
          break;
        /* istanbul ignore next should not happen */
        default:
          onError(scalar, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
          return {
            value: "",
            type: null,
            comment: "",
            range: [offset, offset + source.length, offset + source.length]
          };
      }
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, strict, onError);
      return {
        value,
        type: _type,
        comment: re.comment,
        range: [offset, valueEnd, re.offset]
      };
    }
    function plainValue(source, onError) {
      let badChar = "";
      switch (source[0]) {
        /* istanbul ignore next should not happen */
        case "	":
          badChar = "a tab character";
          break;
        case ",":
          badChar = "flow indicator character ,";
          break;
        case "%":
          badChar = "directive indicator character %";
          break;
        case "|":
        case ">": {
          badChar = `block scalar indicator ${source[0]}`;
          break;
        }
        case "@":
        case "`": {
          badChar = `reserved character ${source[0]}`;
          break;
        }
      }
      if (badChar)
        onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
      return foldLines(source);
    }
    function singleQuotedValue(source, onError) {
      if (source[source.length - 1] !== "'" || source.length === 1)
        onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
      return foldLines(source.slice(1, -1)).replace(/''/g, "'");
    }
    function foldLines(source) {
      let first, line;
      try {
        first = new RegExp("(.*?)(?<![ 	])[ 	]*\r?\n", "sy");
        line = new RegExp("[ 	]*(.*?)(?:(?<![ 	])[ 	]*)?\r?\n", "sy");
      } catch {
        first = /(.*?)[ \t]*\r?\n/sy;
        line = /[ \t]*(.*?)[ \t]*\r?\n/sy;
      }
      let match = first.exec(source);
      if (!match)
        return source;
      let res = match[1];
      let sep = " ";
      let pos = first.lastIndex;
      line.lastIndex = pos;
      while (match = line.exec(source)) {
        if (match[1] === "") {
          if (sep === "\n")
            res += sep;
          else
            sep = "\n";
        } else {
          res += sep + match[1];
          sep = " ";
        }
        pos = line.lastIndex;
      }
      const last = /[ \t]*(.*)/sy;
      last.lastIndex = pos;
      match = last.exec(source);
      return res + sep + (match?.[1] ?? "");
    }
    function doubleQuotedValue(source, onError) {
      let res = "";
      for (let i2 = 1; i2 < source.length - 1; ++i2) {
        const ch = source[i2];
        if (ch === "\r" && source[i2 + 1] === "\n")
          continue;
        if (ch === "\n") {
          const { fold, offset } = foldNewline(source, i2);
          res += fold;
          i2 = offset;
        } else if (ch === "\\") {
          let next = source[++i2];
          const cc = escapeCodes[next];
          if (cc)
            res += cc;
          else if (next === "\n") {
            next = source[i2 + 1];
            while (next === " " || next === "	")
              next = source[++i2 + 1];
          } else if (next === "\r" && source[i2 + 1] === "\n") {
            next = source[++i2 + 1];
            while (next === " " || next === "	")
              next = source[++i2 + 1];
          } else if (next === "x" || next === "u" || next === "U") {
            const length = next === "x" ? 2 : next === "u" ? 4 : 8;
            res += parseCharCode(source, i2 + 1, length, onError);
            i2 += length;
          } else {
            const raw = source.substr(i2 - 1, 2);
            onError(i2 - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
            res += raw;
          }
        } else if (ch === " " || ch === "	") {
          const wsStart = i2;
          let next = source[i2 + 1];
          while (next === " " || next === "	")
            next = source[++i2 + 1];
          if (next !== "\n" && !(next === "\r" && source[i2 + 2] === "\n"))
            res += i2 > wsStart ? source.slice(wsStart, i2 + 1) : ch;
        } else {
          res += ch;
        }
      }
      if (source[source.length - 1] !== '"' || source.length === 1)
        onError(source.length, "MISSING_CHAR", 'Missing closing "quote');
      return res;
    }
    function foldNewline(source, offset) {
      let fold = "";
      let ch = source[offset + 1];
      while (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
        if (ch === "\r" && source[offset + 2] !== "\n")
          break;
        if (ch === "\n")
          fold += "\n";
        offset += 1;
        ch = source[offset + 1];
      }
      if (!fold)
        fold = " ";
      return { fold, offset };
    }
    var escapeCodes = {
      "0": "\0",
      // null character
      a: "\x07",
      // bell character
      b: "\b",
      // backspace
      e: "\x1B",
      // escape character
      f: "\f",
      // form feed
      n: "\n",
      // line feed
      r: "\r",
      // carriage return
      t: "	",
      // horizontal tab
      v: "\v",
      // vertical tab
      N: "\x85",
      // Unicode next line
      _: "\xA0",
      // Unicode non-breaking space
      L: "\u2028",
      // Unicode line separator
      P: "\u2029",
      // Unicode paragraph separator
      " ": " ",
      '"': '"',
      "/": "/",
      "\\": "\\",
      "	": "	"
    };
    function parseCharCode(source, offset, length, onError) {
      const cc = source.substr(offset, length);
      const ok = cc.length === length && /^[0-9a-fA-F]+$/.test(cc);
      const code = ok ? parseInt(cc, 16) : NaN;
      try {
        return String.fromCodePoint(code);
      } catch {
        const raw = source.substr(offset - 2, length + 2);
        onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
        return raw;
      }
    }
    exports.resolveFlowScalar = resolveFlowScalar;
  }
});

// node_modules/yaml/dist/compose/compose-scalar.js
var require_compose_scalar = __commonJS({
  "node_modules/yaml/dist/compose/compose-scalar.js"(exports) {
    "use strict";
    var identity = require_identity();
    var Scalar = require_Scalar();
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    function composeScalar(ctx, token, tagToken, onError) {
      const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar.resolveBlockScalar(ctx, token, onError) : resolveFlowScalar.resolveFlowScalar(token, ctx.options.strict, onError);
      const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
      let tag;
      if (ctx.options.stringKeys && ctx.atKey) {
        tag = ctx.schema[identity.SCALAR];
      } else if (tagName)
        tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
      else if (token.type === "scalar")
        tag = findScalarTagByTest(ctx, value, token, onError);
      else
        tag = ctx.schema[identity.SCALAR];
      let scalar;
      try {
        const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
        scalar = identity.isScalar(res) ? res : new Scalar.Scalar(res);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
        scalar = new Scalar.Scalar(value);
      }
      scalar.range = range;
      scalar.source = value;
      if (type)
        scalar.type = type;
      if (tagName)
        scalar.tag = tagName;
      if (tag.format)
        scalar.format = tag.format;
      if (comment)
        scalar.comment = comment;
      return scalar;
    }
    function findScalarTagByName(schema, value, tagName, tagToken, onError) {
      if (tagName === "!")
        return schema[identity.SCALAR];
      const matchWithTest = [];
      for (const tag of schema.tags) {
        if (!tag.collection && tag.tag === tagName) {
          if (tag.default && tag.test)
            matchWithTest.push(tag);
          else
            return tag;
        }
      }
      for (const tag of matchWithTest)
        if (tag.test?.test(value))
          return tag;
      const kt = schema.knownTags[tagName];
      if (kt && !kt.collection) {
        schema.tags.push(Object.assign({}, kt, { default: false, test: void 0 }));
        return kt;
      }
      onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
      return schema[identity.SCALAR];
    }
    function findScalarTagByTest({ atKey, directives, schema }, value, token, onError) {
      const tag = schema.tags.find((tag2) => (tag2.default === true || atKey && tag2.default === "key") && tag2.test?.test(value)) || schema[identity.SCALAR];
      if (schema.compat) {
        const compat = schema.compat.find((tag2) => tag2.default && tag2.test?.test(value)) ?? schema[identity.SCALAR];
        if (tag.tag !== compat.tag) {
          const ts = directives.tagString(tag.tag);
          const cs = directives.tagString(compat.tag);
          const msg = `Value may be parsed as either ${ts} or ${cs}`;
          onError(token, "TAG_RESOLVE_FAILED", msg, true);
        }
      }
      return tag;
    }
    exports.composeScalar = composeScalar;
  }
});

// node_modules/yaml/dist/compose/util-empty-scalar-position.js
var require_util_empty_scalar_position = __commonJS({
  "node_modules/yaml/dist/compose/util-empty-scalar-position.js"(exports) {
    "use strict";
    function emptyScalarPosition(offset, before, pos) {
      if (before) {
        pos ?? (pos = before.length);
        for (let i2 = pos - 1; i2 >= 0; --i2) {
          let st = before[i2];
          switch (st.type) {
            case "space":
            case "comment":
            case "newline":
              offset -= st.source.length;
              continue;
          }
          st = before[++i2];
          while (st?.type === "space") {
            offset += st.source.length;
            st = before[++i2];
          }
          break;
        }
      }
      return offset;
    }
    exports.emptyScalarPosition = emptyScalarPosition;
  }
});

// node_modules/yaml/dist/compose/compose-node.js
var require_compose_node = __commonJS({
  "node_modules/yaml/dist/compose/compose-node.js"(exports) {
    "use strict";
    var Alias = require_Alias();
    var identity = require_identity();
    var composeCollection = require_compose_collection();
    var composeScalar = require_compose_scalar();
    var resolveEnd = require_resolve_end();
    var utilEmptyScalarPosition = require_util_empty_scalar_position();
    var CN = { composeNode, composeEmptyNode };
    function composeNode(ctx, token, props, onError) {
      const atKey = ctx.atKey;
      const { spaceBefore, comment, anchor, tag } = props;
      let node;
      let isSrcToken = true;
      switch (token.type) {
        case "alias":
          node = composeAlias(ctx, token, onError);
          if (anchor || tag)
            onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
          break;
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "block-scalar":
          node = composeScalar.composeScalar(ctx, token, tag, onError);
          if (anchor)
            node.anchor = anchor.source.substring(1);
          break;
        case "block-map":
        case "block-seq":
        case "flow-collection":
          try {
            node = composeCollection.composeCollection(CN, ctx, token, props, onError);
            if (anchor)
              node.anchor = anchor.source.substring(1);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            onError(token, "RESOURCE_EXHAUSTION", message);
          }
          break;
        default: {
          const message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
          onError(token, "UNEXPECTED_TOKEN", message);
          isSrcToken = false;
        }
      }
      node ?? (node = composeEmptyNode(ctx, token.offset, void 0, null, props, onError));
      if (anchor && node.anchor === "")
        onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      if (atKey && ctx.options.stringKeys && (!identity.isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) {
        const msg = "With stringKeys, all keys must be strings";
        onError(tag ?? token, "NON_STRING_KEY", msg);
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        if (token.type === "scalar" && token.source === "")
          node.comment = comment;
        else
          node.commentBefore = comment;
      }
      if (ctx.options.keepSourceTokens && isSrcToken)
        node.srcToken = token;
      return node;
    }
    function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end }, onError) {
      const token = {
        type: "scalar",
        offset: utilEmptyScalarPosition.emptyScalarPosition(offset, before, pos),
        indent: -1,
        source: ""
      };
      const node = composeScalar.composeScalar(ctx, token, tag, onError);
      if (anchor) {
        node.anchor = anchor.source.substring(1);
        if (node.anchor === "")
          onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
      }
      if (spaceBefore)
        node.spaceBefore = true;
      if (comment) {
        node.comment = comment;
        node.range[2] = end;
      }
      return node;
    }
    function composeAlias({ options }, { offset, source, end }, onError) {
      const alias = new Alias.Alias(source.substring(1));
      if (alias.source === "")
        onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
      if (alias.source.endsWith(":"))
        onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
      const valueEnd = offset + source.length;
      const re = resolveEnd.resolveEnd(end, valueEnd, options.strict, onError);
      alias.range = [offset, valueEnd, re.offset];
      if (re.comment)
        alias.comment = re.comment;
      return alias;
    }
    exports.composeEmptyNode = composeEmptyNode;
    exports.composeNode = composeNode;
  }
});

// node_modules/yaml/dist/compose/compose-doc.js
var require_compose_doc = __commonJS({
  "node_modules/yaml/dist/compose/compose-doc.js"(exports) {
    "use strict";
    var Document = require_Document();
    var composeNode = require_compose_node();
    var resolveEnd = require_resolve_end();
    var resolveProps = require_resolve_props();
    function composeDoc(options, directives, { offset, start, value, end }, onError) {
      const opts = Object.assign({ _directives: directives }, options);
      const doc = new Document.Document(void 0, opts);
      const ctx = {
        atKey: false,
        atRoot: true,
        directives: doc.directives,
        options: doc.options,
        schema: doc.schema
      };
      const props = resolveProps.resolveProps(start, {
        indicator: "doc-start",
        next: value ?? end?.[0],
        offset,
        onError,
        parentIndent: 0,
        startOnNewline: true
      });
      if (props.found) {
        doc.directives.docStart = true;
        if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline)
          onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
      }
      doc.contents = value ? composeNode.composeNode(ctx, value, props, onError) : composeNode.composeEmptyNode(ctx, props.end, start, null, props, onError);
      const contentEnd = doc.contents.range[2];
      const re = resolveEnd.resolveEnd(end, contentEnd, false, onError);
      if (re.comment)
        doc.comment = re.comment;
      doc.range = [offset, contentEnd, re.offset];
      return doc;
    }
    exports.composeDoc = composeDoc;
  }
});

// node_modules/yaml/dist/compose/composer.js
var require_composer = __commonJS({
  "node_modules/yaml/dist/compose/composer.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var directives = require_directives();
    var Document = require_Document();
    var errors = require_errors();
    var identity = require_identity();
    var composeDoc = require_compose_doc();
    var resolveEnd = require_resolve_end();
    function getErrorPos(src) {
      if (typeof src === "number")
        return [src, src + 1];
      if (Array.isArray(src))
        return src.length === 2 ? src : [src[0], src[1]];
      const { offset, source } = src;
      return [offset, offset + (typeof source === "string" ? source.length : 1)];
    }
    function parsePrelude(prelude) {
      let comment = "";
      let atComment = false;
      let afterEmptyLine = false;
      for (let i2 = 0; i2 < prelude.length; ++i2) {
        const source = prelude[i2];
        switch (source[0]) {
          case "#":
            comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
            atComment = true;
            afterEmptyLine = false;
            break;
          case "%":
            if (prelude[i2 + 1]?.[0] !== "#")
              i2 += 1;
            atComment = false;
            break;
          default:
            if (!atComment)
              afterEmptyLine = true;
            atComment = false;
        }
      }
      return { comment, afterEmptyLine };
    }
    var Composer = class {
      constructor(options = {}) {
        this.doc = null;
        this.atDirectives = false;
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
        this.onError = (source, code, message, warning) => {
          const pos = getErrorPos(source);
          if (warning)
            this.warnings.push(new errors.YAMLWarning(pos, code, message));
          else
            this.errors.push(new errors.YAMLParseError(pos, code, message));
        };
        this.directives = new directives.Directives({ version: options.version || "1.2" });
        this.options = options;
      }
      decorate(doc, afterDoc) {
        const { comment, afterEmptyLine } = parsePrelude(this.prelude);
        if (comment) {
          const dc = doc.contents;
          if (afterDoc) {
            doc.comment = doc.comment ? `${doc.comment}
${comment}` : comment;
          } else if (afterEmptyLine || doc.directives.docStart || !dc) {
            doc.commentBefore = comment;
          } else if (identity.isCollection(dc) && !dc.flow && dc.items.length > 0) {
            let it = dc.items[0];
            if (identity.isPair(it))
              it = it.key;
            const cb = it.commentBefore;
            it.commentBefore = cb ? `${comment}
${cb}` : comment;
          } else {
            const cb = dc.commentBefore;
            dc.commentBefore = cb ? `${comment}
${cb}` : comment;
          }
        }
        if (afterDoc) {
          for (let i2 = 0; i2 < this.errors.length; ++i2)
            doc.errors.push(this.errors[i2]);
          for (let i2 = 0; i2 < this.warnings.length; ++i2)
            doc.warnings.push(this.warnings[i2]);
        } else {
          doc.errors = this.errors;
          doc.warnings = this.warnings;
        }
        this.prelude = [];
        this.errors = [];
        this.warnings = [];
      }
      /**
       * Current stream status information.
       *
       * Mostly useful at the end of input for an empty stream.
       */
      streamInfo() {
        return {
          comment: parsePrelude(this.prelude).comment,
          directives: this.directives,
          errors: this.errors,
          warnings: this.warnings
        };
      }
      /**
       * Compose tokens into documents.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *compose(tokens, forceDoc = false, endOffset = -1) {
        for (const token of tokens)
          yield* this.next(token);
        yield* this.end(forceDoc, endOffset);
      }
      /** Advance the composer by one CST token. */
      *next(token) {
        if (node_process.env.LOG_STREAM)
          console.dir(token, { depth: null });
        switch (token.type) {
          case "directive":
            this.directives.add(token.source, (offset, message, warning) => {
              const pos = getErrorPos(token);
              pos[0] += offset;
              this.onError(pos, "BAD_DIRECTIVE", message, warning);
            });
            this.prelude.push(token.source);
            this.atDirectives = true;
            break;
          case "document": {
            const doc = composeDoc.composeDoc(this.options, this.directives, token, this.onError);
            if (this.atDirectives && !doc.directives.docStart)
              this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
            this.decorate(doc, false);
            if (this.doc)
              yield this.doc;
            this.doc = doc;
            this.atDirectives = false;
            break;
          }
          case "byte-order-mark":
          case "space":
            break;
          case "comment":
          case "newline":
            this.prelude.push(token.source);
            break;
          case "error": {
            const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
            const error = new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
            if (this.atDirectives || !this.doc)
              this.errors.push(error);
            else
              this.doc.errors.push(error);
            break;
          }
          case "doc-end": {
            if (!this.doc) {
              const msg = "Unexpected doc-end without preceding document";
              this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg));
              break;
            }
            this.doc.directives.docEnd = true;
            const end = resolveEnd.resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
            this.decorate(this.doc, true);
            if (end.comment) {
              const dc = this.doc.comment;
              this.doc.comment = dc ? `${dc}
${end.comment}` : end.comment;
            }
            this.doc.range[2] = end.offset;
            break;
          }
          default:
            this.errors.push(new errors.YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
        }
      }
      /**
       * Call at end of input to yield any remaining document.
       *
       * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
       * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
       */
      *end(forceDoc = false, endOffset = -1) {
        if (this.doc) {
          this.decorate(this.doc, true);
          yield this.doc;
          this.doc = null;
        } else if (forceDoc) {
          const opts = Object.assign({ _directives: this.directives }, this.options);
          const doc = new Document.Document(void 0, opts);
          if (this.atDirectives)
            this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
          doc.range = [0, endOffset, endOffset];
          this.decorate(doc, false);
          yield doc;
        }
      }
    };
    exports.Composer = Composer;
  }
});

// node_modules/yaml/dist/parse/cst-scalar.js
var require_cst_scalar = __commonJS({
  "node_modules/yaml/dist/parse/cst-scalar.js"(exports) {
    "use strict";
    var resolveBlockScalar = require_resolve_block_scalar();
    var resolveFlowScalar = require_resolve_flow_scalar();
    var errors = require_errors();
    var stringifyString = require_stringifyString();
    function resolveAsScalar(token, strict = true, onError) {
      if (token) {
        const _onError = (pos, code, message) => {
          const offset = typeof pos === "number" ? pos : Array.isArray(pos) ? pos[0] : pos.offset;
          if (onError)
            onError(offset, code, message);
          else
            throw new errors.YAMLParseError([offset, offset + 1], code, message);
        };
        switch (token.type) {
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return resolveFlowScalar.resolveFlowScalar(token, strict, _onError);
          case "block-scalar":
            return resolveBlockScalar.resolveBlockScalar({ options: { strict } }, token, _onError);
        }
      }
      return null;
    }
    function createScalarToken(value, context) {
      const { implicitKey = false, indent, inFlow = false, offset = -1, type = "PLAIN" } = context;
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey,
        indent: indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      const end = context.end ?? [
        { type: "newline", offset: -1, indent, source: "\n" }
      ];
      switch (source[0]) {
        case "|":
        case ">": {
          const he = source.indexOf("\n");
          const head = source.substring(0, he);
          const body = source.substring(he + 1) + "\n";
          const props = [
            { type: "block-scalar-header", offset, indent, source: head }
          ];
          if (!addEndtoBlockProps(props, end))
            props.push({ type: "newline", offset: -1, indent, source: "\n" });
          return { type: "block-scalar", offset, indent, props, source: body };
        }
        case '"':
          return { type: "double-quoted-scalar", offset, indent, source, end };
        case "'":
          return { type: "single-quoted-scalar", offset, indent, source, end };
        default:
          return { type: "scalar", offset, indent, source, end };
      }
    }
    function setScalarValue(token, value, context = {}) {
      let { afterKey = false, implicitKey = false, inFlow = false, type } = context;
      let indent = "indent" in token ? token.indent : null;
      if (afterKey && typeof indent === "number")
        indent += 2;
      if (!type)
        switch (token.type) {
          case "single-quoted-scalar":
            type = "QUOTE_SINGLE";
            break;
          case "double-quoted-scalar":
            type = "QUOTE_DOUBLE";
            break;
          case "block-scalar": {
            const header = token.props[0];
            if (header.type !== "block-scalar-header")
              throw new Error("Invalid block scalar header");
            type = header.source[0] === ">" ? "BLOCK_FOLDED" : "BLOCK_LITERAL";
            break;
          }
          default:
            type = "PLAIN";
        }
      const source = stringifyString.stringifyString({ type, value }, {
        implicitKey: implicitKey || indent === null,
        indent: indent !== null && indent > 0 ? " ".repeat(indent) : "",
        inFlow,
        options: { blockQuote: true, lineWidth: -1 }
      });
      switch (source[0]) {
        case "|":
        case ">":
          setBlockScalarValue(token, source);
          break;
        case '"':
          setFlowScalarValue(token, source, "double-quoted-scalar");
          break;
        case "'":
          setFlowScalarValue(token, source, "single-quoted-scalar");
          break;
        default:
          setFlowScalarValue(token, source, "scalar");
      }
    }
    function setBlockScalarValue(token, source) {
      const he = source.indexOf("\n");
      const head = source.substring(0, he);
      const body = source.substring(he + 1) + "\n";
      if (token.type === "block-scalar") {
        const header = token.props[0];
        if (header.type !== "block-scalar-header")
          throw new Error("Invalid block scalar header");
        header.source = head;
        token.source = body;
      } else {
        const { offset } = token;
        const indent = "indent" in token ? token.indent : -1;
        const props = [
          { type: "block-scalar-header", offset, indent, source: head }
        ];
        if (!addEndtoBlockProps(props, "end" in token ? token.end : void 0))
          props.push({ type: "newline", offset: -1, indent, source: "\n" });
        for (const key of Object.keys(token))
          if (key !== "type" && key !== "offset")
            delete token[key];
        Object.assign(token, { type: "block-scalar", indent, props, source: body });
      }
    }
    function addEndtoBlockProps(props, end) {
      if (end)
        for (const st of end)
          switch (st.type) {
            case "space":
            case "comment":
              props.push(st);
              break;
            case "newline":
              props.push(st);
              return true;
          }
      return false;
    }
    function setFlowScalarValue(token, source, type) {
      switch (token.type) {
        case "scalar":
        case "double-quoted-scalar":
        case "single-quoted-scalar":
          token.type = type;
          token.source = source;
          break;
        case "block-scalar": {
          const end = token.props.slice(1);
          let oa = source.length;
          if (token.props[0].type === "block-scalar-header")
            oa -= token.props[0].source.length;
          for (const tok of end)
            tok.offset += oa;
          delete token.props;
          Object.assign(token, { type, source, end });
          break;
        }
        case "block-map":
        case "block-seq": {
          const offset = token.offset + source.length;
          const nl = { type: "newline", offset, indent: token.indent, source: "\n" };
          delete token.items;
          Object.assign(token, { type, source, end: [nl] });
          break;
        }
        default: {
          const indent = "indent" in token ? token.indent : -1;
          const end = "end" in token && Array.isArray(token.end) ? token.end.filter((st) => st.type === "space" || st.type === "comment" || st.type === "newline") : [];
          for (const key of Object.keys(token))
            if (key !== "type" && key !== "offset")
              delete token[key];
          Object.assign(token, { type, indent, source, end });
        }
      }
    }
    exports.createScalarToken = createScalarToken;
    exports.resolveAsScalar = resolveAsScalar;
    exports.setScalarValue = setScalarValue;
  }
});

// node_modules/yaml/dist/parse/cst-stringify.js
var require_cst_stringify = __commonJS({
  "node_modules/yaml/dist/parse/cst-stringify.js"(exports) {
    "use strict";
    var stringify = (cst) => "type" in cst ? stringifyToken(cst) : stringifyItem(cst);
    function stringifyToken(token) {
      switch (token.type) {
        case "block-scalar": {
          let res = "";
          for (const tok of token.props)
            res += stringifyToken(tok);
          return res + token.source;
        }
        case "block-map":
        case "block-seq": {
          let res = "";
          for (const item of token.items)
            res += stringifyItem(item);
          return res;
        }
        case "flow-collection": {
          let res = token.start.source;
          for (const item of token.items)
            res += stringifyItem(item);
          for (const st of token.end)
            res += st.source;
          return res;
        }
        case "document": {
          let res = stringifyItem(token);
          if (token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
        default: {
          let res = token.source;
          if ("end" in token && token.end)
            for (const st of token.end)
              res += st.source;
          return res;
        }
      }
    }
    function stringifyItem({ start, key, sep, value }) {
      let res = "";
      for (const st of start)
        res += st.source;
      if (key)
        res += stringifyToken(key);
      if (sep)
        for (const st of sep)
          res += st.source;
      if (value)
        res += stringifyToken(value);
      return res;
    }
    exports.stringify = stringify;
  }
});

// node_modules/yaml/dist/parse/cst-visit.js
var require_cst_visit = __commonJS({
  "node_modules/yaml/dist/parse/cst-visit.js"(exports) {
    "use strict";
    var BREAK = /* @__PURE__ */ Symbol("break visit");
    var SKIP = /* @__PURE__ */ Symbol("skip children");
    var REMOVE = /* @__PURE__ */ Symbol("remove item");
    function visit(cst, visitor) {
      if ("type" in cst && cst.type === "document")
        cst = { start: cst.start, value: cst.value };
      _visit(Object.freeze([]), cst, visitor);
    }
    visit.BREAK = BREAK;
    visit.SKIP = SKIP;
    visit.REMOVE = REMOVE;
    visit.itemAtPath = (cst, path19) => {
      let item = cst;
      for (const [field, index] of path19) {
        const tok = item?.[field];
        if (tok && "items" in tok) {
          item = tok.items[index];
        } else
          return void 0;
      }
      return item;
    };
    visit.parentCollection = (cst, path19) => {
      const parent = visit.itemAtPath(cst, path19.slice(0, -1));
      const field = path19[path19.length - 1][0];
      const coll = parent?.[field];
      if (coll && "items" in coll)
        return coll;
      throw new Error("Parent collection not found");
    };
    function _visit(path19, item, visitor) {
      let ctrl = visitor(item, path19);
      if (typeof ctrl === "symbol")
        return ctrl;
      for (const field of ["key", "value"]) {
        const token = item[field];
        if (token && "items" in token) {
          for (let i2 = 0; i2 < token.items.length; ++i2) {
            const ci = _visit(Object.freeze(path19.concat([[field, i2]])), token.items[i2], visitor);
            if (typeof ci === "number")
              i2 = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              token.items.splice(i2, 1);
              i2 -= 1;
            }
          }
          if (typeof ctrl === "function" && field === "key")
            ctrl = ctrl(item, path19);
        }
      }
      return typeof ctrl === "function" ? ctrl(item, path19) : ctrl;
    }
    exports.visit = visit;
  }
});

// node_modules/yaml/dist/parse/cst.js
var require_cst = __commonJS({
  "node_modules/yaml/dist/parse/cst.js"(exports) {
    "use strict";
    var cstScalar = require_cst_scalar();
    var cstStringify = require_cst_stringify();
    var cstVisit = require_cst_visit();
    var BOM = "\uFEFF";
    var DOCUMENT = "";
    var FLOW_END = "";
    var SCALAR = "";
    var isCollection = (token) => !!token && "items" in token;
    var isScalar = (token) => !!token && (token.type === "scalar" || token.type === "single-quoted-scalar" || token.type === "double-quoted-scalar" || token.type === "block-scalar");
    function prettyToken(token) {
      switch (token) {
        case BOM:
          return "<BOM>";
        case DOCUMENT:
          return "<DOC>";
        case FLOW_END:
          return "<FLOW_END>";
        case SCALAR:
          return "<SCALAR>";
        default:
          return JSON.stringify(token);
      }
    }
    function tokenType(source) {
      switch (source) {
        case BOM:
          return "byte-order-mark";
        case DOCUMENT:
          return "doc-mode";
        case FLOW_END:
          return "flow-error-end";
        case SCALAR:
          return "scalar";
        case "---":
          return "doc-start";
        case "...":
          return "doc-end";
        case "":
        case "\n":
        case "\r\n":
          return "newline";
        case "-":
          return "seq-item-ind";
        case "?":
          return "explicit-key-ind";
        case ":":
          return "map-value-ind";
        case "{":
          return "flow-map-start";
        case "}":
          return "flow-map-end";
        case "[":
          return "flow-seq-start";
        case "]":
          return "flow-seq-end";
        case ",":
          return "comma";
      }
      switch (source[0]) {
        case " ":
        case "	":
          return "space";
        case "#":
          return "comment";
        case "%":
          return "directive-line";
        case "*":
          return "alias";
        case "&":
          return "anchor";
        case "!":
          return "tag";
        case "'":
          return "single-quoted-scalar";
        case '"':
          return "double-quoted-scalar";
        case "|":
        case ">":
          return "block-scalar-header";
      }
      return null;
    }
    exports.createScalarToken = cstScalar.createScalarToken;
    exports.resolveAsScalar = cstScalar.resolveAsScalar;
    exports.setScalarValue = cstScalar.setScalarValue;
    exports.stringify = cstStringify.stringify;
    exports.visit = cstVisit.visit;
    exports.BOM = BOM;
    exports.DOCUMENT = DOCUMENT;
    exports.FLOW_END = FLOW_END;
    exports.SCALAR = SCALAR;
    exports.isCollection = isCollection;
    exports.isScalar = isScalar;
    exports.prettyToken = prettyToken;
    exports.tokenType = tokenType;
  }
});

// node_modules/yaml/dist/parse/lexer.js
var require_lexer = __commonJS({
  "node_modules/yaml/dist/parse/lexer.js"(exports) {
    "use strict";
    var cst = require_cst();
    function isEmpty(ch) {
      switch (ch) {
        case void 0:
        case " ":
        case "\n":
        case "\r":
        case "	":
          return true;
        default:
          return false;
      }
    }
    var hexDigits = new Set("0123456789ABCDEFabcdef");
    var tagChars = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
    var flowIndicatorChars = new Set(",[]{}");
    var invalidAnchorChars = new Set(" ,[]{}\n\r	");
    var isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
    var Lexer = class {
      constructor() {
        this.atEnd = false;
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        this.buffer = "";
        this.flowKey = false;
        this.flowLevel = 0;
        this.indentNext = 0;
        this.indentValue = 0;
        this.lineEndPos = null;
        this.next = null;
        this.pos = 0;
      }
      /**
       * Generate YAML tokens from the `source` string. If `incomplete`,
       * a part of the last line may be left as a buffer for the next call.
       *
       * @returns A generator of lexical tokens
       */
      *lex(source, incomplete = false) {
        if (source) {
          if (typeof source !== "string")
            throw TypeError("source is not a string");
          this.buffer = this.buffer ? this.buffer + source : source;
          this.lineEndPos = null;
        }
        this.atEnd = !incomplete;
        let next = this.next ?? "stream";
        while (next && (incomplete || this.hasChars(1)))
          next = yield* this.parseNext(next);
      }
      atLineEnd() {
        let i2 = this.pos;
        let ch = this.buffer[i2];
        while (ch === " " || ch === "	")
          ch = this.buffer[++i2];
        if (!ch || ch === "#" || ch === "\n")
          return true;
        if (ch === "\r")
          return this.buffer[i2 + 1] === "\n";
        return false;
      }
      charAt(n) {
        return this.buffer[this.pos + n];
      }
      continueScalar(offset) {
        let ch = this.buffer[offset];
        if (this.indentNext > 0) {
          let indent = 0;
          while (ch === " ")
            ch = this.buffer[++indent + offset];
          if (ch === "\r") {
            const next = this.buffer[indent + offset + 1];
            if (next === "\n" || !next && !this.atEnd)
              return offset + indent + 1;
          }
          return ch === "\n" || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
        }
        if (ch === "-" || ch === ".") {
          const dt = this.buffer.substr(offset, 3);
          if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3]))
            return -1;
        }
        return offset;
      }
      getLine() {
        let end = this.lineEndPos;
        if (typeof end !== "number" || end !== -1 && end < this.pos) {
          end = this.buffer.indexOf("\n", this.pos);
          this.lineEndPos = end;
        }
        if (end === -1)
          return this.atEnd ? this.buffer.substring(this.pos) : null;
        if (this.buffer[end - 1] === "\r")
          end -= 1;
        return this.buffer.substring(this.pos, end);
      }
      hasChars(n) {
        return this.pos + n <= this.buffer.length;
      }
      setNext(state) {
        this.buffer = this.buffer.substring(this.pos);
        this.pos = 0;
        this.lineEndPos = null;
        this.next = state;
        return null;
      }
      peek(n) {
        return this.buffer.substr(this.pos, n);
      }
      *parseNext(next) {
        switch (next) {
          case "stream":
            return yield* this.parseStream();
          case "line-start":
            return yield* this.parseLineStart();
          case "block-start":
            return yield* this.parseBlockStart();
          case "doc":
            return yield* this.parseDocument();
          case "flow":
            return yield* this.parseFlowCollection();
          case "quoted-scalar":
            return yield* this.parseQuotedScalar();
          case "block-scalar":
            return yield* this.parseBlockScalar();
          case "plain-scalar":
            return yield* this.parsePlainScalar();
        }
      }
      *parseStream() {
        let line = this.getLine();
        if (line === null)
          return this.setNext("stream");
        if (line[0] === cst.BOM) {
          yield* this.pushCount(1);
          line = line.substring(1);
        }
        if (line[0] === "%") {
          let dirEnd = line.length;
          let cs = line.indexOf("#");
          while (cs !== -1) {
            const ch = line[cs - 1];
            if (ch === " " || ch === "	") {
              dirEnd = cs - 1;
              break;
            } else {
              cs = line.indexOf("#", cs + 1);
            }
          }
          while (true) {
            const ch = line[dirEnd - 1];
            if (ch === " " || ch === "	")
              dirEnd -= 1;
            else
              break;
          }
          const n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
          yield* this.pushCount(line.length - n);
          this.pushNewline();
          return "stream";
        }
        if (this.atLineEnd()) {
          const sp = yield* this.pushSpaces(true);
          yield* this.pushCount(line.length - sp);
          yield* this.pushNewline();
          return "stream";
        }
        yield cst.DOCUMENT;
        return yield* this.parseLineStart();
      }
      *parseLineStart() {
        const ch = this.charAt(0);
        if (!ch && !this.atEnd)
          return this.setNext("line-start");
        if (ch === "-" || ch === ".") {
          if (!this.atEnd && !this.hasChars(4))
            return this.setNext("line-start");
          const s = this.peek(3);
          if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) {
            yield* this.pushCount(3);
            this.indentValue = 0;
            this.indentNext = 0;
            return s === "---" ? "doc" : "stream";
          }
        }
        this.indentValue = yield* this.pushSpaces(false);
        if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1)))
          this.indentNext = this.indentValue;
        return yield* this.parseBlockStart();
      }
      *parseBlockStart() {
        const [ch0, ch1] = this.peek(2);
        if (!ch1 && !this.atEnd)
          return this.setNext("block-start");
        if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
          const n = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
          this.indentNext = this.indentValue + 1;
          this.indentValue += n;
          return "block-start";
        }
        return "doc";
      }
      *parseDocument() {
        yield* this.pushSpaces(true);
        const line = this.getLine();
        if (line === null)
          return this.setNext("doc");
        let n = yield* this.pushIndicators();
        switch (line[n]) {
          case "#":
            yield* this.pushCount(line.length - n);
          // fallthrough
          case void 0:
            yield* this.pushNewline();
            return yield* this.parseLineStart();
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel = 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            return "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "doc";
          case '"':
          case "'":
            return yield* this.parseQuotedScalar();
          case "|":
          case ">":
            n += yield* this.parseBlockScalarHeader();
            n += yield* this.pushSpaces(true);
            yield* this.pushCount(line.length - n);
            yield* this.pushNewline();
            return yield* this.parseBlockScalar();
          default:
            return yield* this.parsePlainScalar();
        }
      }
      *parseFlowCollection() {
        let nl, sp;
        let indent = -1;
        do {
          nl = yield* this.pushNewline();
          if (nl > 0) {
            sp = yield* this.pushSpaces(false);
            this.indentValue = indent = sp;
          } else {
            sp = 0;
          }
          sp += yield* this.pushSpaces(true);
        } while (nl + sp > 0);
        const line = this.getLine();
        if (line === null)
          return this.setNext("flow");
        if (indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) {
          const atFlowEndMarker = indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}");
          if (!atFlowEndMarker) {
            this.flowLevel = 0;
            yield cst.FLOW_END;
            return yield* this.parseLineStart();
          }
        }
        let n = 0;
        while (line[n] === ",") {
          n += yield* this.pushCount(1);
          n += yield* this.pushSpaces(true);
          this.flowKey = false;
        }
        n += yield* this.pushIndicators();
        switch (line[n]) {
          case void 0:
            return "flow";
          case "#":
            yield* this.pushCount(line.length - n);
            return "flow";
          case "{":
          case "[":
            yield* this.pushCount(1);
            this.flowKey = false;
            this.flowLevel += 1;
            return "flow";
          case "}":
          case "]":
            yield* this.pushCount(1);
            this.flowKey = true;
            this.flowLevel -= 1;
            return this.flowLevel ? "flow" : "doc";
          case "*":
            yield* this.pushUntil(isNotAnchorChar);
            return "flow";
          case '"':
          case "'":
            this.flowKey = true;
            return yield* this.parseQuotedScalar();
          case ":": {
            const next = this.charAt(1);
            if (this.flowKey || isEmpty(next) || next === ",") {
              this.flowKey = false;
              yield* this.pushCount(1);
              yield* this.pushSpaces(true);
              return "flow";
            }
          }
          // fallthrough
          default:
            this.flowKey = false;
            return yield* this.parsePlainScalar();
        }
      }
      *parseQuotedScalar() {
        const quote = this.charAt(0);
        let end = this.buffer.indexOf(quote, this.pos + 1);
        if (quote === "'") {
          while (end !== -1 && this.buffer[end + 1] === "'")
            end = this.buffer.indexOf("'", end + 2);
        } else {
          while (end !== -1) {
            let n = 0;
            while (this.buffer[end - 1 - n] === "\\")
              n += 1;
            if (n % 2 === 0)
              break;
            end = this.buffer.indexOf('"', end + 1);
          }
        }
        const qb = this.buffer.substring(0, end);
        let nl = qb.indexOf("\n", this.pos);
        if (nl !== -1) {
          while (nl !== -1) {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = qb.indexOf("\n", cs);
          }
          if (nl !== -1) {
            end = nl - (qb[nl - 1] === "\r" ? 2 : 1);
          }
        }
        if (end === -1) {
          if (!this.atEnd)
            return this.setNext("quoted-scalar");
          end = this.buffer.length;
        }
        yield* this.pushToIndex(end + 1, false);
        return this.flowLevel ? "flow" : "doc";
      }
      *parseBlockScalarHeader() {
        this.blockScalarIndent = -1;
        this.blockScalarKeep = false;
        let i2 = this.pos;
        while (true) {
          const ch = this.buffer[++i2];
          if (ch === "+")
            this.blockScalarKeep = true;
          else if (ch > "0" && ch <= "9")
            this.blockScalarIndent = Number(ch) - 1;
          else if (ch !== "-")
            break;
        }
        return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
      }
      *parseBlockScalar() {
        let nl = this.pos - 1;
        let indent = 0;
        let ch;
        loop: for (let i3 = this.pos; ch = this.buffer[i3]; ++i3) {
          switch (ch) {
            case " ":
              indent += 1;
              break;
            case "\n":
              nl = i3;
              indent = 0;
              break;
            case "\r": {
              const next = this.buffer[i3 + 1];
              if (!next && !this.atEnd)
                return this.setNext("block-scalar");
              if (next === "\n")
                break;
            }
            // fallthrough
            default:
              break loop;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("block-scalar");
        if (indent >= this.indentNext) {
          if (this.blockScalarIndent === -1)
            this.indentNext = indent;
          else {
            this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
          }
          do {
            const cs = this.continueScalar(nl + 1);
            if (cs === -1)
              break;
            nl = this.buffer.indexOf("\n", cs);
          } while (nl !== -1);
          if (nl === -1) {
            if (!this.atEnd)
              return this.setNext("block-scalar");
            nl = this.buffer.length;
          }
        }
        let i2 = nl + 1;
        ch = this.buffer[i2];
        while (ch === " ")
          ch = this.buffer[++i2];
        if (ch === "	") {
          while (ch === "	" || ch === " " || ch === "\r" || ch === "\n")
            ch = this.buffer[++i2];
          nl = i2 - 1;
        } else if (!this.blockScalarKeep) {
          do {
            let i3 = nl - 1;
            let ch2 = this.buffer[i3];
            if (ch2 === "\r")
              ch2 = this.buffer[--i3];
            const lastChar = i3;
            while (ch2 === " ")
              ch2 = this.buffer[--i3];
            if (ch2 === "\n" && i3 >= this.pos && i3 + 1 + indent > lastChar)
              nl = i3;
            else
              break;
          } while (true);
        }
        yield cst.SCALAR;
        yield* this.pushToIndex(nl + 1, true);
        return yield* this.parseLineStart();
      }
      *parsePlainScalar() {
        const inFlow = this.flowLevel > 0;
        let end = this.pos - 1;
        let i2 = this.pos - 1;
        let ch;
        while (ch = this.buffer[++i2]) {
          if (ch === ":") {
            const next = this.buffer[i2 + 1];
            if (isEmpty(next) || inFlow && flowIndicatorChars.has(next))
              break;
            end = i2;
          } else if (isEmpty(ch)) {
            let next = this.buffer[i2 + 1];
            if (ch === "\r") {
              if (next === "\n") {
                i2 += 1;
                ch = "\n";
                next = this.buffer[i2 + 1];
              } else
                end = i2;
            }
            if (next === "#" || inFlow && flowIndicatorChars.has(next))
              break;
            if (ch === "\n") {
              const cs = this.continueScalar(i2 + 1);
              if (cs === -1)
                break;
              i2 = Math.max(i2, cs - 2);
            }
          } else {
            if (inFlow && flowIndicatorChars.has(ch))
              break;
            end = i2;
          }
        }
        if (!ch && !this.atEnd)
          return this.setNext("plain-scalar");
        yield cst.SCALAR;
        yield* this.pushToIndex(end + 1, true);
        return inFlow ? "flow" : "doc";
      }
      *pushCount(n) {
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos += n;
          return n;
        }
        return 0;
      }
      *pushToIndex(i2, allowEmpty) {
        const s = this.buffer.slice(this.pos, i2);
        if (s) {
          yield s;
          this.pos += s.length;
          return s.length;
        } else if (allowEmpty)
          yield "";
        return 0;
      }
      *pushIndicators() {
        let n = 0;
        loop: while (true) {
          switch (this.charAt(0)) {
            case "!":
              n += yield* this.pushTag();
              n += yield* this.pushSpaces(true);
              continue loop;
            case "&":
              n += yield* this.pushUntil(isNotAnchorChar);
              n += yield* this.pushSpaces(true);
              continue loop;
            case "-":
            // this is an error
            case "?":
            // this is an error outside flow collections
            case ":": {
              const inFlow = this.flowLevel > 0;
              const ch1 = this.charAt(1);
              if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
                if (!inFlow)
                  this.indentNext = this.indentValue + 1;
                else if (this.flowKey)
                  this.flowKey = false;
                n += yield* this.pushCount(1);
                n += yield* this.pushSpaces(true);
                continue loop;
              }
            }
          }
          break loop;
        }
        return n;
      }
      *pushTag() {
        if (this.charAt(1) === "<") {
          let i2 = this.pos + 2;
          let ch = this.buffer[i2];
          while (!isEmpty(ch) && ch !== ">")
            ch = this.buffer[++i2];
          return yield* this.pushToIndex(ch === ">" ? i2 + 1 : i2, false);
        } else {
          let i2 = this.pos + 1;
          let ch = this.buffer[i2];
          while (ch) {
            if (tagChars.has(ch))
              ch = this.buffer[++i2];
            else if (ch === "%" && hexDigits.has(this.buffer[i2 + 1]) && hexDigits.has(this.buffer[i2 + 2])) {
              ch = this.buffer[i2 += 3];
            } else
              break;
          }
          return yield* this.pushToIndex(i2, false);
        }
      }
      *pushNewline() {
        const ch = this.buffer[this.pos];
        if (ch === "\n")
          return yield* this.pushCount(1);
        else if (ch === "\r" && this.charAt(1) === "\n")
          return yield* this.pushCount(2);
        else
          return 0;
      }
      *pushSpaces(allowTabs) {
        let i2 = this.pos - 1;
        let ch;
        do {
          ch = this.buffer[++i2];
        } while (ch === " " || allowTabs && ch === "	");
        const n = i2 - this.pos;
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos = i2;
        }
        return n;
      }
      *pushUntil(test) {
        let i2 = this.pos;
        let ch = this.buffer[i2];
        while (!test(ch))
          ch = this.buffer[++i2];
        return yield* this.pushToIndex(i2, false);
      }
    };
    exports.Lexer = Lexer;
  }
});

// node_modules/yaml/dist/parse/line-counter.js
var require_line_counter = __commonJS({
  "node_modules/yaml/dist/parse/line-counter.js"(exports) {
    "use strict";
    var LineCounter = class {
      constructor() {
        this.lineStarts = [];
        this.addNewLine = (offset) => this.lineStarts.push(offset);
        this.linePos = (offset) => {
          let low = 0;
          let high = this.lineStarts.length;
          while (low < high) {
            const mid = low + high >> 1;
            if (this.lineStarts[mid] < offset)
              low = mid + 1;
            else
              high = mid;
          }
          if (this.lineStarts[low] === offset)
            return { line: low + 1, col: 1 };
          if (low === 0)
            return { line: 0, col: offset };
          const start = this.lineStarts[low - 1];
          return { line: low, col: offset - start + 1 };
        };
      }
    };
    exports.LineCounter = LineCounter;
  }
});

// node_modules/yaml/dist/parse/parser.js
var require_parser = __commonJS({
  "node_modules/yaml/dist/parse/parser.js"(exports) {
    "use strict";
    var node_process = __require("process");
    var cst = require_cst();
    var lexer = require_lexer();
    function includesToken(list, type) {
      for (let i2 = 0; i2 < list.length; ++i2)
        if (list[i2].type === type)
          return true;
      return false;
    }
    function findNonEmptyIndex(list) {
      for (let i2 = 0; i2 < list.length; ++i2) {
        switch (list[i2].type) {
          case "space":
          case "comment":
          case "newline":
            break;
          default:
            return i2;
        }
      }
      return -1;
    }
    function isFlowToken(token) {
      switch (token?.type) {
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar":
        case "flow-collection":
          return true;
        default:
          return false;
      }
    }
    function getPrevProps(parent) {
      switch (parent.type) {
        case "document":
          return parent.start;
        case "block-map": {
          const it = parent.items[parent.items.length - 1];
          return it.sep ?? it.start;
        }
        case "block-seq":
          return parent.items[parent.items.length - 1].start;
        /* istanbul ignore next should not happen */
        default:
          return [];
      }
    }
    function getFirstKeyStartProps(prev) {
      if (prev.length === 0)
        return [];
      let i2 = prev.length;
      loop: while (--i2 >= 0) {
        switch (prev[i2].type) {
          case "doc-start":
          case "explicit-key-ind":
          case "map-value-ind":
          case "seq-item-ind":
          case "newline":
            break loop;
        }
      }
      while (prev[++i2]?.type === "space") {
      }
      return prev.splice(i2, prev.length);
    }
    function arrayPushArray(target, source) {
      if (source.length < 1e5)
        Array.prototype.push.apply(target, source);
      else
        for (let i2 = 0; i2 < source.length; ++i2)
          target.push(source[i2]);
    }
    function fixFlowSeqItems(fc) {
      if (fc.start.type === "flow-seq-start") {
        for (const it of fc.items) {
          if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
            if (it.key)
              it.value = it.key;
            delete it.key;
            if (isFlowToken(it.value)) {
              if (it.value.end)
                arrayPushArray(it.value.end, it.sep);
              else
                it.value.end = it.sep;
            } else
              arrayPushArray(it.start, it.sep);
            delete it.sep;
          }
        }
      }
    }
    var Parser = class {
      /**
       * @param onNewLine - If defined, called separately with the start position of
       *   each new line (in `parse()`, including the start of input).
       */
      constructor(onNewLine) {
        this.atNewLine = true;
        this.atScalar = false;
        this.indent = 0;
        this.offset = 0;
        this.onKeyLine = false;
        this.stack = [];
        this.source = "";
        this.type = "";
        this.lexer = new lexer.Lexer();
        this.onNewLine = onNewLine;
      }
      /**
       * Parse `source` as a YAML stream.
       * If `incomplete`, a part of the last line may be left as a buffer for the next call.
       *
       * Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
       *
       * @returns A generator of tokens representing each directive, document, and other structure.
       */
      *parse(source, incomplete = false) {
        if (this.onNewLine && this.offset === 0)
          this.onNewLine(0);
        for (const lexeme of this.lexer.lex(source, incomplete))
          yield* this.next(lexeme);
        if (!incomplete)
          yield* this.end();
      }
      /**
       * Advance the parser by the `source` of one lexical token.
       */
      *next(source) {
        this.source = source;
        if (node_process.env.LOG_TOKENS)
          console.log("|", cst.prettyToken(source));
        if (this.atScalar) {
          this.atScalar = false;
          yield* this.step();
          this.offset += source.length;
          return;
        }
        const type = cst.tokenType(source);
        if (!type) {
          const message = `Not a YAML token: ${source}`;
          yield* this.pop({ type: "error", offset: this.offset, message, source });
          this.offset += source.length;
        } else if (type === "scalar") {
          this.atNewLine = false;
          this.atScalar = true;
          this.type = "scalar";
        } else {
          this.type = type;
          yield* this.step();
          switch (type) {
            case "newline":
              this.atNewLine = true;
              this.indent = 0;
              if (this.onNewLine)
                this.onNewLine(this.offset + source.length);
              break;
            case "space":
              if (this.atNewLine && source[0] === " ")
                this.indent += source.length;
              break;
            case "explicit-key-ind":
            case "map-value-ind":
            case "seq-item-ind":
              if (this.atNewLine)
                this.indent += source.length;
              break;
            case "doc-mode":
            case "flow-error-end":
              return;
            default:
              this.atNewLine = false;
          }
          this.offset += source.length;
        }
      }
      /** Call at end of input to push out any remaining constructions */
      *end() {
        while (this.stack.length > 0)
          yield* this.pop();
      }
      get sourceToken() {
        const st = {
          type: this.type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
        return st;
      }
      *step() {
        const top = this.peek(1);
        if (this.type === "doc-end" && top?.type !== "doc-end") {
          while (this.stack.length > 0)
            yield* this.pop();
          this.stack.push({
            type: "doc-end",
            offset: this.offset,
            source: this.source
          });
          return;
        }
        if (!top)
          return yield* this.stream();
        switch (top.type) {
          case "document":
            return yield* this.document(top);
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return yield* this.scalar(top);
          case "block-scalar":
            return yield* this.blockScalar(top);
          case "block-map":
            return yield* this.blockMap(top);
          case "block-seq":
            return yield* this.blockSequence(top);
          case "flow-collection":
            return yield* this.flowCollection(top);
          case "doc-end":
            return yield* this.documentEnd(top);
        }
        yield* this.pop();
      }
      peek(n) {
        return this.stack[this.stack.length - n];
      }
      *pop(error) {
        const token = error ?? this.stack.pop();
        if (!token) {
          const message = "Tried to pop an empty stack";
          yield { type: "error", offset: this.offset, source: "", message };
        } else if (this.stack.length === 0) {
          yield token;
        } else {
          const top = this.peek(1);
          if (token.type === "block-scalar") {
            token.indent = "indent" in top ? top.indent : 0;
          } else if (token.type === "flow-collection" && top.type === "document") {
            token.indent = 0;
          }
          if (token.type === "flow-collection")
            fixFlowSeqItems(token);
          switch (top.type) {
            case "document":
              top.value = token;
              break;
            case "block-scalar":
              top.props.push(token);
              break;
            case "block-map": {
              const it = top.items[top.items.length - 1];
              if (it.value) {
                top.items.push({ start: [], key: token, sep: [] });
                this.onKeyLine = true;
                return;
              } else if (it.sep) {
                it.value = token;
              } else {
                Object.assign(it, { key: token, sep: [] });
                this.onKeyLine = !it.explicitKey;
                return;
              }
              break;
            }
            case "block-seq": {
              const it = top.items[top.items.length - 1];
              if (it.value)
                top.items.push({ start: [], value: token });
              else
                it.value = token;
              break;
            }
            case "flow-collection": {
              const it = top.items[top.items.length - 1];
              if (!it || it.value)
                top.items.push({ start: [], key: token, sep: [] });
              else if (it.sep)
                it.value = token;
              else
                Object.assign(it, { key: token, sep: [] });
              return;
            }
            /* istanbul ignore next should not happen */
            default:
              yield* this.pop();
              yield* this.pop(token);
          }
          if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
            const last = token.items[token.items.length - 1];
            if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
              if (top.type === "document")
                top.end = last.start;
              else
                top.items.push({ start: last.start });
              token.items.splice(-1, 1);
            }
          }
        }
      }
      *stream() {
        switch (this.type) {
          case "directive-line":
            yield { type: "directive", offset: this.offset, source: this.source };
            return;
          case "byte-order-mark":
          case "space":
          case "comment":
          case "newline":
            yield this.sourceToken;
            return;
          case "doc-mode":
          case "doc-start": {
            const doc = {
              type: "document",
              offset: this.offset,
              start: []
            };
            if (this.type === "doc-start")
              doc.start.push(this.sourceToken);
            this.stack.push(doc);
            return;
          }
        }
        yield {
          type: "error",
          offset: this.offset,
          message: `Unexpected ${this.type} token in YAML stream`,
          source: this.source
        };
      }
      *document(doc) {
        if (doc.value)
          return yield* this.lineEnd(doc);
        switch (this.type) {
          case "doc-start": {
            if (findNonEmptyIndex(doc.start) !== -1) {
              yield* this.pop();
              yield* this.step();
            } else
              doc.start.push(this.sourceToken);
            return;
          }
          case "anchor":
          case "tag":
          case "space":
          case "comment":
          case "newline":
            doc.start.push(this.sourceToken);
            return;
        }
        const bv = this.startBlockValue(doc);
        if (bv)
          this.stack.push(bv);
        else {
          yield {
            type: "error",
            offset: this.offset,
            message: `Unexpected ${this.type} token in YAML document`,
            source: this.source
          };
        }
      }
      *scalar(scalar) {
        if (this.type === "map-value-ind") {
          const prev = getPrevProps(this.peek(2));
          const start = getFirstKeyStartProps(prev);
          let sep;
          if (scalar.end) {
            sep = scalar.end;
            sep.push(this.sourceToken);
            delete scalar.end;
          } else
            sep = [this.sourceToken];
          const map = {
            type: "block-map",
            offset: scalar.offset,
            indent: scalar.indent,
            items: [{ start, key: scalar, sep }]
          };
          this.onKeyLine = true;
          this.stack[this.stack.length - 1] = map;
        } else
          yield* this.lineEnd(scalar);
      }
      *blockScalar(scalar) {
        switch (this.type) {
          case "space":
          case "comment":
          case "newline":
            scalar.props.push(this.sourceToken);
            return;
          case "scalar":
            scalar.source = this.source;
            this.atNewLine = true;
            this.indent = 0;
            if (this.onNewLine) {
              let nl = this.source.indexOf("\n") + 1;
              while (nl !== 0) {
                this.onNewLine(this.offset + nl);
                nl = this.source.indexOf("\n", nl) + 1;
              }
            }
            yield* this.pop();
            break;
          /* istanbul ignore next should not happen */
          default:
            yield* this.pop();
            yield* this.step();
        }
      }
      *blockMap(map) {
        const it = map.items[map.items.length - 1];
        switch (this.type) {
          case "newline":
            this.onKeyLine = false;
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              it.start.push(this.sourceToken);
            }
            return;
          case "space":
          case "comment":
            if (it.value) {
              map.items.push({ start: [this.sourceToken] });
            } else if (it.sep) {
              it.sep.push(this.sourceToken);
            } else {
              if (this.atIndentedComment(it.start, map.indent)) {
                const prev = map.items[map.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  map.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
        }
        if (this.indent >= map.indent) {
          const atMapIndent = !this.onKeyLine && this.indent === map.indent;
          const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
          let start = [];
          if (atNextItem && it.sep && !it.value) {
            const nl = [];
            for (let i2 = 0; i2 < it.sep.length; ++i2) {
              const st = it.sep[i2];
              switch (st.type) {
                case "newline":
                  nl.push(i2);
                  break;
                case "space":
                  break;
                case "comment":
                  if (st.indent > map.indent)
                    nl.length = 0;
                  break;
                default:
                  nl.length = 0;
              }
            }
            if (nl.length >= 2)
              start = it.sep.splice(nl[1]);
          }
          switch (this.type) {
            case "anchor":
            case "tag":
              if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start });
                this.onKeyLine = true;
              } else if (it.sep) {
                it.sep.push(this.sourceToken);
              } else {
                it.start.push(this.sourceToken);
              }
              return;
            case "explicit-key-ind":
              if (!it.sep && !it.explicitKey) {
                it.start.push(this.sourceToken);
                it.explicitKey = true;
              } else if (atNextItem || it.value) {
                start.push(this.sourceToken);
                map.items.push({ start, explicitKey: true });
              } else {
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: [this.sourceToken], explicitKey: true }]
                });
              }
              this.onKeyLine = true;
              return;
            case "map-value-ind":
              if (it.explicitKey) {
                if (!it.sep) {
                  if (includesToken(it.start, "newline")) {
                    Object.assign(it, { key: null, sep: [this.sourceToken] });
                  } else {
                    const start2 = getFirstKeyStartProps(it.start);
                    this.stack.push({
                      type: "block-map",
                      offset: this.offset,
                      indent: this.indent,
                      items: [{ start: start2, key: null, sep: [this.sourceToken] }]
                    });
                  }
                } else if (it.value) {
                  map.items.push({ start: [], key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start, key: null, sep: [this.sourceToken] }]
                  });
                } else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
                  const start2 = getFirstKeyStartProps(it.start);
                  const key = it.key;
                  const sep = it.sep;
                  sep.push(this.sourceToken);
                  delete it.key;
                  delete it.sep;
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: start2, key, sep }]
                  });
                } else if (start.length > 0) {
                  it.sep = it.sep.concat(start, this.sourceToken);
                } else {
                  it.sep.push(this.sourceToken);
                }
              } else {
                if (!it.sep) {
                  Object.assign(it, { key: null, sep: [this.sourceToken] });
                } else if (it.value || atNextItem) {
                  map.items.push({ start, key: null, sep: [this.sourceToken] });
                } else if (includesToken(it.sep, "map-value-ind")) {
                  this.stack.push({
                    type: "block-map",
                    offset: this.offset,
                    indent: this.indent,
                    items: [{ start: [], key: null, sep: [this.sourceToken] }]
                  });
                } else {
                  it.sep.push(this.sourceToken);
                }
              }
              this.onKeyLine = true;
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs16 = this.flowScalar(this.type);
              if (atNextItem || it.value) {
                map.items.push({ start, key: fs16, sep: [] });
                this.onKeyLine = true;
              } else if (it.sep) {
                this.stack.push(fs16);
              } else {
                Object.assign(it, { key: fs16, sep: [] });
                this.onKeyLine = true;
              }
              return;
            }
            default: {
              const bv = this.startBlockValue(map);
              if (bv) {
                if (bv.type === "block-seq") {
                  if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
                    yield* this.pop({
                      type: "error",
                      offset: this.offset,
                      message: "Unexpected block-seq-ind on same line with key",
                      source: this.source
                    });
                    return;
                  }
                } else if (atMapIndent) {
                  map.items.push({ start });
                }
                this.stack.push(bv);
                return;
              }
            }
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *blockSequence(seq) {
        const it = seq.items[seq.items.length - 1];
        switch (this.type) {
          case "newline":
            if (it.value) {
              const end = "end" in it.value ? it.value.end : void 0;
              const last = Array.isArray(end) ? end[end.length - 1] : void 0;
              if (last?.type === "comment")
                end?.push(this.sourceToken);
              else
                seq.items.push({ start: [this.sourceToken] });
            } else
              it.start.push(this.sourceToken);
            return;
          case "space":
          case "comment":
            if (it.value)
              seq.items.push({ start: [this.sourceToken] });
            else {
              if (this.atIndentedComment(it.start, seq.indent)) {
                const prev = seq.items[seq.items.length - 2];
                const end = prev?.value?.end;
                if (Array.isArray(end)) {
                  arrayPushArray(end, it.start);
                  end.push(this.sourceToken);
                  seq.items.pop();
                  return;
                }
              }
              it.start.push(this.sourceToken);
            }
            return;
          case "anchor":
          case "tag":
            if (it.value || this.indent <= seq.indent)
              break;
            it.start.push(this.sourceToken);
            return;
          case "seq-item-ind":
            if (this.indent !== seq.indent)
              break;
            if (it.value || includesToken(it.start, "seq-item-ind"))
              seq.items.push({ start: [this.sourceToken] });
            else
              it.start.push(this.sourceToken);
            return;
        }
        if (this.indent > seq.indent) {
          const bv = this.startBlockValue(seq);
          if (bv) {
            this.stack.push(bv);
            return;
          }
        }
        yield* this.pop();
        yield* this.step();
      }
      *flowCollection(fc) {
        const it = fc.items[fc.items.length - 1];
        if (this.type === "flow-error-end") {
          let top;
          do {
            yield* this.pop();
            top = this.peek(1);
          } while (top?.type === "flow-collection");
        } else if (fc.end.length === 0) {
          switch (this.type) {
            case "comma":
            case "explicit-key-ind":
              if (!it || it.sep)
                fc.items.push({ start: [this.sourceToken] });
              else
                it.start.push(this.sourceToken);
              return;
            case "map-value-ind":
              if (!it || it.value)
                fc.items.push({ start: [], key: null, sep: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                Object.assign(it, { key: null, sep: [this.sourceToken] });
              return;
            case "space":
            case "comment":
            case "newline":
            case "anchor":
            case "tag":
              if (!it || it.value)
                fc.items.push({ start: [this.sourceToken] });
              else if (it.sep)
                it.sep.push(this.sourceToken);
              else
                it.start.push(this.sourceToken);
              return;
            case "alias":
            case "scalar":
            case "single-quoted-scalar":
            case "double-quoted-scalar": {
              const fs16 = this.flowScalar(this.type);
              if (!it || it.value)
                fc.items.push({ start: [], key: fs16, sep: [] });
              else if (it.sep)
                this.stack.push(fs16);
              else
                Object.assign(it, { key: fs16, sep: [] });
              return;
            }
            case "flow-map-end":
            case "flow-seq-end":
              fc.end.push(this.sourceToken);
              return;
          }
          const bv = this.startBlockValue(fc);
          if (bv)
            this.stack.push(bv);
          else {
            yield* this.pop();
            yield* this.step();
          }
        } else {
          const parent = this.peek(2);
          if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
            yield* this.pop();
            yield* this.step();
          } else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            fixFlowSeqItems(fc);
            const sep = fc.end.splice(1, fc.end.length);
            sep.push(this.sourceToken);
            const map = {
              type: "block-map",
              offset: fc.offset,
              indent: fc.indent,
              items: [{ start, key: fc, sep }]
            };
            this.onKeyLine = true;
            this.stack[this.stack.length - 1] = map;
          } else {
            yield* this.lineEnd(fc);
          }
        }
      }
      flowScalar(type) {
        if (this.onNewLine) {
          let nl = this.source.indexOf("\n") + 1;
          while (nl !== 0) {
            this.onNewLine(this.offset + nl);
            nl = this.source.indexOf("\n", nl) + 1;
          }
        }
        return {
          type,
          offset: this.offset,
          indent: this.indent,
          source: this.source
        };
      }
      startBlockValue(parent) {
        switch (this.type) {
          case "alias":
          case "scalar":
          case "single-quoted-scalar":
          case "double-quoted-scalar":
            return this.flowScalar(this.type);
          case "block-scalar-header":
            return {
              type: "block-scalar",
              offset: this.offset,
              indent: this.indent,
              props: [this.sourceToken],
              source: ""
            };
          case "flow-map-start":
          case "flow-seq-start":
            return {
              type: "flow-collection",
              offset: this.offset,
              indent: this.indent,
              start: this.sourceToken,
              items: [],
              end: []
            };
          case "seq-item-ind":
            return {
              type: "block-seq",
              offset: this.offset,
              indent: this.indent,
              items: [{ start: [this.sourceToken] }]
            };
          case "explicit-key-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            start.push(this.sourceToken);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, explicitKey: true }]
            };
          }
          case "map-value-ind": {
            this.onKeyLine = true;
            const prev = getPrevProps(parent);
            const start = getFirstKeyStartProps(prev);
            return {
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start, key: null, sep: [this.sourceToken] }]
            };
          }
        }
        return null;
      }
      atIndentedComment(start, indent) {
        if (this.type !== "comment")
          return false;
        if (this.indent <= indent)
          return false;
        return start.every((st) => st.type === "newline" || st.type === "space");
      }
      *documentEnd(docEnd) {
        if (this.type !== "doc-mode") {
          if (docEnd.end)
            docEnd.end.push(this.sourceToken);
          else
            docEnd.end = [this.sourceToken];
          if (this.type === "newline")
            yield* this.pop();
        }
      }
      *lineEnd(token) {
        switch (this.type) {
          case "comma":
          case "doc-start":
          case "doc-end":
          case "flow-seq-end":
          case "flow-map-end":
          case "map-value-ind":
            yield* this.pop();
            yield* this.step();
            break;
          case "newline":
            this.onKeyLine = false;
          // fallthrough
          case "space":
          case "comment":
          default:
            if (token.end)
              token.end.push(this.sourceToken);
            else
              token.end = [this.sourceToken];
            if (this.type === "newline")
              yield* this.pop();
        }
      }
    };
    exports.Parser = Parser;
  }
});

// node_modules/yaml/dist/public-api.js
var require_public_api = __commonJS({
  "node_modules/yaml/dist/public-api.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var errors = require_errors();
    var log = require_log();
    var identity = require_identity();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    function parseOptions(options) {
      const prettyErrors = options.prettyErrors !== false;
      const lineCounter$1 = options.lineCounter || prettyErrors && new lineCounter.LineCounter() || null;
      return { lineCounter: lineCounter$1, prettyErrors };
    }
    function parseAllDocuments(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      const docs = Array.from(composer$1.compose(parser$1.parse(source)));
      if (prettyErrors && lineCounter2)
        for (const doc of docs) {
          doc.errors.forEach(errors.prettifyError(source, lineCounter2));
          doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
        }
      if (docs.length > 0)
        return docs;
      return Object.assign([], { empty: true }, composer$1.streamInfo());
    }
    function parseDocument(source, options = {}) {
      const { lineCounter: lineCounter2, prettyErrors } = parseOptions(options);
      const parser$1 = new parser.Parser(lineCounter2?.addNewLine);
      const composer$1 = new composer.Composer(options);
      let doc = null;
      for (const _doc of composer$1.compose(parser$1.parse(source), true, source.length)) {
        if (!doc)
          doc = _doc;
        else if (doc.options.logLevel !== "silent") {
          doc.errors.push(new errors.YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
          break;
        }
      }
      if (prettyErrors && lineCounter2) {
        doc.errors.forEach(errors.prettifyError(source, lineCounter2));
        doc.warnings.forEach(errors.prettifyError(source, lineCounter2));
      }
      return doc;
    }
    function parse(src, reviver, options) {
      let _reviver = void 0;
      if (typeof reviver === "function") {
        _reviver = reviver;
      } else if (options === void 0 && reviver && typeof reviver === "object") {
        options = reviver;
      }
      const doc = parseDocument(src, options);
      if (!doc)
        return null;
      doc.warnings.forEach((warning) => log.warn(doc.options.logLevel, warning));
      if (doc.errors.length > 0) {
        if (doc.options.logLevel !== "silent")
          throw doc.errors[0];
        else
          doc.errors = [];
      }
      return doc.toJS(Object.assign({ reviver: _reviver }, options));
    }
    function stringify(value, replacer, options) {
      let _replacer = null;
      if (typeof replacer === "function" || Array.isArray(replacer)) {
        _replacer = replacer;
      } else if (options === void 0 && replacer) {
        options = replacer;
      }
      if (typeof options === "string")
        options = options.length;
      if (typeof options === "number") {
        const indent = Math.round(options);
        options = indent < 1 ? void 0 : indent > 8 ? { indent: 8 } : { indent };
      }
      if (value === void 0) {
        const { keepUndefined } = options ?? replacer ?? {};
        if (!keepUndefined)
          return void 0;
      }
      if (identity.isDocument(value) && !_replacer)
        return value.toString(options);
      return new Document.Document(value, _replacer, options).toString(options);
    }
    exports.parse = parse;
    exports.parseAllDocuments = parseAllDocuments;
    exports.parseDocument = parseDocument;
    exports.stringify = stringify;
  }
});

// node_modules/yaml/dist/index.js
var require_dist = __commonJS({
  "node_modules/yaml/dist/index.js"(exports) {
    "use strict";
    var composer = require_composer();
    var Document = require_Document();
    var Schema = require_Schema();
    var errors = require_errors();
    var Alias = require_Alias();
    var identity = require_identity();
    var Pair = require_Pair();
    var Scalar = require_Scalar();
    var YAMLMap = require_YAMLMap();
    var YAMLSeq = require_YAMLSeq();
    var cst = require_cst();
    var lexer = require_lexer();
    var lineCounter = require_line_counter();
    var parser = require_parser();
    var publicApi = require_public_api();
    var visit = require_visit();
    exports.Composer = composer.Composer;
    exports.Document = Document.Document;
    exports.Schema = Schema.Schema;
    exports.YAMLError = errors.YAMLError;
    exports.YAMLParseError = errors.YAMLParseError;
    exports.YAMLWarning = errors.YAMLWarning;
    exports.Alias = Alias.Alias;
    exports.isAlias = identity.isAlias;
    exports.isCollection = identity.isCollection;
    exports.isDocument = identity.isDocument;
    exports.isMap = identity.isMap;
    exports.isNode = identity.isNode;
    exports.isPair = identity.isPair;
    exports.isScalar = identity.isScalar;
    exports.isSeq = identity.isSeq;
    exports.Pair = Pair.Pair;
    exports.Scalar = Scalar.Scalar;
    exports.YAMLMap = YAMLMap.YAMLMap;
    exports.YAMLSeq = YAMLSeq.YAMLSeq;
    exports.CST = cst;
    exports.Lexer = lexer.Lexer;
    exports.LineCounter = lineCounter.LineCounter;
    exports.Parser = parser.Parser;
    exports.parse = publicApi.parse;
    exports.parseAllDocuments = publicApi.parseAllDocuments;
    exports.parseDocument = publicApi.parseDocument;
    exports.stringify = publicApi.stringify;
    exports.visit = visit.visit;
    exports.visitAsync = visit.visitAsync;
  }
});

// packages/quay/src/branch-model.ts
import fs2 from "node:fs";
import path2 from "node:path";
import { execFileSync } from "node:child_process";
function git(root, args) {
  try {
    const out = execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      timeout: 2e4,
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { ok: true, out };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { ok: false, err };
  }
}
function resolveCheckedOutBranch(root) {
  const cur = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (cur.ok) {
    const ref = cur.out.trim();
    if (ref) return ref;
  }
  return null;
}
function resolveDocBranchRole(root) {
  return resolveCheckedOutBranch(root) ?? detectDefaultBranch(root);
}
function resolveSha(root, ref) {
  const r = git(root, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  if (!r.ok) return null;
  const sha = r.out.trim();
  return sha.length > 0 ? sha : null;
}
function revCount(root, a, b) {
  const r = git(root, ["rev-list", "--count", `${a}..${b}`]);
  if (!r.ok) return null;
  const n = Number.parseInt(r.out.trim(), 10);
  return Number.isFinite(n) ? n : null;
}
function isAncestor(root, ancestor, descendant) {
  try {
    execFileSync("git", ["-C", root, "merge-base", "--is-ancestor", ancestor, descendant], {
      timeout: 2e4,
      stdio: ["ignore", "ignore", "ignore"]
    });
    return true;
  } catch (e) {
    const status = e.status;
    if (status === 1) return false;
    return null;
  }
}
function detectDefaultBranch(root, opts = {}) {
  const allowCurrentBranch = opts.allowCurrentBranch !== false;
  const head = git(root, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"]);
  if (head.ok) {
    const ref = head.out.trim();
    if (ref) return ref.replace(/^[^/]+\//, "");
  }
  const has = (b) => resolveSha(root, b) !== null;
  const hasMain = has("main");
  const hasMaster = has("master");
  if (hasMain && !hasMaster) return "main";
  if (hasMaster && !hasMain) return "master";
  if (hasMain && hasMaster) {
  }
  if (!allowCurrentBranch) return null;
  const cur = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  if (cur.ok) {
    const ref = cur.out.trim();
    if (ref && resolveSha(root, ref) !== null) return ref;
  }
  return null;
}
function classifyBranch(root, name, defaultBranch) {
  const base = (extra) => ({
    name,
    state: "unreadable",
    sha: null,
    aheadOfDefault: null,
    behindDefault: null,
    reason: "unreadable",
    detail: "",
    ...extra
  });
  if (!fs2.existsSync(path2.join(root, ".git"))) {
  }
  const insideRepo = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!insideRepo.ok || insideRepo.out.trim() !== "true") {
    return base({ reason: "not-a-git-worktree", detail: `${root} is not inside a git work tree` });
  }
  const sha = resolveSha(root, name);
  if (sha === null) {
    const unborn = git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]);
    if (!unborn.ok) {
      return base({ reason: "no-commits", detail: "the repository has no commits yet \u2014 nothing to branch from" });
    }
    return base({ state: "absent", reason: "absent", detail: `branch '${name}' does not exist` });
  }
  if (defaultBranch === null) {
    return base({
      sha,
      reason: "default-branch-unresolvable",
      detail: `branch '${name}' exists (${sha.slice(0, 8)}) but the project's default branch could not be resolved, so compatibility is undecidable`
    });
  }
  const defaultSha = resolveSha(root, defaultBranch);
  if (defaultSha === null) {
    return base({
      sha,
      reason: "default-branch-unresolvable",
      detail: `branch '${name}' exists (${sha.slice(0, 8)}) but default branch '${defaultBranch}' does not resolve`
    });
  }
  const containsDefault = isAncestor(root, defaultBranch, name);
  if (containsDefault === null) {
    return base({
      sha,
      reason: "ancestry-undecidable",
      detail: `could not decide whether '${defaultBranch}' is an ancestor of '${name}'`
    });
  }
  const ahead = revCount(root, defaultBranch, name);
  const behind = revCount(root, name, defaultBranch);
  if (containsDefault) {
    return {
      name,
      state: "compatible",
      sha,
      aheadOfDefault: ahead,
      behindDefault: behind,
      reason: "contains-default",
      detail: `'${name}' contains '${defaultBranch}' (${ahead ?? "?"} commit(s) ahead, ${behind ?? "?"} behind) \u2014 a valid quay landing baseline`
    };
  }
  return {
    name,
    state: "divergent",
    sha,
    aheadOfDefault: ahead,
    behindDefault: behind,
    reason: "foreign-fork",
    detail: `'${name}' (${sha.slice(0, 8)}) is NOT a continuation of the project's default branch '${defaultBranch}' (${defaultSha.slice(0, 8)}) \u2014 it is ${behind ?? "?"} commit(s) behind and shares only an old merge base, so a task diff against it is meaningless`
  };
}
function ensureBranchModel(root, opts = {}) {
  const dryRun = opts.dryRun === true;
  const adopt = opts.adopt === true;
  const defaultBranch = detectDefaultBranch(root);
  const probe = classifyBranch(root, LANDING_BASELINE_ROLE, defaultBranch);
  if (probe.reason === "not-a-git-worktree" || probe.reason === "no-commits") {
    return {
      ok: true,
      skipped: true,
      defaultBranch,
      entries: [
        {
          role: "default",
          ref: defaultBranch ?? "(none)",
          action: "unreadable",
          sha: null,
          backupRef: null,
          detail: probe.detail
        }
      ],
      remedy: null
    };
  }
  const entries = [];
  const frozenDefaultSha = defaultBranch === null ? null : resolveSha(root, defaultBranch);
  entries.push({
    role: "default",
    ref: defaultBranch ?? "(unresolved)",
    action: defaultBranch === null ? "unreadable" : "reused",
    sha: frozenDefaultSha,
    backupRef: null,
    detail: defaultBranch === null ? "the project's default branch could not be resolved \u2014 the master role is unverified" : `project default branch (master role; quay never renames or moves it)`
  });
  const docName = resolveDocBranchRole(root);
  entries.push(
    docName === null ? { role: "doc-branch", ref: "(unresolved)", action: "unreadable", sha: null, backupRef: null, detail: "the doc-branch role could not be resolved (detached HEAD with no default branch) \u2014 the shipped mechanism derives it at runtime and will report the same" } : { role: "doc-branch", ref: docName, action: "reused", sha: resolveSha(root, docName), backupRef: null, detail: `the doc-only work branch is DERIVED at runtime (driver-filters.ts resolveDocBranch = the checked-out branch), so '${docName}' fills the role; \u26D4 no name is created or assumed here` }
  );
  const roles = [
    { role: LANDING_BASELINE_ENTRY_ROLE, name: LANDING_BASELINE_ROLE }
  ];
  for (const { role, name } of roles) {
    const cls = classifyBranch(root, name, defaultBranch);
    if (cls.state === "absent") {
      if (dryRun) {
        entries.push({ role, ref: name, action: "created", sha: frozenDefaultSha, backupRef: null, detail: `would create '${name}' at ${defaultBranch ?? "?"}` });
        continue;
      }
      if (frozenDefaultSha === null) {
        entries.push({ role, ref: name, action: "unreadable", sha: null, backupRef: null, detail: `cannot create '${name}': the default branch (${defaultBranch ?? "?"}) does not resolve` });
        continue;
      }
      const r = git(root, ["branch", name, defaultBranch]);
      entries.push(
        // `=== true`, not truthiness: this repo's root tsconfig is `strict: false`, under which the
        // NEGATIVE branch of a boolean-discriminant union is NOT narrowed — `r.err` below would be
        // TS2339, which `tsc --noEmit` (the fan-in ts-typecheck gate) rejects. Literal comparison
        // narrows both branches; the same form is used at every `.ok` union in this file.
        r.ok === true ? { role, ref: name, action: "created", sha: frozenDefaultSha, backupRef: null, detail: `created '${name}' at ${defaultBranch} (${frozenDefaultSha.slice(0, 8)})` } : { role, ref: name, action: "unreadable", sha: null, backupRef: null, detail: `git branch ${name} failed: ${r.err}` }
      );
      continue;
    }
    if (cls.state === "compatible") {
      entries.push({ role, ref: name, action: "reused", sha: cls.sha, backupRef: null, detail: cls.detail });
      continue;
    }
    if (cls.state === "unreadable") {
      entries.push({ role, ref: name, action: "unreadable", sha: cls.sha, backupRef: null, detail: cls.detail });
      continue;
    }
    if (!adopt) {
      entries.push({
        role,
        ref: name,
        action: "blocked",
        sha: cls.sha,
        backupRef: null,
        detail: `${cls.detail}. Reusing it silently would make every task's anti-drift diff meaningless (the exact defect this task fixes).`
      });
      continue;
    }
    const shortSha = (cls.sha ?? "unknown").slice(0, 8);
    const backupRef = `${name}-pre-quay-init-${shortSha}`;
    if (dryRun) {
      entries.push({ role, ref: name, action: "adopted", sha: frozenDefaultSha, backupRef, detail: `would preserve '${name}' as '${backupRef}' and re-point '${name}' at ${defaultBranch}` });
      continue;
    }
    if (frozenDefaultSha === null) {
      entries.push({ role, ref: name, action: "unreadable", sha: cls.sha, backupRef: null, detail: `cannot adopt '${name}': the default branch (${defaultBranch ?? "?"}) does not resolve` });
      continue;
    }
    const backup = git(root, ["branch", backupRef, name]);
    const repoint = git(root, ["branch", "-f", name, defaultBranch]);
    if (repoint.ok === true) {
      entries.push({
        role,
        ref: name,
        action: "adopted",
        sha: frozenDefaultSha,
        backupRef,
        detail: `'${name}' was a foreign fork (${shortSha}); preserved as '${backupRef}' and re-pointed at ${defaultBranch} (${frozenDefaultSha.slice(0, 8)})${backup.ok === true ? "" : ` \u2014 \u26A0\uFE0F backup failed: ${backup.err}`}`
      });
    } else {
      entries.push({ role, ref: name, action: "blocked", sha: cls.sha, backupRef, detail: `adopt failed: git branch -f ${name} returned non-zero: ${repoint.err}` });
    }
  }
  const blocked = entries.filter((e) => e.action === "blocked");
  return {
    ok: blocked.length === 0,
    skipped: false,
    defaultBranch,
    entries,
    remedy: blocked.length === 0 ? null : `Re-run with branch adoption enabled to preserve the existing branch(es) and re-point them at ${defaultBranch ?? "the default branch"}: CLI \`quay init --adopt-branch-model\` (or the /quay:init skill with branch adoption). The existing tips are kept under <branch>-pre-quay-init-<sha> \u2014 nothing is destroyed.`
  };
}
function formatBranchModelReport(report) {
  if (report.skipped) {
    return `branch model: SKIPPED \u2014 ${report.entries[0]?.detail ?? "repository not classifiable"}`;
  }
  const lines = [`branch model (default branch: ${report.defaultBranch ?? "UNRESOLVED"}):`];
  for (const e of report.entries) {
    const mark = e.action === "blocked" ? "BLOCKED" : e.action.toUpperCase();
    const backup = e.backupRef ? ` [backup: ${e.backupRef}]` : "";
    lines.push(`  [${mark}] ${e.role} -> ${e.ref}${backup} \u2014 ${e.detail}`);
  }
  if (report.remedy) lines.push(`  remedy: ${report.remedy}`);
  return lines.join("\n");
}
function ensureDocBranch(root, opts) {
  const name = (opts.name ?? "").trim();
  const dryRun = opts.dryRun === true;
  const adopt = opts.adopt === true;
  const base = {
    name,
    checkedOut: null,
    baselineSha: null,
    preexistingSha: null,
    sha: null
  };
  const notEvaluated = (detail) => ({
    ...base,
    state: "unreadable",
    action: "unreadable",
    ok: true,
    notEvaluated: true,
    detail
  });
  const blocked = (detail) => ({
    ...base,
    state: "blocked",
    action: "blocked",
    ok: false,
    notEvaluated: false,
    detail
  });
  const insideRepo = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!insideRepo.ok || insideRepo.out.trim() !== "true") {
    return notEvaluated(`${root} is not inside a git work tree \u2014 the doc-branch role is not judged`);
  }
  const checkedOut = resolveCheckedOutBranch(root);
  if (checkedOut === null) {
    return notEvaluated(
      "HEAD is detached (or the repository is unborn): no branch is checked out, so the doc-branch role cannot be judged \u2014 \u26D4 NOT treated as 'already independent' (an unreadable HEAD is its own state)."
    );
  }
  base.checkedOut = checkedOut;
  const baselineSha = resolveSha(root, LANDING_BASELINE_ROLE);
  base.baselineSha = baselineSha;
  if (checkedOut !== LANDING_BASELINE_ROLE) {
    return {
      ...base,
      state: "independent",
      action: "noop",
      ok: true,
      notEvaluated: false,
      detail: `the main checkout is on '${checkedOut}', which is not the landing baseline '${LANDING_BASELINE_ROLE}' \u2014 the doc-branch invariant already holds; nothing was created, renamed or switched`
    };
  }
  if (baselineSha === null) {
    return notEvaluated(
      `the main checkout is on '${LANDING_BASELINE_ROLE}' but that ref does not resolve \u2014 the doc branch cannot be judged against (or forked from) it`
    );
  }
  if (name === "") {
    return notEvaluated(
      "no doc-branch name was supplied \u2014 refusing to invent one (a branch name invented in the judgment layer is the per-project identity literal target-identity-literal-check.ts fails RED on). Pass it in: `--doc-branch-name <name>`, or `loop.doc_branch` in .quay/config.yml."
    );
  }
  if (name === LANDING_BASELINE_ROLE) {
    return blocked(
      `the requested doc-branch name '${name}' IS the landing baseline \u2014 a doc branch must be a DIFFERENT ref from '${LANDING_BASELINE_ROLE}'; refusing (nothing created or switched)`
    );
  }
  const preexistingSha = resolveSha(root, name);
  base.preexistingSha = preexistingSha;
  if (preexistingSha === null) {
    if (dryRun) {
      return {
        ...base,
        state: "absent",
        action: "created",
        ok: true,
        notEvaluated: false,
        sha: baselineSha,
        detail: `would create '${name}' at '${LANDING_BASELINE_ROLE}' (${baselineSha.slice(0, 8)}) and switch the main checkout to it`
      };
    }
    const r2 = git(root, ["checkout", "-b", name]);
    return {
      ...base,
      state: "absent",
      action: r2.ok === true ? "created" : "failed",
      ok: r2.ok === true,
      notEvaluated: false,
      sha: r2.ok === true ? baselineSha : null,
      detail: r2.ok === true ? `created '${name}' at '${LANDING_BASELINE_ROLE}' (${baselineSha.slice(0, 8)}) and switched the main checkout to it \u2014 the working tree is byte-identical (same commit)` : `could not create/switch to '${name}': git checkout -b returned non-zero: ${r2.err}`
    };
  }
  const nameContainsBaseline = isAncestor(root, LANDING_BASELINE_ROLE, name);
  const baselineContainsName = isAncestor(root, name, LANDING_BASELINE_ROLE);
  if (nameContainsBaseline === null || baselineContainsName === null) {
    return notEvaluated(
      `branch '${name}' exists (${preexistingSha.slice(0, 8)}) but its ancestry with '${LANDING_BASELINE_ROLE}' could not be decided \u2014 refusing to judge it as either related or a collision`
    );
  }
  if (!nameContainsBaseline && !baselineContainsName) {
    const shortSha = preexistingSha.slice(0, 8);
    const backupRef = `${name}-pre-quay-init-${shortSha}`;
    const collision = `branch '${name}' (${shortSha}) shares NO ancestry with '${LANDING_BASELINE_ROLE}' (${baselineSha.slice(0, 8)}) \u2014 a name collision, not a doc branch. Switching the main checkout onto it would move the human edit surface onto a foreign line.`;
    if (!adopt) {
      return blocked(
        `${collision} NOTHING WAS MOVED. Resolve it by hand, re-run with a different --doc-branch-name, or carry out the adoption decision (--adopt-branch-model) \u2014 which preserves the colliding tip as '${backupRef}' and re-points '${name}' at the baseline.`
      );
    }
    if (dryRun) {
      return {
        ...base,
        state: "blocked",
        action: "adopted",
        ok: true,
        notEvaluated: false,
        sha: baselineSha,
        detail: `would preserve '${name}' (${shortSha}) as '${backupRef}', re-point '${name}' at '${LANDING_BASELINE_ROLE}' (${baselineSha.slice(0, 8)}) and switch the main checkout to it`
      };
    }
    const backup = git(root, ["branch", backupRef, name]);
    const repoint = git(root, ["branch", "-f", name, LANDING_BASELINE_ROLE]);
    if (repoint.ok !== true) {
      return {
        ...base,
        state: "blocked",
        action: "failed",
        ok: false,
        notEvaluated: false,
        sha: preexistingSha,
        detail: `${collision} adopt failed: git branch -f ${name} returned non-zero: ${repoint.err}`
      };
    }
    const co = git(root, ["checkout", name]);
    return {
      ...base,
      state: "blocked",
      action: co.ok === true ? "adopted" : "failed",
      ok: co.ok === true,
      notEvaluated: false,
      sha: baselineSha,
      detail: co.ok === true ? `'${name}' was an unrelated line (${shortSha}); preserved as '${backupRef}' and re-pointed at '${LANDING_BASELINE_ROLE}' (${baselineSha.slice(0, 8)}), then the main checkout was switched to it${backup.ok === true ? "" : ` \u2014 \u26A0\uFE0F backup failed: ${backup.err}`}` : `re-pointed '${name}' at '${LANDING_BASELINE_ROLE}' but could not switch to it: git checkout returned non-zero: ${co.err}`
    };
  }
  if (dryRun) {
    return {
      ...base,
      state: "reusable",
      action: "switched",
      ok: true,
      notEvaluated: false,
      sha: preexistingSha,
      detail: `would switch the main checkout to the existing related branch '${name}' (${preexistingSha.slice(0, 8)}) \u2014 unchanged, never renamed or re-pointed`
    };
  }
  const r = git(root, ["checkout", name]);
  return {
    ...base,
    state: "reusable",
    action: r.ok === true ? "switched" : "failed",
    ok: r.ok === true,
    notEvaluated: false,
    sha: preexistingSha,
    detail: r.ok === true ? `switched the main checkout to the existing related branch '${name}' (${preexistingSha.slice(0, 8)}) \u2014 unchanged, never renamed or re-pointed` : `could not switch to the existing branch '${name}': git checkout returned non-zero: ${r.err}`
  };
}
function landingBaselineEstablishedNow(report) {
  return report.entries.some(
    (e) => e.role === LANDING_BASELINE_ENTRY_ROLE && (e.action === "created" || e.action === "adopted")
  );
}
function moveCheckoutOntoLandingBaseline(root) {
  const to = LANDING_BASELINE_ROLE;
  const notEvaluated = (detail) => ({
    action: "not-evaluated",
    ok: true,
    notEvaluated: true,
    from: null,
    to,
    detail
  });
  const insideRepo = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!insideRepo.ok || insideRepo.out.trim() !== "true") {
    return notEvaluated(`${root} is not inside a git work tree \u2014 there is no checkout to move`);
  }
  const from = resolveCheckedOutBranch(root);
  if (from === null) {
    return notEvaluated(
      "HEAD is detached (or the repository is unborn): no branch is checked out, so there is no main-checkout position to move onto the landing baseline \u2014 \u26D4 NOT treated as 'already there'."
    );
  }
  if (from === to) {
    return {
      action: "already-on-baseline",
      ok: true,
      notEvaluated: false,
      from,
      to,
      detail: `the main checkout is already on '${to}' \u2014 nothing to switch`
    };
  }
  const headSha = resolveSha(root, "HEAD");
  const baselineSha = resolveSha(root, to);
  if (headSha === null || baselineSha === null) {
    return notEvaluated(
      `the checked-out commit or '${to}' does not resolve \u2014 the switch cannot be shown to be metadata-only, so it is not attempted (the main checkout stays on '${from}')`
    );
  }
  if (headSha !== baselineSha) {
    return notEvaluated(
      `'${to}' (${baselineSha.slice(0, 8)}) does not point at the checked-out commit (${headSha.slice(0, 8)}) \u2014 switching would move the main checkout onto a DIFFERENT tree, which is not this step's job (the main checkout stays on '${from}')`
    );
  }
  const r = git(root, ["checkout", to]);
  if (r.ok !== true) {
    return {
      action: "failed",
      ok: false,
      notEvaluated: false,
      from,
      to,
      detail: `could not switch the main checkout from '${from}' to '${to}': git checkout returned non-zero: ${r.err}`
    };
  }
  return {
    action: "switched",
    ok: true,
    notEvaluated: false,
    from,
    to,
    detail: `switched the main checkout from '${from}' to the landing baseline '${to}' \u2014 both point at ${headSha.slice(0, 8)}, so the working tree is unchanged; the doc-branch judgment that runs next now sees the position it needs to establish the doc branch`
  };
}
function formatBaselineCheckoutReport(report) {
  const mark = report.notEvaluated ? "NOT-EVALUATED" : report.action === "failed" ? "FAILED" : report.action === "switched" ? "SWITCHED" : "NOOP";
  return `landing-baseline checkout (from: ${report.from ?? "(detached HEAD)"}, to: ${report.to}):
  [${mark}] baseline-checkout \u2014 ${report.detail}`;
}
function formatDocBranchReport(report) {
  const mark = report.notEvaluated ? "NOT-EVALUATED" : report.action === "blocked" ? "BLOCKED" : report.action === "failed" ? "FAILED" : report.action.toUpperCase();
  return [
    `doc branch (name: ${report.name === "" ? "(none supplied)" : report.name}, landing baseline: ${LANDING_BASELINE_ROLE}):`,
    `  [${mark}] doc-branch -> ${report.name === "" ? "(none)" : report.name} \u2014 ${report.detail}`
  ].join("\n");
}
function goalBranchName(goalId) {
  return `goal/${goalId}`;
}
function goalBranchRefExists(root, goalId) {
  const r = git(root, ["rev-parse", "--verify", "--quiet", `${goalBranchName(goalId)}^{commit}`]);
  return r.ok && r.out.trim() !== "";
}
function goalBranchTip(root, goalId) {
  return resolveSha(root, goalBranchName(goalId));
}
function ensureGoalBranch(root, goalId) {
  const name = goalBranchName(goalId);
  const base0 = { name, sha: null, base: null };
  const unreadable = (detail) => ({
    ...base0,
    action: "unreadable",
    ok: true,
    notEvaluated: true,
    detail
  });
  const insideRepo = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!insideRepo.ok || insideRepo.out.trim() !== "true") {
    return unreadable(`${root} is not inside a git work tree \u2014 '${name}' cannot be created there`);
  }
  const existing = resolveSha(root, name);
  if (existing !== null) {
    return {
      ...base0,
      action: "reused",
      ok: true,
      notEvaluated: false,
      sha: existing,
      detail: `'${name}' already exists at ${existing.slice(0, 8)} \u2014 reused, \u26D4 never re-pointed`
    };
  }
  const base = resolveSha(root, LANDING_BASELINE_ROLE);
  if (base === null) {
    return unreadable(
      `'${name}' does not exist and the landing baseline '${LANDING_BASELINE_ROLE}' does not resolve \u2014 the goal branch cannot be forked from a ref that is not there (\u26D4 not fallen back to HEAD)`
    );
  }
  const created = git(root, ["branch", name, base]);
  if (created.ok === false) {
    return {
      ...base0,
      action: "blocked",
      ok: false,
      notEvaluated: false,
      detail: `could not create '${name}' at ${base.slice(0, 8)}: git branch returned non-zero: ${created.err}`
    };
  }
  return {
    ...base0,
    action: "created",
    ok: true,
    notEvaluated: false,
    sha: base,
    base,
    detail: `created '${name}' at '${LANDING_BASELINE_ROLE}' tip ${base.slice(0, 8)}`
  };
}
function discardGoalBranch(root, goalId) {
  const name = goalBranchName(goalId);
  const tipSha = resolveSha(root, name);
  if (tipSha === null) {
    return { removed: false, tipSha: null, detail: `'${name}' does not exist \u2014 nothing to discard` };
  }
  const del = git(root, ["branch", "-D", name]);
  if (del.ok === false) {
    return {
      removed: false,
      tipSha,
      detail: `could not delete '${name}' (tip ${tipSha.slice(0, 8)}): git branch -D returned non-zero: ${del.err}`
    };
  }
  return { removed: true, tipSha, detail: `deleted '${name}' (tip ${tipSha})` };
}
var LANDING_BASELINE_ROLE, LANDING_BASELINE_ENTRY_ROLE;
var init_branch_model = __esm({
  "packages/quay/src/branch-model.ts"() {
    LANDING_BASELINE_ROLE = "develop";
    LANDING_BASELINE_ENTRY_ROLE = "landing-baseline";
  }
});

// packages/quay/src/kernel/regex-escape.ts
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
var init_regex_escape = __esm({
  "packages/quay/src/kernel/regex-escape.ts"() {
  }
});

// packages/quay/src/plugin-root.ts
import fs3 from "node:fs";
import path3 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { execFileSync as execFileSync2 } from "node:child_process";
function moduleDir() {
  if (typeof __dirname === "string") return __dirname;
  return path3.dirname(fileURLToPath2(import.meta.url));
}
function kernelAnchorExists(root) {
  return KERNEL_RELS.some((rel) => fs3.existsSync(path3.join(root, rel)));
}
function mainCheckoutRoot(dir) {
  try {
    const out = execFileSync2("git", ["-C", dir, "worktree", "list", "--porcelain"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
    const worktrees = out.split("\n").filter((l) => l.startsWith("worktree ")).map((l) => path3.resolve(l.slice("worktree ".length).trim()));
    if (worktrees.length < 2) return null;
    const main2 = worktrees[0];
    const real = path3.resolve(dir);
    for (const w of worktrees.slice(1)) {
      if (real === w || real.startsWith(w + path3.sep)) return main2;
    }
    return null;
  } catch {
    return null;
  }
}
function selfPluginRoot() {
  const dir = moduleDir();
  const main2 = mainCheckoutRoot(dir);
  if (main2) {
    const cand = path3.join(main2, "plugin");
    return kernelAnchorExists(cand) ? cand : null;
  }
  return resolvePluginRootFrom(dir);
}
function realpathOrNull(p) {
  if (!p) return null;
  try {
    return fs3.realpathSync(p);
  } catch {
    return null;
  }
}
function resolvePluginRootReading() {
  const env = process.env.QUAY_PLUGIN_ROOT;
  if (env) {
    const warnings = [];
    const self = selfPluginRoot();
    const selfReal = realpathOrNull(self);
    const envReal = realpathOrNull(env);
    if (selfReal !== null && envReal !== null && selfReal !== envReal) {
      warnings.push(
        `QUAY_PLUGIN_ROOT (${env}) differs from this module's own plugin root (${self}) \u2014 a pinned env pointer freezes the plugin version like a frozen PATH entry`
      );
    }
    return { root: env, warnings };
  }
  return { root: selfPluginRoot(), warnings: [] };
}
function resolvePluginRoot() {
  return resolvePluginRootReading().root;
}
function resolvePluginRootFrom(startDir) {
  let dir = startDir;
  let nearest = null;
  for (let i2 = 0; i2 < 8; i2++) {
    for (const cand of [path3.join(dir, "plugin"), dir]) {
      if (!kernelAnchorExists(cand)) continue;
      if (nearest === null) nearest = cand;
      if (isPluginSourceCheckout(cand)) return cand;
    }
    const parent = path3.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return nearest;
}
function isPluginSourceCheckout(root = resolvePluginRoot()) {
  if (!root) return false;
  return fs3.existsSync(path3.join(path3.dirname(root), "packages", "quay", "src"));
}
var KERNEL_RELS;
var init_plugin_root = __esm({
  "packages/quay/src/plugin-root.ts"() {
    KERNEL_RELS = [
      path3.join("scripts", "driver-runtime.ts"),
      path3.join("scripts", "dist", "driver-runtime.js")
    ];
  }
});

// packages/quay/src/config.ts
import fs4 from "node:fs";
import path4 from "node:path";
function findConfig(startDir = process.cwd()) {
  let dir = startDir;
  for (; ; ) {
    const candidate = path4.join(dir, ".quay", "config.yml");
    if (fs4.existsSync(candidate)) return candidate;
    const parent = path4.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
function hasMcpEntry(entry) {
  return Array.isArray(entry?.mcp_entry) && entry.mcp_entry.length > 0;
}
function resolveProviderEntry(providerId, entry, pluginRoot = resolvePluginRoot()) {
  if (providerId !== "native") {
    return { entry, mcpEntry: hasMcpEntry(entry) ? entry.mcp_entry : null, unresolvable: false };
  }
  if (!pluginRoot) {
    return { entry, mcpEntry: hasMcpEntry(entry) ? entry.mcp_entry : null, unresolvable: !hasMcpEntry(entry) };
  }
  const dir = path4.join(pluginRoot, "vendor", "quay-native");
  const out = { ...entry };
  if (typeof out.path !== "string" || out.path === "") out.path = dir;
  if (!hasMcpEntry(out)) {
    out.mcp_entry = ["node", path4.join(dir, "dist", "quay-native.js"), "mcp"];
  }
  return { entry: out, mcpEntry: out.mcp_entry, unresolvable: false };
}
var import_yaml, NATIVE_PROVIDER_UNRESOLVABLE;
var init_config = __esm({
  "packages/quay/src/config.ts"() {
    import_yaml = __toESM(require_dist(), 1);
    init_plugin_root();
    NATIVE_PROVIDER_UNRESOLVABLE = "native-provider-unresolvable";
  }
});

// packages/quay/src/kernel/gate-run-options.ts
function shQuote(arg) {
  return `'${String(arg).replaceAll("'", `'\\''`)}'`;
}
function resolveAcceptanceTimeoutMs(gateConfig = {}) {
  const envTimeout = Number(process.env.QUAY_ACCEPTANCE_TIMEOUT_MS);
  if (Number.isFinite(envTimeout) && envTimeout > 0) return envTimeout;
  const cfgTimeout = gateConfig.timeoutMs;
  return typeof cfgTimeout === "number" && cfgTimeout > 0 ? cfgTimeout : DEFAULT_ACCEPTANCE_TIMEOUT_MS;
}
function resolveRunnerOptions(gateConfig = {}) {
  const cwd = process.env.QUAY_ACCEPTANCE_CWD || gateConfig.cwd || process.cwd();
  const timeoutMs = resolveAcceptanceTimeoutMs(gateConfig);
  const envFile = process.env.QUAY_ACCEPTANCE_ENV || void 0;
  return { cwd, timeoutMs, envFile };
}
var DEFAULT_ACCEPTANCE_TIMEOUT_MS;
var init_gate_run_options = __esm({
  "packages/quay/src/kernel/gate-run-options.ts"() {
    DEFAULT_ACCEPTANCE_TIMEOUT_MS = 6e4;
  }
});

// packages/quay/src/gate/acceptance-runner.ts
import { spawnSync } from "node:child_process";
import fs5 from "node:fs";
import path5 from "node:path";
function verdictFromAcceptance(r) {
  if (r.ok) return { verdict: "pass", cause: null, reason: r.reason };
  const cause = r.timedOut ? "timeout" : r.code === null ? "spawn" : NOT_RUNNABLE_EXIT_CODES.has(r.code) ? "not-runnable" : r.code === 3 ? "declared" : null;
  if (cause === null) return { verdict: "fail", cause: null, reason: r.reason };
  return {
    verdict: "not-evaluated",
    cause,
    reason: `not-evaluated (${cause}): ${r.reason}`.slice(0, FAILURE_REASON_MAX_CHARS)
  };
}
function resolveAcceptanceTimeout(recordTimeoutMs, env = process.env) {
  if (typeof recordTimeoutMs === "number" && Number.isFinite(recordTimeoutMs) && recordTimeoutMs > 0) {
    return { timeoutMs: recordTimeoutMs, source: "record" };
  }
  const raw = env[ACCEPTANCE_TIMEOUT_ENV];
  const n = raw === void 0 ? NaN : Number(String(raw).trim());
  if (Number.isFinite(n) && n > 0) return { timeoutMs: n, source: "env" };
  return { timeoutMs: DEFAULT_ACCEPTANCE_TIMEOUT_MS, source: "default" };
}
function timeoutKnobHint(t) {
  switch (t.source) {
    case "record":
      return "raise this record's `timeoutMs` (the deadline in force)";
    case "env":
      return `raise ${ACCEPTANCE_TIMEOUT_ENV}`;
    default:
      return `set the record's \`timeoutMs\` or ${ACCEPTANCE_TIMEOUT_ENV}`;
  }
}
function gateCostName(command, fallback = "acceptance") {
  const m = String(command).match(/[\w.-]+\.(?:sh|ts|mjs)\b/);
  return m ? m[0] : fallback;
}
function gateLoadAvg() {
  try {
    const v = Number(String(fs5.readFileSync("/proc/loadavg", "utf8")).trim().split(/\s+/)[0]);
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}
function recordGateCost(cwd, name, ms, exit) {
  if (process.env.QUAY_COST_LEDGER !== "1") return;
  try {
    const ledger = path5.join(cwd, ".quay", "checker-cost.jsonl");
    if (!fs5.existsSync(path5.dirname(ledger))) return;
    const rec = {
      name,
      ms,
      n: 0,
      load: gateLoadAvg(),
      exit: exit ?? -1,
      ts: (/* @__PURE__ */ new Date()).toISOString()
    };
    fs5.appendFileSync(ledger, JSON.stringify(rec) + "\n", "utf8");
  } catch {
  }
}
function flattenOutput(text) {
  return text.replace(/\s+/g, " ").trim();
}
function boundedExcerpt(text, source, budget, head) {
  if (text.length <= budget) return text;
  const marker = `[truncated, ${text.length} chars of ${source} omitted]`;
  const keep = Math.max(0, budget - marker.length - 3);
  return head ? `${text.slice(0, keep)} \u2026 ${marker}` : `\u2026 ${marker} ${text.slice(text.length - keep)}`;
}
function withFailureOutput(prefix, r) {
  const errText = flattenOutput(String(r.stderr ?? ""));
  const outText = flattenOutput(String(r.stdout ?? ""));
  const sep = " \u2014 ";
  const budget = FAILURE_REASON_MAX_CHARS - prefix.length - sep.length;
  if (budget <= 0) return prefix.slice(0, FAILURE_REASON_MAX_CHARS);
  const body = errText ? boundedExcerpt(errText, "stderr", budget, true) : outText ? boundedExcerpt(outText, "stdout", budget, false) : "criterion wrote no output to stderr/stdout";
  return prefix + sep + body;
}
function runAcceptance({ command, cwd, timeoutMs = DEFAULT_ACCEPTANCE_TIMEOUT_MS, envFile, name, timeoutKnob }) {
  if (envFile !== void 0 && !fs5.existsSync(envFile)) {
    return {
      ok: false,
      code: null,
      signal: null,
      timedOut: false,
      reason: `acceptance_env file not found: ${envFile}`
    };
  }
  const shellCmd = envFile ? `. ${shQuote(envFile)} && ${command}` : command;
  const costName = name ?? gateCostName(command);
  const startedMs = Date.now();
  const r = spawnSync(shellCmd, {
    cwd,
    shell: true,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  recordGateCost(cwd, costName, Date.now() - startedMs, r.status);
  if (r.error && r.error.code === "ETIMEDOUT") {
    return {
      ok: false,
      code: null,
      signal: "SIGKILL",
      timedOut: true,
      // DIR-046-C: name the actual knob to raise, not just the fact of the
      // timeout — this is the exact discoverability gap session 8b74052c hit
      // (the user spent ~15min grepping installed source for the env var).
      // ⛔ `timeoutKnob` is per-CALLER-PATH: the default wording is the task
      // gate's, and a goal caller passes its own (see the field's doc comment).
      reason: `acceptance timed out after ${timeoutMs}ms (killed) \u2014 ${timeoutKnob ?? "raise gates.yml timeoutMs / --timeout"}`
    };
  }
  if (r.error) {
    return {
      ok: false,
      code: null,
      signal: r.signal ?? null,
      timedOut: false,
      reason: `acceptance failed to spawn: ${r.error.message}`
    };
  }
  const ok = r.status === 0;
  return {
    ok,
    code: r.status,
    signal: r.signal ?? null,
    timedOut: false,
    reason: ok ? "acceptance passed (exit 0)" : withFailureOutput(
      `acceptance failed (exit ${r.status}${r.signal ? `, signal ${r.signal}` : ""})`,
      r
    )
  };
}
var NOT_RUNNABLE_EXIT_CODES, ACCEPTANCE_TIMEOUT_ENV, FAILURE_REASON_MAX_CHARS;
var init_acceptance_runner = __esm({
  "packages/quay/src/gate/acceptance-runner.ts"() {
    init_gate_run_options();
    NOT_RUNNABLE_EXIT_CODES = /* @__PURE__ */ new Set([126, 127]);
    ACCEPTANCE_TIMEOUT_ENV = "QUAY_ACCEPTANCE_TIMEOUT_MS";
    FAILURE_REASON_MAX_CHARS = 500;
  }
});

// packages/quay/src/gate/dark-axis-record.ts
function isBlockContinuation(line) {
  return /^\s+\S/.test(line);
}
function numbersIn(text) {
  const out = [];
  const re = /-?\d+(?:\.\d+)?/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(Number(m[0]));
  return out;
}
function measurementNumbers(blockLines) {
  const out = [];
  for (const line of blockLines) {
    const probe = new RegExp(NUMERIC_MEASUREMENT_RE.source, "g");
    let m;
    while ((m = probe.exec(line)) !== null) {
      for (const n of numbersIn(m[2])) out.push(n);
      if (m[0].length === 0) probe.lastIndex++;
    }
  }
  return out;
}
function findDisclaimer(lines) {
  for (let i2 = 0; i2 < lines.length; i2++) {
    const line = lines[i2];
    if (!DISCLAIM_ZH_RE.test(line) && !DISCLAIM_EN_RE.test(line)) continue;
    const candidates = [line];
    for (let j = i2 + 1; j < lines.length && j <= i2 + 1; j++) {
      if (lines[j].trim() !== "") candidates.push(lines[j]);
    }
    for (const c of candidates) {
      const zh = c.match(REASON_ZH_RE);
      const en = c.match(REASON_EN_RE);
      const reason = zh ? zh[1] : en ? en[1] : null;
      if (reason && reason.trim() !== "") {
        return { line: i2 + 1, text: line.trim(), reason: reason.trim() };
      }
    }
  }
  return null;
}
function classifyDarkAxisRecord(body) {
  if (typeof body !== "string") {
    return {
      state: "NOT-EVALUATED",
      readings: [],
      disclaimer: null,
      reason: "NOT-EVALUATED \u2014 the task carries no readable body (typeof body !== string). An unreadable input is neither evidence of a record nor evidence of its absence (\u786C\u89C4\u5219 3b)."
    };
  }
  const lines = body.split("\n");
  const readings = [];
  for (let i2 = 0; i2 < lines.length; i2++) {
    const m = AXIS_AT_LINE_START_RE.exec(lines[i2]);
    if (!m) continue;
    const block = [lines[i2]];
    for (let j = i2 + 1; j < lines.length && isBlockContinuation(lines[j]); j++) block.push(lines[j]);
    const numbers = measurementNumbers(block);
    if (numbers.length === 0) continue;
    readings.push({ axis: m[1], line: i2 + 1, numbers, text: lines[i2].trim() });
  }
  const disclaimer = findDisclaimer(lines);
  const substantive = readings.filter((r) => r.axis === "L_D" || r.axis === "L_G");
  if (substantive.length > 0) {
    const shown = substantive.map((r) => `${r.axis}(line ${r.line})=[${r.numbers.join(", ")}]`).join(" ");
    return {
      state: "RECORDED",
      readings,
      disclaimer,
      reason: `RECORDED \u2014 ${substantive.length} L_D/L_G reading(s) with concrete quantities: ${shown}`
    };
  }
  if (disclaimer) {
    return {
      state: "DISCLAIMED",
      readings,
      disclaimer,
      reason: `DISCLAIMED \u2014 explicit declaration at line ${disclaimer.line}: "${disclaimer.text}" (\u7406\u7531: ${disclaimer.reason})`
    };
  }
  const otherAxes = readings.length > 0 ? ` (found only non-L_D/L_G reading(s): ${readings.map((r) => r.axis).join(", ")})` : "";
  return {
    state: "MISSING",
    readings,
    disclaimer: null,
    reason: `MISSING \u2014 the task body records no L_D/L_G reading (a numeric quantity at an axis-anchored line) and carries no explicit "\u8BE5\u8F74\u4ECD\u6697,\u7406\u7531:<...>" declaration${otherAxes}. ADR-007 requires one or the other before the task may be called done.`
  };
}
function darkAxisGateCheck(task) {
  const verdict2 = classifyDarkAxisRecord(task?.body);
  return {
    ok: verdict2.state === "RECORDED" || verdict2.state === "DISCLAIMED",
    reason: `dark-axis (ADR-007 per-milestone predicate): ${verdict2.reason}`
  };
}
var LINE_PREFIX, AXIS_AT_LINE_START_RE, KEY, VALUE, NUMERIC_MEASUREMENT_RE, DISCLAIM_ZH_RE, DISCLAIM_EN_RE, REASON_ZH_RE, REASON_EN_RE;
var init_dark_axis_record = __esm({
  "packages/quay/src/gate/dark-axis-record.ts"() {
    LINE_PREFIX = "^(?:\\s*(?:[-*+]\\s+(?:\\[[ xX]\\]\\s*)?|\\d+\\.\\s+(?:\\[[ xX]\\]\\s*)?|>\\s*))?(?:\\*\\*)?\\s*";
    AXIS_AT_LINE_START_RE = new RegExp(`${LINE_PREFIX}(L_[DGS])(?![A-Za-z0-9_])`);
    KEY = "[^\\s=\uFF1A]{0,39}[A-Za-z\\u4e00-\\u9fff][^\\s=\uFF1A]{0,39}";
    VALUE = "-?\\d+(?:\\.\\d+)?(?:\\s*[:\uFF1A/]\\s*\\d+(?:\\.\\d+)?)?";
    NUMERIC_MEASUREMENT_RE = new RegExp(`(?:^|[\\s(\uFF08[\uFF0C,;\uFF1B])(${KEY})\\s*[=:\uFF1A]\\s*(${VALUE})`);
    DISCLAIM_ZH_RE = new RegExp(`${LINE_PREFIX}(?:L_[DGS]\\s*[\uFF1A:=]?\\s*)?\u8BE5\u8F74\u4ECD\u6697`);
    DISCLAIM_EN_RE = new RegExp(`${LINE_PREFIX}(?:L_[DGS]\\s*[\uFF1A:=]?\\s*)?axis\\s+still\\s+dark\\b`, "i");
    REASON_ZH_RE = /理由\s*[：:]\s*(\S.*)$/;
    REASON_EN_RE = /\breason\s*[：:]\s*(\S.*)$/i;
  }
});

// packages/quay/src/frontmatter-store-base.ts
import fs6 from "node:fs";
import path6 from "node:path";
function parseFrontmatter(raw) {
  const m = FRONTMATTER_RE.exec(raw);
  if (!m) throw new Error("malformed file: missing YAML frontmatter block");
  return { frontmatter: import_yaml2.default.parse(m[1]) ?? {}, body: m[2] ?? "" };
}
function serializeFrontmatter(frontmatter, body) {
  return `---
${import_yaml2.default.stringify(frontmatter).trimEnd()}
---
${body}`;
}
function makeAssertSafeStatus(kind, validStatuses) {
  return function assertSafeStatus(status) {
    if (status !== void 0 && !validStatuses.includes(status)) {
      throw new Error(`invalid ${kind} status "${status}" \u2014 must be one of ${validStatuses.join(", ")}`);
    }
  };
}
function makeAssertSafeId(kind, idRe, expected) {
  const allowed = Array.isArray(idRe) ? idRe : [idRe];
  return function assertSafeId(id) {
    if (typeof id !== "string" || !allowed.some((re) => re.test(id))) {
      throw new Error(`invalid ${kind} id ${JSON.stringify(id)}: must match ${expected}`);
    }
    return id;
  };
}
function slugify(title, fallback = "adr") {
  return String(title || "").trim().toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/^-+|-+$/g, "") || fallback;
}
function fileNameForId(dir, id) {
  const files = fs6.readdirSync(dir).filter((f) => f.endsWith(".md"));
  return files.find((f) => f === `${id}.md` || f.startsWith(`${id}-`)) ?? null;
}
function withFileLock(dir, id, fn) {
  const lockPath = path6.join(dir, `${id}.lock`);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  for (; ; ) {
    try {
      const fd = fs6.openSync(lockPath, "wx");
      fs6.writeSync(fd, String(process.pid));
      fs6.closeSync(fd);
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      try {
        const stat = fs6.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > STALE_LOCK_MS) {
          fs6.rmSync(lockPath, { force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() > deadline) throw new Error(`timed out acquiring lock for ${id} in ${dir}`);
    }
  }
  try {
    return fn();
  } finally {
    fs6.rmSync(lockPath, { force: true });
  }
}
var import_yaml2, FRONTMATTER_RE, STALE_LOCK_MS, LOCK_TIMEOUT_MS;
var init_frontmatter_store_base = __esm({
  "packages/quay/src/frontmatter-store-base.ts"() {
    import_yaml2 = __toESM(require_dist(), 1);
    FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
    STALE_LOCK_MS = 5e3;
    LOCK_TIMEOUT_MS = 3e3;
  }
});

// packages/quay/src/store-commit.ts
import fs7 from "node:fs";
import path7 from "node:path";
import { execFileSync as execFileSync3 } from "node:child_process";
function storeCommitMessage(parts) {
  const actor = parts.actor !== void 0 && parts.actor.trim() !== "" ? ` by ${parts.actor.trim()}` : "";
  return `${parts.kind}: ${parts.id} ${parts.action}${actor}`;
}
function resolveCommitActor(actor) {
  if (actor !== void 0 && actor.trim() !== "") return actor.trim();
  const env = process.env.QUAY_STORE_COMMIT_ACTOR;
  if (env !== void 0 && env.trim() !== "") return env.trim();
  return `cli:${process.pid}`;
}
function gitOut(root, args, trim = true) {
  try {
    const out = execFileSync3("git", ["-C", root, ...args], {
      stdio: ["ignore", "pipe", "ignore"]
    }).toString();
    return trim ? out.trim() : out;
  } catch {
    return null;
  }
}
function gitOk(root, args) {
  try {
    execFileSync3("git", ["-C", root, ...args], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
function resolveGitRoot(dir) {
  try {
    const out = execFileSync3("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
      stdio: ["ignore", "pipe", "ignore"]
    }).toString().trim();
    return out || null;
  } catch {
    return null;
  }
}
function commitStoreWrite(opts) {
  const { relPath, kind, id, action, actor, propagate = "none", skipIf } = opts;
  const root = opts.root === void 0 ? resolveGitRoot(process.cwd()) : opts.root;
  if (!root) return { outcome: "not-in-git", propagated: false };
  if (gitOut(root, ["rev-parse", "--is-inside-work-tree"]) !== "true") {
    return { outcome: "not-in-git", propagated: false };
  }
  const abs = path7.join(root, relPath);
  const head = gitOut(root, ["show", `HEAD:${relPath}`], false);
  const workExists = fs7.existsSync(abs);
  if (head !== null && workExists) {
    const work = fs7.readFileSync(abs, "utf8");
    const unchanged = skipIf ? skipIf(head, work) : byteIdentical(head, work);
    if (unchanged) {
      gitOk(root, ["checkout", "HEAD", "--", relPath]);
      return { outcome: "unchanged", propagated: false };
    }
  }
  const message = storeCommitMessage({ kind, id, action, actor: resolveCommitActor(actor) });
  if (!gitOk(root, ["add", "--", relPath])) return { outcome: "failed", propagated: false };
  if (!gitOk(root, ["commit", "--no-verify", "-m", message, "--", relPath])) {
    return { outcome: "failed", propagated: false };
  }
  let propagated = false;
  if (propagate === "develop") {
    const branch = gitOut(root, ["branch", "--show-current"]);
    if (branch) propagated = gitOk(root, ["push", ".", `${branch}:develop`]);
  }
  return { outcome: "committed", propagated };
}
function commitStoreBatch(opts) {
  const { relPaths, kind, id, action, actor, propagate = "none" } = opts;
  const root = opts.root === void 0 ? resolveGitRoot(process.cwd()) : opts.root;
  if (!root) return "not-in-git";
  if (gitOut(root, ["rev-parse", "--is-inside-work-tree"]) !== "true") return "not-in-git";
  if (relPaths.length === 0) return "unchanged";
  if (!gitOk(root, ["add", "--", ...relPaths])) return "failed";
  const staged = gitOut(root, ["diff", "--cached", "--name-only"]);
  if (staged === null || staged === "") return "unchanged";
  const message = storeCommitMessage({ kind, id, action, actor: resolveCommitActor(actor) });
  if (!gitOk(root, ["commit", "--no-verify", "-m", message, "--", ...relPaths])) return "failed";
  if (propagate === "develop") {
    const branch = gitOut(root, ["branch", "--show-current"]);
    if (branch) gitOk(root, ["push", ".", `${branch}:develop`]);
  }
  return "committed";
}
var byteIdentical;
var init_store_commit = __esm({
  "packages/quay/src/store-commit.ts"() {
    byteIdentical = (head, work) => head === work;
  }
});

// packages/quay/src/document-store.ts
import fs8 from "node:fs";
import path8 from "node:path";
function createDocumentStore(docDir) {
  fs8.mkdirSync(docDir, { recursive: true });
  const assertSafeId = makeAssertSafeId("document", DOCUMENT_ID_RE, "DOC-NNN (>=3 digits)");
  const assertSafeStatus = makeAssertSafeStatus("document", VALID_DOCUMENT_STATUSES);
  function toViewModel(frontmatter, body, updatedAt) {
    const vm = {
      id: frontmatter.id,
      title: frontmatter.title,
      status: frontmatter.status,
      kind: frontmatter.kind,
      contracts: frontmatter.contracts ?? [],
      body
    };
    if (updatedAt !== void 0) vm.updatedAt = updatedAt;
    return vm;
  }
  function get(id) {
    assertSafeId(id);
    const file = fileNameForId(docDir, id);
    if (!file) return null;
    const p = path8.join(docDir, file);
    const { frontmatter, body } = parseFrontmatter(fs8.readFileSync(p, "utf8"));
    let updatedAt;
    try {
      updatedAt = fs8.statSync(p).mtimeMs;
    } catch {
    }
    return toViewModel(frontmatter, body, updatedAt);
  }
  function listWithMalformed(filter = {}) {
    const malformed = [];
    const items = [];
    for (const f of fs8.readdirSync(docDir)) {
      if (!(f.endsWith(".md") && f.startsWith("DOC-"))) continue;
      const p = path8.join(docDir, f);
      const raw = fs8.readFileSync(p, "utf8");
      let parsed = null;
      try {
        parsed = parseFrontmatter(raw);
      } catch (err) {
        malformed.push({ file: f, error: err.message });
      }
      if (!parsed) continue;
      let updatedAt;
      try {
        updatedAt = fs8.statSync(p).mtimeMs;
      } catch {
      }
      items.push(toViewModel(parsed.frontmatter, parsed.body, updatedAt));
    }
    return {
      items: items.filter((d) => filter.status ? d.status === filter.status : true).filter((d) => filter.kind ? d.kind === filter.kind : true).sort((a, b) => String(a.id).localeCompare(String(b.id))),
      malformed
    };
  }
  function list(filter = {}) {
    return listWithMalformed(filter).items;
  }
  function write(id, { title, status, kind, contracts, body }) {
    assertSafeId(id);
    assertSafeStatus(status);
    return withFileLock(docDir, id, () => {
      const existingFile = fileNameForId(docDir, id);
      let frontmatter = {};
      let existingBody = "";
      if (existingFile) {
        const parsed = parseFrontmatter(fs8.readFileSync(path8.join(docDir, existingFile), "utf8"));
        frontmatter = { ...parsed.frontmatter };
        existingBody = parsed.body;
      }
      frontmatter.id = id;
      if (title !== void 0) frontmatter.title = title;
      const prevStatus = typeof frontmatter.status === "string" ? frontmatter.status : void 0;
      frontmatter.status = status ?? frontmatter.status ?? "draft";
      if (kind !== void 0) frontmatter.kind = kind;
      if (contracts !== void 0) frontmatter.contracts = contracts;
      const ordered = {};
      for (const k of ["id", "title", "status", "kind", "contracts"]) {
        if (frontmatter[k] !== void 0) ordered[k] = frontmatter[k];
      }
      for (const k of Object.keys(frontmatter)) {
        if (!OWNED_KEYS.has(k)) ordered[k] = frontmatter[k];
      }
      const finalBody = body !== void 0 ? body : existingBody;
      const fileName = existingFile ?? `${id}-${slugify(title, "doc")}.md`;
      fs8.writeFileSync(path8.join(docDir, fileName), serializeFrontmatter(ordered, finalBody), "utf8");
      const action = !existingFile ? "create" : prevStatus !== void 0 && prevStatus !== frontmatter.status ? `status ${prevStatus}\u2192${frontmatter.status}` : "update";
      commitDocFile(docDir, fileName, id, action);
      return get(id);
    });
  }
  return { list, listWithMalformed, get, write };
}
function commitDocFile(docDir, fileName, id, action) {
  const root = resolveGitRoot(docDir);
  return commitStoreWrite({
    relPath: root ? path8.relative(root, path8.join(docDir, fileName)) : `docs-managed/${fileName}`,
    kind: "docs-managed",
    id,
    action,
    root,
    propagate: "none"
  }).outcome;
}
var VALID_DOCUMENT_STATUSES, DOCUMENT_ID_RE, OWNED_KEYS;
var init_document_store = __esm({
  "packages/quay/src/document-store.ts"() {
    init_frontmatter_store_base();
    init_store_commit();
    VALID_DOCUMENT_STATUSES = ["draft", "active", "retired"];
    DOCUMENT_ID_RE = /^DOC-\d{3,}$/;
    OWNED_KEYS = /* @__PURE__ */ new Set(["id", "title", "status", "kind", "contracts"]);
  }
});

// packages/quay/src/contract-validator.ts
function evaluateOne(entry, body) {
  const { target, type, pattern, description } = entry ?? {};
  const base = { pattern, type, description };
  if (target !== "self") {
    return { ...base, ok: false, reason: `unsupported contract target ${JSON.stringify(target)} \u2014 only "self" is supported` };
  }
  if (type !== "grep" && type !== "not-grep") {
    return { ...base, ok: false, reason: `unknown contract type ${JSON.stringify(type)} \u2014 must be "grep" or "not-grep"` };
  }
  if (typeof pattern !== "string" || pattern === "") {
    return { ...base, ok: false, reason: "malformed contract entry: missing (or empty) `pattern`" };
  }
  const present = String(body ?? "").includes(pattern);
  const ok = type === "grep" ? present : !present;
  return { ...base, ok };
}
function validateContracts(doc) {
  const contracts = doc?.contracts;
  if (contracts === void 0) {
    return { ok: true, results: [] };
  }
  if (!Array.isArray(contracts)) {
    return { ok: false, results: [{ ok: false, reason: "contracts must be an array" }] };
  }
  const results = contracts.map((entry) => evaluateOne(entry, doc?.body));
  return { ok: results.every((r) => r.ok), results };
}
var init_contract_validator = __esm({
  "packages/quay/src/contract-validator.ts"() {
  }
});

// packages/quay/src/gate/factories/document-contract.ts
function makeDocumentContractGate(docId, docDir) {
  return async (_task) => {
    const store = createDocumentStore(docDir);
    const doc = store.get(docId);
    if (!doc) {
      return { ok: false, reason: `no such document: ${docId}` };
    }
    if (!Array.isArray(doc.contracts) || doc.contracts.length === 0) {
      return {
        ok: false,
        reason: `${docId} has no contracts defined (set its \`contracts:\` frontmatter field to a non-empty list of self-checks)`
      };
    }
    const { ok, results } = validateContracts(doc);
    if (ok) return { ok: true, reason: `all ${results.length} contract(s) passed` };
    const failed = results.filter((r) => !r.ok);
    const reason = failed.map((r) => r.reason ?? `pattern ${JSON.stringify(r.pattern)} (${r.type}) failed`).join("; ");
    return { ok: false, reason };
  };
}
var init_document_contract = __esm({
  "packages/quay/src/gate/factories/document-contract.ts"() {
    init_document_store();
    init_contract_validator();
  }
});

// packages/quay/src/gate/gate-event-store.ts
var gate_event_store_exports = {};
__export(gate_event_store_exports, {
  appendGateEvent: () => appendGateEvent,
  queryGateEvents: () => queryGateEvents
});
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
function appendGateEvent(logPath, event) {
  const dir = dirname(logPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  appendFileSync(logPath, JSON.stringify(event) + "\n");
}
function queryGateEvents(logPath, filter = {}) {
  if (!existsSync(logPath)) return [];
  const events = readFileSync(logPath, "utf8").split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line));
  const filtered = events.filter((event) => {
    if (filter.pipeline_id !== void 0 && event.pipeline_id !== filter.pipeline_id) return false;
    if (filter.gate !== void 0 && event.gate !== filter.gate) return false;
    if (filter.actor !== void 0 && event.actor !== filter.actor) return false;
    if (filter.since !== void 0 && event.timestamp < filter.since) return false;
    if (filter.until !== void 0 && event.timestamp > filter.until) return false;
    return true;
  });
  const offset = filter.offset ?? 0;
  const page = filtered.slice(offset);
  return filter.limit !== void 0 ? page.slice(0, filter.limit) : page;
}
var init_gate_event_store = __esm({
  "packages/quay/src/gate/gate-event-store.ts"() {
  }
});

// packages/quay/src/kernel/verdict-parse.ts
function parseBinaryVerdict(stdout, exitCode, positive, negative) {
  if (exitCode !== 0) return "not-evaluated";
  const text = (stdout ?? "").trim();
  if (text === positive || text === negative) return text;
  const candidates = [text, ...text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).reverse()];
  for (const cand of candidates) {
    try {
      const obj = JSON.parse(cand);
      if (obj && typeof obj === "object" && (obj.verdict === positive || obj.verdict === negative)) {
        return obj.verdict;
      }
    } catch {
    }
  }
  return "not-evaluated";
}
var init_verdict_parse = __esm({
  "packages/quay/src/kernel/verdict-parse.ts"() {
  }
});

// packages/quay/src/criterion-fidelity.ts
import fs9 from "node:fs";
import path9 from "node:path";
function parseFidelityVerdict(stdout, exitCode) {
  return parseBinaryVerdict(stdout, exitCode, "faithful", "vacuous");
}
function scanSurfaceTopSegments(mechanism) {
  const segs = /* @__PURE__ */ new Set();
  const re = /["']([A-Za-z0-9_.-]+\/[A-Za-z0-9_.\-/]+)["']/g;
  let m;
  while ((m = re.exec(mechanism)) !== null) {
    const first = m[1].split("/")[0];
    if (first.startsWith(".")) continue;
    segs.add(first);
  }
  return segs;
}
function regexBodies(mechanism) {
  const bodies = [];
  const re = /new\s+RegExp\s*\(\s*(`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g;
  let m;
  while ((m = re.exec(mechanism)) !== null) bodies.push(m[1]);
  return bodies.join("\n");
}
function mechanicalFidelityVerdict(expect, mechanism) {
  if (!mechanism || mechanism.trim() === "") return null;
  if (!TOTALITY_CLAIM_RE.test(expect)) return null;
  const segs = scanSurfaceTopSegments(mechanism);
  if (segs.size === 0) return null;
  const bodies = regexBodies(mechanism);
  const gaps = [...segs].filter((s) => !bodies.includes(s));
  return gaps.length > 0 ? "vacuous" : "faithful";
}
function readMechanismFromCriterion(criterion, root) {
  if (!root) return null;
  const relPaths = /* @__PURE__ */ new Set();
  const re = /([A-Za-z0-9_.-]+(?:[/\\][A-Za-z0-9_.-]+)+\.(?:ts|mjs|js|cjs|sh))/g;
  let m;
  while ((m = re.exec(criterion)) !== null) relPaths.add(m[1]);
  if (relPaths.size === 0) return null;
  const parts = [];
  for (const rel of relPaths) {
    try {
      parts.push(`/* --- ${rel} --- */
${fs9.readFileSync(path9.join(root, rel), "utf8")}`);
    } catch {
    }
  }
  return parts.length > 0 ? parts.join("\n") : null;
}
function buildFidelityPrompt(criterion, expect, opts = {}) {
  const lines = [
    "You are a criterion-fidelity judge in the quay repo. Decide whether this goal criterion CAN be false on the object its `expect` claims to measure \u2014 a real measurement, or vacuously true?"
  ];
  if (opts.root) lines.push(`Repo root: ${opts.root}.`);
  lines.push("## criterion (runnable command):", criterion, "## expect (claimed object):", expect);
  if (opts.mechanism !== void 0) {
    lines.push("## criterion's referenced mechanism (source):", opts.mechanism);
  } else {
    lines.push("You may read the files the criterion references in the repo to inspect its mechanism.");
  }
  lines.push(
    "## How to judge vacuousness (the decisive question)",
    "A criterion that claims completeness (e.g. its `expect` says the verdict is the checker's own mechanical enumeration, and that enumeration is complete over the claimed object category) is vacuous if the checker it invokes cannot flag the category it claims \u2014 the count it reports is a too-narrow-definition count.",
    "Concrete test: does the checker's SCAN SURFACE include a source directory (a top-level path segment such as `packages/`) whose path segment appears in NONE of the checker's pattern definitions (its RegExp bodies)? If a scanned directory's defining path segment is never referenced by any pattern, the checker cannot flag anchors within that directory, so a `0` count over that directory is vacuous for it.",
    "Few-shot NEGATIVE example (vacuous): a checker whose `expect` claims its enumeration is complete, but which scans a `packages/<pkg>/src` source tree while every RegExp only matches `path.join(__dirname, \u2026)` and never references `packages` \u2014 it can never flag a `packages/\u2026`-anchored module, so its completeness claim is false \u21D2 vacuous.",
    "Few-shot POSITIVE example (faithful): a checker scanning `packages/<pkg>/src` whose RegExp set DOES include a pattern referencing `packages` \u2014 it can flag the `packages/\u2026` anchor, so its `0` count can be false \u21D2 faithful."
  );
  lines.push(
    'Reply with EXACTLY one line of JSON and nothing else: {"verdict":"faithful"} if the criterion can be false on the claimed object, otherwise {"verdict":"vacuous"}.'
  );
  return lines.join("\n");
}
function criterionFidelityVerdict(criterion, expect, invokeJudge, opts = {}) {
  const mechanism = opts.mechanism ?? readMechanismFromCriterion(criterion, opts.root);
  const mechanical = mechanicalFidelityVerdict(expect, mechanism);
  if (mechanical !== null) {
    return {
      verdict: mechanical,
      reason: mechanical === "vacuous" ? "mechanical fidelity (no LLM): a scanned source directory's path segment appears in no pattern \u2014 coverage gap \u21D2 vacuous" : "mechanical fidelity (no LLM): every scanned source directory's path segment is covered by some pattern \u21D2 faithful"
    };
  }
  const prompt = buildFidelityPrompt(criterion, expect, opts);
  let res;
  try {
    res = invokeJudge(prompt);
  } catch (err) {
    return {
      verdict: "not-evaluated",
      reason: `fidelity judge threw: ${err instanceof Error ? err.message : String(err)}`
    };
  }
  const verdict2 = parseFidelityVerdict(res.stdout, res.exitCode);
  const reason = verdict2 === "not-evaluated" ? `fidelity judge unreadable (exit ${res.exitCode})` : `fidelity judge: ${verdict2}`;
  return { verdict: verdict2, reason };
}
var TOTALITY_CLAIM_RE;
var init_criterion_fidelity = __esm({
  "packages/quay/src/criterion-fidelity.ts"() {
    init_verdict_parse();
    TOTALITY_CLAIM_RE = /完整性由[^，。\n]*机械枚举|机械枚举|完整性由检查器|枚举为\s*0|枚举为\s*[0-9]+\s*处/;
  }
});

// packages/quay/src/abi.ts
var TASK_STATUSES, TASK_STATUS_SET, GOAL_STATUSES;
var init_abi = __esm({
  "packages/quay/src/abi.ts"() {
    TASK_STATUSES = ["todo", "ready", "done", "needs-human", "superseded"];
    TASK_STATUS_SET = new Set(TASK_STATUSES);
    GOAL_STATUSES = ["draft", "active", "achieved", "superseded", "retired", "needs-human"];
  }
});

// packages/quay/src/kernel/env-merge.ts
function mergeEnv(base, override) {
  const out = { ...base };
  for (const [k, v] of Object.entries(override)) {
    if (v === "") delete out[k];
    else out[k] = v;
  }
  return out;
}
var init_env_merge = __esm({
  "packages/quay/src/kernel/env-merge.ts"() {
  }
});

// packages/quay/src/worktree-namespace.ts
import fs10 from "node:fs";
import path10 from "node:path";
function readUnifiedConfig(rootAbs) {
  try {
    const raw = fs10.readFileSync(path10.join(rootAbs, ".quay", "config.yml"), "utf8");
    const parsed = import_yaml3.default.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function resolveWorktreeNamespace(root) {
  const rootAbs = path10.resolve(root);
  const fallbackDir = path10.join(path10.dirname(rootAbs), DEFAULT_WORKTREE_NAMESPACE_NAME);
  let config = null;
  let configExists = false;
  try {
    configExists = fs10.existsSync(path10.join(rootAbs, ".quay", "config.yml"));
  } catch {
    configExists = false;
  }
  if (configExists) config = readUnifiedConfig(rootAbs);
  const loop = config?.loop;
  const raw = loop && typeof loop === "object" && !Array.isArray(loop) ? loop.worktree_root : void 0;
  if (typeof raw === "string" && raw.trim()) {
    return { dir: path10.resolve(rootAbs, raw.trim()), source: "config", diagnostic: null };
  }
  const why = !configExists ? `no ${".quay/config.yml"} in ${rootAbs}` : config == null ? `${".quay/config.yml"} is unreadable or not a YAML mapping` : raw === void 0 ? `${".quay/config.yml"} has no loop.worktree_root` : `loop.worktree_root is not a non-empty string (${JSON.stringify(raw)})`;
  return {
    dir: fallbackDir,
    source: "fallback",
    diagnostic: `${why} \u2014 falling back to <parent-of-root>/${DEFAULT_WORKTREE_NAMESPACE_NAME} (${fallbackDir})`
  };
}
var import_yaml3, DEFAULT_WORKTREE_NAMESPACE_NAME;
var init_worktree_namespace = __esm({
  "packages/quay/src/worktree-namespace.ts"() {
    import_yaml3 = __toESM(require_dist(), 1);
    DEFAULT_WORKTREE_NAMESPACE_NAME = "quay-worktrees";
  }
});

// packages/quay/src/goal-store.ts
import fs11 from "node:fs";
import path11 from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync as spawnSync2 } from "node:child_process";
import { fileURLToPath as fileURLToPath3 } from "node:url";
function gitTreeSha(cwd) {
  const r = spawnSync2("git", ["-C", cwd, "rev-parse", "HEAD^{tree}"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"]
  });
  if (r.status !== 0 || typeof r.stdout !== "string") return null;
  const sha = r.stdout.trim();
  return sha === "" ? null : sha;
}
function evaluationContext(root) {
  let evaluationRoot = root;
  try {
    evaluationRoot = fs11.realpathSync(root);
  } catch {
  }
  return { evaluationRoot, treeSha: gitTreeSha(evaluationRoot) };
}
function goalCriterionWorktreeDir(root, goalId) {
  return path11.join(resolveWorktreeNamespace(root).dir, `${GOAL_CRITERION_WORKTREE_PREFIX}${goalId}`);
}
function resolveCriterionRoot(mainRoot, goal) {
  const id = typeof goal?.id === "string" ? goal.id : "";
  if (goal?.branch !== true || !isGoalId(id)) return { cwd: mainRoot, source: "main" };
  if (!goalBranchRefExists(mainRoot, id)) return { cwd: mainRoot, source: "main" };
  return { cwd: goalCriterionWorktreeDir(mainRoot, id), source: "goal-worktree" };
}
function buildCriterionRoots(mainRoot, goals) {
  const byGoal = /* @__PURE__ */ new Map();
  for (const g of goals) {
    const id = String(g.id ?? "");
    if (!isGoalId(id)) continue;
    byGoal.set(id, resolveCriterionRoot(mainRoot, g));
  }
  return byGoal;
}
function criterionCwdFor(mainRoot, byGoal, ac) {
  const gid = typeof ac.goal === "string" ? ac.goal : "";
  return byGoal.get(gid)?.cwd ?? mainRoot;
}
function criterionFingerprint(criterion) {
  const s = typeof criterion === "string" ? criterion : "";
  return createHash("sha256").update(s.replace(/\s+/g, " ").trim(), "utf8").digest("hex").slice(0, 16);
}
function gateTails(goalDir) {
  const last = /* @__PURE__ */ new Map();
  const lastSweep = /* @__PURE__ */ new Map();
  const logPath = path11.join(path11.dirname(goalDir), ".quay", "gate-events.jsonl");
  let events;
  try {
    events = queryGateEvents(logPath, { gate: "goal" });
  } catch {
    return { last, lastSweep };
  }
  for (const ev of events) {
    const id = String(ev.pipeline_id ?? ev.item_id ?? "");
    if (!id) continue;
    const payload = ev.payload ?? {};
    const row = {
      at: String(ev.timestamp ?? ""),
      verdict: String(ev.verdict ?? ""),
      actor: String(ev.actor ?? ""),
      reason: typeof payload.reason === "string" ? payload.reason : "",
      criterionHash: typeof payload.criterionHash === "string" ? payload.criterionHash : ""
    };
    last.set(id, row);
    if (row.actor === SWEEP_ACTOR || row.actor === AMEND_ACTOR) lastSweep.set(id, row);
  }
  return { last, lastSweep };
}
function ledgerEvidenceMap(goalDir) {
  const map = /* @__PURE__ */ new Map();
  const logPath = path11.join(path11.dirname(goalDir), ".quay", "gate-events.jsonl");
  let events;
  try {
    events = queryGateEvents(logPath, { gate: "goal" });
  } catch {
    return map;
  }
  for (const ev of events) {
    const id = String(ev.pipeline_id ?? ev.item_id ?? "");
    if (!id) continue;
    const reading = ev.payload && typeof ev.payload === "object" && typeof ev.payload.reason === "string" ? ev.payload.reason : void 0;
    const prev = map.get(id);
    map.set(id, { at: ev.timestamp, verdict: ev.verdict, reading, firstAt: prev?.firstAt ?? ev.timestamp });
  }
  return map;
}
function stalenessSignalPath(goalDir) {
  return path11.join(path11.dirname(goalDir), GOAL_STALENESS_SIGNAL_REL);
}
function appendGoalStalenessSignal(goalDir, rec) {
  const file = stalenessSignalPath(goalDir);
  try {
    fs11.mkdirSync(path11.dirname(file), { recursive: true });
    fs11.appendFileSync(file, JSON.stringify({ ts: rec.staleSince, event: "stale", ...rec }) + "\n", "utf8");
  } catch (err) {
    console.error(
      `goal-store: could not append the goal-staleness signal for ${rec.goalId} (${rec.triggeringAcId}) \u2014 the record was written but the divergence is NOT recorded: ${err.message}`
    );
  }
  return file;
}
function resolveGoalStaleness(goalDir, goalId, opts) {
  const n = readGoalStalenessIndex(goalDir).byGoal.get(goalId)?.length ?? 0;
  if (n === 0) return 0;
  const file = stalenessSignalPath(goalDir);
  try {
    fs11.mkdirSync(path11.dirname(file), { recursive: true });
    fs11.appendFileSync(
      file,
      JSON.stringify({
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        event: "resolved",
        goalId,
        actor: opts.actor,
        reason: opts.reason ?? ""
      }) + "\n",
      "utf8"
    );
  } catch (err) {
    console.error(
      `goal-store: could not append the goal-staleness RESOLUTION for ${goalId} \u2014 the reopen was written but the signal stays marked unresolved: ${err.message}`
    );
    return 0;
  }
  return n;
}
function readGoalStalenessIndex(goalDir) {
  const byGoal = /* @__PURE__ */ new Map();
  const file = stalenessSignalPath(goalDir);
  let raw;
  try {
    raw = fs11.readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { evaluated: true, byGoal };
    return { evaluated: false, reason: `${file}: ${err.message}`, byGoal };
  }
  for (const [i2, line] of raw.split("\n").entries()) {
    if (line.trim() === "") continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch (err) {
      return { evaluated: false, reason: `${file}:${i2 + 1}: unparseable JSON (${err.message})`, byGoal };
    }
    const goalId = typeof rec.goalId === "string" ? rec.goalId : "";
    if (goalId === "") {
      return { evaluated: false, reason: `${file}:${i2 + 1}: no goalId`, byGoal };
    }
    if (rec.event === "resolved") {
      byGoal.delete(goalId);
    } else if (rec.event === "stale") {
      const arr = byGoal.get(goalId) ?? [];
      arr.push({
        goalId,
        staleSince: String(rec.staleSince ?? rec.ts ?? ""),
        triggeringAcId: String(rec.triggeringAcId ?? ""),
        goalStatusAtTime: String(rec.goalStatusAtTime ?? "")
      });
      byGoal.set(goalId, arr);
    } else {
      return { evaluated: false, reason: `${file}:${i2 + 1}: unknown event ${JSON.stringify(rec.event)}`, byGoal };
    }
  }
  return { evaluated: true, byGoal };
}
function goalStatusOf(goalDir, goalId) {
  const file = fileNameForId(goalDir, goalId);
  if (!file) return null;
  try {
    const { frontmatter } = parseFrontmatter(fs11.readFileSync(path11.join(goalDir, file), "utf8"));
    return typeof frontmatter.status === "string" ? frontmatter.status : null;
  } catch {
    return null;
  }
}
function parseStaleMs(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value * 864e5;
  if (typeof value === "string") {
    const m = value.trim().match(/^(\d+(?:\.\d+)?)\s*(d|h|m)$/i);
    if (m) {
      const n = Number(m[1]);
      const unit = m[2].toLowerCase();
      const mult = unit === "d" ? 864e5 : unit === "h" ? 36e5 : 6e4;
      return n * mult;
    }
  }
  return null;
}
function readGoalConfig(workspaceRoot) {
  let cap = DEFAULT_GOAL_CAP;
  let staleMs = DEFAULT_STALE_MS;
  const cfgPath = path11.join(workspaceRoot, ".quay", "config.yml");
  if (fs11.existsSync(cfgPath)) {
    try {
      const parsed = import_yaml4.default.parse(fs11.readFileSync(cfgPath, "utf8"));
      const goals = parsed && typeof parsed === "object" ? parsed.goals : void 0;
      if (goals && typeof goals === "object") {
        const g = goals;
        if (typeof g.cap === "number" && Number.isFinite(g.cap) && g.cap >= 1) cap = g.cap;
        const sd = parseStaleMs(g.stale);
        if (sd !== null) staleMs = sd;
      }
    } catch {
    }
  }
  return { cap, staleMs };
}
function isGoalId(id) {
  return typeof id === "string" && GOAL_ID_RE.test(id);
}
function isCriterionId(id) {
  return typeof id === "string" && AC_ID_RE.test(id);
}
function hasTrailingComputedFailureExit(code) {
  const opener = new RegExp(EXIT_CALL_SRC, "g");
  let m;
  while ((m = opener.exec(code)) !== null) {
    let depth = 1;
    let i2 = m.index + m[0].length;
    let quote = null;
    for (; i2 < code.length; i2++) {
      const c = code[i2];
      if (quote !== null) {
        if (c === "\\" && quote !== "'") {
          i2++;
          continue;
        }
        if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"') {
        quote = c;
        continue;
      }
      if (c === "(") depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) continue;
    if (TRAILING_ELSE_NONZERO_RE.test(code.slice(m.index + m[0].length, i2))) return true;
  }
  return false;
}
function hasFailureExit(code) {
  return FAILURE_EXIT_RE.test(code) || hasTrailingComputedFailureExit(code);
}
function splitTopLevelSegments(stmt) {
  const segs = [];
  let start = 0;
  let quote = null;
  let depth = 0;
  const push = (end, nextOp) => {
    const text = stmt.slice(start, end);
    if (text.trim() !== "") segs.push({ text: text.trim(), start, end, nextOp });
  };
  for (let i2 = 0; i2 < stmt.length; i2++) {
    const c = stmt[i2];
    if (quote !== null) {
      if (c === "\\" && quote !== "'") {
        i2++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "\\") {
      i2++;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      continue;
    }
    if (c === "$" && stmt[i2 + 1] === "(") {
      depth++;
      i2++;
      continue;
    }
    if (c === "(") {
      depth++;
      continue;
    }
    if (c === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth !== 0) continue;
    if (c === "&" && stmt[i2 + 1] === "&") {
      push(i2, "&&");
      i2++;
      start = i2 + 1;
      continue;
    }
    if (c === "|" && stmt[i2 + 1] === "|") {
      push(i2, "||");
      i2++;
      start = i2 + 1;
      continue;
    }
    if (c === "|") {
      push(i2, "|");
      start = i2 + 1;
      continue;
    }
    if (c === ";") {
      push(i2, ";");
      start = i2 + 1;
      continue;
    }
  }
  push(stmt.length, null);
  return segs;
}
function isSilentOnFailureSegment(seg) {
  const s = seg.trim();
  if (s === "") return false;
  if (DEVNULL_BOTH_RE.test(s)) return true;
  if (DEVNULL_OUT_RE.test(s) && (DEVNULL_ERR_RE.test(s) || STDERR_FOLLOWS_STDOUT_RE.test(s))) return true;
  return SILENT_PREDICATE_RE.test(s);
}
function statusBearingStatement(criterion) {
  const logical = [];
  let text = "";
  let lineOf = [];
  const flush = () => {
    if (text.trim() !== "") logical.push({ text, lineOf });
    text = "";
    lineOf = [];
  };
  const rawLines = criterion.split("\n");
  for (let i2 = 0; i2 < rawLines.length; i2++) {
    const masked = maskValueStrings(maskHashComments(rawLines[i2]));
    const trimmed = masked.trim();
    const cont = trimmed.endsWith("\\");
    const piece = cont ? trimmed.slice(0, -1).trimEnd() : trimmed;
    if (piece === "" && !cont) {
      flush();
      continue;
    }
    if (text !== "") {
      text += " ";
      lineOf.push(i2 + 1);
    }
    const base = text.length;
    text += piece;
    for (let k = 0; k < piece.length; k++) lineOf[base + k] = i2 + 1;
    if (!cont) flush();
  }
  flush();
  return logical.length === 0 ? null : logical[logical.length - 1];
}
function maskHashComments(line) {
  let out = "";
  let quote = null;
  for (let i2 = 0; i2 < line.length; i2++) {
    const c = line[i2];
    if (quote !== null) {
      if (c === "\\" && quote !== "'") {
        out += c;
        if (i2 + 1 < line.length) out += line[++i2];
        continue;
      }
      if (c === quote) quote = null;
      out += c;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      quote = c;
      out += c;
      continue;
    }
    if (c === "#") break;
    out += c;
  }
  return out;
}
function maskValueStrings(line) {
  return line.replace(
    /([:=])([ \t]*)((?:"(?:[^"\\]|\\.)*")|(?:'(?:[^'\\]|\\.)*'))/g,
    (m, sep, gap, lit) => {
      if (lit.includes("$(") || lit.includes("`")) return m;
      return sep + gap + " ".repeat(lit.length);
    }
  );
}
function implicitFailureExitLines(criterion) {
  if (criterion.split("\n").some((l) => hasFailureExit(maskValueStrings(maskHashComments(l))))) return [];
  const stmt = statusBearingStatement(criterion);
  if (stmt === null) return [];
  if (/^exit\s+0\s*$/.test(stmt.text.trim())) return [];
  const out = [];
  const segs = splitTopLevelSegments(stmt.text);
  segs.forEach((s, idx) => {
    const isLast = idx === segs.length - 1;
    if (!(isLast || s.nextOp === "&&")) return;
    if (!isSilentOnFailureSegment(s.text)) return;
    let line = 0;
    for (let k = s.start; k >= 0; k--) {
      if (stmt.lineOf[k] !== void 0) {
        line = stmt.lineOf[k];
        break;
      }
    }
    out.push({ line, text: s.text, implicit: true });
  });
  return out;
}
function isBareFailureExitLine(line) {
  const code = maskValueStrings(maskHashComments(line));
  return hasFailureExit(code) && !ATTRIBUTION_RE.test(code);
}
function statementLeavesOpen(text) {
  let quote = null;
  let depth = 0;
  let ticks = 0;
  for (let i2 = 0; i2 < text.length; i2++) {
    const c = text[i2];
    if (quote !== null) {
      if (c === "\\" && quote !== "'") {
        i2++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "\\") {
      i2++;
      continue;
    }
    if (c === "'" || c === '"') {
      quote = c;
      continue;
    }
    if (c === "`") {
      ticks++;
      continue;
    }
    if (c === "$" && text[i2 + 1] === "(") {
      depth++;
      i2++;
      continue;
    }
    if (c === ")") depth = Math.max(0, depth - 1);
  }
  return quote !== null || depth !== 0 || ticks % 2 !== 0 || /\\\s*$/.test(text);
}
function errexitAbortSilentExits(criterion) {
  const out = [];
  const lines = criterion.split("\n");
  let errexit = false;
  let condPending = false;
  for (let i2 = 0; i2 < lines.length; i2++) {
    const code = maskHashComments(lines[i2]).trim();
    if (condPending) {
      if (CONDITION_END_RE.test(code)) condPending = false;
      continue;
    }
    if (code === "") continue;
    if (CONDITION_OPENER_RE.test(code)) {
      if (!CONDITION_END_RE.test(code)) condPending = true;
      continue;
    }
    if (ERREXIT_OFF_RE.test(code)) {
      errexit = false;
      continue;
    }
    if (ERREXIT_ON_RE.test(code)) {
      errexit = true;
      continue;
    }
    if (!errexit) continue;
    if (!ASSIGNMENT_PREFIX_RE.test(code)) continue;
    const startLine = i2 + 1;
    let stmt = code;
    while (statementLeavesOpen(stmt) && i2 + 1 < lines.length) {
      i2 += 1;
      stmt += "\n" + maskHashComments(lines[i2]);
    }
    const eq = code.indexOf("=");
    if (!CMD_SUBST_RE.test(code.slice(eq + 1))) continue;
    if (stmt.includes("||")) continue;
    out.push({ line: startLine, text: code, errexitAbort: true });
  }
  return out;
}
function bareFailureExitsOfCriterion(criterion) {
  const out = [];
  criterion.split("\n").forEach((line, i2) => {
    if (isBareFailureExitLine(line)) out.push({ line: i2 + 1, text: line.trim() });
  });
  if (out.length === 0) out.push(...implicitFailureExitLines(criterion));
  const already = new Set(out.map((b) => b.line));
  for (const b of errexitAbortSilentExits(criterion)) {
    if (!already.has(b.line)) out.push(b);
  }
  return out;
}
function evaluateCriterionAttribution(criterion) {
  if (typeof criterion !== "string") {
    return {
      evaluated: false,
      error: `criterion is not a string (got ${criterion === null ? "null" : typeof criterion}) \u2014 a criterion is the runnable command that verifies the record`,
      bare: []
    };
  }
  if (criterion.trim() === "") {
    return {
      evaluated: false,
      error: "criterion is empty (or whitespace-only) \u2014 there is nothing to judge, which is not the same as judging it clean",
      bare: []
    };
  }
  return { evaluated: true, bare: bareFailureExitsOfCriterion(criterion) };
}
function formatBareFailureExits(bare) {
  return bare.map((b) => {
    const kind = b.errexitAbort ? " (errexit abort \u2014 under `set -e` this assignment's command substitution ends the shell here, so the cause written below never runs; guard it with `|| true` or move it into a condition)" : b.implicit ? " (implicit \u2014 this command's status becomes the criterion's)" : "";
    return `line ${b.line}${kind}: ${b.text}`;
  }).join("; ");
}
function annotateGoalProgress(all) {
  const byGoal = /* @__PURE__ */ new Map();
  for (const g of all) {
    if (typeof g.goal !== "string") continue;
    const arr = byGoal.get(g.goal) ?? [];
    arr.push(g);
    byGoal.set(g.goal, arr);
  }
  for (const g of all) {
    if (!isGoalId(String(g.id))) continue;
    const acs = byGoal.get(String(g.id)) ?? [];
    let lastMs;
    let firstMs;
    let lastStr;
    let firstStr;
    for (const ac of acs) {
      const ev = ac.evidence;
      if (ev && typeof ev.at === "string") {
        const t = Date.parse(ev.at);
        if (!Number.isNaN(t) && (lastMs === void 0 || t > lastMs)) {
          lastMs = t;
          lastStr = ev.at;
        }
      }
      if (ev && typeof ev.firstAt === "string") {
        const t = Date.parse(ev.firstAt);
        if (!Number.isNaN(t) && (firstMs === void 0 || t < firstMs)) {
          firstMs = t;
          firstStr = ev.firstAt;
        }
      }
    }
    g.lastProgressAt = lastStr;
    g.firstEvidenceAt = firstStr;
  }
}
function annotateGoalStaleness(all, goalDir) {
  if (!all.some((g) => isGoalId(String(g.id)))) return;
  const idx = readGoalStalenessIndex(goalDir);
  for (const g of all) {
    if (!isGoalId(String(g.id))) continue;
    if (!idx.evaluated) {
      g.staleness = { state: "not-evaluated", signals: [], reason: idx.reason };
      continue;
    }
    const signals = idx.byGoal.get(String(g.id)) ?? [];
    g.staleness = signals.length > 0 ? { state: "stale", signals } : { state: "clean", signals: [] };
  }
}
function inAchievedReverifyScope(ac, activeGoalIds) {
  return activeGoalIds.has(String(ac.goal ?? "")) || ac.longTerm === true;
}
function parseAdjudicationTable(text) {
  const standing = [];
  const oneTime = [];
  const unrecognized = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("|")) continue;
    const cells = t.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim().replace(/`/g, ""));
    if (cells.length < 2) continue;
    if (!/^AC-\d+$/.test(cells[0])) continue;
    if (cells[1] === "\u5E38\u8BBE\u4E0D\u53D8\u5F0F") standing.push(cells[0]);
    else if (cells[1] === "\u4E00\u6B21\u6027\u9A8C\u6536") oneTime.push(cells[0]);
    else unrecognized.push({ id: cells[0], ruling: cells[1] });
  }
  return { standing, oneTime, unrecognized };
}
function commitGoalFile(goalDir, fileName, id, action) {
  const root = resolveGitRoot(goalDir);
  return commitStoreWrite({
    relPath: root ? path11.relative(root, path11.join(goalDir, fileName)) : `goals/${fileName}`,
    kind: "goals",
    id,
    action,
    root,
    propagate: "none"
  }).outcome;
}
function createGoalStore(goalDir, opts = {}) {
  fs11.mkdirSync(goalDir, { recursive: true });
  const cap = opts.cap ?? DEFAULT_GOAL_CAP;
  const staleMs = opts.staleMs ?? DEFAULT_STALE_MS;
  const storeFidelityJudge = opts.fidelityJudge;
  const assertSafeId = makeAssertSafeId(
    "goal",
    [GOAL_ID_RE, AC_ID_RE],
    "GOAL-NNN or AC-NNN (>=3 digits)"
  );
  const assertSafeStatus = makeAssertSafeStatus("goal", VALID_GOAL_STATUSES);
  function toViewModel(frontmatter, body, evidenceMap, updatedAt) {
    const evidence = evidenceMap.get(String(frontmatter.id ?? ""));
    const vm = {
      id: frontmatter.id,
      title: frontmatter.title,
      status: frontmatter.status,
      kind: frontmatter.kind,
      goal: frontmatter.goal,
      criterion: frontmatter.criterion,
      expect: frontmatter.expect,
      origin: frontmatter.origin,
      posture: frontmatter.posture,
      timeoutMs: frontmatter.timeoutMs,
      longTerm: frontmatter["long-term"] === true,
      // Undeclared reads as `false` (SPEC §4.1: 「缺省 = false = 现状」) — a three-state answer here
      // would put the two consumers that must treat them identically (branch or not) at odds.
      branch: frontmatter.branch === true,
      // SPEC-goal-branch §4.7: undeclared reads as `pre-merge` (the failure-visible default). The
      // write path refuses any other value, so a legacy/hand-written file carrying an unknown token
      // also projects as `pre-merge` — never as an `undefined` a driver would have to guess at.
      phase: frontmatter.phase === "post-merge" ? "post-merge" : "pre-merge",
      fidelity: frontmatter.fidelity,
      evidence,
      // Own-record time (a criterion): lastProgressAt = its LAST gate=goal event, firstEvidenceAt =
      // its FIRST. A GOAL's own fields are undefined here (GOALs carry no criterion and are never
      // gated themselves) — list() derives a GOAL's time from its ACs via annotateGoalProgress.
      lastProgressAt: typeof evidence?.at === "string" ? evidence.at : void 0,
      firstEvidenceAt: typeof evidence?.firstAt === "string" ? evidence.firstAt : void 0,
      activatedAt: frontmatter.activatedAt,
      statusLog: frontmatter.statusLog,
      supersedes: frontmatter.supersedes ?? [],
      supersededBy: frontmatter["superseded-by"] ?? [],
      body
    };
    if (updatedAt !== void 0) vm.updatedAt = updatedAt;
    return vm;
  }
  function get(id) {
    assertSafeId(id);
    const file = fileNameForId(goalDir, id);
    if (!file) return null;
    const p = path11.join(goalDir, file);
    const { frontmatter, body } = parseFrontmatter(fs11.readFileSync(p, "utf8"));
    let updatedAt;
    try {
      updatedAt = fs11.statSync(p).mtimeMs;
    } catch {
    }
    const vm = toViewModel(frontmatter, body, ledgerEvidenceMap(goalDir), updatedAt);
    annotateGoalStaleness([vm], goalDir);
    return vm;
  }
  function listWithMalformed(filter = {}) {
    const evidenceMap = ledgerEvidenceMap(goalDir);
    const malformed = [];
    const all = [];
    for (const f of fs11.readdirSync(goalDir)) {
      if (!(f.endsWith(".md") && (f.startsWith("GOAL-") || f.startsWith("AC-")))) continue;
      const p = path11.join(goalDir, f);
      const raw = fs11.readFileSync(p, "utf8");
      let parsed = null;
      try {
        parsed = parseFrontmatter(raw);
      } catch (err) {
        malformed.push({ file: f, error: err.message });
      }
      if (!parsed) continue;
      let updatedAt;
      try {
        updatedAt = fs11.statSync(p).mtimeMs;
      } catch {
      }
      all.push(toViewModel(parsed.frontmatter, parsed.body, evidenceMap, updatedAt));
    }
    annotateGoalProgress(all);
    annotateGoalStaleness(all, goalDir);
    return {
      items: all.filter((g) => filter.status ? g.status === filter.status : true).filter((g) => filter.kind ? g.kind === filter.kind : true).filter((g) => filter.goal ? g.goal === filter.goal : true).sort((a, b) => String(a.id).localeCompare(String(b.id))),
      malformed
    };
  }
  function list(filter = {}) {
    return listWithMalformed(filter).items;
  }
  function activeGoals() {
    return list().filter((g) => isGoalId(String(g.id)) && g.status === "active");
  }
  function listActiveCriteria() {
    const activeGoalIds = new Set(activeGoals().map((p) => String(p.id)));
    return list().filter((g) => !isGoalId(String(g.id)) && activeGoalIds.has(String(g.goal)));
  }
  function isGoalAchieved(goalId) {
    assertSafeId(goalId);
    if (!isGoalId(goalId)) {
      throw new Error(`isGoalAchieved requires a GOAL-NNN id, got ${JSON.stringify(goalId)}`);
    }
    const acs = list().filter((g) => String(g.goal) === goalId);
    if (acs.length === 0) return false;
    return acs.every((g) => g.status === "achieved");
  }
  function checkWithinCap() {
    const ap = activeGoals();
    const activeCount = ap.length;
    return {
      withinCap: activeCount <= cap,
      hasDirection: activeCount >= 1,
      activeCount,
      cap,
      active: ap.map((p) => String(p.id))
    };
  }
  function checkStaleness(nowMs = Date.now()) {
    const all = list();
    const fresh = [];
    const stale = [];
    const notEvaluated = [];
    const divergent = [];
    const active = activeGoals();
    for (const g of active) {
      const gid = String(g.id);
      if (isGoalAchieved(gid)) divergent.push(gid);
      let lastProgressAt;
      for (const ac of all.filter((r) => String(r.goal) === gid)) {
        const ev = ac.evidence;
        if (ev && typeof ev.at === "string") {
          const t = Date.parse(ev.at);
          if (!Number.isNaN(t) && (lastProgressAt === void 0 || t > lastProgressAt)) {
            lastProgressAt = t;
          }
        }
      }
      if (lastProgressAt === void 0) {
        notEvaluated.push(gid);
      } else if (nowMs - lastProgressAt > staleMs) {
        stale.push(gid);
      } else {
        fresh.push(gid);
      }
    }
    const scopeSize = active.length;
    return { fresh, stale, notEvaluated, divergent, scopeSize, evaluated: scopeSize > 0, cap, staleMs };
  }
  function checkAchievedFailing() {
    const all = list();
    const activeGoalIds = new Set(all.filter((g) => isGoalId(String(g.id)) && g.status === "active").map((g) => String(g.id)));
    const inScope = [];
    for (const ac of all) {
      if (!isCriterionId(String(ac.id))) continue;
      if (ac.status !== "achieved") continue;
      if (!inAchievedReverifyScope(ac, activeGoalIds)) continue;
      const criterion = typeof ac.criterion === "string" ? ac.criterion : "";
      if (criterion.trim() === "") continue;
      inScope.push(ac);
    }
    const scopeSize = inScope.length;
    const inScopeIds = inScope.map((ac) => String(ac.id));
    if (process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] === "1") {
      return { achievedButFailing: [], evaluated: false, scopeSize, inScope: inScopeIds };
    }
    const achievedButFailing = [];
    const root = resolveGitRoot(goalDir) ?? path11.dirname(goalDir);
    const criterionRoots = buildCriterionRoots(root, all);
    const prev = process.env[GOAL_ACCEPTANCE_ACTIVE_ENV];
    process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] = "1";
    try {
      for (const ac of inScope) {
        const criterion = typeof ac.criterion === "string" ? ac.criterion : "";
        const cwd = criterionCwdFor(root, criterionRoots, ac);
        const res = runAcceptance({ command: criterion, cwd, timeoutMs: resolveAcceptanceTimeoutMs() });
        if (!res.ok) achievedButFailing.push(String(ac.id));
      }
    } finally {
      if (prev === void 0) delete process.env[GOAL_ACCEPTANCE_ACTIVE_ENV];
      else process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] = prev;
    }
    return { achievedButFailing, evaluated: scopeSize > 0, scopeSize, inScope: inScopeIds };
  }
  function checkReverifyScope() {
    const activeGoalIds = new Set(activeGoals().map((g) => String(g.id)));
    const statusById = /* @__PURE__ */ new Map();
    for (const g of list()) if (isGoalId(String(g.id))) statusById.set(String(g.id), String(g.status));
    const inScope = [];
    const outOfScope = [];
    const skippedNoCriterion = [];
    for (const ac of list()) {
      if (!isCriterionId(String(ac.id))) continue;
      if (ac.status !== "achieved") continue;
      const goal = String(ac.goal ?? "");
      const entry = {
        id: String(ac.id),
        goal,
        goalStatus: statusById.get(goal) ?? "absent",
        longTerm: ac.longTerm === true
      };
      if (inAchievedReverifyScope(ac, activeGoalIds)) {
        if (String(ac.criterion ?? "").trim() === "") skippedNoCriterion.push(entry.id);
        else inScope.push(entry);
      } else {
        outOfScope.push(entry);
      }
    }
    return {
      scopeSize: inScope.length,
      evaluated: inScope.length > 0,
      activeGoals: [...activeGoalIds].sort(),
      inScope,
      outOfScope,
      skippedNoCriterion
    };
  }
  function frozenAchievedAcs() {
    const activeGoalIds = new Set(activeGoals().map((g) => String(g.id)));
    return list().filter(
      (ac) => isCriterionId(String(ac.id)) && ac.status === "achieved" && !inAchievedReverifyScope(ac, activeGoalIds) && String(ac.criterion ?? "").trim() !== ""
    );
  }
  function checkStalePass(nowMs = Date.now()) {
    const maxAgeMs = DEFAULT_STALE_PASS_MAX_AGE_MS;
    const frozen = frozenAchievedAcs();
    const { last, lastSweep } = gateTails(goalDir);
    const failing = [];
    const staleUnverified = [];
    const notEvaluated = [];
    const verifiedFresh = [];
    const amendedUnverified = [];
    const neverGated = [];
    let sweptEver = 0;
    let lastSweepAt = null;
    for (const ac of frozen) {
      const id = String(ac.id);
      const tail = last.get(id);
      const sw = lastSweep.get(id);
      if (sw) {
        sweptEver++;
        if (lastSweepAt === null || sw.at > lastSweepAt) lastSweepAt = sw.at;
      }
      if (!tail) {
        neverGated.push(id);
        continue;
      }
      if (sw && sw.criterionHash !== criterionFingerprint(ac.criterion)) {
        amendedUnverified.push(id);
        continue;
      }
      const swAgeMs = sw ? nowMs - Date.parse(sw.at) : Infinity;
      if (sw && Number.isFinite(swAgeMs) && swAgeMs <= maxAgeMs) {
        if (sw.verdict === "fail") failing.push(id);
        else if (sw.verdict === "pass") verifiedFresh.push(id);
        else notEvaluated.push(id);
      } else if (tail.verdict === "fail") {
        failing.push(id);
      } else if (tail.verdict === "not-evaluated") {
        notEvaluated.push(id);
      } else {
        staleUnverified.push(id);
      }
    }
    const sortIds = (a) => a.sort();
    return {
      frozenScope: frozen.length,
      evaluated: frozen.length > 0,
      failing: sortIds(failing),
      staleUnverified: sortIds(staleUnverified),
      notEvaluated: sortIds(notEvaluated),
      verifiedFresh: sortIds(verifiedFresh),
      amendedUnverified: sortIds(amendedUnverified),
      neverGated: sortIds(neverGated),
      rotation: { sweptEver, lastSweepAt, minAgeMs: DEFAULT_SWEEP_MIN_AGE_MS, maxAgeMs }
    };
  }
  async function sweepFrozen(o = {}) {
    const budget = o.budget ?? DEFAULT_SWEEP_BUDGET;
    const minAgeMs = o.minAgeMs ?? DEFAULT_SWEEP_MIN_AGE_MS;
    const wallMs = o.wallMs ?? DEFAULT_SWEEP_WALL_MS;
    const nowMs = o.nowMs ?? Date.now();
    const frozen = frozenAchievedAcs();
    if (process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] === "1") {
      return { evaluated: false, refused: true, eligible: 0, ran: [], stoppedBy: "exhausted" };
    }
    const { lastSweep } = gateTails(goalDir);
    const ageOf = (id) => {
      const sw = lastSweep.get(id);
      if (!sw) return Infinity;
      const t = Date.parse(sw.at);
      return Number.isFinite(t) ? nowMs - t : Infinity;
    };
    const byId = new Map(frozen.map((ac) => [String(ac.id), ac]));
    const amendedIds = new Set(
      frozen.map((ac) => String(ac.id)).filter((id) => {
        const sw = lastSweep.get(id);
        if (!sw || sw.criterionHash === "") return false;
        return sw.criterionHash !== criterionFingerprint(byId.get(id)?.criterion);
      })
    );
    const eligibleAt = (id) => ageOf(id) > (lastSweep.get(id)?.verdict === "fail" ? minAgeMs / DEFAULT_FAIL_RECHECK_DIVISOR : minAgeMs);
    const eligible = frozen.map((ac) => String(ac.id)).filter((id) => amendedIds.has(id) || eligibleAt(id)).sort((a, b) => {
      const aa = amendedIds.has(a);
      const ab = amendedIds.has(b);
      if (aa !== ab) return aa ? -1 : 1;
      const da = ageOf(a);
      const db = ageOf(b);
      if (da !== db) return db - da;
      return a.localeCompare(b);
    });
    const picked = eligible.slice(0, budget);
    if (picked.length === 0) {
      return { evaluated: frozen.length > 0, refused: false, eligible: eligible.length, ran: [], stoppedBy: "exhausted" };
    }
    const { appendGateEvent: appendGateEvent2 } = await Promise.resolve().then(() => (init_gate_event_store(), gate_event_store_exports));
    const logPath = path11.join(path11.dirname(goalDir), ".quay", "gate-events.jsonl");
    const root = resolveGitRoot(goalDir) ?? path11.dirname(goalDir);
    const criterionRoots = buildCriterionRoots(root, list());
    const startedAt = Date.now();
    const ran = [];
    const prev = process.env[GOAL_ACCEPTANCE_ACTIVE_ENV];
    process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] = "1";
    let stoppedBy = picked.length < eligible.length ? "budget" : "exhausted";
    try {
      for (const id of picked) {
        if (Date.now() - startedAt > wallMs) {
          stoppedBy = "wall";
          break;
        }
        const criterion = String(byId.get(id)?.criterion ?? "");
        const t0 = Date.now();
        const cwd = criterionCwdFor(root, criterionRoots, byId.get(id) ?? {});
        const res = runAcceptance({ command: criterion, cwd, timeoutMs: resolveAcceptanceTimeoutMs() });
        const v = verdictFromAcceptance(res);
        ran.push({ id, verdict: v.verdict, reason: v.reason.slice(0, 500), ms: Date.now() - t0 });
        appendGateEvent2(logPath, {
          id: randomUUID(),
          item_id: id,
          pipeline_id: id,
          gate: "goal",
          // ⛔ The actor is the DRY-RUN's cause, and the two causes are distinguishable
          // (AMEND_ACTOR vs SWEEP_ACTOR) — so a reader can tell "the age rotation reached it" from
          // "its criterion text changed, so this round ran it immediately". Both count as rotation
          // writes (see `gateTails`), because both are re-verifications.
          actor: amendedIds.has(id) ? AMEND_ACTOR : SWEEP_ACTOR,
          verdict: v.verdict,
          timestamp: (/* @__PURE__ */ new Date()).toISOString(),
          // The fingerprint pins WHICH criterion text this verdict is about — the whole point of the
          // amendment gate. ⛔ Recorded, not inferred later from mtime/clock (hard rule 4 corollary
          // 2: a value that depends on the host is not a measurement).
          // `cause` is present only when there IS one (⛔ not `cause: null` on the pass/fail events):
          // the shape of the 8000+ existing goal events is a contract several readers parse.
          payload: {
            reason: v.reason,
            ...v.cause ? { cause: v.cause } : {},
            criterionHash: criterionFingerprint(criterion),
            // WHICH tree this rotation re-verified on (SPEC §7 辛) — `cwd` here is the criterion cwd
            // passed to `runAcceptance` above, so the two name the same tree by construction.
            ...evaluationContext(cwd)
          }
        });
      }
    } finally {
      if (prev === void 0) delete process.env[GOAL_ACCEPTANCE_ACTIVE_ENV];
      else process.env[GOAL_ACCEPTANCE_ACTIVE_ENV] = prev;
    }
    return { evaluated: frozen.length > 0, refused: false, eligible: eligible.length, ran, stoppedBy };
  }
  function discardGoalBranchNow(root, id) {
    const del = discardGoalBranch(root, id);
    if (!del.removed && del.tipSha !== null) {
      console.error(`goal-store: ${id} was discarded but its branch was NOT deleted \u2014 ${del.detail}`);
    }
  }
  function flipGoal(oldId, patch) {
    const file = fileNameForId(goalDir, oldId);
    if (!file) return;
    const p = path11.join(goalDir, file);
    const { frontmatter, body } = parseFrontmatter(fs11.readFileSync(p, "utf8"));
    const fm = frontmatter;
    const prevStatus = String(fm.status ?? "");
    fm.status = patch.status;
    if (patch.supersededBy !== void 0) fm["superseded-by"] = patch.supersededBy;
    const root = fm.branch === true ? resolveGitRoot(goalDir) : null;
    let discardTipSha = null;
    if (root !== null && (patch.status === "superseded" || patch.status === "retired")) {
      discardTipSha = goalBranchTip(root, oldId);
      if (discardTipSha !== null) {
        const prior = Array.isArray(fm.statusLog) ? fm.statusLog : [];
        fm.statusLog = [...prior, {
          at: (/* @__PURE__ */ new Date()).toISOString(),
          from: prevStatus,
          to: patch.status,
          actor: "goal-store",
          reason: `discarded branch ${goalBranchName(oldId)} tip ${discardTipSha}`
        }];
      }
    }
    fs11.writeFileSync(p, serializeFrontmatter(fm, body), "utf8");
    const outcome = commitGoalFile(goalDir, file, oldId, `status ${prevStatus}\u2192${patch.status}`);
    if (outcome === "failed") {
      console.error(`goal-store: commit of "${oldId}" failed \u2014 the file was written to disk but is not on any branch's history`);
    }
    if (root !== null && discardTipSha !== null) discardGoalBranchNow(root, oldId);
  }
  function write(id, {
    title,
    status,
    goal,
    criterion,
    expect,
    origin,
    supersedes,
    supersededBy,
    body,
    disposeOld,
    longTerm,
    branch,
    phase,
    force = false,
    actor,
    reason,
    dryRun = false,
    commit = true,
    intent,
    fidelityJudge
  }) {
    assertSafeId(id);
    assertSafeStatus(status);
    const isGoalRecord = isGoalId(id);
    if (isGoalRecord && criterion !== void 0) {
      throw new Error(
        `${id} is a GOAL record and cannot carry a \`criterion\` field \u2014 a goal is judged by the conjunction of its ACs`
      );
    }
    if (phase !== void 0 && !VALID_CRITERION_PHASES.includes(phase)) {
      throw new Error(
        `${id}: phase must be one of ${VALID_CRITERION_PHASES.join(" | ")} (got ${JSON.stringify(phase)}) \u2014 the phase is DECLARED by the author, never inferred from the criterion text`
      );
    }
    if (isGoalRecord && phase !== void 0) {
      throw new Error(
        `${id} is a GOAL record and cannot carry a \`phase\` field \u2014 phase is an AC property (a goal is judged by the conjunction of its ACs, each with its own phase)`
      );
    }
    return withFileLock(goalDir, id, () => {
      const existingFile = fileNameForId(goalDir, id);
      let frontmatter = {};
      let existingBody = "";
      if (existingFile) {
        const parsed = parseFrontmatter(fs11.readFileSync(path11.join(goalDir, existingFile), "utf8"));
        frontmatter = { ...parsed.frontmatter };
        existingBody = parsed.body;
      }
      if (intent !== void 0) {
        if (intent === "absent" && existingFile) {
          throw new GoalIntentConflictError(id, "absent", "present");
        }
        if (intent === "existing" && !existingFile) {
          throw new GoalIntentConflictError(id, "existing", "absent");
        }
      }
      const finalBody = body !== void 0 ? body : existingBody;
      const prevStatus = typeof frontmatter.status === "string" ? frontmatter.status : void 0;
      const priorCriterion = frontmatter.criterion;
      const branchGitRoot = isGoalRecord ? resolveGitRoot(goalDir) : null;
      const priorBranch = frontmatter.branch === true;
      const branchRefExists = branchGitRoot !== null && goalBranchRefExists(branchGitRoot, id);
      if (isGoalRecord && branch !== void 0 && branchRefExists && branch !== priorBranch) {
        throw new Error(
          `refusing to change ${id}'s \`branch\` field: the derived branch '${goalBranchName(id)}' already exists \u2014 the field is locked once the branch is created (SPEC-goal-branch \xA74.1/\xA74.11); it cannot be flipped under an in-flight task's merge target`
        );
      }
      frontmatter.id = id;
      if (title !== void 0) frontmatter.title = title;
      const nextStatus = status ?? frontmatter.status ?? "draft";
      frontmatter.status = nextStatus;
      const discarding = isGoalRecord && (nextStatus === "superseded" || nextStatus === "retired") && prevStatus !== nextStatus && priorBranch && branchGitRoot !== null;
      const discardTipSha = discarding ? goalBranchTip(branchGitRoot, id) : null;
      frontmatter.kind = isGoalRecord ? "goal" : "criterion";
      if (goal !== void 0) frontmatter.goal = goal;
      if (criterion !== void 0) frontmatter.criterion = criterion;
      if (expect !== void 0) frontmatter.expect = expect;
      if (origin !== void 0) frontmatter.origin = origin;
      if (supersedes !== void 0) frontmatter.supersedes = supersedes;
      if (supersededBy !== void 0) frontmatter["superseded-by"] = supersededBy;
      if (longTerm !== void 0) frontmatter["long-term"] = longTerm;
      if (branch !== void 0) frontmatter.branch = branch;
      if (phase !== void 0) frontmatter.phase = phase;
      const statusChanged = prevStatus !== void 0 && nextStatus !== prevStatus;
      const activating = nextStatus === "active" && prevStatus !== void 0 && prevStatus !== "active";
      const goalInAcScope = nextStatus === "draft" || nextStatus === "active";
      if (!isGoalRecord && (typeof frontmatter.goal !== "string" || frontmatter.goal.trim() === "")) {
        throw new Error(`AC record ${id} must declare a \`goal: GOAL-NNN\` \u2014 activeness derives from the goal`);
      }
      if (typeof frontmatter.origin !== "string" || frontmatter.origin.trim() === "") {
        throw new Error(
          `origin is required for ${id} \u2014 an AC/goal without an empirical basis is cargo cult; empty origin writes nothing`
        );
      }
      const touchesCriterion = criterion !== void 0;
      const touchesExpect = expect !== void 0;
      if (!existingFile) {
        if (!isGoalRecord) {
          if (typeof frontmatter.criterion !== "string" || frontmatter.criterion.trim() === "") {
            throw new Error(
              `${id} is a criterion record and requires a non-empty \`criterion\` \u2014 the runnable command that verifies it (a criterion's content lives in criterion+expect, not the body; empty criterion writes nothing)`
            );
          }
          if (typeof frontmatter.expect !== "string" || frontmatter.expect.trim() === "") {
            throw new Error(
              `${id} is a criterion record and requires a non-empty \`expect\` \u2014 the expected outcome the criterion proves (a criterion's content lives in criterion+expect, not the body; empty expect writes nothing)`
            );
          }
        } else {
          if (finalBody.trim().length < MIN_GOAL_BODY_CHARS) {
            throw new Error(
              `${id} is a GOAL record and requires a \`body\` of \u2265${MIN_GOAL_BODY_CHARS} non-whitespace chars (background / scope & non-goals / exit conditions) \u2014 \`origin\` is only a provenance citation, not the body; empty body writes nothing`
            );
          }
        }
      } else if (!isGoalRecord) {
        if (touchesCriterion && (typeof frontmatter.criterion !== "string" || frontmatter.criterion.trim() === "")) {
          throw new Error(
            `${id} cannot be updated to an empty \`criterion\` \u2014 the runnable command that verifies it (empty criterion writes nothing)`
          );
        }
        if (touchesExpect && (typeof frontmatter.expect !== "string" || frontmatter.expect.trim() === "")) {
          throw new Error(
            `${id} cannot be updated to an empty \`expect\` \u2014 the expected outcome the criterion proves (empty expect writes nothing)`
          );
        }
      }
      if (!isGoalRecord && (criterion !== void 0 || !existingFile)) {
        const nextAttr = evaluateCriterionAttribution(frontmatter.criterion);
        if (nextAttr.evaluated) {
          const bare = nextAttr.bare;
          if (!existingFile) {
            if (bare.length > 0) {
              throw new Error(
                // ⛔ TWO accepted repairs, and the entry's own class label (in formatBareFailureExits)
                // says which one applies. Telling every author "write a cause on this line" would be
                // actively wrong for an `errexit abort`: the cause IS written, on a line errexit never
                // reaches — the assignment must be guarded instead. A rejection that names the wrong
                // repair is a rejection that does not open (硬规则 3b).
                `${id}: criterion carries ${bare.length} failure exit(s) that write no cause \u2014 refused at the write surface. Offending: ${formatBareFailureExits(bare)}. Accepted forms: (a) a WRITTEN failure exit whose line also writes to stderr/stdout (e.g. \`sys.stderr.write("...\\n")\`, \`>&2\`, \`console.error\`); (b) for a line marked "errexit abort", GUARD the assignment \u2014 \`VAR="$(cmd || true)"\`, \`VAR="$(cmd)" || true\`, or \`if ! VAR=$(cmd); then \u2026\` \u2014 because a cause written below it can never run.`
              );
            }
          } else {
            const priorAttr = evaluateCriterionAttribution(priorCriterion);
            if (!priorAttr.evaluated) {
              if (bare.length > 0) {
                throw new Error(
                  `${id}: the STORED criterion is NOT-EVALUATED (${priorAttr.error}), so the shrink-only comparison cannot be computed \u2014 this update is therefore accepted only if the new criterion is strictly clean, and it carries ${bare.length} bare failure exit(s): ${formatBareFailureExits(bare)}`
                );
              }
            } else if (bare.length > priorAttr.bare.length) {
              throw new Error(
                `${id}: criterion attribution would REGRESS \u2014 the new text carries ${bare.length} failure exit(s) with no cause, the stored text carried ${priorAttr.bare.length} (shrink-only: a criterion edit may not ADD unattributable failure exits). Offending: ${formatBareFailureExits(bare)}`
              );
            }
          }
        }
      }
      if (activating && !isGoalRecord && !force) {
        const criterionCmd = typeof frontmatter.criterion === "string" ? frontmatter.criterion : "";
        if (criterionCmd.trim() === "") {
          throw new Error(`cannot activate ${id}: criterion not-evaluated (no criterion defined) \u2014 pass --force to override`);
        }
        const gateRoot = resolveGitRoot(goalDir) ?? path11.dirname(goalDir);
        const startedMs = Date.now();
        const gateRes = runAcceptance({ command: criterionCmd, cwd: gateRoot, timeoutMs: resolveAcceptanceTimeoutMs() });
        const wallMs = Date.now() - startedMs;
        if (gateRes.code === null && !gateRes.timedOut) {
          throw new Error(`cannot activate ${id}: criterion not-evaluated (${gateRes.reason}) \u2014 pass --force to override`);
        }
        console.error(`goal-store: activated ${id} \u2014 criterion ran in ${wallMs}ms (${verdictFromAcceptance(gateRes).verdict})`);
      }
      if (goalInAcScope && isGoalRecord) {
        const namingAcs = list().filter((r) => String(r.id ?? "").startsWith("AC-") && String(r.goal ?? "") === id);
        if (namingAcs.length === 0) {
          const acFirst = `Write the AC first \u2014 an AC may name a GOAL that does not exist yet (this store requires only that \`goal:\` be a non-empty string, \u26D4 not that the named GOAL exist), so this order is legal at every instant: goal-store write AC-NNN --goal ${id} --status draft --criterion '<runnable command>' --expect '<expected outcome>' --origin '<empirical basis>', then run THIS write again. AC-first is what makes the invariant unobservable-as-false for any length of time (\u26D4 not a shorter window \u2014 an unreachable state).`;
          throw new Error(
            `cannot write ${id} as ${nextStatus}: 0 AC records name it \u2014 a GOAL in {draft, active} must carry at least one AC (a goal is judged by the conjunction of its ACs, so a goal with none has no exit condition and its achievement is undecidable; ACs naming ${id}: ${namingAcs.length}). ` + acFirst
          );
        }
      }
      if (activating && !isGoalRecord && !force) {
        const judge = fidelityJudge ?? storeFidelityJudge;
        if (typeof judge === "function") {
          const fidelityCmd = typeof frontmatter.criterion === "string" ? frontmatter.criterion : "";
          const expectText = typeof frontmatter.expect === "string" ? frontmatter.expect : "";
          const fidelityRoot = resolveGitRoot(goalDir) ?? path11.dirname(goalDir);
          const fRes = criterionFidelityVerdict(fidelityCmd, expectText, judge, { root: fidelityRoot });
          if (fRes.verdict === "vacuous" || fRes.verdict === "not-evaluated") {
            throw new Error(`cannot activate ${id}: criterion ${fRes.verdict} (${fRes.reason}) \u2014 pass --force to override`);
          }
          frontmatter.fidelity = { verdict: fRes.verdict, reason: fRes.reason, at: (/* @__PURE__ */ new Date()).toISOString() };
        } else {
          frontmatter.fidelity = { verdict: "not-evaluated", reason: "no judge configured", at: (/* @__PURE__ */ new Date()).toISOString() };
        }
      }
      if (activating && !isGoalRecord && force) {
        frontmatter.fidelity = {
          verdict: "forced",
          reason: "--force override (skipped evaluability + fidelity gates)",
          at: (/* @__PURE__ */ new Date()).toISOString()
        };
      }
      if (nextStatus === "active" && prevStatus !== "active" && typeof frontmatter.activatedAt !== "string") {
        frontmatter.activatedAt = (/* @__PURE__ */ new Date()).toISOString();
      }
      if (statusChanged) {
        const prior = Array.isArray(frontmatter.statusLog) ? frontmatter.statusLog : [];
        const discardNote = discardTipSha !== null ? `discarded branch ${goalBranchName(id)} tip ${discardTipSha}` : "";
        const entryReason = discardNote === "" ? reason ?? "" : reason === void 0 || reason.trim() === "" ? discardNote : `${reason}\uFF08${discardNote}\uFF09`;
        frontmatter.statusLog = [...prior, {
          at: (/* @__PURE__ */ new Date()).toISOString(),
          from: prevStatus,
          to: nextStatus,
          actor: actor ?? "goal-cli",
          reason: entryReason
        }];
      }
      if (isGoalRecord && nextStatus === "active") {
        const disposedIds = /* @__PURE__ */ new Set();
        if (disposeOld) disposedIds.add(String(disposeOld.id));
        if (Array.isArray(supersedes)) for (const oldId of supersedes) disposedIds.add(String(oldId));
        if (!dryRun) {
          if (disposeOld) {
            flipGoal(String(disposeOld.id), {
              status: disposeOld.to === "achieved" ? "achieved" : "superseded",
              supersededBy: disposeOld.to === "achieved" ? void 0 : [id]
            });
          }
          if (Array.isArray(supersedes)) {
            for (const oldId of supersedes) flipGoal(String(oldId), { status: "superseded", supersededBy: [id] });
          }
        }
        const remainingActive = activeGoals().filter((p) => String(p.id) !== id && !disposedIds.has(String(p.id)));
        if (remainingActive.length >= cap) {
          throw new Error(
            `cannot activate ${id}: active GOAL count would exceed cap ${cap} \u2014 currently active: ${remainingActive.map((p) => String(p.id)).join(", ")} (dispose one via disposeOld {id, to} or supersedes:[id])`
          );
        }
      }
      delete frontmatter.evidence;
      const ordered = {};
      for (const k of [
        "id",
        "title",
        "status",
        "kind",
        "goal",
        "criterion",
        "expect",
        "origin",
        "activatedAt",
        "statusLog",
        "labels",
        "posture",
        "supersedes",
        "superseded-by",
        "long-term",
        "fidelity",
        "timeoutMs",
        "branch",
        "phase"
      ]) {
        if (frontmatter[k] !== void 0) ordered[k] = frontmatter[k];
      }
      for (const k of Object.keys(frontmatter)) {
        if (!OWNED_KEYS2.has(k)) ordered[k] = frontmatter[k];
      }
      if (dryRun) {
        return toViewModel(ordered, finalBody, ledgerEvidenceMap(goalDir));
      }
      const fileName = existingFile ?? `${id}-${slugify(title, "goal")}.md`;
      fs11.writeFileSync(path11.join(goalDir, fileName), serializeFrontmatter(ordered, finalBody), "utf8");
      if (!isGoalRecord) {
        const owningGoal = typeof frontmatter.goal === "string" ? frontmatter.goal.trim() : "";
        if (owningGoal !== "" && nextStatus !== "achieved") {
          const ownerStatus = goalStatusOf(goalDir, owningGoal);
          if (ownerStatus === "achieved") {
            appendGoalStalenessSignal(goalDir, {
              goalId: owningGoal,
              staleSince: (/* @__PURE__ */ new Date()).toISOString(),
              triggeringAcId: id,
              goalStatusAtTime: ownerStatus
            });
            console.error(
              `goal-store: ${id} was filed ${nextStatus} under ${owningGoal} which reads achieved \u2014 recorded a goal-staleness signal (the GOAL record itself is NOT modified; reopening is a human decision)`
            );
          }
        }
      } else if (nextStatus === "active") {
        const resolved = resolveGoalStaleness(goalDir, id, { actor: actor ?? "goal-cli", reason });
        if (resolved > 0) {
          console.error(
            `goal-store: ${id} \u2192 active resolved ${resolved} goal-staleness signal(s) (actor=${actor ?? "goal-cli"})`
          );
        }
      }
      if (commit) {
        let action;
        if (!existingFile) {
          action = "create";
        } else if (statusChanged) {
          action = `status ${prevStatus}\u2192${nextStatus}`;
        } else {
          const touched = [];
          if (title !== void 0) touched.push("title");
          if (goal !== void 0) touched.push("goal");
          if (criterion !== void 0) touched.push("criterion");
          if (expect !== void 0) touched.push("expect");
          if (origin !== void 0) touched.push("origin");
          if (supersedes !== void 0) touched.push("supersedes");
          if (supersededBy !== void 0) touched.push("superseded-by");
          if (longTerm !== void 0) touched.push("long-term");
          if (body !== void 0) touched.push("body");
          action = touched.length > 0 ? `field:${touched.join(",")}` : "update";
        }
        const outcome = commitGoalFile(goalDir, fileName, id, action);
        if (outcome === "failed") {
          console.error(`goal-store: commit of "${id}" failed \u2014 the file was written to disk but is not on any branch's history`);
        }
      }
      if (branchGitRoot !== null) {
        const enteringActive = nextStatus === "active" && prevStatus !== "active";
        const branchJustSet = branch === true && !priorBranch;
        if (isGoalRecord && nextStatus === "active" && frontmatter.branch === true && !branchRefExists && (enteringActive || branchJustSet)) {
          const rep = ensureGoalBranch(branchGitRoot, id);
          if (rep.action === "blocked" || rep.action === "unreadable") {
            console.error(`goal-store: ${id} is branch-mode but '${rep.name}' was NOT created \u2014 ${rep.detail}`);
          }
        }
        if (discarding && discardTipSha !== null) discardGoalBranchNow(branchGitRoot, id);
      }
      return get(id);
    });
  }
  function writeBatch(records, { dryRun = false } = {}) {
    const root = resolveGitRoot(goalDir);
    const results = [];
    const relPaths = [];
    for (const r of records) {
      const vm = write(r.id, {
        title: r.title,
        status: r.status,
        goal: r.goal,
        criterion: r.criterion,
        expect: r.expect,
        origin: r.origin,
        supersedes: r.supersedes,
        supersededBy: r.supersededBy,
        body: r.body,
        force: r.force,
        phase: r.phase,
        actor: r.actor,
        reason: r.reason,
        commit: false,
        dryRun
      });
      results.push(vm);
      const f = fileNameForId(goalDir, r.id);
      if (f) relPaths.push(root ? path11.relative(root, path11.join(goalDir, f)) : `goals/${f}`);
    }
    if (!dryRun) {
      const outcome = commitStoreBatch({
        relPaths,
        kind: "goals",
        id: records.map((r) => r.id).join(" "),
        action: "batch",
        root
      });
      if (outcome === "failed") {
        console.error(`goal-store: batch commit of ${records.length} record(s) failed \u2014 files written to disk but not on any branch's history`);
      }
    }
    return results;
  }
  return { list, listWithMalformed, get, write, writeBatch, activeGoals, listActiveCriteria, isGoalAchieved, checkWithinCap, checkStaleness, checkAchievedFailing, checkReverifyScope, frozenAchievedAcs, checkStalePass, sweepFrozen };
}
function judgeFromArgv(judgeArgv) {
  return (prompt) => {
    const r = spawnSync2(judgeArgv[0], [...judgeArgv.slice(1), prompt], {
      encoding: "utf8",
      timeout: FIDELITY_JUDGE_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { stdout: typeof r.stdout === "string" ? r.stdout : null, exitCode: r.status ?? null };
  };
}
function readProfilesYaml(root) {
  const file = path11.join(root, ".quay", "profiles.yml");
  if (!fs11.existsSync(file)) return null;
  try {
    const doc = import_yaml4.default.parse(fs11.readFileSync(file, "utf8"));
    return doc && typeof doc === "object" && !Array.isArray(doc) ? doc : null;
  } catch {
    return null;
  }
}
function fidelitySettingsArg(root, resolvedEnv, unset) {
  const devTree = path11.join(root, ".claude", "launch.settings.json");
  let settingsFile = null;
  if (fs11.existsSync(devTree)) {
    settingsFile = devTree;
  } else {
    const pluginRoot = resolvePluginRoot();
    if (pluginRoot) {
      const shipped = path11.join(pluginRoot, ".claude", "launch.settings.json");
      if (fs11.existsSync(shipped)) settingsFile = shipped;
    }
  }
  if (!settingsFile) return null;
  let settings;
  try {
    settings = JSON.parse(fs11.readFileSync(settingsFile, "utf8"));
  } catch {
    return null;
  }
  const baseEnv = settings.env && typeof settings.env === "object" ? settings.env : {};
  const env = { ...baseEnv };
  for (const k of unset) delete env[k];
  Object.assign(env, resolvedEnv);
  const needsJson = unset.length > 0 || Object.keys(resolvedEnv).length > 0;
  return needsJson ? JSON.stringify({ ...settings, env }) : settingsFile;
}
function resolveFidelityJudgeArgvFromConfig(root) {
  const profiles = readProfilesYaml(root);
  if (!profiles) return null;
  const roles = profiles.roles ?? {};
  const profileMap = profiles.profiles ?? {};
  const role = roles["fix-worker"];
  if (!role || typeof role !== "object") return null;
  const profileName = typeof role.profile === "string" ? role.profile : "worker-default";
  const profile = profileMap[profileName];
  if (!profile || typeof profile !== "object") return null;
  const launcher = profile.launcher ?? role.launcher;
  if (typeof launcher !== "string" || launcher === "") return null;
  const model = role.model !== void 0 ? role.model : profile.model;
  const bare = role.bare !== void 0 ? role.bare === true : profile.bare === true;
  const name = typeof role.name === "string" && role.name !== "" ? role.name : "quay-fix-worker";
  const baseEnv = profile.env && typeof profile.env === "object" ? profile.env : {};
  const roleEnv = role.env && typeof role.env === "object" ? role.env : {};
  const env = mergeEnv(baseEnv, roleEnv);
  const unset = [
    ...Array.isArray(profile.unset) ? profile.unset.map(String) : [],
    ...Array.isArray(role.unset) ? role.unset.map(String) : []
  ];
  for (const k of unset) delete env[k];
  const settingsArg = fidelitySettingsArg(root, env, unset);
  if (settingsArg === null) return null;
  const argv = [launcher, "--settings", settingsArg];
  if (profiles.excludeDynamicSystemPromptSections === true) argv.push("--exclude-dynamic-system-prompt-sections");
  if (profiles.promptSuggestions === false) argv.push("--prompt-suggestions", "false");
  if (typeof model === "string" && model !== "") argv.push("--model", model);
  if (bare === true) argv.push("--bare");
  argv.push("-n", name, "-p");
  return argv;
}
async function runGoalStoreCli(argv) {
  const args = argv.slice(2);
  const rootFlagIdx = args.indexOf("--root");
  let root = null;
  if (rootFlagIdx >= 0) {
    root = args[rootFlagIdx + 1] ?? null;
    args.splice(rootFlagIdx, 2);
  }
  if (!root) {
    let dir = path11.dirname(fileURLToPath3(import.meta.url));
    for (let i2 = 0; i2 < 12; i2++) {
      if (fs11.existsSync(path11.join(dir, ".git"))) {
        root = dir;
        break;
      }
      const parent = path11.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  root = root ?? process.cwd();
  const goalDir = path11.join(root, "goals");
  const logPath = path11.join(root, ".quay", "gate-events.jsonl");
  const goalCfg = readGoalConfig(root);
  let fidelityJudge;
  const judgeCmd = process.env.QUAY_GOAL_FIDELITY_JUDGE;
  if (judgeCmd && judgeCmd.trim() !== "") {
    fidelityJudge = judgeFromArgv(judgeCmd.trim().split(/\s+/));
  } else {
    const cfgArgv = resolveFidelityJudgeArgvFromConfig(root);
    if (cfgArgv) fidelityJudge = judgeFromArgv(cfgArgv);
  }
  const store = createGoalStore(goalDir, { cap: goalCfg.cap, staleMs: goalCfg.staleMs, fidelityJudge });
  const [sub, ...rest] = args;
  switch (sub) {
    case "list": {
      const filter = {};
      const fi = rest.indexOf("--status");
      if (fi >= 0) filter.status = rest[fi + 1];
      process.stdout.write(JSON.stringify(store.list(filter), null, 2) + "\n");
      return 0;
    }
    case "get": {
      if (rest.length === 0) {
        console.error("goal-store: get requires <id>");
        return 2;
      }
      const rec = store.get(rest[0]);
      if (!rec) {
        console.error(`goal-store: no such goal: ${rest[0]}`);
        return 1;
      }
      process.stdout.write(JSON.stringify(rec, null, 2) + "\n");
      return 0;
    }
    case "write": {
      const id = rest[0];
      if (!id) {
        console.error("goal-store: write requires <id>");
        return 2;
      }
      const opts = {};
      let force = false;
      let dryRun = false;
      let intent;
      let fidelityJudgeArgv;
      for (let i2 = 1; i2 < rest.length; i2++) {
        const k = rest[i2];
        if (!k.startsWith("--")) continue;
        const key = k.slice(2);
        if (key === "force") {
          force = true;
          continue;
        }
        if (key === "dry-run") {
          dryRun = true;
          continue;
        }
        if (key === "expect-absent") {
          intent = "absent";
          continue;
        }
        if (key === "expect-existing") {
          intent = "existing";
          continue;
        }
        if (key === "fidelity-judge-argv") {
          const raw = rest[i2 + 1];
          if (raw === void 0) {
            console.error("goal-store: --fidelity-judge-argv requires a JSON argv array");
            return 2;
          }
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            console.error("goal-store: --fidelity-judge-argv is not valid JSON");
            return 2;
          }
          if (!Array.isArray(parsed) || parsed.length === 0 || parsed.some((x) => typeof x !== "string")) {
            console.error("goal-store: --fidelity-judge-argv must be a non-empty JSON array of strings");
            return 2;
          }
          fidelityJudgeArgv = parsed;
          i2++;
          continue;
        }
        const v = rest[i2 + 1];
        if (key === "long-term") {
          if (v !== "true" && v !== "false") {
            console.error("goal-store: --long-term must be exactly true or false");
            return 2;
          }
          opts["long-term"] = v === "true";
          i2++;
          continue;
        }
        if (key === "branch") {
          if (v !== "true" && v !== "false") {
            console.error("goal-store: --branch must be exactly true or false");
            return 2;
          }
          opts["branch"] = v === "true";
          i2++;
          continue;
        }
        if (key === "phase") {
          if (!VALID_CRITERION_PHASES.includes(String(v))) {
            console.error(`goal-store: --phase must be exactly ${VALID_CRITERION_PHASES.join(" or ")}`);
            return 2;
          }
          opts["phase"] = v;
          i2++;
          continue;
        }
        if (key === "title" || key === "status" || key === "goal" || key === "criterion" || key === "expect" || key === "origin" || key === "body" || key === "superseded-by" || key === "supersedes" || key === "dispose-old" || key === "dispose-to" || key === "actor" || key === "reason") {
          opts[key] = v;
          i2++;
        } else {
          console.error(`goal-store: unknown write flag: ${k}`);
          return 2;
        }
      }
      let disposeOld;
      if (opts["dispose-old"] !== void 0) {
        const to = opts["dispose-to"] === "achieved" ? "achieved" : opts["dispose-to"] === "superseded" ? "superseded" : null;
        if (!to) {
          console.error("goal-store: --dispose-old requires --dispose-to achieved|superseded");
          return 2;
        }
        disposeOld = { id: String(opts["dispose-old"]), to };
      }
      try {
        const rec = store.write(id, {
          title: opts.title,
          status: opts.status,
          goal: opts.goal,
          criterion: opts.criterion,
          expect: opts.expect,
          // P1: `origin` is optional on update (patch semantics — omitting it keeps the stored
          // value). Create still requires it — enforced by write()'s origin check, not here.
          origin: opts.origin,
          body: opts.body,
          supersededBy: Array.isArray(opts["superseded-by"]) ? opts["superseded-by"] : typeof opts["superseded-by"] === "string" ? [opts["superseded-by"]] : void 0,
          // `--supersedes <id>` — the DECLARATION half of the same field `write()` already owns
          // (goal-store.ts:1913 `supersedes?: string[]`, applied at :2002). It was reachable through
          // the JS API but had no CLI surface, so every CLI writer (meta-driver's draft proposals)
          // was structurally unable to carry it. Single id per flag ⇒ wrapped, the same shape
          // `--superseded-by` uses just above.
          //
          // ⛔ BOUNDARY — this flag carries no disposal power over a CRITERION, and that is
          // structural, not a convention to be maintained: `write()`'s disposal branch is gated on
          // `isGoalRecord && nextStatus === "active"` (:2322), so for an `AC-*` record the flip is
          // unreachable on EVERY status, including activation. A proposal that declares
          // `supersedes: [AC-old]` therefore leaves `AC-old`'s `status` byte-identical — flipping it
          // stays a human action. (For a GOAL record the disposal semantics are the pre-existing I1′
          // mechanism, already reachable via `--dispose-old`; this flag adds no new semantic there,
          // it only stops the field from being un-writable.)
          supersedes: typeof opts.supersedes === "string" ? [opts.supersedes] : void 0,
          disposeOld,
          // `--long-term true|false` (AC-216 declaration, machine-writable). `false` is MEANINGFUL
          // (explicitly clear the declaration) — hence the `!== undefined` guard, not a truthiness
          // test: passing the boolean straight through preserves the patch semantics in `write`.
          longTerm: opts["long-term"],
          // `--branch true|false` (SPEC-goal-branch §4.1). `false` is MEANINGFUL (explicitly decline)
          // — the `!== undefined` guard preserves the patch semantics in `write`, exactly like longTerm.
          branch: opts["branch"],
          // `--phase pre-merge|post-merge` (SPEC-goal-branch §4.7). `undefined` (omitted) preserves
          // patch semantics; the value was validated against the enum above, before the call.
          phase: opts["phase"],
          force,
          actor: opts.actor,
          reason: opts.reason,
          dryRun,
          intent,
          // Per-write judge seam (the `--fidelity-judge-argv` flag). undefined ⇒ fall back to the
          // store-level judge (from QUAY_GOAL_FIDELITY_JUDGE), or to the "no judge configured"
          // visibility branch when neither is present.
          fidelityJudge: fidelityJudgeArgv ? judgeFromArgv(fidelityJudgeArgv) : void 0
        });
        process.stdout.write(JSON.stringify(rec, null, 2) + "\n");
        return 0;
      } catch (err) {
        console.error(`goal-store: write failed: ${err.message}`);
        return 2;
      }
    }
    case "batch": {
      const ji = rest.indexOf("--json");
      if (ji < 0) {
        console.error("goal-store: batch requires --json <array-of-records>");
        return 2;
      }
      const dryRun = rest.includes("--dry-run");
      const raw = rest[ji + 1];
      if (raw === void 0) {
        console.error("goal-store: batch --json missing value");
        return 2;
      }
      let records;
      try {
        records = JSON.parse(raw);
      } catch {
        console.error("goal-store: batch --json is not valid JSON");
        return 2;
      }
      if (!Array.isArray(records)) {
        console.error("goal-store: batch --json must be a JSON array");
        return 2;
      }
      try {
        const results = store.writeBatch(records.map((r) => {
          const o = r && typeof r === "object" ? r : {};
          return {
            id: String(o.id ?? ""),
            title: o.title,
            status: o.status,
            goal: o.goal,
            criterion: o.criterion,
            expect: o.expect,
            origin: o.origin,
            body: o.body,
            // SPEC-goal-branch §4.1 — batch records carry the opt-in gate the same way `write` does
            // (patch semantics on a boolean, ⛔ not a truthy coercion).
            branch: typeof o.branch === "boolean" ? o.branch : void 0,
            // SPEC-goal-branch §4.7 — batch records carry the AC phase the same way `write` does;
            // `write` validates the enum, so a bad token is refused rather than stored.
            phase: typeof o.phase === "string" ? o.phase : void 0,
            force: o.force === true,
            actor: o.actor,
            reason: o.reason
          };
        }), { dryRun });
        process.stdout.write(JSON.stringify(results, null, 2) + "\n");
        return 0;
      } catch (err) {
        console.error(`goal-store: batch failed: ${err.message}`);
        return 2;
      }
    }
    case "gate": {
      const id = rest[0];
      if (!id) {
        console.error("goal-store: gate requires <id>");
        return 2;
      }
      const dryRun = rest.includes("--dry-run");
      const timeoutIdx = rest.indexOf("--timeout");
      if (timeoutIdx >= 0) {
        const raw = rest[timeoutIdx + 1];
        const ms = Number(raw);
        if (raw === void 0 || !Number.isFinite(ms) || ms <= 0) {
          console.error(`goal-store: --timeout requires a positive number of milliseconds (got ${JSON.stringify(raw)})`);
          return 2;
        }
        process.env.QUAY_ACCEPTANCE_TIMEOUT_MS = String(ms);
      }
      const { appendGateEvent: appendGateEvent2 } = await Promise.resolve().then(() => (init_gate_event_store(), gate_event_store_exports));
      const rec = store.get(id);
      if (!rec) {
        console.error(`goal-store: no such goal: ${id}`);
        return 2;
      }
      const criterion = rec.criterion;
      let verdict2;
      let reason;
      let cause = null;
      const t = resolveAcceptanceTimeout(rec.timeoutMs);
      const timeoutMs = t.timeoutMs;
      const gateCwd = criterionCwdFor(
        root,
        buildCriterionRoots(root, store.list()),
        rec
      );
      if (typeof criterion !== "string" || criterion.trim() === "") {
        verdict2 = "fail";
        reason = `${id} has no criterion defined (fail-closed \u2014 an unenforceable AC must never silently pass)`;
      } else {
        const result = runAcceptance({
          command: criterion,
          cwd: gateCwd,
          timeoutMs: t.timeoutMs,
          timeoutKnob: timeoutKnobHint(t)
        });
        const v = verdictFromAcceptance(result);
        verdict2 = v.verdict;
        reason = v.reason;
        cause = v.cause;
      }
      const event = {
        id: randomUUID(),
        item_id: id,
        pipeline_id: id,
        gate: "goal",
        actor: "goal-cli",
        verdict: verdict2,
        timestamp: (/* @__PURE__ */ new Date()).toISOString(),
        // `cause` only when there is one — see the sweep site's note on the payload shape.
        // `evaluationRoot`/`treeSha` name WHICH tree this verdict was obtained on (SPEC §7 辛):
        // `gateCwd` is the criterion cwd passed to `runAcceptance` above, so the two are the same tree
        // (the criterion worktree for a branch-mode goal, the main checkout otherwise).
        payload: { reason, ...cause ? { cause } : {}, ...evaluationContext(gateCwd) }
      };
      if (!dryRun) appendGateEvent2(logPath, event);
      const out = { id, verdict: verdict2, cause, reason, timeoutMs, timestamp: event.timestamp, dryRun, event };
      process.stdout.write(JSON.stringify(out, null, 2) + "\n");
      return verdict2 === "pass" ? 0 : 1;
    }
    case "check": {
      const KNOWN_CHECK_FLAGS = /* @__PURE__ */ new Set([
        "--reverify-scope",
        "--adjudication",
        "--achieved-failing",
        "--staleness",
        "--stale-pass",
        "--sweep",
        "--budget",
        "--min-age-ms",
        "--wall-ms"
      ]);
      const unknownFlags = rest.filter((a) => a.startsWith("--") && !KNOWN_CHECK_FLAGS.has(a));
      if (unknownFlags.length > 0) {
        console.error(`goal-store: unknown check flag(s): ${unknownFlags.join(", ")} \u2014 refusing to fall through to a different check (fail-closed)`);
        return 2;
      }
      if (rest.includes("--reverify-scope")) {
        const r2 = store.checkReverifyScope();
        const out = { ...r2 };
        const violations = [];
        const ai = rest.indexOf("--adjudication");
        if (ai >= 0) {
          const adjPath = rest[ai + 1];
          if (adjPath === void 0 || !fs11.existsSync(adjPath)) {
            console.error(`goal-store: --adjudication ${JSON.stringify(adjPath)} is not readable`);
            return 2;
          }
          const adj = parseAdjudicationTable(fs11.readFileSync(adjPath, "utf8"));
          const inIds = new Set(r2.inScope.map((e) => e.id));
          const standingMissing = adj.standing.filter((id) => !inIds.has(id));
          const oneTimeButInScope = adj.oneTime.filter((id) => inIds.has(id));
          const undeclaredInScope = r2.inScope.filter((e) => e.goalStatus === "achieved" && !e.longTerm).map((e) => e.id);
          out.adjudication = { ...adj, standingMissing, oneTimeButInScope, undeclaredInScope };
          for (const id of adj.unrecognized) violations.push(`unrecognized ruling for ${id.id}: ${JSON.stringify(id.ruling)}`);
          for (const id of standingMissing) violations.push(`ruled \u5E38\u8BBE\u4E0D\u53D8\u5F0F but NOT in reverify scope (long-term not written): ${id}`);
          for (const id of oneTimeButInScope) violations.push(`ruled \u4E00\u6B21\u6027\u9A8C\u6536 but IS in reverify scope: ${id}`);
          for (const id of undeclaredInScope) violations.push(`in scope under an achieved GOAL without long-term: ${id}`);
        }
        out.violations = violations;
        process.stdout.write(JSON.stringify(out, null, 2) + "\n");
        if (violations.length > 0) {
          for (const v of violations) console.error(`goal-store: ${v}`);
          return 1;
        }
        return r2.scopeSize > 0 ? 0 : 3;
      }
      if (rest.includes("--stale-pass")) {
        const numArg = (flag, dflt) => {
          const i2 = rest.indexOf(flag);
          if (i2 < 0) return dflt;
          const n = Number(rest[i2 + 1]);
          return Number.isFinite(n) && n >= 0 ? n : dflt;
        };
        let sweep = null;
        if (rest.includes("--sweep")) {
          sweep = await store.sweepFrozen({
            budget: numArg("--budget", DEFAULT_SWEEP_BUDGET),
            minAgeMs: numArg("--min-age-ms", DEFAULT_SWEEP_MIN_AGE_MS),
            wallMs: numArg("--wall-ms", DEFAULT_SWEEP_WALL_MS)
          });
        }
        const r2 = store.checkStalePass();
        process.stdout.write(JSON.stringify(sweep ? { ...r2, sweep } : r2, null, 2) + "\n");
        if (r2.failing.length > 0) {
          console.error(`stale-pass: frozen achieved AC(s) whose criterion is CURRENTLY false: ${r2.failing.join(", ")}`);
          return 1;
        }
        if (r2.frozenScope > 0 && (r2.rotation.sweptEver === 0 || r2.notEvaluated.length > 0)) {
          const why = r2.rotation.sweptEver === 0 ? `the rotation has never run (no actor=${SWEEP_ACTOR} event in the ledger)` : `the rotation ran and ${r2.notEvaluated.length} criterion(a) declared NOT-EVALUATED here: ${r2.notEvaluated.join(", ")}`;
          console.error(`stale-pass: NOT-EVALUATED \u2014 ${r2.frozenScope} frozen achieved AC(s) but ${why}`);
          return 3;
        }
        return 0;
      }
      if (rest.includes("--achieved-failing")) {
        const r2 = store.checkAchievedFailing();
        process.stdout.write(JSON.stringify(r2, null, 2) + "\n");
        return r2.achievedButFailing.length === 0 && r2.evaluated ? 0 : 1;
      }
      if (rest.includes("--staleness")) {
        const r2 = store.checkStaleness();
        process.stdout.write(JSON.stringify(r2, null, 2) + "\n");
        return r2.divergent.length === 0 ? 0 : 1;
      }
      const r = store.checkWithinCap();
      process.stdout.write(JSON.stringify(r, null, 2) + "\n");
      return r.withinCap ? 0 : 1;
    }
    default: {
      console.error(
        `goal-store: unknown subcommand ${JSON.stringify(sub)} \u2014 expected list|get|write|batch|gate|check`
      );
      return 2;
    }
  }
}
var import_yaml4, VALID_GOAL_STATUSES, MIN_GOAL_BODY_CHARS, VALID_CRITERION_PHASES, GOAL_ID_RE, AC_ID_RE, GOAL_ACCEPTANCE_ACTIVE_ENV, GOAL_CRITERION_WORKTREE_PREFIX, SWEEP_ACTOR, AMEND_ACTOR, DEFAULT_SWEEP_MIN_AGE_MS, DEFAULT_SWEEP_BUDGET, DEFAULT_SWEEP_WALL_MS, DEFAULT_FAIL_RECHECK_DIVISOR, DEFAULT_STALE_PASS_MAX_AGE_MS, OWNED_KEYS2, GOAL_STALENESS_SIGNAL_REL, DEFAULT_GOAL_CAP, DEFAULT_STALE_MS, GoalIntentConflictError, FAILURE_EXIT_RE, EXIT_CALL_SRC, TRAILING_ELSE_NONZERO_RE, SILENT_PREDICATE_RE, DEVNULL_OUT_RE, DEVNULL_BOTH_RE, DEVNULL_ERR_RE, STDERR_FOLLOWS_STDOUT_RE, ATTRIBUTION_RE, ERREXIT_ON_RE, ERREXIT_OFF_RE, CONDITION_OPENER_RE, CONDITION_END_RE, ASSIGNMENT_PREFIX_RE, CMD_SUBST_RE, FIDELITY_JUDGE_TIMEOUT_MS, isMain;
var init_goal_store = __esm({
  "packages/quay/src/goal-store.ts"() {
    import_yaml4 = __toESM(require_dist(), 1);
    init_frontmatter_store_base();
    init_acceptance_runner();
    init_gate_run_options();
    init_gate_event_store();
    init_store_commit();
    init_criterion_fidelity();
    init_plugin_root();
    init_abi();
    init_env_merge();
    init_branch_model();
    init_worktree_namespace();
    VALID_GOAL_STATUSES = [...GOAL_STATUSES];
    MIN_GOAL_BODY_CHARS = 40;
    VALID_CRITERION_PHASES = ["pre-merge", "post-merge"];
    GOAL_ID_RE = /^GOAL-\d{3,}$/;
    AC_ID_RE = /^AC-\d{3,}$/;
    GOAL_ACCEPTANCE_ACTIVE_ENV = "QUAY_GOAL_ACCEPTANCE_ACTIVE";
    GOAL_CRITERION_WORKTREE_PREFIX = "goal-";
    SWEEP_ACTOR = "goal-sweep";
    AMEND_ACTOR = "goal-amend";
    DEFAULT_SWEEP_MIN_AGE_MS = 60 * 60 * 1e3;
    DEFAULT_SWEEP_BUDGET = 6;
    DEFAULT_SWEEP_WALL_MS = 3e4;
    DEFAULT_FAIL_RECHECK_DIVISOR = 6;
    DEFAULT_STALE_PASS_MAX_AGE_MS = 4 * 60 * 60 * 1e3;
    OWNED_KEYS2 = /* @__PURE__ */ new Set([
      "id",
      "title",
      "status",
      "kind",
      "goal",
      "criterion",
      "expect",
      "origin",
      "activatedAt",
      "statusLog",
      "labels",
      "posture",
      "supersedes",
      "superseded-by",
      "long-term",
      "fidelity",
      "timeoutMs",
      // SPEC-goal-branch §4.1 — the opt-in isolation gate. The branch NAME is derived (`goal/<id>`),
      // ⛔ never a stored field: storing it would make "which branch does this goal land on" a
      // human-writable arbitrary string, which is exactly what §4.8's identity rule forbids.
      "branch",
      // SPEC-goal-branch §4.7 (裁定⑭⑮) — an AC's evaluation phase. Declared, never inferred from the
      // criterion's text (hard rule 2); projected as `pre-merge` when absent.
      "phase"
    ]);
    GOAL_STALENESS_SIGNAL_REL = ".quay/goal-staleness-signal.jsonl";
    DEFAULT_GOAL_CAP = 3;
    DEFAULT_STALE_MS = 7 * 24 * 60 * 60 * 1e3;
    GoalIntentConflictError = class extends Error {
      id;
      expect;
      actual;
      constructor(id, expect, actual) {
        super(
          `goal-store intent conflict on ${id}: declared ${expect === "absent" ? "--expect-absent (create intent)" : "--expect-existing (update intent)"} but ${actual === "present" ? "the record already exists" : "the record does not exist"} \u2014 refusing to ${expect === "absent" ? "overwrite" : "create"} (write() aborted, nothing written to disk)`
        );
        this.name = "GoalIntentConflictError";
        this.id = id;
        this.expect = expect;
        this.actual = actual;
      }
    };
    FAILURE_EXIT_RE = /(?:sys\.)?exit\s*\(\s*1(?![\d])|\bexit\s+1\b/;
    EXIT_CALL_SRC = "(?:sys\\.)?exit\\s*\\(";
    TRAILING_ELSE_NONZERO_RE = /\belse\s*[1-9]\d*\s*$/;
    SILENT_PREDICATE_RE = /^(?:command\s+|!\s*)*(?:\[|test|grep)(?:\s|$)/;
    DEVNULL_OUT_RE = /(?:^|\s)(?:1?>|1?>>)\s*\/dev\/null(?:\s|$)/;
    DEVNULL_BOTH_RE = /(?:^|\s)(?:&>|>&)\s*\/dev\/null(?:\s|$)/;
    DEVNULL_ERR_RE = /(?:^|\s)(?:2>|2>>)\s*\/dev\/null(?:\s|$)/;
    STDERR_FOLLOWS_STDOUT_RE = /(?:^|\s)2>&1(?:\s|$)/;
    ATTRIBUTION_RE = /stderr|>&2|console\.error/;
    ERREXIT_ON_RE = /^(?:command\s+)?set\s+(?:-\w*e\w*(?:\s|$)|-\w*o\s+errexit(?:\s|$))/;
    ERREXIT_OFF_RE = /^(?:command\s+)?set\s+(?:\+\w*e\w*(?:\s|$)|\+\w*o\s+errexit(?:\s|$))/;
    CONDITION_OPENER_RE = /^(?:if|elif|while|until|!)(?:\s|$)/;
    CONDITION_END_RE = /(?:^|[;&|\s])(?:then|do)\s*$/;
    ASSIGNMENT_PREFIX_RE = /^(?:export\s+|readonly\s+|declare\s+-\w+\s+)?[A-Za-z_][A-Za-z0-9_]*=(?!=)/;
    CMD_SUBST_RE = /\$\(|`/;
    FIDELITY_JUDGE_TIMEOUT_MS = 18e4;
    isMain = process.argv[1] != null && process.argv[1].endsWith("goal-store.ts");
    if (isMain) {
      runGoalStoreCli(process.argv).then((code) => {
        process.exitCode = code;
      });
    }
  }
});

// packages/quay/src/gate/factories/goal.ts
import path12 from "node:path";
function makeGoalGate(goalId, goalDir) {
  return async (_task) => {
    const store = createGoalStore(goalDir);
    const goal = store.get(goalId);
    if (!goal) {
      return { ok: false, reason: `no such goal: ${goalId}` };
    }
    const criterion = goal.criterion;
    if (typeof criterion !== "string" || criterion.trim() === "") {
      return {
        ok: false,
        reason: `${goalId} has no criterion defined (fail-closed \u2014 an unenforceable AC must never silently pass)`
      };
    }
    const { cwd, timeoutMs } = resolveRunnerOptions({ cwd: path12.dirname(goalDir) });
    const result = runAcceptance({ command: criterion, cwd, timeoutMs });
    return { ok: result.ok, reason: result.reason, kind: verdictFromAcceptance(result).verdict };
  };
}
var init_goal = __esm({
  "packages/quay/src/gate/factories/goal.ts"() {
    init_acceptance_runner();
    init_gate_run_options();
    init_goal_store();
  }
});

// packages/quay/src/gate/factories/utils.ts
var init_utils = __esm({
  "packages/quay/src/gate/factories/utils.ts"() {
    init_gate_run_options();
  }
});

// packages/quay/src/gate/factories/it0.ts
function makeIt0Gate(scriptPath, argsKey, label, gateConfig) {
  return async (task) => {
    const args = task.extra?.[argsKey];
    if (!Array.isArray(args) || args.length === 0 || typeof args[0] !== "string" || args[0].trim() === "") {
      return {
        ok: false,
        reason: `no ${label} arguments defined (set task.extra.${argsKey} to an array, e.g. via \`quay task edit <id> --extra '{"${argsKey}":["<arg1>"]}'\`)`
      };
    }
    const command = [scriptPath, ...args].map(shQuote).join(" ");
    const { cwd, timeoutMs } = resolveRunnerOptions(gateConfig);
    const { ok, reason } = runAcceptance({ command, cwd, timeoutMs });
    return { ok, reason };
  };
}
var init_it0 = __esm({
  "packages/quay/src/gate/factories/it0.ts"() {
    init_acceptance_runner();
    init_utils();
  }
});

// packages/quay/src/gate/factories/fixed-script.ts
function makeFixedScriptGate(scriptPath, _label, gateConfig) {
  return async () => {
    const command = shQuote(scriptPath);
    const { cwd, timeoutMs } = resolveRunnerOptions(gateConfig);
    const { ok, reason } = runAcceptance({ command, cwd, timeoutMs });
    return { ok, reason };
  };
}
var init_fixed_script = __esm({
  "packages/quay/src/gate/factories/fixed-script.ts"() {
    init_acceptance_runner();
    init_utils();
  }
});

// packages/quay/src/adr-store.ts
import fs12 from "node:fs";
import path13 from "node:path";
function createAdrStore(adrDir) {
  fs12.mkdirSync(adrDir, { recursive: true });
  const assertSafeId = makeAssertSafeId("ADR", ADR_ID_RE, "ADR-NNN (>=3 digits)");
  const assertSafeStatus = makeAssertSafeStatus("ADR", VALID_ADR_STATUSES);
  function fileNameForId2(id) {
    return fileNameForId(adrDir, id);
  }
  function withLock(id, fn) {
    return withFileLock(adrDir, id, fn);
  }
  function parse(raw) {
    try {
      return parseFrontmatter(raw);
    } catch {
      throw new Error("malformed ADR file: missing YAML frontmatter block");
    }
  }
  function serialize(frontmatter, body) {
    return serializeFrontmatter(frontmatter, body);
  }
  function toViewModel(frontmatter, body, updatedAt) {
    const vm = {
      id: frontmatter.id,
      title: frontmatter.title,
      status: frontmatter.status,
      date: frontmatter.date ?? null,
      supersedes: frontmatter.supersedes ?? [],
      supersededBy: frontmatter["superseded-by"] ?? [],
      tags: frontmatter.tags ?? [],
      // Surface the applies-to/enforcement fields reserved above (round-tripped
      // verbatim, previously unconsumed) — the "continuously applied" half.
      // Additive/non-breaking: absent → empty array / undefined, same
      // safe-default shape as supersedes/tags above.
      appliesTo: frontmatter["applies-to"] ?? [],
      enforcement: frontmatter.enforcement,
      body
    };
    if (updatedAt !== void 0) vm.updatedAt = updatedAt;
    return vm;
  }
  function appliesToMatches(appliesTo, targetPath) {
    if (!Array.isArray(appliesTo) || appliesTo.length === 0) return false;
    return appliesTo.some((glob) => {
      try {
        return path13.matchesGlob(targetPath, glob);
      } catch {
        return false;
      }
    });
  }
  function get(id) {
    assertSafeId(id);
    const file = fileNameForId2(id);
    if (!file) return null;
    const p = path13.join(adrDir, file);
    const { frontmatter, body } = parse(fs12.readFileSync(p, "utf8"));
    let updatedAt;
    try {
      updatedAt = fs12.statSync(p).mtimeMs;
    } catch {
    }
    return toViewModel(frontmatter, body, updatedAt);
  }
  function listWithMalformed(filter = {}) {
    const malformed = [];
    const items = [];
    for (const f of fs12.readdirSync(adrDir)) {
      if (!(f.endsWith(".md") && f.startsWith("ADR-"))) continue;
      const p = path13.join(adrDir, f);
      const raw = fs12.readFileSync(p, "utf8");
      let parsed = null;
      try {
        parsed = parse(raw);
      } catch (err) {
        malformed.push({ file: f, error: err.message });
      }
      if (!parsed) continue;
      let updatedAt;
      try {
        updatedAt = fs12.statSync(p).mtimeMs;
      } catch {
      }
      items.push(toViewModel(parsed.frontmatter, parsed.body, updatedAt));
    }
    return {
      items: items.filter((a) => filter.status ? a.status === filter.status : true).filter((a) => filter.tag ? (a.tags || []).includes(filter.tag) : true).filter((a) => filter.appliesTo ? appliesToMatches(a.appliesTo, filter.appliesTo) : true).sort((a, b) => String(a.id).localeCompare(String(b.id))),
      malformed
    };
  }
  function list(filter = {}) {
    return listWithMalformed(filter).items;
  }
  function write(id, { title, status, date, supersedes, supersededBy, tags, body }) {
    assertSafeId(id);
    assertSafeStatus(status);
    return withLock(id, () => {
      const existingFile = fileNameForId2(id);
      let frontmatter = {};
      let existingBody = "";
      if (existingFile) {
        const parsed = parse(fs12.readFileSync(path13.join(adrDir, existingFile), "utf8"));
        frontmatter = { ...parsed.frontmatter };
        existingBody = parsed.body;
      }
      frontmatter.id = id;
      if (title !== void 0) frontmatter.title = title;
      const prevStatus = typeof frontmatter.status === "string" ? frontmatter.status : void 0;
      frontmatter.status = status ?? frontmatter.status ?? "proposed";
      if (date !== void 0) frontmatter.date = date;
      if (supersedes !== void 0) frontmatter.supersedes = supersedes;
      if (supersededBy !== void 0) frontmatter["superseded-by"] = supersededBy;
      if (tags !== void 0) frontmatter.tags = tags;
      const ordered = {};
      for (const k of ["id", "title", "status", "date", "supersedes", "superseded-by", "tags"]) {
        if (frontmatter[k] !== void 0) ordered[k] = frontmatter[k];
      }
      for (const k of Object.keys(frontmatter)) {
        if (!OWNED_KEYS3.has(k)) ordered[k] = frontmatter[k];
      }
      const finalBody = body !== void 0 ? body : existingBody;
      const fileName = existingFile ?? `${id}-${slugify(title)}.md`;
      fs12.writeFileSync(path13.join(adrDir, fileName), serialize(ordered, finalBody), "utf8");
      const action = !existingFile ? "create" : prevStatus !== void 0 && prevStatus !== frontmatter.status ? `status ${prevStatus}\u2192${frontmatter.status}` : "update";
      commitAdrFile(adrDir, fileName, id, action);
      return get(id);
    });
  }
  return { list, listWithMalformed, get, write };
}
function commitAdrFile(adrDir, fileName, id, action) {
  const root = resolveGitRoot(adrDir);
  return commitStoreWrite({
    relPath: root ? path13.relative(root, path13.join(adrDir, fileName)) : `adr/${fileName}`,
    kind: "adr",
    id,
    action,
    root,
    propagate: "none"
  }).outcome;
}
var VALID_ADR_STATUSES, ADR_ID_RE, OWNED_KEYS3;
var init_adr_store = __esm({
  "packages/quay/src/adr-store.ts"() {
    init_frontmatter_store_base();
    init_store_commit();
    VALID_ADR_STATUSES = ["proposed", "accepted", "superseded", "deprecated", "rejected"];
    ADR_ID_RE = /^ADR-\d{3,}$/;
    OWNED_KEYS3 = /* @__PURE__ */ new Set(["id", "title", "status", "date", "supersedes", "superseded-by", "tags"]);
  }
});

// packages/quay/src/gate/factories/adr.ts
import path14 from "node:path";
function makeAdrGate(adrId, adrDir) {
  return async (_task) => {
    const adrStore = createAdrStore(adrDir);
    const adr = adrStore.get(adrId);
    if (!adr) {
      return { ok: false, reason: `no such ADR: ${adrId}` };
    }
    if (adr.status !== "accepted") {
      return {
        ok: false,
        reason: `${adrId} is not accepted (status: ${adr.status}) \u2014 an ADR must be accepted before its gate can enforce it`
      };
    }
    const command = adr.enforcement;
    if (typeof command !== "string" || command.trim() === "") {
      return {
        ok: false,
        reason: `${adrId} has no enforcement command defined (set its \`enforcement:\` frontmatter field to a runnable check)`
      };
    }
    const { cwd, timeoutMs } = resolveRunnerOptions({ cwd: path14.dirname(adrDir) });
    const { ok, reason } = runAcceptance({ command, cwd, timeoutMs });
    return { ok, reason };
  };
}
var init_adr = __esm({
  "packages/quay/src/gate/factories/adr.ts"() {
    init_acceptance_runner();
    init_utils();
    init_adr_store();
  }
});

// packages/quay/src/gate/factories/test-pass.ts
function makeTestPassGate(command, _label, gateConfig) {
  return async () => {
    if (typeof command !== "string" || command.trim() === "") {
      return { ok: false, reason: "no test command configured (set gates.yml testPass[].command)" };
    }
    const { cwd, timeoutMs } = resolveRunnerOptions(gateConfig);
    const { ok, reason } = runAcceptance({ command, cwd, timeoutMs });
    return { ok, reason };
  };
}
var init_test_pass = __esm({
  "packages/quay/src/gate/factories/test-pass.ts"() {
    init_acceptance_runner();
    init_utils();
  }
});

// packages/quay/src/gate/factories/coverage-floor.ts
import { spawnSync as spawnSync3 } from "node:child_process";
function spawnSyncCapture(command, cwd, timeoutMs) {
  const r = spawnSync3(command, {
    cwd,
    shell: true,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (r.error && r.error.code === "ETIMEDOUT") {
    return { output: "", timedOut: true, error: null };
  }
  if (r.error) {
    return { output: "", timedOut: false, error: r.error.message };
  }
  return { output: `${r.stdout ?? ""}
${r.stderr ?? ""}`, timedOut: false, error: null };
}
function makeCoverageFloorGate(command, floor, pattern, _label, gateConfig) {
  return async () => {
    if (typeof command !== "string" || command.trim() === "") {
      return { ok: false, reason: "no coverage command configured (set gates.yml coverageFloor[].command)" };
    }
    if (typeof floor !== "number" || Number.isNaN(floor)) {
      return { ok: false, reason: "no coverage floor configured (set gates.yml coverageFloor[].floor, a number 0-100)" };
    }
    const { cwd, timeoutMs } = resolveRunnerOptions(gateConfig);
    const r = spawnSyncCapture(command, cwd, timeoutMs);
    if (r.timedOut) return { ok: false, reason: `coverage command timed out after ${timeoutMs}ms (killed) \u2014 raise gates.yml timeoutMs / --timeout` };
    if (r.error) return { ok: false, reason: `coverage command failed to spawn: ${r.error}` };
    const re = new RegExp(pattern && pattern.trim() !== "" ? pattern : "([\\d.]+)\\s*%");
    const m = re.exec(r.output);
    if (!m || m[1] === void 0) {
      return {
        ok: false,
        reason: `could not find a coverage percentage in command output (pattern ${JSON.stringify(re.source)} matched nothing)`
      };
    }
    const actual = Number(m[1]);
    if (Number.isNaN(actual)) {
      return { ok: false, reason: `matched coverage value ${JSON.stringify(m[1])} is not a number` };
    }
    const ok = actual >= floor;
    return {
      ok,
      reason: ok ? `coverage ${actual}% >= floor ${floor}%` : `coverage ${actual}% below floor ${floor}%`
    };
  };
}
var init_coverage_floor = __esm({
  "packages/quay/src/gate/factories/coverage-floor.ts"() {
    init_utils();
  }
});

// packages/quay/src/gate/factories/red-green.ts
function makeRedGreenGate(redCommand, greenCommand, _label, gateConfig) {
  return async () => {
    if (typeof redCommand !== "string" || redCommand.trim() === "") {
      return { ok: false, reason: "no red command configured (set gates.yml redGreen[].red)" };
    }
    if (typeof greenCommand !== "string" || greenCommand.trim() === "") {
      return { ok: false, reason: "no green command configured (set gates.yml redGreen[].green)" };
    }
    const { cwd, timeoutMs } = resolveRunnerOptions(gateConfig);
    const redResult = runAcceptance({ command: redCommand, cwd, timeoutMs });
    if (redResult.ok) {
      return { ok: false, reason: `red command unexpectedly passed (exit 0) \u2014 no real RED state to prove: ${redResult.reason}` };
    }
    const greenResult = runAcceptance({ command: greenCommand, cwd, timeoutMs });
    if (!greenResult.ok) {
      return { ok: false, reason: `green command failed \u2014 RED->GREEN transition not evidenced: ${greenResult.reason}` };
    }
    return { ok: true, reason: `red command failed as expected (${redResult.reason}); green command passed (${greenResult.reason})` };
  };
}
var init_red_green = __esm({
  "packages/quay/src/gate/factories/red-green.ts"() {
    init_acceptance_runner();
    init_utils();
  }
});

// packages/quay/src/gate/factories/index.ts
var gateFactories;
var init_factories = __esm({
  "packages/quay/src/gate/factories/index.ts"() {
    init_it0();
    init_fixed_script();
    init_adr();
    init_test_pass();
    init_coverage_floor();
    init_red_green();
    init_document_contract();
    init_goal();
    gateFactories = {
      "it0": makeIt0Gate,
      "fixed-script": makeFixedScriptGate,
      "adr": makeAdrGate,
      "test-pass": makeTestPassGate,
      "coverage-floor": makeCoverageFloorGate,
      "red-green": makeRedGreenGate,
      // SPEC-goal-mechanism-2026-09-06.md §5.2 / AC-176: makeGoalGate was exported but
      // missing from this dispatch map — a goal gate could not be configured via
      // gates.yml. Registered here so `type: goal` resolves (same gap the spec flagged
      // in its §9 "gateFactories 缺口" note).
      "goal": makeGoalGate
    };
  }
});

// packages/quay/src/gate/config/loader.ts
import fs13 from "node:fs";
import path15 from "node:path";
function resolveGateDiagnosticsSink() {
  if (cachedSink) return cachedSink;
  const raw = process.env.QUAY_GATE_DIAGNOSTICS;
  if (raw === void 0 || raw === "stderr" || raw.trim() === "") {
    cachedSink = { append(line) {
      process.stderr.write(line + "\n");
    } };
    return cachedSink;
  }
  if (raw === "quiet") {
    cachedSink = { append(_line) {
    } };
    return cachedSink;
  }
  const pending = [];
  const stream = fs13.createWriteStream(raw, { flags: "a" });
  let writer = (line) => {
    pending.push(line);
    stream.write(line + "\n");
  };
  let degraded = false;
  stream.on("error", (err) => {
    if (!degraded) {
      degraded = true;
      for (const line of pending) process.stderr.write(line + "\n");
      process.stderr.write("[error] QUAY_GATE_DIAGNOSTICS: cannot write to '" + raw + "' (" + err.message + "); falling back to stderr\n");
      writer = (line) => process.stderr.write(line + "\n");
    }
  });
  cachedSink = { append(line) {
    writer(line);
  } };
  return cachedSink;
}
function emitDiagnostic(severity, message) {
  resolveGateDiagnosticsSink().append(`${SEVERITY_LABEL[severity]} ${message}`);
}
function discoverWorkspaceRoot(startDir = process.cwd()) {
  const configPath = findConfig(startDir);
  if (!configPath) return null;
  return path15.dirname(path15.dirname(configPath));
}
function resolveGateConfigFile(workspaceRoot) {
  if (!workspaceRoot) return null;
  const unifiedConfigPath = path15.join(workspaceRoot, ".quay", "config.yml");
  if (fs13.existsSync(unifiedConfigPath)) {
    return { file: unifiedConfigPath, text: fs13.readFileSync(unifiedConfigPath, "utf8") };
  }
  const legacyGatesPath = path15.join(workspaceRoot, ".quay", "gates.yml");
  if (!fs13.existsSync(legacyGatesPath)) return null;
  return { file: legacyGatesPath, text: fs13.readFileSync(legacyGatesPath, "utf8") };
}
function parseGatesConfig(text, srcFile) {
  const empty = { it0: [], adr: [], fixed: [], testPass: [], coverageFloor: [], redGreen: [] };
  const adrLines = [];
  let doc;
  const lc = new import_yaml5.default.LineCounter();
  try {
    doc = import_yaml5.default.parseDocument(text, { keepSourceTokens: true, lineCounter: lc });
  } catch {
    return { config: srcFile ? { ...empty, srcFile } : empty, adrLines: [] };
  }
  if (doc.errors.length > 0) {
    return { config: srcFile ? { ...empty, srcFile } : empty, adrLines: [] };
  }
  if (!doc.contents || !import_yaml5.default.isMap(doc.contents)) {
    return { config: srcFile ? { ...empty, srcFile } : empty, adrLines: [] };
  }
  let gatesMap = null;
  if (doc.contents.has("gates")) {
    const gNode = doc.contents.get("gates", true);
    if (import_yaml5.default.isMap(gNode)) gatesMap = gNode;
  } else {
    const isLegacyGatesYml = srcFile !== void 0 && path15.basename(srcFile) === "gates.yml";
    if (isLegacyGatesYml) gatesMap = doc.contents;
  }
  if (!gatesMap) return { config: srcFile ? { ...empty, srcFile } : empty, adrLines: [] };
  for (const pair of gatesMap.items) {
    if (!import_yaml5.default.isScalar(pair.key)) continue;
    const key = String(pair.key.value);
    if (!KNOWN_GATE_SECTIONS.includes(key)) {
      emitDiagnostic("error", "unrecognized gate section '" + key + "' \u2014 expected one of " + KNOWN_GATE_SECTIONS.join(", ") + "; section ignored");
    } else if (!import_yaml5.default.isSeq(pair.value)) {
      emitDiagnostic("error", "gate section '" + key + "' must be a list (wrong nesting level); entries ignored");
    }
  }
  const lineOf = (node) => {
    const n = node;
    if (!n?.range?.[0]) return 0;
    return lc.linePos(n.range[0]).line;
  };
  const parseSection = (key) => {
    const node = gatesMap.get(key, true);
    if (!node || !import_yaml5.default.isSeq(node)) return [];
    return node.items.map((item) => {
      const line = lineOf(item);
      if (import_yaml5.default.isMap(item)) {
        const data = {};
        for (const pair of item.items) {
          if (import_yaml5.default.isScalar(pair.key)) {
            const k = String(pair.key.value);
            data[k] = import_yaml5.default.isScalar(pair.value) ? pair.value.value : pair.value?.toJSON?.() ?? null;
          }
        }
        return { data, line };
      }
      return { data: {}, line };
    }).filter((e) => Object.keys(e.data).length > 0);
  };
  const mkSrc = (line) => srcFile && line > 0 ? { file: srcFile, line } : void 0;
  const it0Parsed = parseSection("it0");
  const fixedParsed = parseSection("fixed");
  const testPassParsed = parseSection("testPass");
  const coverageFloorParsed = parseSection("coverageFloor");
  const redGreenParsed = parseSection("redGreen");
  const adrNode = gatesMap.get("adr", true);
  if (adrNode && import_yaml5.default.isSeq(adrNode)) {
    for (const item of adrNode.items) {
      if (import_yaml5.default.isScalar(item) && typeof item.value === "string" && item.value.trim() !== "") {
        adrLines.push({ id: item.value.trim(), line: lineOf(item) });
      }
    }
  }
  const config = {
    it0: it0Parsed.map((e) => ({ ...e.data, src: mkSrc(e.line) })),
    adr: adrLines.map((a) => a.id),
    fixed: fixedParsed.map((e) => ({ ...e.data, src: mkSrc(e.line) })),
    testPass: testPassParsed.map((e) => ({ ...e.data, src: mkSrc(e.line) })),
    coverageFloor: coverageFloorParsed.map((e) => ({ ...e.data, src: mkSrc(e.line) })),
    redGreen: redGreenParsed.map((e) => ({ ...e.data, src: mkSrc(e.line) })),
    srcFile
  };
  return { config, adrLines };
}
function fieldPresent(entry, field) {
  const v = entry[field];
  switch (field) {
    case "name":
    case "script":
    case "argsKey":
      return Boolean(v);
    case "command":
    case "red":
    case "green":
      return typeof v === "string";
    case "floor":
      return typeof v === "number";
    default:
      return true;
  }
}
function collectEntryDiagnostics(type, entry) {
  const e = entry;
  const missing = (REQUIRED_FIELDS[type] ?? []).filter((f) => !e || !fieldPresent(e, f));
  if (missing.length === 0) return [];
  const name = typeof e?.name === "string" && e.name.trim() !== "" ? e.name : "<unnamed>";
  return missing.map((field) => ({
    level: "ERROR",
    message: type + " gate '" + name + "' missing required field '" + field + "' \u2014 gate will not be registered"
  }));
}
function warnExtraFields(type, entry, known) {
  const extras = Object.keys(entry).filter((k) => !known.has(k));
  if (extras.length > 0) {
    const name = typeof entry.name === "string" && entry.name.trim() !== "" ? entry.name : "<unnamed>";
    emitDiagnostic("warn", type + " gate '" + name + "' has unexpected extra field(s) \u2014 registered");
  }
}
function loadWorkspaceGateMetadata(workspaceRoot) {
  if (!workspaceRoot) return { gates: {}, rows: [], diagnostics: [] };
  const resolved = resolveGateConfigFile(workspaceRoot);
  const diagnostics = [];
  const rows = [];
  const gates = {};
  if (resolved) {
    let cfg;
    let adrLines;
    try {
      const parsed = parseGatesConfig(resolved.text, resolved.file);
      cfg = parsed.config;
      adrLines = parsed.adrLines;
    } catch {
      return { gates: {}, rows: [], diagnostics: [] };
    }
    const srcFile = cfg.srcFile ?? resolved.file;
    const srcStr = (line) => line > 0 ? srcFile + ":" + line : srcFile;
    const configYmlPath = path15.join(workspaceRoot, ".quay", "config.yml");
    if (fs13.existsSync(configYmlPath)) {
      const legacyPath = path15.join(workspaceRoot, ".quay", "gates.yml");
      if (fs13.existsSync(legacyPath)) {
        try {
          const legacyCfg = parseGatesConfig(fs13.readFileSync(legacyPath, "utf8"), legacyPath).config;
          const registered = new Set([
            ...cfg.it0.map((e) => e.name),
            ...cfg.adr,
            ...cfg.fixed.map((e) => e.name),
            ...cfg.testPass.map((e) => e.name),
            ...cfg.coverageFloor.map((e) => e.name),
            ...cfg.redGreen.map((e) => e.name)
          ].filter(Boolean));
          for (const arr of [legacyCfg.it0, legacyCfg.fixed, legacyCfg.testPass, legacyCfg.coverageFloor, legacyCfg.redGreen]) {
            for (const e of arr) {
              const nm = e.name;
              if (nm && !registered.has(nm)) {
                const legacySrc = e.src;
                const loc = legacySrc ? legacySrc.file + ":" + legacySrc.line : legacyPath;
                diagnostics.push({
                  level: "WARNING",
                  message: "gate '" + nm + "' declared in " + loc + " as testPass but NOT registered \u2014 .quay/config.yml has a gates: section that takes precedence (DIR-050)."
                });
              }
            }
          }
        } catch {
        }
      }
    }
    const gateConfigOf = (entry) => {
      const cwd = typeof entry?.cwd === "string" && entry.cwd.trim() !== "" ? path15.isAbsolute(entry.cwd) ? entry.cwd : path15.resolve(workspaceRoot, entry.cwd) : void 0;
      const timeoutMs = typeof entry?.timeoutMs === "number" && entry.timeoutMs > 0 ? entry.timeoutMs : void 0;
      return { cwd, timeoutMs };
    };
    for (const entry of cfg.it0) {
      if (!entry || !fieldPresent(entry, "name") || !fieldPresent(entry, "script") || !fieldPresent(entry, "argsKey")) {
        diagnostics.push(...collectEntryDiagnostics("it0", entry));
        continue;
      }
      const scriptPath = path15.isAbsolute(entry.script) ? entry.script : path15.resolve(workspaceRoot, entry.script);
      gates[entry.name] = gateFactories["it0"](scriptPath, entry.argsKey, entry.name, gateConfigOf(entry));
      rows.push({ name: entry.name, source: srcStr(entry.src?.line ?? 0), type: "it0", detail: "script: " + entry.script + " argsKey: " + entry.argsKey });
      warnExtraFields("it0", entry, KNOWN_IT0);
    }
    const adrDir = path15.join(workspaceRoot, "adr");
    for (const a of adrLines) {
      if (!a.id || a.id.trim() === "") continue;
      gates[a.id.toLowerCase()] = gateFactories["adr"](a.id, adrDir);
      rows.push({ name: a.id.toLowerCase(), source: srcStr(a.line), type: "adr", detail: "adr: " + a.id });
    }
    for (const entry of cfg.fixed) {
      if (!entry || !fieldPresent(entry, "name") || !fieldPresent(entry, "script")) {
        diagnostics.push(...collectEntryDiagnostics("fixed", entry));
        continue;
      }
      const scriptPath = path15.isAbsolute(entry.script) ? entry.script : path15.resolve(workspaceRoot, entry.script);
      gates[entry.name] = gateFactories["fixed-script"](scriptPath, entry.name, gateConfigOf(entry));
      rows.push({ name: entry.name, source: srcStr(entry.src?.line ?? 0), type: "fixed", detail: "script: " + entry.script });
      warnExtraFields("fixed", entry, KNOWN_FIXED);
    }
    for (const entry of cfg.testPass) {
      if (!entry || !fieldPresent(entry, "name") || !fieldPresent(entry, "command")) {
        diagnostics.push(...collectEntryDiagnostics("testPass", entry));
        continue;
      }
      gates[entry.name] = gateFactories["test-pass"](entry.command, entry.name, gateConfigOf(entry));
      rows.push({ name: entry.name, source: srcStr(entry.src?.line ?? 0), type: "testPass", detail: "command: " + entry.command });
      warnExtraFields("testPass", entry, KNOWN_TP);
    }
    for (const entry of cfg.coverageFloor) {
      if (!entry || !fieldPresent(entry, "name") || !fieldPresent(entry, "command") || !fieldPresent(entry, "floor")) {
        diagnostics.push(...collectEntryDiagnostics("coverageFloor", entry));
        continue;
      }
      gates[entry.name] = gateFactories["coverage-floor"](entry.command, entry.floor, entry.pattern, entry.name, gateConfigOf(entry));
      rows.push({ name: entry.name, source: srcStr(entry.src?.line ?? 0), type: "coverageFloor", detail: "command: " + entry.command + " floor: " + entry.floor + "%" });
      warnExtraFields("coverageFloor", entry, KNOWN_COV);
    }
    for (const entry of cfg.redGreen) {
      if (!entry || !fieldPresent(entry, "name") || !fieldPresent(entry, "red") || !fieldPresent(entry, "green")) {
        diagnostics.push(...collectEntryDiagnostics("redGreen", entry));
        continue;
      }
      gates[entry.name] = gateFactories["red-green"](entry.red, entry.green, entry.name, gateConfigOf(entry));
      rows.push({ name: entry.name, source: srcStr(entry.src?.line ?? 0), type: "redGreen", detail: "red: " + entry.red + " green: " + entry.green });
      warnExtraFields("redGreen", entry, KNOWN_RG);
    }
  }
  for (const d of diagnostics) {
    if (d.level === "ERROR") {
      emitDiagnostic("error", d.message);
    }
  }
  return { gates, rows, diagnostics };
}
function loadWorkspaceGates(workspaceRoot) {
  return loadWorkspaceGateMetadata(workspaceRoot).gates;
}
var import_yaml5, SEVERITY_LABEL, KNOWN_GATE_SECTIONS, cachedSink, REQUIRED_FIELDS, KNOWN_IT0, KNOWN_FIXED, KNOWN_TP, KNOWN_COV, KNOWN_RG;
var init_loader = __esm({
  "packages/quay/src/gate/config/loader.ts"() {
    import_yaml5 = __toESM(require_dist(), 1);
    init_factories();
    init_config();
    SEVERITY_LABEL = {
      error: "[error]",
      warn: "[warn]"
    };
    KNOWN_GATE_SECTIONS = ["it0", "adr", "fixed", "testPass", "coverageFloor", "redGreen"];
    REQUIRED_FIELDS = {
      it0: ["name", "script", "argsKey"],
      fixed: ["name", "script"],
      testPass: ["name", "command"],
      coverageFloor: ["name", "command", "floor"],
      redGreen: ["name", "red", "green"]
    };
    KNOWN_IT0 = /* @__PURE__ */ new Set(["name", "script", "argsKey", "cwd", "timeoutMs", "src"]);
    KNOWN_FIXED = /* @__PURE__ */ new Set(["name", "script", "cwd", "timeoutMs", "src"]);
    KNOWN_TP = /* @__PURE__ */ new Set(["name", "command", "cwd", "timeoutMs", "src"]);
    KNOWN_COV = /* @__PURE__ */ new Set(["name", "command", "floor", "pattern", "cwd", "timeoutMs", "src"]);
    KNOWN_RG = /* @__PURE__ */ new Set(["name", "red", "green", "cwd", "timeoutMs", "src"]);
  }
});

// packages/quay/src/gate/registry.ts
import path16 from "node:path";
import { fileURLToPath as fileURLToPath4 } from "node:url";
function registerDocumentGate(gateName, docDir, docId) {
  gateRegistry[gateName] = makeDocumentContractGate(docId, docDir);
}
function listGates(workspaceRoot) {
  if (workspaceRoot === void 0) workspaceRoot = discoverWorkspaceRoot();
  return Object.keys(gateRegistry).concat(Object.keys(loadWorkspaceGates(workspaceRoot)));
}
var moduleDir2, REPO_ROOT, DOCUMENTS_DIR, DOCUMENT_GATE_IDS, gateRegistry, dg, i;
var init_registry = __esm({
  "packages/quay/src/gate/registry.ts"() {
    init_acceptance_runner();
    init_dark_axis_record();
    init_document_contract();
    init_goal();
    init_gate_run_options();
    init_loader();
    init_loader();
    moduleDir2 = typeof __dirname === "string" ? __dirname : path16.dirname(fileURLToPath4(import.meta.url));
    REPO_ROOT = discoverWorkspaceRoot(moduleDir2) ?? path16.resolve(moduleDir2, "..", "..", "..", "..");
    DOCUMENTS_DIR = path16.join(REPO_ROOT, "docs-managed");
    DOCUMENT_GATE_IDS = [{ gateName: "doc-quay-directive-skill", docId: "DOC-001" }];
    gateRegistry = {
      dod: async function(task, client) {
        var r = await client.taskCheck(task.id);
        return { ok: r.ok === true, reason: r.reason };
      },
      acceptance: async function(task) {
        var command = (task.extra || {}).acceptance;
        if (typeof command !== "string" || command.trim() === "") {
          return { ok: false, reason: "no acceptance command defined (set with `quay task edit <id> --acceptance '<cmd>'`)" };
        }
        var opts = resolveRunnerOptions();
        var result = runAcceptance({ command, cwd: opts.cwd, timeoutMs: opts.timeoutMs, envFile: opts.envFile });
        return { ok: result.ok, reason: result.reason, kind: verdictFromAcceptance(result).verdict };
      },
      // ADR-007's PER-MILESTONE half (net-new; tasks/gap-adr007-per-milestone-dark-axis-enforcement-gate).
      // The ADR forbids judging a milestone on L_T alone, and has recorded since 2026-07-20 that the
      // per-milestone predicate — "does the task record an L_D/L_G reading, or state explicitly that the
      // axis is still dark" — was STILL FUTURE WORK. Registered here as a real named gate (so
      // `quay gate <id> --gate dark-axis` / `gate_run{gate:"dark-axis"}` can assert it directly), and
      // required on the ready→done path by lifecycle.ts's runComplete/runCompleteLoop whenever the
      // workspace declares ADR-007. The judgment itself is dark-axis-record.ts — one implementation,
      // shared with the plugin CLI `plugin/scripts/dark-axis-record-check.ts`.
      "dark-axis": async function(task) {
        return darkAxisGateCheck(task);
      }
    };
    for (i = 0; i < DOCUMENT_GATE_IDS.length; i++) {
      dg = DOCUMENT_GATE_IDS[i];
      registerDocumentGate(dg.gateName, DOCUMENTS_DIR, dg.docId);
    }
  }
});

// packages/quay/src/loop-params.ts
var import_yaml6, VALID_STOP_RE, VALID_EXECUTION, VALID_AUDIT;
var init_loop_params = __esm({
  "packages/quay/src/loop-params.ts"() {
    import_yaml6 = __toESM(require_dist(), 1);
    VALID_STOP_RE = /^(once|until\(.+\))$/;
    VALID_EXECUTION = /* @__PURE__ */ new Set(["dispatched", "inline"]);
    VALID_AUDIT = /* @__PURE__ */ new Set(["adversarial", "none"]);
  }
});

// packages/quay/src/config-validate.ts
import fs14 from "node:fs";
import path17 from "node:path";
function extractWorkspaceGateNames(gatesSection) {
  if (!gatesSection || typeof gatesSection !== "object") return [];
  const names = [];
  const g = gatesSection;
  for (const key of KNOWN_GATE_KEYS) {
    const arr = g[key];
    if (Array.isArray(arr)) {
      for (const entry of arr) {
        if (key === "adr") {
          if (typeof entry === "string" && entry.trim() !== "") {
            names.push(entry.toLowerCase());
          }
        } else if (entry && typeof entry === "object" && typeof entry.name === "string") {
          names.push(entry.name);
        }
      }
    }
  }
  return names;
}
function gateEntryName(entry, index) {
  if (entry && typeof entry === "object" && typeof entry.name === "string") {
    return entry.name;
  }
  return `[${index}]`;
}
function checkProviders(unifiedParsed, workspaceRoot, pluginRoot) {
  const issues = [];
  if (!unifiedParsed || typeof unifiedParsed !== "object") return issues;
  const providers = unifiedParsed.providers;
  if (!providers || typeof providers !== "object") return issues;
  for (const [pid, pdata] of Object.entries(providers)) {
    if (!pdata || typeof pdata !== "object") continue;
    const p = pdata;
    if (p.enabled !== true) continue;
    if (pid === "native" && typeof p.path === "string" && p.path !== "") {
      const resolved = path17.isAbsolute(p.path) ? p.path : path17.resolve(workspaceRoot, p.path);
      if (FROZEN_CACHE_PATH_RE.test(p.path)) {
        issues.push({
          severity: "warn",
          field: `providers.${pid}.path`,
          message: `Native provider path "${p.path}" is frozen to a versioned plugin install-cache directory \u2014 the version segment pins the runtime and will not follow a plugin upgrade`,
          suggestion: `Remove providers.native.path and mcp_entry to let Core resolve them from the plugin root`
        });
      } else if (!fs14.existsSync(resolved)) {
        issues.push({
          severity: "error",
          field: `providers.${pid}.path`,
          message: `Native provider path does not exist: "${p.path}" (resolved to ${resolved})`,
          suggestion: `Remove providers.native.path and mcp_entry to let Core resolve them from the plugin root, or point path at an existing directory`
        });
      }
    }
    const resolvedEntry = resolveProviderEntry(pid, p, pluginRoot);
    if (resolvedEntry.mcpEntry) continue;
    if (resolvedEntry.unresolvable) {
      issues.push({
        severity: "error",
        field: `providers.${pid}`,
        code: NATIVE_PROVIDER_UNRESOLVABLE,
        message: `${NATIVE_PROVIDER_UNRESOLVABLE}: enabled provider "native" omits path/mcp_entry (Core resolves them from the plugin root) but no plugin root could be resolved`,
        suggestion: `Re-run /quay:init from an installed plugin, set QUAY_PLUGIN_ROOT, or declare mcp_entry: ["node", "<provider-runtime>", "mcp"] explicitly`
      });
    } else {
      issues.push({
        severity: "error",
        field: `providers.${pid}`,
        code: "provider-missing-mcp-entry",
        message: `Enabled provider "${pid}" is missing mcp_entry (must be a non-empty array)`,
        suggestion: 'Add mcp_entry: ["node", "./bin/<provider>.ts", "mcp"] to this provider'
      });
    }
  }
  return issues;
}
function checkGateNesting(gatesParsed) {
  const issues = [];
  if (!gatesParsed || typeof gatesParsed !== "object") return issues;
  const g = gatesParsed;
  for (const key of Object.keys(g)) {
    if (!KNOWN_GATE_KEYS.includes(key)) {
      issues.push({
        severity: "error",
        field: `gates.${key}`,
        message: `"${key}" is not a recognized gate type key`,
        suggestion: `Gate entries must be nested under one of: ${KNOWN_GATE_KEYS.join(", ")}. Example: gates:
  testPass:
    - name: ${key}
      command: "<cmd>"`
      });
    }
  }
  return issues;
}
function checkGateShapes(gatesParsed) {
  const issues = [];
  if (!gatesParsed || typeof gatesParsed !== "object") return issues;
  const g = gatesParsed;
  for (const key of KNOWN_GATE_KEYS) {
    const arr = g[key];
    if (!Array.isArray(arr)) continue;
    if (key === "adr") {
      for (let i2 = 0; i2 < arr.length; i2++) {
        const entry = arr[i2];
        if (typeof entry !== "string" || entry.trim() === "") {
          issues.push({
            severity: "error",
            field: `gates.adr[${i2}]`,
            message: `adr entry at index ${i2} must be a non-empty string (got ${typeof entry})`,
            suggestion: 'Each adr entry must be a string like "ADR-NNN"'
          });
        }
      }
      continue;
    }
    const schema = GATE_SCHEMAS[key];
    if (!schema) continue;
    for (let i2 = 0; i2 < arr.length; i2++) {
      const entry = arr[i2];
      if (!entry || typeof entry !== "object") {
        issues.push({
          severity: "error",
          field: `gates.${key}[${i2}]`,
          message: `Expected an object for ${key} gate entry at index ${i2}, got ${typeof entry}`,
          suggestion: `Should be: ${schema.shape}`
        });
        continue;
      }
      const e = entry;
      for (const field of schema.requiredFields) {
        if (field === "floor") {
          if (typeof e[field] !== "number") {
            issues.push({
              severity: "error",
              field: `gates.${key}[${i2}].${field}`,
              message: `${key} entry "${gateEntryName(entry, i2)}" is missing required field "${field}" (must be a number)`,
              suggestion: `Should be: ${schema.shape}`
            });
          }
        } else {
          if (!e[field] || typeof e[field] === "string" && e[field].trim() === "") {
            issues.push({
              severity: "error",
              field: `gates.${key}[${i2}].${field}`,
              message: `${key} entry "${gateEntryName(entry, i2)}" is missing required field "${field}"`,
              suggestion: `Should be: ${schema.shape}`
            });
          }
        }
      }
    }
  }
  return issues;
}
function checkGateReferences(loopParsed, gatesParsed, workspaceRoot) {
  const issues = [];
  if (!loopParsed || typeof loopParsed !== "object") return issues;
  const lp = loopParsed;
  if (lp.gates === void 0) return issues;
  let gateRefs;
  if (Array.isArray(lp.gates)) {
    gateRefs = lp.gates.filter((g) => typeof g === "string");
  } else if (typeof lp.gates === "string") {
    gateRefs = [lp.gates];
  } else {
    return issues;
  }
  const builtInNames = listGates(workspaceRoot);
  const workspaceNames = extractWorkspaceGateNames(gatesParsed);
  const knownNames = /* @__PURE__ */ new Set([...builtInNames, ...workspaceNames]);
  for (const ref of gateRefs) {
    if (!knownNames.has(ref)) {
      issues.push({
        severity: "error",
        field: `loop.gates`,
        message: `Unresolved gate reference: "${ref}" is not a registered gate name`,
        suggestion: `Registered gates: ${[...knownNames].sort().join(", ") || "(none)"}. Check that the gate is defined under "gates:" in your config.`
      });
    }
  }
  return issues;
}
function checkLoopRequiredFields(loopParsed) {
  const issues = [];
  if (!loopParsed || typeof loopParsed !== "object") return issues;
  const lp = loopParsed;
  if (!lp.board || typeof lp.board !== "string" || lp.board.trim() === "") {
    issues.push({
      severity: "error",
      field: "loop.board",
      message: `Missing required field "board" (provider name, e.g. "native")`
    });
  }
  if (lp.gates === void 0 || lp.gates === null) {
    issues.push({
      severity: "error",
      field: "loop.gates",
      message: `Missing required field "gates" (gate name or list, e.g. ["acceptance"])`
    });
  } else if (!Array.isArray(lp.gates) && typeof lp.gates !== "string") {
    issues.push({
      severity: "error",
      field: "loop.gates",
      message: `Field "gates" must be a string or non-empty array (got ${typeof lp.gates})`
    });
  } else if (typeof lp.gates === "string" && lp.gates.trim() === "") {
    issues.push({
      severity: "error",
      field: "loop.gates",
      message: `Field "gates" is an empty string \u2014 must be a non-empty gate name`
    });
  }
  return issues;
}
function checkLoopFieldValues(loopParsed) {
  const issues = [];
  if (!loopParsed || typeof loopParsed !== "object") return issues;
  const lp = loopParsed;
  if (lp.execution !== void 0) {
    const v = lp.execution;
    if (typeof v !== "string" || !VALID_EXECUTION.has(v)) {
      issues.push({
        severity: "error",
        field: "loop.execution",
        message: `Invalid execution value "${v}" \u2014 must be "dispatched" or "inline"`
      });
    }
  }
  if (lp.audit !== void 0) {
    const v = lp.audit;
    if (typeof v !== "string" || !VALID_AUDIT.has(v)) {
      issues.push({
        severity: "error",
        field: "loop.audit",
        message: `Invalid audit value "${v}" \u2014 must be "adversarial" or "none"`
      });
    }
  }
  if (lp.concurrency !== void 0) {
    const v = lp.concurrency;
    if (!Number.isInteger(v) || v < 1) {
      issues.push({
        severity: "error",
        field: "loop.concurrency",
        message: `Invalid concurrency value "${v}" \u2014 must be an integer >= 1`
      });
    }
  }
  if (lp.stop !== void 0) {
    const v = lp.stop;
    if (typeof v !== "string" || !VALID_STOP_RE.test(v.trim())) {
      issues.push({
        severity: "error",
        field: "loop.stop",
        message: `Invalid stop value "${v}" \u2014 must be "once", "until(.halt)", "until(empty)", or "until(<condition>)"`
      });
    }
  }
  return issues;
}
function checkRoutines(loopParsed) {
  const issues = [];
  if (!loopParsed || typeof loopParsed !== "object") return issues;
  const lp = loopParsed;
  const routines = lp.routines;
  if (routines === void 0) return issues;
  if (!Array.isArray(routines)) {
    issues.push({
      severity: "error",
      field: "loop.routines",
      message: `Field "routines" must be an array (got ${typeof routines})`
    });
    return issues;
  }
  for (let i2 = 0; i2 < routines.length; i2++) {
    const r = routines[i2];
    if (!r || typeof r !== "object") {
      issues.push({
        severity: "error",
        field: `loop.routines[${i2}]`,
        message: `Routine at index ${i2} must be an object (got ${typeof r})`
      });
      continue;
    }
    const entry = r;
    if (typeof entry.name !== "string" || entry.name.trim() === "") {
      issues.push({
        severity: "error",
        field: `loop.routines[${i2}].name`,
        message: `Routine at index ${i2} needs a non-empty string "name"`
      });
    }
    if (typeof entry.trigger !== "string") {
      issues.push({
        severity: "error",
        field: `loop.routines[${i2}].trigger`,
        message: `Routine "${entry.name ?? `[${i2}]`}" is missing required field "trigger"`,
        suggestion: 'Must be "every(N)" (N>=1), "interval:<N>m" (N>=1), or "on(<event>)"'
      });
    } else {
      const triggerStr = entry.trigger.trim();
      if (!/^(every\(\s*\d+\s*\)|interval:\s*\d+\s*m|on\(\s*[\w-]+\s*\))$/.test(triggerStr)) {
        issues.push({
          severity: "error",
          field: `loop.routines[${i2}].trigger`,
          message: `Routine "${entry.name ?? `[${i2}]`}" trigger "${triggerStr}" is invalid`,
          suggestion: 'Must be "every(N)" (N>=1), "interval:<N>m" (N>=1), or "on(<event>)"'
        });
      } else {
        const m = triggerStr.match(/^every\(\s*(\d+)\s*\)$/);
        if (m && Number(m[1]) < 1) {
          issues.push({
            severity: "error",
            field: `loop.routines[${i2}].trigger`,
            message: `Routine "${entry.name ?? `[${i2}]`}" trigger "every(${m[1]})" invalid \u2014 N must be >= 1`
          });
        }
        const intervalMatch = triggerStr.match(/^interval:\s*(\d+)\s*m$/);
        if (intervalMatch && Number(intervalMatch[1]) < 1) {
          issues.push({
            severity: "error",
            field: `loop.routines[${i2}].trigger`,
            message: `Routine "${entry.name ?? `[${i2}]`}" trigger "interval:${intervalMatch[1]}m" invalid \u2014 N must be >= 1`
          });
        }
      }
    }
    const hasDispatch = typeof entry.dispatch === "string" && entry.dispatch.trim() !== "";
    const hasProbe = typeof entry.probe === "string" && entry.probe.trim() !== "";
    if (!hasDispatch && !hasProbe) {
      issues.push({
        severity: "error",
        field: `loop.routines[${i2}]`,
        message: `Routine "${entry.name ?? `[${i2}]`}" needs at least one of "dispatch" or "probe"`
      });
    }
  }
  return issues;
}
function validateProviderEnv(unifiedParsed) {
  const issues = [];
  if (!unifiedParsed || typeof unifiedParsed !== "object") return issues;
  const providers = unifiedParsed.providers;
  if (!providers || typeof providers !== "object") return issues;
  for (const [pid, pdata] of Object.entries(providers)) {
    if (!pdata || typeof pdata !== "object") continue;
    const p = pdata;
    if (p.enabled !== true) continue;
    const env = p.env;
    const envMap = env && typeof env === "object" ? env : {};
    if (pid === "native") {
      if (!envMap.QUAY_NATIVE_TASKS_DIR) {
        issues.push({
          severity: "warn",
          field: `providers.${pid}.env.QUAY_NATIVE_TASKS_DIR`,
          message: `Native provider "${pid}" has no QUAY_NATIVE_TASKS_DIR env var \u2014 defaulting to ./tasks`
        });
      }
    } else if (pid === "github") {
      const repo = envMap.QUAY_GITHUB_REPO;
      if (!repo) {
        issues.push({
          severity: "warn",
          field: `providers.${pid}.env.QUAY_GITHUB_REPO`,
          message: `GitHub provider "${pid}" has no QUAY_GITHUB_REPO env var \u2014 defaulting to yaleh/quay`
        });
      } else {
        const parts = repo.split("/");
        if (parts.length < 2 || !parts[0] || !parts[1]) {
          issues.push({
            severity: "error",
            field: `providers.${pid}.env.QUAY_GITHUB_REPO`,
            message: `QUAY_GITHUB_REPO must be "owner/repo" (got: "${repo}")`
          });
        }
      }
    }
  }
  return issues;
}
function isPathBinary(token) {
  const dirs = (process.env.PATH || "").split(path17.delimiter);
  for (const dir of dirs) {
    const candidate = path17.join(dir, token);
    try {
      if (fs14.existsSync(candidate)) {
        const stat = fs14.statSync(candidate);
        if (stat.isFile()) return true;
      }
    } catch {
    }
  }
  return false;
}
function classifyCommandToken(token, fieldPath, workspaceRoot) {
  if (SHELL_KEYWORDS.has(token)) return null;
  if (isPathBinary(token)) return null;
  if (token.startsWith("./") || token.startsWith("../") || token.startsWith("/")) {
    const resolved = path17.isAbsolute(token) ? token : path17.resolve(workspaceRoot, token);
    if (!fs14.existsSync(resolved)) {
      return {
        severity: "error",
        field: fieldPath,
        message: `Script file not found: "${token}" (resolved to ${resolved})`
      };
    }
    return null;
  }
  return {
    severity: "warn",
    field: fieldPath,
    message: `Command token "${token}" is not resolvable on PATH and is not an explicit file path \u2014 may become available at build time`
  };
}
function checkFileExistence(gatesParsed, workspaceRoot) {
  const issues = [];
  if (!gatesParsed || typeof gatesParsed !== "object") return issues;
  const g = gatesParsed;
  const it0Arr = g.it0;
  if (Array.isArray(it0Arr)) {
    for (let i2 = 0; i2 < it0Arr.length; i2++) {
      const entry = it0Arr[i2];
      if (entry && typeof entry === "object") {
        const e = entry;
        if (typeof e.script === "string" && e.script.trim() !== "") {
          const script = e.script.trim();
          const resolved = path17.isAbsolute(script) ? script : path17.resolve(workspaceRoot, script);
          if (!fs14.existsSync(resolved)) {
            issues.push({
              severity: "error",
              field: `gates.it0[${i2}].script`,
              message: `Script file not found: "${script}" (resolved to ${resolved})`
            });
          }
        }
      }
    }
  }
  const fixedArr = g.fixed;
  if (Array.isArray(fixedArr)) {
    for (let i2 = 0; i2 < fixedArr.length; i2++) {
      const entry = fixedArr[i2];
      if (entry && typeof entry === "object") {
        const e = entry;
        if (typeof e.script === "string" && e.script.trim() !== "") {
          const script = e.script.trim();
          const resolved = path17.isAbsolute(script) ? script : path17.resolve(workspaceRoot, script);
          if (!fs14.existsSync(resolved)) {
            issues.push({
              severity: "error",
              field: `gates.fixed[${i2}].script`,
              message: `Script file not found: "${script}" (resolved to ${resolved})`
            });
          }
        }
      }
    }
  }
  const tpArr = g.testPass;
  if (Array.isArray(tpArr)) {
    for (let i2 = 0; i2 < tpArr.length; i2++) {
      const entry = tpArr[i2];
      if (entry && typeof entry === "object" && typeof entry.command === "string") {
        const cmd = entry.command.trim();
        if (cmd) {
          const firstToken = cmd.split(/\s+/)[0];
          const issue = classifyCommandToken(firstToken, `gates.testPass[${i2}].command`, workspaceRoot);
          if (issue) issues.push(issue);
        }
      }
    }
  }
  const cfArr = g.coverageFloor;
  if (Array.isArray(cfArr)) {
    for (let i2 = 0; i2 < cfArr.length; i2++) {
      const entry = cfArr[i2];
      if (entry && typeof entry === "object" && typeof entry.command === "string") {
        const cmd = entry.command.trim();
        if (cmd) {
          const firstToken = cmd.split(/\s+/)[0];
          const issue = classifyCommandToken(firstToken, `gates.coverageFloor[${i2}].command`, workspaceRoot);
          if (issue) issues.push(issue);
        }
      }
    }
  }
  const rgArr = g.redGreen;
  if (Array.isArray(rgArr)) {
    for (let i2 = 0; i2 < rgArr.length; i2++) {
      const entry = rgArr[i2];
      if (entry && typeof entry === "object") {
        const e = entry;
        for (const field of ["red", "green"]) {
          if (typeof e[field] === "string") {
            const cmd = e[field].trim();
            if (cmd) {
              const firstToken = cmd.split(/\s+/)[0];
              const issue = classifyCommandToken(firstToken, `gates.redGreen[${i2}].${field}`, workspaceRoot);
              if (issue) issues.push(issue);
            }
          }
        }
      }
    }
  }
  return issues;
}
function runChecks({ unifiedParsed, gatesParsed, loopParsed, workspaceRoot, pluginRoot, checkFiles }) {
  const allIssues = [];
  if (unifiedParsed) allIssues.push(...checkProviders(unifiedParsed, workspaceRoot, pluginRoot));
  if (gatesParsed) allIssues.push(...checkGateNesting(gatesParsed));
  if (gatesParsed) allIssues.push(...checkGateShapes(gatesParsed));
  if (loopParsed) allIssues.push(...checkGateReferences(loopParsed, gatesParsed, workspaceRoot));
  if (loopParsed) allIssues.push(...checkLoopRequiredFields(loopParsed));
  if (loopParsed) allIssues.push(...checkLoopFieldValues(loopParsed));
  if (loopParsed) allIssues.push(...checkRoutines(loopParsed));
  if (unifiedParsed) allIssues.push(...validateProviderEnv(unifiedParsed));
  if (checkFiles && gatesParsed) allIssues.push(...checkFileExistence(gatesParsed, workspaceRoot));
  return allIssues;
}
function verdict(issues) {
  return { ok: !issues.some((i2) => i2.severity === "error"), issues };
}
function validateConfigText({ text, workspaceRoot, checkFiles = false, pluginRoot }) {
  let unified;
  try {
    unified = import_yaml7.default.parse(text);
  } catch (e) {
    return {
      ok: false,
      issues: [{ severity: "error", field: "config.yml", message: `YAML syntax error in .quay/config.yml: ${e.message}` }]
    };
  }
  const u = unified && typeof unified === "object" ? unified : null;
  const issues = runChecks({
    unifiedParsed: unified,
    gatesParsed: u?.gates ?? null,
    loopParsed: u?.loop ?? null,
    workspaceRoot,
    pluginRoot,
    checkFiles
  });
  return verdict(issues);
}
var import_yaml7, KNOWN_GATE_KEYS, GATE_SCHEMAS, SHELL_KEYWORDS, FROZEN_CACHE_PATH_RE;
var init_config_validate = __esm({
  "packages/quay/src/config-validate.ts"() {
    import_yaml7 = __toESM(require_dist(), 1);
    init_config();
    init_registry();
    init_loop_params();
    KNOWN_GATE_KEYS = ["it0", "fixed", "testPass", "coverageFloor", "redGreen", "adr"];
    GATE_SCHEMAS = {
      it0: {
        requiredFields: ["name", "script", "argsKey"],
        shape: '{ name: "<name>", script: "<path>", argsKey: "<key>" }'
      },
      fixed: {
        requiredFields: ["name", "script"],
        shape: '{ name: "<name>", script: "<path>" }'
      },
      testPass: {
        requiredFields: ["name", "command"],
        shape: '{ name: "<name>", command: "<shell command>" }'
      },
      coverageFloor: {
        requiredFields: ["name", "command", "floor"],
        shape: '{ name: "<name>", command: "<shell command>", floor: <number> }'
      },
      redGreen: {
        requiredFields: ["name", "red", "green"],
        shape: '{ name: "<name>", red: "<command>", green: "<command>" }'
      },
      adr: {
        requiredFields: [],
        shape: '- "ADR-NNN"'
      }
    };
    SHELL_KEYWORDS = /* @__PURE__ */ new Set([
      "for",
      "while",
      "if",
      "case",
      "until",
      "do",
      "done",
      "then",
      "else",
      "elif",
      "fi",
      "esac",
      "time",
      "exec",
      "eval",
      "source",
      "."
    ]);
    FROZEN_CACHE_PATH_RE = /(^|[\\/])cache[\\/]quay[\\/]quay[\\/][^\\/]+([\\/]|$)/;
  }
});

// packages/quay/src/init.ts
var init_exports = {};
__export(init_exports, {
  CLOSED_SET_ITEMS: () => CLOSED_SET_ITEMS,
  DEFAULT_NEVER_LAYDOWN: () => DEFAULT_NEVER_LAYDOWN,
  KNOWN_TOP_LEVEL_CONFIG_KEYS: () => KNOWN_TOP_LEVEL_CONFIG_KEYS,
  LOOP_VALUE_MIGRATIONS: () => LOOP_VALUE_MIGRATIONS,
  LOOP_VERSION_DEFAULTS: () => LOOP_VERSION_DEFAULTS,
  RETIRED_CONFIG_KEYS: () => RETIRED_CONFIG_KEYS,
  autoCommitClosedSet: () => autoCommitClosedSet,
  buildInitReport: () => buildInitReport,
  classifyConfig: () => classifyConfig,
  closedSetFingerprint: () => closedSetFingerprint,
  closedSetReport: () => closedSetReport,
  corruptBackupPathFor: () => corruptBackupPathFor,
  deliverySurfaceL1Report: () => deliverySurfaceL1Report,
  deriveLoopScripts: () => deriveLoopScripts,
  deriveLoopScriptsClosure: () => deriveLoopScriptsClosure,
  detectProjectType: () => detectProjectType,
  detectProvider: () => detectProvider,
  detectTestCommand: () => detectTestCommand,
  detectTmuxSession: () => detectTmuxSession,
  ensureGitignore: () => ensureGitignore,
  ensureLoopConfig: () => ensureLoopConfig,
  ensureProviderCarrierEnv: () => ensureProviderCarrierEnv,
  ensureProviderCarrierEnvText: () => ensureProviderCarrierEnvText,
  foldPlainScalars: () => foldPlainScalars,
  generateConfigContent: () => generateConfigContent,
  generateLaunchSettingsContent: () => generateLaunchSettingsContent,
  generateProfilesContent: () => generateProfilesContent,
  hasNpmTestScript: () => hasNpmTestScript,
  mcpEntryForProvider: () => mcpEntryForProvider,
  migrateStaleMcpEntry: () => migrateStaleMcpEntry,
  printInstallSteps: () => printInstallSteps,
  printNextSteps: () => printNextSteps,
  profilesNamePrefix: () => profilesNamePrefix,
  providerEntryFile: () => providerEntryFile,
  providerRuntimeExistenceReport: () => providerRuntimeExistenceReport,
  pyYamlDump: () => pyYamlDump,
  readExistingLoopValue: () => readExistingLoopValue,
  readJsonField: () => readJsonField,
  readPluginName: () => readPluginName,
  readPluginRootVersion: () => readPluginRootVersion,
  readPluginVersion: () => readPluginVersion,
  reconcileConfigContent: () => reconcileConfigContent,
  reconcileConfigFile: () => reconcileConfigFile,
  refreshProjectPluginLink: () => refreshProjectPluginLink,
  resolveProjectLoopValues: () => resolveProjectLoopValues,
  runInit: () => runInit,
  snapshotClosedSet: () => snapshotClosedSet,
  switchEnabledProviderText: () => switchEnabledProviderText,
  upgradeConfigContent: () => upgradeConfigContent,
  validateWorktreeRoot: () => validateWorktreeRoot,
  writeClaudeSettings: () => writeClaudeSettings
});
import fs15 from "node:fs";
import os from "node:os";
import path18 from "node:path";
import { createHash as createHash2 } from "node:crypto";
import { execFileSync as execFileSync4, spawnSync as spawnSync4 } from "node:child_process";
function classifyConfig(configPath) {
  if (!fs15.existsSync(configPath)) return { state: "absent", configPath };
  let raw;
  try {
    raw = fs15.readFileSync(configPath, "utf8");
  } catch (err) {
    return { state: "corrupt", configPath, reason: `cannot read the file: ${err instanceof Error ? err.message : String(err)}` };
  }
  let parsed;
  try {
    parsed = import_yaml8.default.parse(raw);
  } catch (err) {
    return { state: "corrupt", configPath, reason: `YAML parse failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (parsed === null || parsed === void 0) return { state: "valid", configPath, config: {}, raw };
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      state: "corrupt",
      configPath,
      raw,
      reason: `the document's top level is ${Array.isArray(parsed) ? "a list" : `a ${typeof parsed}`}, not a mapping \u2014 no quay consumer can read it as a config`
    };
  }
  return { state: "valid", configPath, config: parsed, raw };
}
function reconcileConfigContent(raw) {
  const doc = import_yaml8.default.parseDocument(raw);
  const added = [];
  const migrated = [];
  for (const [key, value] of Object.entries(LOOP_VERSION_DEFAULTS)) {
    if (doc.hasIn(["loop", key])) continue;
    doc.setIn(["loop", key], value);
    added.push(key);
  }
  for (const [key, rule] of Object.entries(LOOP_VALUE_MIGRATIONS)) {
    const current = doc.getIn(["loop", key]);
    if (typeof current !== "string" || !rule.from.includes(current)) continue;
    doc.setIn(["loop", key], rule.to);
    migrated.push(`${key}: ${current} -> ${String(rule.to)}`);
  }
  const unchanged = added.length === 0 && migrated.length === 0;
  return { content: unchanged ? raw : doc.toString(), report: { added, migrated, unchanged } };
}
function fieldToPath(field) {
  const segments = [];
  for (const part of field.split(".")) {
    const m = /^([^[\]]*)((?:\[\d+\])*)$/.exec(part);
    if (!m) return null;
    if (m[1]) segments.push(m[1]);
    for (const idx of m[2].matchAll(/\[(\d+)\]/g)) segments.push(Number(idx[1]));
  }
  return segments.length > 0 ? segments : null;
}
function deletionPath(field) {
  const path19 = fieldToPath(field);
  if (!path19) return null;
  const idx = path19.findIndex((s) => typeof s === "number");
  return idx >= 0 ? path19.slice(0, idx + 1) : path19;
}
function documentToString(doc, raw, changed) {
  return changed ? doc.toString() : raw;
}
function upgradeConfigContent(raw, opts) {
  const report = {
    added: [],
    migrated: [],
    removed: [],
    pinned: [],
    unknownKeys: [],
    dropped: [],
    projectValues: [],
    untouched: false
  };
  const doc = import_yaml8.default.parseDocument(raw);
  if (doc.errors.length > 0) {
    return {
      ok: false,
      content: raw,
      report,
      issues: [{ severity: "error", field: "config.yml", message: `YAML parse failed: ${doc.errors[0].message}` }]
    };
  }
  let changed = false;
  for (const retired of RETIRED_CONFIG_KEYS) {
    if (!doc.hasIn(retired.path)) continue;
    doc.deleteIn(retired.path);
    report.removed.push(retired.label);
    changed = true;
  }
  for (const [key, value] of Object.entries(LOOP_VERSION_DEFAULTS)) {
    if (doc.hasIn(["loop", key])) continue;
    doc.setIn(["loop", key], value);
    report.added.push(key);
    changed = true;
  }
  for (const [key, rule] of Object.entries(LOOP_VALUE_MIGRATIONS)) {
    const current = doc.getIn(["loop", key]);
    if (typeof current !== "string" || !rule.from.includes(current)) continue;
    doc.setIn(["loop", key], rule.to);
    report.migrated.push(`${key}: ${current} -> ${String(rule.to)}`);
    changed = true;
  }
  if (opts.projectValues) {
    const pv = opts.projectValues;
    const merged = [
      ["repo_root", pv.repoRoot],
      ["test_command", pv.testCommand],
      ["tmux_session", pv.tmuxSession],
      ["worktree_root", pv.worktreeRoot]
    ];
    for (const [key, value] of merged) {
      const current = doc.getIn(["loop", key]);
      if (current === value || current === void 0 && value === null) continue;
      doc.setIn(["loop", key], value);
      report.projectValues.push(key);
      changed = true;
    }
  }
  const contents = doc.contents;
  if (import_yaml8.default.isMap(contents)) {
    for (const item of contents.items) {
      const keyNode = item.key;
      const key = typeof keyNode === "object" && keyNode !== null && "value" in keyNode ? String(keyNode.value) : String(keyNode);
      if (!KNOWN_TOP_LEVEL_CONFIG_KEYS.has(key)) report.unknownKeys.push(key);
    }
  }
  let content = documentToString(doc, raw, changed);
  const carrier = ensureProviderCarrierEnvText(content, { wsRoot: opts.workspaceRoot });
  if (carrier.pinned.length > 0) {
    report.pinned = carrier.pinned.map((p) => p.key);
    content = carrier.text;
  }
  report.untouched = report.removed.length === 0 && report.added.length === 0 && report.migrated.length === 0 && report.pinned.length === 0 && report.projectValues.length === 0;
  let verdictResult = validateConfigText({ text: content, workspaceRoot: opts.workspaceRoot, pluginRoot: opts.pluginRoot });
  if (!verdictResult.ok && opts.dropIncompatible === true) {
    const seen = /* @__PURE__ */ new Set();
    for (const issue of verdictResult.issues) {
      if (issue.severity !== "error") continue;
      const path19 = deletionPath(issue.field);
      if (!path19 || seen.has(path19.join("."))) continue;
      seen.add(path19.join("."));
      if (!doc.hasIn(path19)) continue;
      doc.deleteIn(path19);
      report.dropped.push(issue.field);
      changed = true;
    }
    if (report.dropped.length > 0) {
      for (const [key, value] of Object.entries(LOOP_VERSION_DEFAULTS)) {
        if (doc.hasIn(["loop", key])) continue;
        doc.setIn(["loop", key], value);
        report.added.push(key);
      }
      content = doc.toString();
      const carrier2 = ensureProviderCarrierEnvText(content, { wsRoot: opts.workspaceRoot });
      if (carrier2.pinned.length > 0) {
        report.pinned = carrier2.pinned.map((p) => p.key);
        content = carrier2.text;
      }
      report.untouched = report.removed.length === 0 && report.added.length === 0 && report.migrated.length === 0 && report.pinned.length === 0 && report.dropped.length === 0 && report.projectValues.length === 0;
      verdictResult = validateConfigText({ text: content, workspaceRoot: opts.workspaceRoot, pluginRoot: opts.pluginRoot });
    }
  }
  return { ok: verdictResult.ok, content, report, issues: verdictResult.issues };
}
function corruptBackupPathFor(configPath, stamp) {
  const base = `${configPath}.corrupt-${stamp}`;
  if (!fs15.existsSync(base)) return base;
  let n = 1;
  while (fs15.existsSync(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
function writeFileAtomic(filePath, content) {
  fs15.mkdirSync(path18.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs15.writeFileSync(tmp, content, "utf8");
  fs15.renameSync(tmp, filePath);
}
function loopDefaultsFor(providerId) {
  return Object.entries(LOOP_VERSION_DEFAULTS).map(([k, v]) => [k, k === "board" ? providerId : v]);
}
function mcpEntryForProvider(providerPath) {
  const segments = providerPath.split(/[\\/]+/);
  const installed = segments.includes("node_modules");
  return installed ? '["node", "./dist/quay-native.js", "mcp"]' : '["node", "./bin/quay-native.ts", "mcp"]';
}
function generateConfigContent(opts) {
  const { providerId, providerPath, isNode, isGo } = opts;
  const values = opts.values;
  const abs = (rel) => opts.root ? path18.join(opts.root, rel) : `./${rel}`;
  const gateSuggestions = buildGateSuggestions({ isNode, isGo });
  const lines = [
    "# .quay/config.yml \u2014 quay workspace configuration",
    "# Generated by `quay init`. See README.md or run `quay --help` for usage.",
    "",
    "# " + ruleLine(69),
    "# Section 1: Providers \u2014 where tasks live",
    "# " + ruleLine(69),
    "# quay is provider-agnostic: tasks can live on a local filesystem",
    "# (native provider), in GitHub Issues (github provider), or in any",
    "# backend that implements the Provider ABI.",
    "#",
    "# Each provider entry declares:",
    "#   enabled: true/false     \u2014 exactly ONE provider must be enabled",
    "#   path: <dir>             \u2014 provider package root (relative to workspaceRoot). OPTIONAL for the",
    "#                             native provider: Core resolves it from the plugin root when omitted.",
    "#   tasks_dir: <dir>        \u2014 where task files live (relative to workspaceRoot)",
    "#   mcp_entry: [cmd, args]  \u2014 how to launch the provider's MCP server (relative to provider.path).",
    "#                             OPTIONAL for the native provider (Core derives it from the plugin root);",
    "#                             REQUIRED for every other provider.",
    "#   env: <map>              \u2014 environment variables passed to the MCP server process",
    "#   default_task_status: todo|ready  \u2014 status for new tasks when none is specified (default: todo)",
    "#",
    "providers:",
    "  " + providerId + ":",
    "    enabled: true",
    // ⛔ NO `path:` / NO `mcp_entry:` for the NATIVE provider (gap-project-quay-pointer-is-init-plugin-
    // root-and-version-records-derive-from-it (D), human ruling 2026-10-06): a declared path freezes
    // the runtime to the install-cache version that wrote it, so a plugin upgrade never takes effect.
    // Core resolves the native binding from its OWN plugin root (`plugin-root.ts`) — the single
    // resolver — and the shipped shell writer emits the same shape. The two fresh-install writers
    // disagreeing about these two keys is exactly the drift AC-331 removes.
    // (`mcpEntryForProvider` below remains the ONE chooser for a provider that DOES need a declared
    // entry — e.g. a custom or github provider — and is unit-tested directly.)
    "    tasks_dir: " + JSON.stringify(abs("tasks")),
    "    env:",
    "      QUAY_NATIVE_TASKS_DIR: " + JSON.stringify(abs("tasks")),
    "      QUAY_NATIVE_GOAL_DIR: " + JSON.stringify(abs("goals")),
    "      QUAY_NATIVE_ADR_DIR: " + JSON.stringify(abs("adr")),
    "      QUAY_NATIVE_META_DIR: " + JSON.stringify(abs("meta")),
    "    # default_task_status: todo   # uncomment to change default status for new tasks",
    "",
    "  # GitHub provider (uncomment to use GitHub Issues as your task store):",
    "  # github:",
    "  #   enabled: false",
    '  #   path: "./node_modules/quay-github"',
    '  #   tasks_dir: "./tasks"',
    '  #   mcp_entry: ["node", "./bin/quay-github.mjs", "mcp"]',
    "  #   env:",
    '  #     GITHUB_TOKEN: "' + GH_TOKEN_SHELL_REF + '"',
    '  #     GITHUB_REPO: "owner/repo"',
    "",
    "# " + ruleLine(69),
    "# Section 2: Gates \u2014 automated quality checks",
    "# " + ruleLine(69),
    "# Gates are named, runnable checks that evaluate tasks. The gate engine",
    "# (QENG) runs them via `quay gate <task-id> [--gate <name>]`.",
    "#",
    "# Six gate types are supported:",
    "#   it0            \u2014 runs a script with args; argsKey names a task.extra",
    "#                    field whose value is passed as the script argument.",
    "#   adr            \u2014 checks that an ADR exists in the workspace adr/ dir.",
    "#   fixed          \u2014 runs a fixed script (no per-task args).",
    "#   testPass       \u2014 runs a test command; PASS if exit 0.",
    "#   coverageFloor  \u2014 runs a coverage command; parses output for a",
    "#                     percentage and PASS if >= floor.",
    "#   redGreen       \u2014 runs a RED command (must fail), then a GREEN",
    "#                     command (must pass) \u2014 RED->GREEN per ADR-001.",
    "#",
    "# All gate entries support optional cwd (working directory override) and",
    "# timeoutMs (millisecond deadline override).",
    "#",
    "gates:",
    "  # Built-in acceptance gate \u2014 always available, runs task.extra.acceptance",
    "  # as a shell command. Fail-closed if unset on a task.",
    "",
    "  # it0 gates \u2014 script-driven checks with per-task args:",
    "  # it0:",
    "  #   - name: dod-check          # gate name (used with --gate dod-check)",
    '  #     script: "./scripts/it0-dod-check.sh"',
    "  #     argsKey: acceptance       # reads task.extra.acceptance as the arg",
    '  #     # cwd: "./subdir"         # optional working directory',
    "  #     # timeoutMs: 120000        # optional timeout in milliseconds",
    "",
    "  # ADR gates \u2014 existence checks on architecture decision records:",
    "  # adr:",
    "  #   - ADR-001",
    "  #   - ADR-002",
    "",
    "  # Fixed-script gates \u2014 same script every run, no per-task args:",
    "  # fixed:",
    "  #   - name: lint",
    '  #     script: "./scripts/lint.sh"',
    "",
    "  # Test-pass gate" + gateSuggestions.testPassComment + ":",
    ...gateSuggestions.testPassLines,
    "",
    "  # Coverage-floor gate \u2014 runs a command and checks coverage percentage:",
    "  # coverageFloor:",
    "  #   - name: coverage-80",
    '  #     command: "node --test --experimental-test-coverage test/*.mjs"',
    "  #     floor: 80",
    '  #     # pattern: "All files"     # optional regex to extract coverage line',
    "",
    "  # Red-green gate \u2014 RED must fail, GREEN must pass (ADR-001):",
    "  # redGreen:",
    "  #   - name: red-green-tests",
    `  #     red: "node --test --test-name-pattern='failing test' test/*.mjs"`,
    '  #     green: "node --test test/*.mjs"',
    "",
    "# " + ruleLine(69),
    "# Section 3: Loop \u2014 autonomous iteration driver",
    "# " + ruleLine(69),
    "# The loop driver (`quay run`) scans the board for ready tasks and drives",
    "# them through gate checks. Configured here or in .quay/loop.yml (legacy).",
    "#",
    "# Fields:",
    '#   board: <provider>         REQUIRED \u2014 which provider to scan (e.g. "native")',
    "#   gates: <name> | [names]   REQUIRED \u2014 gate(s) to run on each task",
    '#   stop: <policy>            OPTIONAL \u2014 when to stop (default "once"):',
    '#                               "once"         \u2014 process one ready task',
    '#                               "until(.halt)"  \u2014 stop when .halt sentinel exists',
    '#                               "until(empty)"  \u2014 stop when no ready tasks remain',
    '#                               "until(<cond>)" \u2014 stop on custom condition',
    '#   policy: <name>            OPTIONAL \u2014 task selection ranking (default "ready-first")',
    '#   execution: dispatched|inline  OPTIONAL \u2014 build style (default "dispatched"):',
    '#                               "dispatched" \u2014 fresh background subagent per task',
    `#                               "inline"     \u2014 run in the driver's own context`,
    '#   audit: adversarial|none   OPTIONAL \u2014 audit style (default "adversarial"):',
    '#                               "adversarial" \u2014 fresh subagent audits diff before land',
    '#                               "none"        \u2014 gate-output only, no independent audit',
    "#   concurrency: <int>        OPTIONAL \u2014 max parallel builds (default 1, serial).",
    "#                               >1 requires touches-disjoint tasks.",
    "#   routines:                 OPTIONAL \u2014 standing routine track (periodic tasks):",
    "#     - name: <string>          routine name",
    "#       trigger: every(N)|on(<event>)  when to fire",
    "#       dispatch: <prompt>      (legacy) prompt to dispatch",
    "#       probe: <name>           (DIR-056) probe-spec name",
    "#",
    "loop:",
    // ── The four PROJECT-DERIVED values, emitted FIRST so `loop.repo_root` is the section's first key
    //    (the shipped shell writer's shape, and what the fresh-install readers expect to find up top).
    //    ⛔ Only present when `values` was supplied: an upgrade candidate starts from version defaults
    //    alone, because the user's own project values are already in their config and must win.
    ...values ? [
      `  repo_root: ${versionDefaultLine(values.repoRoot)}`,
      "  # quay's mechanical fan-in runs this project's test entrypoint with its own value-taking flags",
      "  # (--buckets / --root / --state-dir / --runner / --log-file / --run-id, plus --test-concurrency=N).",
      "  # If you ship scripts/test.sh, it MUST consume such a flag together with its VALUE (shift 2) and",
      "  # MUST NOT read a flag's value as a positional test-file argument \u2014 otherwise every fan-in round",
      `  # reds with "Could not find '<value>'" and burns a whole worker session. Full contract:`,
      '  # plugin/skills/init/SKILL.md, section "loop.test_command contract".',
      `  test_command: ${versionDefaultLine(values.testCommand)}`,
      `  tmux_session: ${values.tmuxSession === null ? "null" : versionDefaultLine(values.tmuxSession)}`,
      `  worktree_root: ${versionDefaultLine(values.worktreeRoot)}`
    ] : [],
    // EVERY default in this section — `board` and `gates` included — is EMITTED FROM THE SAME TABLE
    // the reconcile fills from (`LOOP_VERSION_DEFAULTS`) rather than re-typed here. Two hand-kept
    // copies of one list is the defect this whole change exists to remove: a fresh workspace must not
    // be born one reconcile behind, which is exactly what a template that forgets a key the reconcile
    // knows about produces. It is also what a template that writes a key the RECONCILE then
    // DUPLICATES produces — so neither key is spelled out literally below.
    // The version-level defaults, EMITTED FROM THE SAME TABLE the reconcile fills from
    // (`LOOP_VERSION_DEFAULTS`) rather than re-typed here. Two hand-kept copies of one list is the
    // defect this whole change exists to remove: a fresh workspace must not be born one reconcile
    // behind, which is exactly what a template that forgets a key the reconcile knows about produces.
    // `loopDefaultLine` (not `String(v)`) so a LIST value emits a real YAML flow sequence —
    // `String(["a"])` is `"a"`, which parses back as the scalar `a` and silently turns a list into a
    // string (the same class as the "a value that looks like a declaration but is not one" defect).
    ...loopDefaultsFor(providerId).map(([k, v]) => `  ${k}: ${versionDefaultLine(v)}`),
    '  # stop: "once"                # uncomment and set your preferred stop policy',
    '  # policy: "ready-first"        # uncomment to customize task selection',
    '  # execution: "dispatched"      # uncomment to use inline builds',
    '  # audit: "adversarial"         # uncomment to skip adversarial audit',
    "  # concurrency: 1               # uncomment for parallel builds (requires touches-disjoint)",
    "  # routines:                    # uncomment to add periodic routines",
    '  #   - name: "health-check"',
    '  #     trigger: "every(60)"',
    '  #     probe: "health"',
    "",
    "# " + ruleLine(69),
    "# Section 4: Serve \u2014 the web server's bind binding (OPTIONAL, COMMENTED OUT)",
    "# " + ruleLine(69),
    "# The web server's bind host/port. \u26D4 NOT WRITTEN: the uncommented defaults below are exactly the",
    "# values `resolveServeBinding` falls back to, so writing them would say nothing \u2014 and it made a",
    "# fresh install and an upgrade disagree about whether the section exists at all (AC-330).",
    "# Uncomment ONLY to pin your own values; the ones shown ARE the effective defaults.",
    "#",
    "# Exactly ONE reader: `resolveServeBinding` (packages/quay/src/serve-binding.ts). An explicit",
    "# command-line `--host` / `--port` still wins over this section; a malformed value here (a",
    "# non-integer port, a blank host) REFUSES the start rather than silently falling back \u2014 so",
    "# \u300C\u914D\u9519\u4E86\u300D and \u300C\u6CA1\u914D\u300D are never the same reading.",
    "#",
    "# serve:",
    '#   host: "0.0.0.0"   # the declared fallback: listen on all interfaces',
    "#   port: 0           # 0 = NO CONSTRAINT \u2014 the kernel assigns an ephemeral port, read back",
    "#                     # from .quay/server.json (the section is PER-CHECKOUT: .quay/config.yml",
    "#                     # is gitignored, so two workspaces on one machine pick different ports)",
    ""
  ];
  return lines.join("\n");
}
function ruleLine(len) {
  return "\u2500".repeat(len);
}
function versionDefaultLine(v) {
  if (Array.isArray(v)) {
    return `[${v.map((x) => JSON.stringify(String(x))).join(", ")}]`;
  }
  return String(v);
}
function buildGateSuggestions({ isNode, isGo }) {
  if (isNode) {
    return {
      testPassComment: " \u2014 runs a test command, PASS if exit 0",
      testPassLines: [
        "  # testPass:",
        "  #   - name: node-tests",
        '  #     command: "node --test test/*.mjs"'
      ]
    };
  }
  if (isGo) {
    return {
      testPassComment: " \u2014 runs a test command, PASS if exit 0",
      testPassLines: [
        "  # testPass:",
        "  #   - name: go-tests",
        '  #     command: "go test ./..."'
      ]
    };
  }
  return {
    testPassComment: " (no project-type detected; uncomment and edit to match your stack)",
    testPassLines: [
      "  # testPass:",
      "  #   - name: tests",
      '  #     command: "your-test-command-here"'
    ]
  };
}
function detectProjectType(root) {
  const isNode = fs15.existsSync(path18.join(root, "package.json"));
  const isGo = fs15.existsSync(path18.join(root, "go.mod"));
  return { isNode, isGo };
}
function detectProvider() {
  return "native";
}
function detectTestCommand(root) {
  if (fs15.existsSync(path18.join(root, "scripts", "test.sh"))) return "bash scripts/test.sh";
  if (fs15.existsSync(path18.join(root, "package.json")) && hasNpmTestScript(path18.join(root, "package.json"))) {
    return "npm test";
  }
  if (fs15.existsSync(path18.join(root, "go.mod"))) return "go test ./...";
  if (fs15.existsSync(path18.join(root, "Cargo.toml"))) return "cargo test";
  return null;
}
function detectTmuxSession(project) {
  let out = "";
  try {
    out = execFileSync4("tmux", ["list-sessions", "-F", "#{session_name}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    });
  } catch {
    return { state: "none", session: null, matches: [] };
  }
  const matches = out.split("\n").map((l) => l.trim()).filter((l) => l !== "" && (l === project || l.startsWith(`${project}-`)));
  if (matches.length === 1) return { state: "unique", session: matches[0], matches };
  if (matches.length > 1) return { state: "multiple", session: null, matches };
  return { state: "none", session: null, matches: [] };
}
function validateWorktreeRoot(root) {
  let probe = root;
  while (!fs15.existsSync(probe) && probe !== path18.dirname(probe)) probe = path18.dirname(probe);
  let fsType = "unknown";
  try {
    fsType = execFileSync4("stat", ["-f", "-c", "%T", probe], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    fsType = "unknown";
  }
  return { ok: fsType !== "tmpfs", probe, fsType };
}
function resolveProjectLoopValues(root, configPath, explicit, log) {
  const say = log ?? ((l) => console.log(l));
  const projectName = explicit.projectName && explicit.projectName !== "" ? explicit.projectName : path18.basename(root);
  let repoRoot = explicit.repoRoot && explicit.repoRoot !== "" ? explicit.repoRoot : readExistingLoopValue(configPath, "repo_root");
  if (repoRoot === "") repoRoot = root;
  let testCommand = explicit.testCommand && explicit.testCommand !== "" ? explicit.testCommand : readExistingLoopValue(configPath, "test_command");
  if (testCommand !== "") {
    say(
      explicit.testCommand && explicit.testCommand !== "" ? `  using explicit --test-command: ${testCommand}` : `  using existing config loop.test_command: ${testCommand} (config-preserving upgrade \u2014 explicit --test-command overrides)`
    );
  }
  if (testCommand === "") {
    const detected = detectTestCommand(root);
    if (detected === null) {
      return {
        ok: false,
        failure: {
          reason: `quay init needs the target project's test command but none could be detected in ${root}.`,
          detail: [
            "Searched: scripts/test.sh \u2192 package.json scripts.test \u2192 go.mod \u2192 Cargo.toml.",
            "Pass --test-command <cmd> explicitly."
          ]
        }
      };
    }
    testCommand = detected;
    say(`  detected test command: ${testCommand} (from the target project \u2014 confirm this is correct)`);
  }
  let tmuxSession;
  if (explicit.tmuxSession && explicit.tmuxSession !== "") {
    tmuxSession = explicit.tmuxSession;
    say(`  using explicit --tmux-session: ${tmuxSession}`);
  } else {
    const existing = readExistingLoopValue(configPath, "tmux_session");
    if (existing !== "" && existing !== "null") {
      tmuxSession = existing;
      say(`  using existing config loop.tmux_session: ${tmuxSession} (config-preserving upgrade \u2014 explicit --tmux-session overrides)`);
    } else {
      const project = projectName;
      const detected = detectTmuxSession(project);
      if (detected.state === "unique") {
        tmuxSession = detected.session;
        say(`  detected tmux session: ${tmuxSession} (matching project '${project}' \u2014 confirm this is correct)`);
      } else {
        tmuxSession = null;
        if (detected.state === "multiple") {
          say(`  note: multiple tmux sessions match project '${project}' \u2014 loop.tmux_session left null (tmux is optional; pass --tmux-session to pin one)`);
        } else {
          say(`  note: no tmux session detected for project '${project}' \u2014 loop.tmux_session left null (tmux is optional; SPEC-tmux-retirement-2026-09-03)`);
        }
      }
    }
  }
  let worktreeRoot = explicit.worktreeRoot && explicit.worktreeRoot !== "" ? explicit.worktreeRoot : readExistingLoopValue(configPath, "worktree_root");
  if (worktreeRoot === "") worktreeRoot = `${repoRoot}/../${path18.basename(repoRoot)}-worktrees`;
  const wt = validateWorktreeRoot(worktreeRoot);
  if (!wt.ok) {
    return {
      ok: false,
      failure: {
        reason: `worktree root '${worktreeRoot}' is on tmpfs ('${wt.probe}' is tmpfs) \u2014 this is memory, not disk.`,
        detail: [
          "Every worktree under it consumes RAM; the 2026-08-04 machine-wide OOM traced straight to it.",
          `Change it to a real disk path \u2014 e.g. '${repoRoot}/../${path18.basename(repoRoot)}-worktrees', or pass --worktree-root.`
        ]
      }
    };
  }
  say(`  worktree root: ${worktreeRoot} (filesystem: ${wt.fsType} \u2014 not tmpfs, OK)`);
  return { ok: true, values: { repoRoot, testCommand, tmuxSession, worktreeRoot } };
}
function generateLaunchSettingsContent() {
  return JSON.stringify(
    {
      $schema: "https://json.schemastore.org/claude-code-settings.json",
      permissions: { defaultMode: "bypassPermissions" },
      // ⛔ These three are the SHIPPED template's env block (plugin/.claude/launch.settings.json),
      // and the list is load-bearing, not decorative: `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN` and
      // `CLAUDE_CODE_DISABLE_MOUSE` were added to the shipped file 2026-08-11 (cold-start
      // usability) and this inline copy was NOT updated — so every project initialised through the
      // TS engine got a launch settings file MISSING them, while one initialised by the shell entry
      // (which copied the shipped file verbatim) got them. Two writers, two answers (硬规则 5b).
      // The shell entry is a shim now, so this is the only writer — and `packages/quay/test/
      // init.test.mjs` pins this table to the shipped file byte-for-byte, the same executable
      // invariant its `.quay/profiles.yml` sibling has. Edit both or neither.
      env: {
        CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN: "1",
        CLAUDE_CODE_DISABLE_MOUSE: "1",
        CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: "false"
      }
    },
    null,
    2
  ) + "\n";
}
function profilesNamePrefix(projectName) {
  const cleaned = projectName.replace(/[^A-Za-z0-9._-]/g, "-");
  return cleaned === "" ? "quay" : cleaned;
}
function generateProfilesContent(projectName = "quay") {
  return SHIPPED_PROFILES_TEMPLATE.replace(/^(\s*name:\s*)quay-/gm, `$1${profilesNamePrefix(projectName)}-`);
}
function runInit(opts) {
  const root = path18.resolve(opts.root);
  const quayDir = path18.join(root, ".quay");
  const configPath = path18.join(quayDir, "config.yml");
  const tasksDir = path18.join(root, "tasks");
  const launchSettingsPath = path18.join(root, ".claude", "launch.settings.json");
  const launchSettingsContent = generateLaunchSettingsContent();
  const profilesPath = path18.join(quayDir, "profiles.yml");
  const profilesContent = generateProfilesContent(opts.project ?? path18.basename(root));
  if (opts.branchModelOnly === true) {
    const branchModel2 = ensureBranchModel(root, {
      adopt: opts.adoptBranchModel === true,
      dryRun: opts.dryRun === true
    });
    return {
      outcome: "branch-model-only",
      configState: classifyConfig(configPath).state,
      configPath,
      tasksDir,
      content: "",
      launchSettingsPath,
      launchSettingsContent: "",
      profilesPath,
      profilesContent: "",
      branchModel: branchModel2,
      branchModelReport: formatBranchModelReport(branchModel2),
      pluginLink: { state: "not-run", reason: "the config-free branch-model entry touches no config" },
      validated: "not-evaluated"
    };
  }
  const existing = classifyConfig(configPath);
  const branchModel = ensureBranchModel(root, {
    adopt: opts.adoptBranchModel === true,
    dryRun: opts.dryRun === true
  });
  const branchModelReport = formatBranchModelReport(branchModel);
  if (!branchModel.ok && !opts.dryRun) {
    return {
      outcome: "branch-model-blocked",
      configState: existing.state,
      configPath,
      tasksDir,
      content: "",
      launchSettingsPath,
      launchSettingsContent: "",
      profilesPath,
      profilesContent: "",
      branchModel,
      branchModelReport,
      pluginLink: { state: "not-run", reason: "init refused before the link step (nothing was written)" },
      validated: "not-evaluated"
    };
  }
  const existingLoop = existing.config?.["loop"] ?? {};
  const configuredDocBranch = typeof existingLoop["doc_branch"] === "string" ? existingLoop["doc_branch"] : void 0;
  const docBranchName = opts.docBranchName ?? configuredDocBranch ?? "author";
  let baselineCheckoutReport = null;
  if (opts.dryRun !== true && landingBaselineEstablishedNow(branchModel)) {
    const checkout = moveCheckoutOntoLandingBaseline(root);
    baselineCheckoutReport = formatBaselineCheckoutReport(checkout);
    if (!checkout.ok) {
      return {
        outcome: "doc-branch-blocked",
        configState: existing.state,
        configPath,
        tasksDir,
        content: "",
        launchSettingsPath,
        launchSettingsContent: "",
        profilesPath,
        profilesContent: "",
        branchModel,
        branchModelReport,
        pluginLink: { state: "not-run", reason: "init refused before the link step (nothing was written)" },
        validated: "not-evaluated",
        failureReason: "could not move the main checkout onto the landing baseline it just established \u2014 refusing to continue, because the doc-branch bootstrap would then read the unmoved checkout."
      };
    }
  }
  const docBranch = ensureDocBranch(root, {
    name: docBranchName,
    dryRun: opts.dryRun === true,
    adopt: opts.adoptBranchModel === true
  });
  const docBranchReport = formatDocBranchReport(docBranch);
  if (!docBranch.ok && opts.dryRun !== true) {
    return {
      outcome: "doc-branch-blocked",
      configState: existing.state,
      configPath,
      tasksDir,
      content: "",
      launchSettingsPath,
      launchSettingsContent: "",
      profilesPath,
      profilesContent: "",
      branchModel,
      branchModelReport,
      docBranch,
      docBranchReport,
      pluginLink: { state: "not-run", reason: "init refused before the link step (nothing was written)" },
      validated: "not-evaluated",
      failureReason: docBranch.detail
    };
  }
  const docBranchFields = {
    docBranch,
    docBranchReport,
    ...baselineCheckoutReport !== null ? { baselineCheckoutReport } : {}
  };
  const preWriteSnapshot = snapshotClosedSet(root);
  const say = opts.log ?? ((l) => console.log(l));
  const projectValues = resolveProjectLoopValues(
    root,
    configPath,
    {
      repoRoot: opts.repoRoot,
      testCommand: opts.testCommand,
      tmuxSession: opts.tmuxSession,
      worktreeRoot: opts.worktreeRoot,
      projectName: opts.project
    },
    say
  );
  if (projectValues.ok === false) {
    return {
      outcome: "project-values-unresolved",
      configState: existing.state,
      configPath,
      tasksDir,
      content: "",
      launchSettingsPath,
      launchSettingsContent: "",
      profilesPath,
      profilesContent: "",
      branchModel,
      branchModelReport,
      ...docBranchFields,
      pluginLink: { state: "not-run", reason: "init refused before the link step (nothing was written)" },
      validated: "not-evaluated",
      failureReason: projectValues.failure.reason,
      failureDetail: projectValues.failure.detail,
      closedSetState: closedSetReport(root, preWriteSnapshot)
    };
  }
  const values = projectValues.values;
  if (existing.state === "valid") {
    let rawForUpgrade = existing.raw ?? "";
    if (opts.pluginRoot) {
      const providerRoot = path18.join(opts.pluginRoot, "vendor", "quay-native");
      migrateStaleMcpEntry({
        cfgPath: configPath,
        installProvider: providerRoot,
        installRuntime: path18.join(providerRoot, "dist", "quay-native.js"),
        installCore: path18.join(opts.pluginRoot, "vendor", "quay", "dist", "quay.js"),
        wsRoot: root,
        dryRun: opts.dryRun === true,
        backupTs: String(Math.floor(Date.now() / 1e3)),
        log: opts.log
      });
      try {
        rawForUpgrade = fs15.readFileSync(configPath, "utf8");
      } catch {
      }
    }
    const up = upgradeConfigContent(rawForUpgrade, {
      workspaceRoot: root,
      // ⛔ `undefined`, never `null`: the validator reads `null` as "no plugin root could be resolved"
      // (the state a fixture injects) and `undefined` as "resolve it yourself" — passing `null` here
      // would make every upgrade fail with `native-provider-unresolvable`.
      pluginRoot: opts.pluginRoot ?? void 0,
      dropIncompatible: opts.dropIncompatible === true,
      // AC-331: the four project-derived values follow the same comment-preserving, per-key pipeline
      // as the version defaults — the CLI's equivalent of the shell entry's `ensure_loop_config`.
      projectValues: values
    });
    const base = {
      configState: "valid",
      configPath,
      tasksDir,
      launchSettingsPath,
      launchSettingsContent: "",
      profilesPath,
      profilesContent: "",
      branchModel,
      branchModelReport,
      ...docBranchFields,
      upgrade: up.report,
      validated: up.ok,
      ...up.ok ? {} : { validationIssues: up.issues }
    };
    if (!up.ok) {
      return {
        outcome: "upgrade-invalid",
        content: up.content,
        upgradeIssues: up.issues,
        pluginLink: { state: "not-run", reason: "the upgrade was refused before the link step (nothing was written)" },
        ...base
      };
    }
    if (!opts.dryRun && !up.report.untouched) {
      writeFileAtomic(configPath, up.content);
    }
    const pluginLink2 = opts.dryRun || !opts.pluginRoot ? {
      state: "not-run",
      reason: opts.dryRun ? "a dry run writes nothing, so the link step is not run" : "no plugin root was given for this run (CLAUDE_PLUGIN_ROOT / --plugin-root unset)"
    } : refreshProjectPluginLink({ wsRoot: root, pluginRoot: opts.pluginRoot, dryRun: false, log: opts.log });
    const upgradeAutoCommit = opts.dryRun ? void 0 : autoCommitClosedSet(root, opts.autoCommitConfig ?? "prompt", readPluginVersion(opts.pluginRoot));
    return {
      outcome: up.report.untouched ? "unchanged" : "reconciled",
      content: up.content,
      pluginLink: pluginLink2,
      ...upgradeAutoCommit ? { autoCommit: upgradeAutoCommit } : {},
      ...base
    };
  }
  const isRebuild = existing.state === "corrupt";
  let corruptBackupPath;
  if (isRebuild) {
    corruptBackupPath = corruptBackupPathFor(configPath, Math.floor(Date.now() / 1e3));
  }
  const { isNode, isGo } = detectProjectType(root);
  const providerId = opts.provider ?? detectProvider();
  const providerPath = resolveProviderPath(root);
  let content = generateConfigContent({ providerId, providerPath, isNode, isGo, values, root });
  if (isRebuild) {
    const fixpoint = upgradeConfigContent(content, {
      workspaceRoot: root,
      // ⛔ `undefined`, never `null` — same reading as the upgrade path above.
      pluginRoot: opts.pluginRoot ?? void 0
    });
    if (!fixpoint.ok) {
      return {
        outcome: "rebuild-invalid",
        configState: "corrupt",
        corruptReason: existing.reason,
        corruptBackupPath,
        rebuildIssues: fixpoint.issues,
        configPath,
        tasksDir,
        content: fixpoint.content,
        launchSettingsPath,
        launchSettingsContent: "",
        profilesPath,
        profilesContent: "",
        branchModel,
        branchModelReport,
        ...docBranchFields,
        pluginLink: { state: "not-run", reason: "the rebuild was refused before the link step (nothing was written)" },
        validated: false,
        validationIssues: fixpoint.issues,
        closedSetState: closedSetReport(root, preWriteSnapshot)
      };
    }
    content = fixpoint.content;
  }
  const freshVerdict = validateConfigText({ text: content, workspaceRoot: root, pluginRoot: opts.pluginRoot ?? void 0 });
  if (opts.dryRun) {
    return {
      outcome: "dry-run",
      configState: existing.state,
      ...corruptBackupPath ? { corruptBackupPath } : {},
      configPath,
      tasksDir,
      content,
      launchSettingsPath,
      launchSettingsContent,
      profilesPath,
      profilesContent,
      branchModel,
      branchModelReport,
      ...docBranchFields,
      pluginLink: { state: "not-run", reason: "a dry run writes nothing, so the link step is not run" },
      validated: freshVerdict.ok,
      ...freshVerdict.ok ? {} : { validationIssues: freshVerdict.issues }
    };
  }
  const goalsDir = path18.join(root, "goals");
  const settingsPath = path18.join(root, ".claude", "settings.json");
  const pluginVersion = readPluginVersion(opts.pluginRoot);
  const installStepsText = printInstallSteps();
  let autoCommit;
  let pluginLink = { state: "not-run", reason: "the run aborted before the link step" };
  const gitignoreWarnings = [];
  try {
    if (isRebuild && corruptBackupPath) fs15.copyFileSync(configPath, corruptBackupPath);
    fs15.mkdirSync(quayDir, { recursive: true });
    writeFileAtomic(configPath, content);
    if (!fs15.existsSync(profilesPath)) {
      fs15.mkdirSync(path18.dirname(profilesPath), { recursive: true });
      fs15.writeFileSync(profilesPath, profilesContent, "utf8");
    }
    if (!fs15.existsSync(tasksDir)) fs15.mkdirSync(tasksDir, { recursive: true });
    if (!fs15.existsSync(goalsDir)) fs15.mkdirSync(goalsDir, { recursive: true });
    const manifest = opts.pluginRoot ? path18.join(opts.pluginRoot, "scripts", "quay-runtime-artifacts.txt") : null;
    gitignoreWarnings.push(...ensureGitignore(root, { runtimeArtifactsManifest: manifest, log: say }).warnings);
    if (!fs15.existsSync(launchSettingsPath)) {
      fs15.mkdirSync(path18.dirname(launchSettingsPath), { recursive: true });
      fs15.writeFileSync(launchSettingsPath, launchSettingsContent, "utf8");
    }
    fs15.mkdirSync(path18.dirname(settingsPath), { recursive: true });
    writeClaudeSettings(settingsPath, readPluginName(opts.pluginRoot));
    const resolvedPluginRoot = opts.pluginRoot ?? (process.env.CLAUDE_PLUGIN_ROOT && process.env.CLAUDE_PLUGIN_ROOT !== "" ? process.env.CLAUDE_PLUGIN_ROOT : resolvePluginRoot());
    let linkExists = false;
    try {
      linkExists = fs15.lstatSync(path18.join(quayDir, "plugin")).isSymbolicLink();
    } catch {
      linkExists = false;
    }
    pluginLink = resolvedPluginRoot ? refreshProjectPluginLink({
      wsRoot: root,
      pluginRoot: resolvedPluginRoot,
      dryRun: false,
      log: say,
      allowSourceCheckout: opts.allowSourceCheckoutLink === true && !linkExists
    }) : { state: "not-run", reason: "no plugin root could be resolved (CLAUDE_PLUGIN_ROOT / --plugin-root / module location)" };
    autoCommit = autoCommitClosedSet(root, opts.autoCommitConfig ?? "prompt", pluginVersion);
  } catch (err) {
    return {
      outcome: "write-failed",
      configState: existing.state,
      ...isRebuild ? { corruptReason: existing.reason, corruptBackupPath } : {},
      configPath,
      tasksDir,
      content,
      launchSettingsPath,
      launchSettingsContent,
      profilesPath,
      profilesContent,
      branchModel,
      branchModelReport,
      ...docBranchFields,
      pluginLink: { state: "not-run", reason: "the run aborted mid-write" },
      validated: freshVerdict.ok,
      ...freshVerdict.ok ? {} : { validationIssues: freshVerdict.issues },
      failureReason: err instanceof Error ? err.message : String(err),
      closedSetState: closedSetReport(root, preWriteSnapshot)
    };
  }
  return {
    outcome: isRebuild ? "rebuilt" : "written",
    configState: existing.state,
    // The rebuild's own facts: WHY the old file could not be read, and WHERE its bytes were kept.
    // Both are carried on the result so no caller has to re-derive them from stdout.
    ...isRebuild ? { corruptReason: existing.reason, corruptBackupPath } : {},
    configPath,
    tasksDir,
    content,
    launchSettingsPath,
    launchSettingsContent,
    profilesPath,
    profilesContent,
    branchModel,
    branchModelReport,
    ...docBranchFields,
    pluginLink,
    validated: freshVerdict.ok,
    ...freshVerdict.ok ? {} : { validationIssues: freshVerdict.issues },
    installSteps: installStepsText,
    ...autoCommit ? { autoCommit } : {},
    ...gitignoreWarnings.length > 0 ? { failureDetail: gitignoreWarnings } : {}
  };
}
function buildInitReport(result, o) {
  const issues = result.validationIssues ?? result.upgradeIssues ?? [];
  const unknownKeys = result.upgrade?.unknownKeys ?? [];
  const warnings = [
    ...unknownKeys.map((k) => `unrecognized top-level config key "${k}" \u2014 kept as-is (not deleted)`),
    ...result.validated === false ? issues.filter((i2) => i2.severity === "error").map((i2) => `candidate config did not validate: ${i2.field} \u2014 ${i2.message}`) : []
  ];
  return {
    outcome: result.outcome,
    configState: result.configState,
    corruptReason: result.corruptReason ?? null,
    corruptBackupPath: result.corruptBackupPath ?? null,
    dryRun: o.dryRun,
    validated: result.validated,
    issues,
    warnings,
    configPath: result.configPath,
    tasksDir: result.tasksDir,
    added: result.upgrade?.added ?? [],
    migrated: result.upgrade?.migrated ?? [],
    removed: result.upgrade?.removed ?? [],
    pinned: result.upgrade?.pinned ?? [],
    dropped: result.upgrade?.dropped ?? [],
    projectValues: result.upgrade?.projectValues ?? [],
    unknownKeys,
    pluginLink: result.pluginLink,
    ...o.dryRun ? { content: result.content } : {}
  };
}
function resolveProviderPath(workspaceRoot) {
  try {
    const moduleDir3 = import.meta.url ? path18.dirname(new URL(import.meta.url).pathname) : path18.dirname(process.argv[1] ?? ".");
    let candidate = path18.resolve(moduleDir3, "..", "..", "quay-native");
    if (fs15.existsSync(path18.join(candidate, "package.json"))) {
      const rel = path18.relative(workspaceRoot, candidate);
      if (rel && !rel.startsWith("..")) {
        return rel.startsWith(".") ? rel : "./" + rel;
      }
      return rel;
    }
    candidate = path18.resolve(process.cwd(), "packages", "quay-native");
    if (fs15.existsSync(path18.join(candidate, "package.json"))) {
      const rel = path18.relative(workspaceRoot, candidate);
      if (rel && !rel.startsWith("..")) {
        return rel.startsWith(".") ? rel : "./" + rel;
      }
      return rel;
    }
  } catch {
  }
  return "./node_modules/quay-native";
}
function printNextSteps(providerId, tasksDir) {
  console.log(`
Next steps:
  1. Create your first task:
       quay task create TASK-001 --title "My first task"

  2. List all tasks:
       quay task list

  3. Start the MCP server (for AI agent integration):
       quay mcp

  4. Run the gate engine on a task:
       quay gate TASK-001

  Workspace ready at: ${path18.dirname(path18.dirname(tasksDir))}
  Provider: ${providerId}
  Tasks dir: ${tasksDir}
`);
}
function foldPlainScalars(text) {
  const lines = text.split("\n");
  const out = [];
  for (const line of lines) {
    const m = PLAIN_LINE_RE.exec(line);
    if (!m) {
      out.push(line);
      continue;
    }
    const [, indentPart, rest] = m;
    let prefix;
    let value;
    if (indentPart.endsWith("- ")) {
      prefix = indentPart;
      value = rest;
    } else {
      const sep = rest.indexOf(": ");
      if (sep < 0 || rest.startsWith("- ")) {
        out.push(line);
        continue;
      }
      prefix = indentPart + rest.slice(0, sep + 2);
      value = rest.slice(sep + 2);
    }
    if (value === "" || /^["'|>&*!%@`[\]{},#]/.test(value)) {
      out.push(line);
      continue;
    }
    const lineIndent = indentPart.length - indentPart.trimStart().length;
    const cont = " ".repeat(lineIndent + 2);
    let rendered = prefix;
    let col = prefix.length;
    let i2 = 0;
    const n = value.length;
    while (i2 < n) {
      if (value[i2] === " ") {
        let j = i2;
        while (j < n && value[j] === " ") j++;
        const runLen = j - i2;
        const isLast = j === n;
        if (runLen === 1 && col > PYYAML_BEST_WIDTH && i2 !== 0 && !isLast) {
          rendered += "\n" + cont;
          col = cont.length;
        } else {
          rendered += value.slice(i2, j);
          col += runLen;
        }
        i2 = j;
      } else {
        let j = i2;
        while (j < n && value[j] !== " ") j++;
        rendered += value.slice(i2, j);
        col += j - i2;
        i2 = j;
      }
    }
    out.push(rendered);
  }
  return out.join("\n");
}
function pyYamlDump(doc) {
  return foldPlainScalars(import_yaml8.default.stringify(doc, PYYAML_DUMP_OPTS));
}
function pythonTruthyString(v) {
  if (v === void 0 || v === null || v === "" || v === 0 || v === false) return "";
  if (v === true) return "True";
  return typeof v === "string" ? v : String(v);
}
function readExistingLoopValue(cfgPath, key) {
  try {
    if (!fs15.existsSync(cfgPath)) return "";
    const doc = import_yaml8.default.parse(fs15.readFileSync(cfgPath, "utf8")) ?? {};
    const loop = doc["loop"];
    if (typeof loop !== "object" || loop === null || Array.isArray(loop)) return "";
    return pythonTruthyString(loop[key]);
  } catch {
    return "";
  }
}
function readJsonField(jsonPath, field, fallback) {
  try {
    const doc = JSON.parse(fs15.readFileSync(jsonPath, "utf8"));
    const v = doc[field];
    if (v === void 0 || v === null) return fallback;
    return typeof v === "string" ? v : String(v);
  } catch {
    return fallback;
  }
}
function hasNpmTestScript(pkgPath) {
  try {
    const doc = JSON.parse(fs15.readFileSync(pkgPath, "utf8"));
    const scripts = doc["scripts"];
    if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) return false;
    const t = scripts["test"];
    return typeof t === "string" && t.trim() !== "";
  } catch {
    return false;
  }
}
function ensureLoopConfig(o) {
  if (!fs15.existsSync(o.cfgPath)) return;
  const data = import_yaml8.default.parse(fs15.readFileSync(o.cfgPath, "utf8")) ?? {};
  const before = pyYamlDump(data);
  let loop = data["loop"];
  if (typeof loop !== "object" || loop === null || Array.isArray(loop)) loop = {};
  const l = loop;
  l["repo_root"] = o.repoRoot;
  l["test_command"] = o.testCommand;
  l["tmux_session"] = o.tmuxSession ? o.tmuxSession : null;
  l["worktree_root"] = o.worktreeRoot;
  data["loop"] = l;
  const after = pyYamlDump(data);
  if (after === before) {
    console.log("  unchanged: .quay/config.yml loop: (values already current \u2014 no gratuitous rewrite, AC3)");
    return;
  }
  if (o.dryRun) {
    console.log("  would-write: .quay/config.yml loop: (repo_root/test_command/tmux_session/worktree_root updated, doc_surfaces filled when absent; \u5176\u4F59 loop \u952E\u4FDD\u7559 \u2014 config \u4FDD\u7559 \u589E\u91CF\u5347\u7EA7)");
    return;
  }
  fs15.writeFileSync(o.cfgPath, after, "utf8");
  console.log("  wrote: .quay/config.yml loop: (repo_root/test_command/tmux_session/worktree_root updated, doc_surfaces filled when absent; \u5176\u4F59 loop \u952E\u4FDD\u7559\u2014 config \u4FDD\u7559 \u589E\u91CF\u5347\u7EA7)");
}
function reconcileConfigFile(o) {
  const cls = classifyConfig(o.cfgPath);
  if (cls.state !== "valid") {
    console.log(`  reconcile: NOT-EVALUATED \u2014 .quay/config.yml is ${cls.state}${cls.state === "corrupt" ? ` (${cls.reason})` : ""}; left untouched (run \`quay init\` in the project to rebuild it from this version's defaults)`);
    return;
  }
  const { content, report } = reconcileConfigContent(cls.raw ?? "");
  if (report.unchanged) {
    console.log("  unchanged: .quay/config.yml (already current for this version of quay \u2014 version-level defaults present, not rewritten)");
    return;
  }
  const lines = [
    ...report.added.map((k) => `loop.${k}`),
    ...report.migrated.map((m) => `loop.${m}`)
  ];
  if (o.dryRun) {
    console.log(`  would-reconcile: .quay/config.yml (${lines.join(", ")})`);
    return;
  }
  fs15.writeFileSync(o.cfgPath, content, "utf8");
  console.log(`  reconciled: .quay/config.yml version-level defaults (${lines.join(", ")}); comments and every other key preserved`);
}
function indentOf(s) {
  return s.length - s.trimStart().length;
}
function blockEnd(lines, start, parentInd) {
  let j = start + 1;
  while (j < lines.length) {
    if (lines[j].trim() && indentOf(lines[j]) <= parentInd) return j;
    j++;
  }
  return lines.length;
}
function findChild(lines, start, end, key, minIndent) {
  const pat = new RegExp("^(\\s*)" + escapeRegExp(key) + "\\s*:");
  for (let i2 = start; i2 < end; i2++) {
    const m = pat.exec(lines[i2]);
    if (m && m[1].length >= minIndent) return [i2, m[1].length];
  }
  return null;
}
function ensureProviderCarrierEnvText(text, o) {
  const lines = text.split("\n");
  const noop = (note) => ({ text, pinned: [], note });
  const prov = findChild(lines, 0, lines.length, "providers", 0);
  if (!prov) return noop("no-providers");
  const native = findChild(lines, prov[0] + 1, blockEnd(lines, prov[0], prov[1]), "native", prov[1] + 1);
  if (!native) return noop("no-native");
  const nativeEnd = blockEnd(lines, native[0], native[1]);
  const env = findChild(lines, native[0] + 1, nativeEnd, "env", native[1] + 1);
  const present = {};
  if (env) {
    const rest = lines[env[0]].slice(lines[env[0]].indexOf(":") + 1).trim();
    if (rest && !rest.startsWith("{")) return noop("inline-env");
    if (rest.startsWith("{")) {
      for (const m of rest.matchAll(/(QUAY_NATIVE_\w+)\s*:/g)) present[m[1]] = "";
    } else {
      const keyRe = /^(\s*)(QUAY_NATIVE_\w+)\s*:\s*(.*)$/;
      for (let i2 = env[0] + 1; i2 < blockEnd(lines, env[0], env[1]); i2++) {
        const m = keyRe.exec(lines[i2]);
        if (m && m[1].length > env[1]) present[m[2]] = m[3].trim();
      }
    }
  }
  const missing = CARRIER_KINDS.filter(([k]) => !(k in present));
  if (missing.length === 0) return noop(null);
  const rawTasks = (present["QUAY_NATIVE_TASKS_DIR"] ?? "./tasks").trim().replace(/^["']|["']$/g, "");
  const absolute = rawTasks.startsWith("/") || rawTasks.startsWith("~");
  const valueFor = (kind) => absolute ? `${o.wsRoot}/${kind}` : `./${kind}`;
  const pinned = missing.map(([k, kind]) => ({ key: k, value: valueFor(kind) }));
  const newLines = [...lines];
  let insertAt;
  let baseInd;
  let added;
  if (!env) {
    insertAt = nativeEnd;
    baseInd = native[1] + 2;
    added = [" ".repeat(baseInd) + "env:", ...pinned.map((p) => `${" ".repeat(baseInd + 2)}${p.key}: "${p.value}"`)];
  } else {
    let last = env[0];
    for (let i2 = env[0] + 1; i2 < blockEnd(lines, env[0], env[1]); i2++) {
      if (lines[i2].trim()) last = i2;
    }
    insertAt = last + 1;
    baseInd = env[1] + 2;
    added = pinned.map((p) => `${" ".repeat(baseInd)}${p.key}: "${p.value}"`);
  }
  newLines.splice(insertAt, 0, ...added);
  return { text: newLines.join("\n"), pinned, note: null };
}
function ensureProviderCarrierEnv(o) {
  if (!fs15.existsSync(o.cfgPath)) return;
  const res = ensureProviderCarrierEnvText(fs15.readFileSync(o.cfgPath, "utf8"), { wsRoot: o.wsRoot });
  if (res.note === "no-providers") {
    console.log("  note: .quay/config.yml has no providers: section \u2014 carrier env pins not applicable (nothing written)");
    return;
  }
  if (res.note === "no-native") {
    console.log("  note: providers: has no native: entry \u2014 carrier env pins not applicable (nothing written)");
    return;
  }
  if (res.note === "inline-env") {
    console.error(
      "  note: providers.native.env has an unrecognized inline form \u2014 carrier env pins NOT applied (add QUAY_NATIVE_ADR_DIR/QUAY_NATIVE_GOAL_DIR/QUAY_NATIVE_META_DIR by hand)"
    );
    return;
  }
  if (res.pinned.length === 0) {
    console.log("  unchanged: .quay/config.yml providers.native.env: (four carrier dirs already pinned \u2014 no rewrite, AC4)");
    return;
  }
  if (o.dryRun) {
    for (const p of res.pinned) {
      console.log(`  would-pin: providers.native.env.${p.key}: "${p.value}" (carrier dir pin \u2014 AC4)`);
    }
    return;
  }
  fs15.writeFileSync(o.cfgPath, res.text, "utf8");
  for (const p of res.pinned) {
    console.log(`  pinned: .quay/config.yml providers.native.env.${p.key}: "${p.value}" (carrier dir pin \u2014 AC4)`);
  }
}
function switchEnabledProviderText(text, target) {
  const lines = text.split("\n");
  const noop = (note) => ({ text, changed: [], added: [], note });
  const prov = findChild(lines, 0, lines.length, "providers", 0);
  if (!prov) return noop("no-providers");
  const provRest = lines[prov[0]].slice(lines[prov[0]].indexOf(":") + 1).trim();
  if (provRest !== "" && !provRest.startsWith("#")) return noop("inline-providers");
  const provEnd = blockEnd(lines, prov[0], prov[1]);
  let childInd = null;
  for (let i2 = prov[0] + 1; i2 < provEnd; i2++) {
    const line = lines[i2];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const m = /^(\s*)[A-Za-z0-9_-]+\s*:/.exec(line);
    if (!m) continue;
    const ind = m[1].length;
    if (ind > prov[1] && (childInd === null || ind < childInd)) childInd = ind;
  }
  if (childInd === null) return noop("no-target");
  const entries = [];
  for (let i2 = prov[0] + 1; i2 < provEnd; i2++) {
    const line = lines[i2];
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const m = /^(\s*)([A-Za-z0-9_-]+)\s*:/.exec(line);
    if (!m || m[1].length !== childInd) continue;
    entries.push({ pid: m[2], start: i2, end: blockEnd(lines, i2, childInd) });
  }
  if (!entries.some((e) => e.pid === target)) return noop("no-target");
  const out = [...lines];
  const changed = [];
  const added = [];
  for (let n = entries.length - 1; n >= 0; n--) {
    const { pid, start, end } = entries[n];
    const want = pid === target ? "true" : "false";
    const at = findChild(out, start + 1, Math.min(end, out.length), "enabled", childInd + 1);
    if (!at) {
      if (pid !== target) continue;
      out.splice(start + 1, 0, `${" ".repeat(childInd + 2)}enabled: ${want}`);
      added.push(pid);
      continue;
    }
    const [lineIdx, lineInd] = at;
    const rawValue = out[lineIdx].slice(out[lineIdx].indexOf(":") + 1);
    const hash = rawValue.indexOf("#");
    const valuePart = hash >= 0 ? rawValue.slice(0, hash) : rawValue;
    const current = valuePart.trim();
    if (current === want) continue;
    const pad = valuePart.slice(valuePart.trimEnd().length);
    out[lineIdx] = `${" ".repeat(lineInd)}enabled: ${want}${pad}${hash >= 0 ? rawValue.slice(hash) : ""}`;
    changed.push({ provider: pid, from: current, to: want });
  }
  changed.reverse();
  return { text: out.join("\n"), changed, added, note: null };
}
function readPluginRootVersion(pluginRoot) {
  if (!pluginRoot) return null;
  try {
    const v = JSON.parse(fs15.readFileSync(path18.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"))?.version;
    return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  } catch {
    return null;
  }
}
function refreshProjectPluginLink(o) {
  const log = o.log ?? ((line) => console.log(line));
  const linkPath = path18.join(o.wsRoot, ".quay", "plugin");
  let existing = null;
  try {
    existing = fs15.lstatSync(linkPath);
  } catch {
    existing = null;
  }
  const currentTarget = existing?.isSymbolicLink() ? (() => {
    try {
      return fs15.readlinkSync(linkPath);
    } catch {
      return null;
    }
  })() : null;
  const decide = () => {
    if (!o.pluginRoot) {
      return { state: "not-evaluated", reason: "plugin root unknown (CLAUDE_PLUGIN_ROOT / --plugin-root unset)" };
    }
    const root = path18.resolve(o.pluginRoot);
    if (!fs15.existsSync(path18.join(root, ".claude-plugin", "plugin.json"))) {
      return { state: "not-evaluated", reason: `${root} is not a quay plugin root (no .claude-plugin/plugin.json)` };
    }
    if (isPluginSourceCheckout(root) && o.allowSourceCheckout !== true) {
      return { state: "not-evaluated", reason: `${root} is a source checkout (dev tree), not an installed plugin` };
    }
    return { state: "linked", pluginRoot: root, version: readPluginRootVersion(root) };
  };
  const reading = decide();
  if (reading.state === "not-evaluated") {
    log(`  project-plugin-link: NOT-EVALUATED \u2014 ${reading.reason} (existing link left unchanged)`);
    return reading;
  }
  if (existing && !existing.isSymbolicLink()) {
    log(`  project-plugin-link: REFUSED \u2014 ${linkPath} exists and is not a symlink (left unchanged)`);
    return { state: "not-evaluated", reason: `${linkPath} exists and is not a symlink` };
  }
  if (o.dryRun) {
    log(
      currentTarget === reading.pluginRoot ? `  would-keep: .quay/plugin -> ${reading.pluginRoot} (v${reading.version ?? "?"}; already current)` : `  would-link: .quay/plugin -> ${reading.pluginRoot} (v${reading.version ?? "?"})`
    );
    return reading;
  }
  fs15.mkdirSync(path18.dirname(linkPath), { recursive: true });
  if (existing) {
    try {
      fs15.rmSync(linkPath, { force: true });
    } catch {
    }
  }
  fs15.symlinkSync(reading.pluginRoot, linkPath);
  log(`  linked: .quay/plugin -> ${reading.pluginRoot} (v${reading.version ?? "?"} \u2014 the plugin root this init ran from)`);
  return reading;
}
function migrateStaleMcpEntry(o) {
  const say = o.log ?? ((line) => console.log(line));
  if (!fs15.existsSync(o.cfgPath)) return;
  const data = import_yaml8.default.parse(fs15.readFileSync(o.cfgPath, "utf8")) ?? {};
  const providers = data["providers"];
  const prov = typeof providers === "object" && providers !== null ? providers["native"] : void 0;
  if (typeof prov !== "object" || prov === null || Array.isArray(prov)) return;
  const sha = (p) => {
    try {
      return createHash2("sha256").update(fs15.readFileSync(p)).digest("hex");
    } catch {
      return null;
    }
  };
  const under = (p, base) => {
    const abs = path18.resolve(p);
    return abs === base || abs.startsWith(base + path18.sep);
  };
  const rtDir = path18.join(o.wsRoot, ".quay", "runtime");
  const inRetiredRuntime = (p) => {
    const s = String(p);
    const cands = path18.isAbsolute(s) ? [s] : [s, path18.join(o.wsRoot, s)];
    return cands.some((c) => under(c, rtDir));
  };
  const retiredRtState = () => {
    let st;
    try {
      st = fs15.statSync(rtDir);
    } catch {
      return "absent";
    }
    if (!st.isDirectory()) return "absent";
    const known = [
      [path18.join(rtDir, "bin", "quay-native.js"), o.installRuntime],
      [path18.join(rtDir, "bin", "quay.js"), o.installCore]
    ].filter(([t]) => fs15.existsSync(t));
    if (known.length === 0 || known.some(([, s]) => sha(s) === null)) return "unknown";
    return known.some(([t, s]) => sha(t) !== sha(s)) ? "retire" : "keep";
  };
  const rtState = retiredRtState();
  let changed = false;
  const removed = [];
  const stripped = stripNativeProviderBindingLines(fs15.readFileSync(o.cfgPath, "utf8"));
  if (stripped.removed.length > 0) {
    changed = true;
    for (const r of stripped.removed) removed.push(`providers.native.${r}`);
  }
  const referencedByBinding = () => stripped.text.includes(rtDir) || /(^|[\s"'])\.quay\/runtime/.test(stripped.text);
  const backupDir = path18.join(o.wsRoot, ".quay", "quay-init-backups", o.backupTs);
  if (rtState === "retire" && !referencedByBinding()) {
    let dest = path18.join(backupDir, "runtime");
    if (o.dryRun) {
      say(`  would-retire-orphan-runtime: ${rtDir} -> ${dest} (retired layout, unreferenced, stale vs this delivery \u2014 AC1)`);
    } else {
      fs15.mkdirSync(backupDir, { recursive: true });
      let n = 1;
      while (fs15.existsSync(dest)) {
        dest = path18.join(backupDir, `runtime-${n}`);
        n++;
      }
      fs15.renameSync(rtDir, dest);
      say(`  retired-orphan-runtime: ${rtDir} -> backup ${dest} (retired layout, unreferenced, stale vs this delivery \u2014 AC1)`);
    }
  } else if (rtState === "retire") {
    say(`  kept-referenced-runtime: ${rtDir} (still referenced by the provider binding \u2014 NOT retired)`);
  } else if (rtState === "keep") {
    say(`  kept-runtime-copy: ${rtDir} (byte-identical to this delivery \u2014 untouched, AC3)`);
  } else if (rtState === "unknown") {
    say(`  kept-unrecognized-runtime-dir: ${rtDir} (not quay's install-generated runtime shape \u2014 never touched)`);
  }
  if (!changed) return;
  const note = "the native provider is resolved from the plugin root, so the config carries no path";
  if (o.dryRun) {
    for (const m of removed) say(`  would-remove: ${m} (${note})`);
    return;
  }
  fs15.writeFileSync(o.cfgPath, stripped.text, "utf8");
  for (const m of removed) say(`  removed: ${m} (${note})`);
}
function stripNativeProviderBindingLines(text) {
  const lines = text.split("\n");
  const out = [];
  const removed = [];
  let inProviders = false;
  let nativeIndent = null;
  for (let i2 = 0; i2 < lines.length; i2++) {
    const line = lines[i2];
    const trimmed = line.trim();
    if (trimmed === "") {
      out.push(line);
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      inProviders = /^providers:\s*(#.*)?$/.test(line);
      nativeIndent = null;
      out.push(line);
      continue;
    }
    if (!inProviders) {
      out.push(line);
      continue;
    }
    if (nativeIndent === null) {
      if (/^native:\s*(#.*)?$/.test(trimmed)) nativeIndent = indent;
      out.push(line);
      continue;
    }
    if (indent <= nativeIndent) {
      nativeIndent = null;
      out.push(line);
      continue;
    }
    const m = /^(path|mcp_entry):\s*(.*)$/.exec(trimmed);
    if (!m) {
      out.push(line);
      continue;
    }
    const inline = m[2].replace(/\s+#.*$/, "").trim();
    if (inline === "") {
      let j = i2 + 1;
      const items = [];
      while (j < lines.length) {
        const l = lines[j];
        const lt = l.trim();
        if (lt === "" || lt.startsWith("#")) break;
        const li = l.length - l.trimStart().length;
        if (li < indent || !lt.startsWith("- ")) break;
        items.push(lt.replace(/^- /, ""));
        j++;
      }
      removed.push(`${m[1]}: [${items.join(", ")}]`);
      i2 = j - 1;
      continue;
    }
    removed.push(`${m[1]}: ${inline}`);
  }
  return { text: out.join("\n"), removed };
}
function deriveLoopScriptsClosure(o) {
  const never = new Set(o.neverLaydown.split(/\s+/).filter(Boolean));
  const REF_RE = /(?:\$\{SCRIPT_DIR\}\/|\$SCRIPT_DIR\/)([a-zA-Z0-9][a-zA-Z0-9._/-]*)/g;
  const read = (p) => {
    try {
      return fs15.readFileSync(p).toString("utf8");
    } catch {
      return "";
    }
  };
  const names = [];
  for (const ln of fs15.readFileSync(o.outPath, "utf8").split("\n")) {
    const t = ln.replace(/\n$/, "");
    if (t) names.push(t);
  }
  const seen = new Set(names);
  let changed = true;
  let rnd = 0;
  while (changed && rnd < 20) {
    changed = false;
    rnd += 1;
    for (const s of [...names]) {
      const script = path18.join(o.pluginRoot, "scripts", s);
      if (!fs15.existsSync(script) || !fs15.statSync(script).isFile()) continue;
      for (const m of read(script).matchAll(REF_RE)) {
        const dep = m[1];
        if (!dep) continue;
        if (never.has(dep)) continue;
        const depPath = path18.join(o.pluginRoot, "scripts", dep);
        if (!fs15.existsSync(depPath) || !fs15.statSync(depPath).isFile()) continue;
        if (!seen.has(dep)) {
          names.push(dep);
          seen.add(dep);
          changed = true;
        }
      }
    }
  }
  const outText = [...new Set(names)].sort().map((x) => x + "\n").join("");
  fs15.writeFileSync(o.outPath, outText, "utf8");
}
function deriveLoopScripts(o) {
  const never = new Set(o.neverLaydown.split(/\s+/).filter(Boolean));
  return stableDerivation(() => deriveLoopScriptsOnce(o.pluginRoot, never));
}
function stableDerivation(once) {
  let last = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const a = once();
    const b = once();
    if (a.length > 0 && a.join("\n") === b.join("\n")) return { names: a, stable: true };
    last = a;
  }
  return { names: last, stable: false };
}
function listFilesSafe(patternDir, filter) {
  try {
    return fs15.readdirSync(patternDir).filter(filter).map((n) => path18.join(patternDir, n));
  } catch {
    return [];
  }
}
function deriveLoopScriptsOnce(pluginRoot, never) {
  const read = (p) => {
    try {
      return fs15.readFileSync(p, "utf8");
    } catch {
      return "";
    }
  };
  const names = /* @__PURE__ */ new Set();
  const aFiles = [
    ...listFilesSafe(path18.join(pluginRoot, "skills"), () => true).flatMap((d) => listFilesSafe(d, (n) => n === "SKILL.md")),
    ...listFilesSafe(path18.join(pluginRoot, "loop"), (n) => n.endsWith(".md")),
    ...listFilesSafe(path18.join(pluginRoot, "workflows"), (n) => n.endsWith(".js"))
  ];
  for (const f of aFiles) {
    for (const m of read(f).matchAll(/plugin\/scripts\/([a-zA-Z0-9._-]+)/g)) names.add(m[1]);
  }
  const mechFiles = [
    path18.join(pluginRoot, "skills", "cold-start", "SKILL.md"),
    ...listFilesSafe(path18.join(pluginRoot, "loop"), (n) => n.endsWith(".md"))
  ].filter((f) => fs15.existsSync(f));
  for (const f of mechFiles) {
    for (const m of read(f).matchAll(/(^|[^/a-zA-Z0-9._-])([a-zA-Z0-9._-]+\.[a-zA-Z0-9]+)/g)) {
      const tok = m[2];
      if (never.has(tok)) continue;
      if (!fs15.existsSync(path18.join(pluginRoot, "scripts", tok))) continue;
      names.add(tok);
    }
  }
  for (const explicit of [
    "inner-idle-log.ts",
    "it0-split-or-commit-check.ts",
    "pipe-exit-code-check.sh",
    "gate-script-base.ts",
    "workflow-event-schema.mjs",
    "task-schema.ts",
    "task-ops.ts",
    "shape-sections.ts",
    "regex-escape.ts",
    "touches-parser.ts",
    "task-status.ts",
    "wiring-coverage-check.ts",
    "capability-catalog.sh",
    "l1-delivery-surface-check.ts",
    "dead-loop-check.sh",
    "inner-blocked-signal.ts",
    "inner-forensics.mjs",
    "task-contract-check.ts",
    "task-status-drift-check.ts",
    "touches-orthogonality-check.ts",
    "verify-delivery-surface.ts",
    "precommit-guard.ts",
    "touches-one-entry-one-path-check.ts",
    "quay-session.ts",
    "repo-root.sh",
    "repo-root.ts",
    "checker-io.ts",
    "driver-result.ts",
    "canonical-test-files.ts",
    "suite-params.ts",
    "over90-task-gate.ts",
    "semantic-trigger.ts",
    "main-thread-edit-check.ts",
    "per-file-cpu-report.mjs"
  ]) names.add(explicit);
  for (const f of listFilesSafe(path18.join(pluginRoot, "scripts"), (n) => n.startsWith("quay-") && n.endsWith(".ts"))) {
    for (const m of read(f).matchAll(/name: "[a-zA-Z0-9._-]+", file: "([a-zA-Z0-9._-]+)"/g)) {
      const member = m[1];
      if (never.has(member)) continue;
      if (!fs15.existsSync(path18.join(pluginRoot, "scripts", member))) continue;
      names.add(member);
    }
  }
  for (const tick of ["orchestrator-tick-core.md", "fast-mode-tick-core.md", "manager-tick-core.md"]) names.add(tick);
  const archiveDir = path18.join(pluginRoot, "..", "archive");
  if (fs15.existsSync(archiveDir)) {
    const archived = /* @__PURE__ */ new Set();
    const walk = (d) => {
      for (const e of fs15.readdirSync(d, { withFileTypes: true })) {
        const p = path18.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else archived.add(e.name);
      }
    };
    try {
      walk(archiveDir);
    } catch {
    }
    for (const name of [...names]) if (archived.has(name)) names.delete(name);
  }
  const tmp = path18.join(os.tmpdir(), `quay-laydown-derive-${process.pid}-${Math.random().toString(36).slice(2)}.txt`);
  fs15.writeFileSync(tmp, [...names].sort().map((x) => x + "\n").join(""), "utf8");
  try {
    deriveLoopScriptsClosure({ outPath: tmp, pluginRoot, neverLaydown: [...never].join(" ") });
    return fs15.readFileSync(tmp, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
  } finally {
    try {
      fs15.unlinkSync(tmp);
    } catch {
    }
  }
}
function providerEntryFile(cfgPath, pluginRoot) {
  try {
    const doc = import_yaml8.default.parse(fs15.readFileSync(cfgPath, "utf8")) ?? {};
    const providers = doc["providers"];
    const prov = typeof providers === "object" && providers !== null ? providers["native"] : void 0;
    if (typeof prov !== "object" || prov === null || Array.isArray(prov)) {
      return "NOT-EVALUATED:no providers.native entry in the config";
    }
    const resolved = resolveProviderEntry("native", prov, pluginRoot);
    const mcp = resolved.mcpEntry;
    if (Array.isArray(mcp) && mcp.length >= 2) return String(mcp[1]);
    return `NOT-EVALUATED:${NATIVE_PROVIDER_UNRESOLVABLE} (native omits path/mcp_entry and no plugin root could be resolved)`;
  } catch (e) {
    return `NOT-EVALUATED:unreadable config (${e instanceof Error ? e.message : String(e)})`;
  }
}
function deliverySurfaceL1Report(pluginRoot) {
  if (!pluginRoot) return { ok: true, lines: [], errors: [] };
  const l1Script = path18.join(pluginRoot, "scripts", "l1-delivery-surface-check.ts");
  if (!fs15.existsSync(l1Script)) return { ok: true, lines: [], errors: [] };
  const deliveryRoot = path18.dirname(pluginRoot);
  const specFile = path18.join(deliveryRoot, "orchestration", "SPEC-complete-delivery-surface-2026-08-05.md");
  if (!fs15.existsSync(specFile)) {
    return {
      ok: true,
      lines: [`  delivery-surface-l1: SKIP (repo-level SPEC not found at ${specFile} \u2014 bare plugin copy; referenced\u2286landed still guards the mechanism axis)`],
      errors: []
    };
  }
  const r = spawnSync4(
    process.execPath,
    ["--no-warnings", "--experimental-strip-types", l1Script, "--surface", "--root", deliveryRoot, "--spec", specFile],
    { encoding: "utf8", timeout: 12e4 }
  );
  if (r.status !== 0) {
    return {
      ok: false,
      lines: [],
      errors: ["ERROR: delivery-surface L1 check failed \u2014 the six-category delivery surface is incomplete."]
    };
  }
  return { ok: true, lines: (r.stdout ?? "").trimEnd().split("\n").filter((l) => l !== ""), errors: [] };
}
function providerRuntimeExistenceReport(cfgPath, pluginRoot, o = {}) {
  if (o.dryRun) {
    return { ok: true, lines: ["  verify-provider-runtime-existence: (dry-run, skipped)"], errors: [] };
  }
  if (!fs15.existsSync(cfgPath)) {
    return { ok: false, lines: [], errors: ["  verify-provider-runtime-existence: FAIL \u2014 no .quay/config.yml to verify"] };
  }
  const entryFile = providerEntryFile(cfgPath, pluginRoot);
  if (entryFile.startsWith("NOT-EVALUATED:")) {
    return {
      ok: true,
      lines: [`  verify-provider-runtime-existence: NOT-EVALUATED \u2014 ${entryFile.slice("NOT-EVALUATED:".length)}`],
      errors: []
    };
  }
  if (entryFile === "") {
    return {
      ok: false,
      lines: [],
      errors: ["  verify-provider-runtime-existence: FAIL \u2014 no runtime file could be determined (provider-entry-file returned nothing)"]
    };
  }
  if (!fs15.existsSync(entryFile)) {
    return {
      ok: false,
      lines: [],
      errors: [`  FAIL (referenced-runtime-missing): the provider mcp_entry references ${entryFile} but it does not exist in the target`]
    };
  }
  const lines = [`  verify-provider-runtime-existence: OK (${entryFile} exists)`];
  const base = path18.basename(entryFile);
  const srcBundle = base === "quay.js" ? pluginRoot ? path18.join(pluginRoot, "vendor", "quay", "dist", "quay.js") : "" : base === "quay-native.js" ? pluginRoot ? path18.join(pluginRoot, "vendor", "quay-native", "dist", "quay-native.js") : "" : "";
  if (srcBundle !== "" && fs15.existsSync(srcBundle)) {
    if (!fs15.readFileSync(entryFile).equals(fs15.readFileSync(srcBundle))) {
      return {
        ok: false,
        lines: [],
        errors: [
          `  FAIL (stale-runtime): ${entryFile} differs from the plugin's current vendored bundle (${srcBundle}) \u2014 a stale dist from an older install`
        ]
      };
    }
    lines.push(`  verify-provider-runtime-freshness: OK (${entryFile} matches the plugin's current vendored bundle)`);
  }
  return { ok: true, lines, errors: [] };
}
function writeClaudeSettings(dst, pluginName) {
  let data = {};
  if (fs15.existsSync(dst)) {
    try {
      data = JSON.parse(fs15.readFileSync(dst, "utf8"));
    } catch {
      data = {};
    }
  }
  let ep = data["enabledPlugins"];
  if (typeof ep !== "object" || ep === null || Array.isArray(ep)) {
    ep = {};
    data["enabledPlugins"] = ep;
  }
  ep[`${pluginName}@${pluginName}`] = true;
  let perm = data["permissions"];
  if (typeof perm !== "object" || perm === null || Array.isArray(perm)) {
    perm = {};
    data["permissions"] = perm;
  }
  let allow = perm["allow"];
  if (!Array.isArray(allow)) {
    allow = [];
    perm["allow"] = allow;
  }
  const entry = `mcp__plugin_${pluginName}_${pluginName}__*`;
  if (!allow.includes(entry)) allow.push(entry);
  fs15.writeFileSync(dst, JSON.stringify(data, null, 2) + "\n", "utf8");
}
function closedSetFingerprint(absPath) {
  try {
    const st = fs15.statSync(absPath);
    if (st.isDirectory()) {
      const entries = fs15.readdirSync(absPath).slice().sort();
      return createHash2("sha256").update(entries.join("\n")).digest("hex");
    }
    return createHash2("sha256").update(fs15.readFileSync(absPath)).digest("hex");
  } catch {
    return fs15.existsSync(absPath) ? "UNREADABLE" : "ABSENT";
  }
}
function snapshotClosedSet(root) {
  const snap = {};
  for (const item of CLOSED_SET_ITEMS) snap[item] = closedSetFingerprint(path18.join(root, item));
  return snap;
}
function closedSetReport(root, before) {
  return CLOSED_SET_ITEMS.map((item) => {
    const now = closedSetFingerprint(path18.join(root, item));
    let state;
    if (now === "UNREADABLE") state = "unreadable";
    else if (now === "ABSENT") state = "unwritten";
    else if (before[item] === now) state = "pre-existing";
    else state = "written";
    return { item, state };
  });
}
function readPluginName(pluginRoot) {
  if (!pluginRoot) return "quay";
  const name = readJsonField(path18.join(pluginRoot, ".claude-plugin", "plugin.json"), "name", "quay");
  return name === "" ? "quay" : name;
}
function readPluginVersion(pluginRoot) {
  if (!pluginRoot) return "unknown";
  const v = readJsonField(path18.join(pluginRoot, ".claude-plugin", "plugin.json"), "version", "unknown");
  return v === "" ? "unknown" : v;
}
function readManifestLines(p) {
  try {
    return fs15.readFileSync(p, "utf8").split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));
  } catch {
    return [];
  }
}
function ensureGitignore(root, opts = {}) {
  const say = opts.log ?? ((l) => console.log(l));
  const gi = path18.join(root, ".gitignore");
  const warnings = [];
  let wrote = false;
  const existing = () => fs15.existsSync(gi) ? fs15.readFileSync(gi, "utf8") : "";
  const blockPresent = (header) => existing().split("\n").some((l) => l.trim() === header);
  const entries = [
    "# quay runtime state (generated by the loop \u2014 .quay/config.yml + .quay/profiles.yml stay tracked)",
    ".quay/*",
    "!.quay/config.yml",
    "!.quay/profiles.yml"
  ];
  if (!blockPresent(entries[0])) {
    fs15.appendFileSync(gi, entries.join("\n") + "\n", "utf8");
    wrote = true;
    say("  appended: .quay/* (+ negation for config.yml/profiles.yml) to .gitignore");
  } else {
    say("  skipped: .gitignore already carries .quay/*");
  }
  const RUNTIME_HEADER = "# quay runtime artifacts outside .quay/ (written by quay itself; list = plugin/scripts/quay-runtime-artifacts.txt \u2014 do NOT hand-edit, add to that manifest)";
  if (!opts.runtimeArtifactsManifest) {
    warnings.push("runtime-artifact manifest path unknown \u2014 no quay runtime ignore rules written (a consumer project will go dirty on any task-store read)");
    say(`  WARNING: ${warnings[warnings.length - 1]}`);
    return { wrote, warnings };
  }
  const patterns = readManifestLines(opts.runtimeArtifactsManifest);
  if (patterns.length === 0) {
    warnings.push(`runtime-artifact manifest not found or empty at ${opts.runtimeArtifactsManifest} \u2014 no quay runtime ignore rules written`);
    say(`  WARNING: ${warnings[warnings.length - 1]}`);
    return { wrote, warnings };
  }
  if (blockPresent(RUNTIME_HEADER)) {
    say("  skipped: .gitignore already carries the quay runtime-artifact block");
    return { wrote, warnings };
  }
  const present = new Set(existing().split("\n").map((l) => l.trim()));
  const lines = [RUNTIME_HEADER];
  for (const p of patterns) if (!present.has(p)) lines.push(p);
  fs15.appendFileSync(gi, lines.join("\n") + "\n", "utf8");
  wrote = true;
  say(`  appended: quay runtime-artifact block (${patterns.length} pattern(s))`);
  return { wrote, warnings };
}
function printInstallSteps() {
  return [
    "",
    "\u2501\u2501\u2501 quay plugin install steps (explicit \u2014 config does NOT auto-install) \u2501\u2501\u2501",
    "The files just written ENABLE the quay plugin for this project, but they DO NOT install it.",
    "`enabledPlugins` only toggles an ALREADY-INSTALLED plugin, and an untrusted directory's project",
    'settings are not read at all \u2014 so "config committed => auto-installed" is FALSE. Install it first:',
    "",
    "  # 1. register the PUBLISHED marketplace source \u2014 the github channel. The CLI takes exactly ONE",
    "  #    <source> argument: `marketplace add <name> <source>` is rejected outright.",
    "  claude plugin marketplace add yaleh/quay",
    "",
    "  # 2. install it, at the scope YOU choose (\u26D4 `claude plugin install` defaults to `user`, so pass",
    "  #    --scope explicitly \u2014 but the VALUE is yours):",
    "  #      --scope user     one version for every project on this machine; upgrade once, here",
    "  #      --scope project  a per-project switch, version pinned in <cwd>/.claude/settings.json",
    "  #      --scope local    this working copy only, not committed",
    "  claude plugin install quay@quay --scope <user|project|local>",
    "",
    "  # (or the npm-global path: `npm install -g quay` \u2014 its register-plugin.mjs postinstall registers",
    "  #  the marketplace source only; pass QUAY_PLUGIN_SCOPE=user|project|local to enable it in the same run)",
    "  #",
    "  # 3. UPGRADE LATER \u2014 IN PLACE, at the scope that already holds the record (\u26D4 never `uninstall`",
    "  #    then `install --scope ...`: that replaces the record you have):",
    `  #      claude plugin list --json | jq -r '.[] | select(.id=="quay@quay") | .scope' | sort -u`,
    "  #      claude plugin update quay@quay --scope <the scope just printed>",
    "  #    then re-run /quay:init so `.quay/plugin` re-points at the new version's directory.",
    "",
    "  # 4. accept the trust dialog the FIRST time you enter this directory, then restart the session.",
    "After that, the enabledPlugins block below takes effect (a restart is required to apply).",
    "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501",
    ""
  ].join("\n");
}
function autoCommitClosedSet(root, mode, pluginVersion) {
  const git2 = (args) => {
    try {
      const out = execFileSync4("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return { ok: true, out };
    } catch (e) {
      const err = e;
      return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  };
  if (!git2(["rev-parse", "--is-inside-work-tree"]).ok) {
    return { state: "not-a-repo", files: [], detail: "SKIP (not a git repository \u2014 the laid-down files are not committed; init a repo or commit manually)" };
  }
  const status = git2(["status", "--porcelain"]).out;
  if (status.trim() === "") {
    return { state: "skipped", files: [], detail: "nothing to commit (working tree clean)" };
  }
  if (mode === "no") {
    return { state: "skipped", files: [], detail: "skipped as chosen \u2014 the laid-down files remain uncommitted" };
  }
  if (mode !== "yes" && !process.stdin.isTTY) {
    return {
      state: "declined",
      files: [],
      detail: "DECLINED (non-interactive \u2014 pass --auto-commit-config to commit, or --auto-commit-skip to skip)"
    };
  }
  const paths = [".quay/config.yml", ".quay/profiles.yml", "tasks", "goals", ".gitignore", ".claude/launch.settings.json", ".claude/settings.json"];
  for (const p of paths) {
    if (fs15.existsSync(path18.join(root, p))) git2(["add", "--", p]);
  }
  const staged = git2(["diff", "--cached", "--name-only"]).out.split("\n").map((l) => l.trim()).filter(Boolean);
  if (staged.length === 0) {
    return { state: "skipped", files: [], detail: "nothing staged (all laid-down files are gitignored or already committed)" };
  }
  const commit = git2(["commit", "-q", "-m", `chore(quay-init): initialize quay project files (plugin v${pluginVersion})`]);
  if (!commit.ok) {
    return {
      state: "skipped",
      files: staged,
      detail: `ERROR: auto-commit failed (git commit returned non-zero). Configure git identity, then re-run init (idempotent) to commit. ${commit.out.trim()}`.trim()
    };
  }
  return { state: "committed", files: staged, detail: `committed ${staged.length} file(s) as chore(quay-init) (plugin v${pluginVersion})` };
}
var import_yaml8, LOOP_VERSION_DEFAULTS, LOOP_VALUE_MIGRATIONS, RETIRED_CONFIG_KEYS, KNOWN_TOP_LEVEL_CONFIG_KEYS, GH_TOKEN_SHELL_REF, SHIPPED_PROFILES_TEMPLATE, PYYAML_BEST_WIDTH, PYYAML_DUMP_OPTS, PLAIN_LINE_RE, CARRIER_KINDS, DEFAULT_NEVER_LAYDOWN, CLOSED_SET_ITEMS;
var init_init = __esm({
  "packages/quay/src/init.ts"() {
    import_yaml8 = __toESM(require_dist());
    init_branch_model();
    init_regex_escape();
    init_plugin_root();
    init_config();
    init_config_validate();
    LOOP_VERSION_DEFAULTS = {
      /**
       * The provider the loop driver scans (`readLoopParams().board` → the MCP `task_list`/`task_write`
       * `provider` argument in `plugin/skills/loop-driver/SKILL.md`). A REQUIRED key of the `loop:`
       * schema (`loop-params.ts` FAIL-CLOSES without it, and `config-validate.ts` rejects a config that
       * omits it) — so a fresh install that does not write it produces a config that fails
       * `quay config validate` and a loop-driver that refuses to run.
       *
       * A VERSION-LEVEL constant because a fresh workspace enables exactly ONE provider and it is the
       * reference one: `detectProvider()` is native-only and no CLI/MCP surface exposes a provider
       * choice at init time. A config that enables a DIFFERENT provider gets `board` bound to that
       * provider by `generateConfigContent` (which overrides this default with its own `providerId`),
       * never by a constant written over a disagreement.
       *
       * ⛔ Mirror: `plugin/scripts/quay-init.sh`'s fresh-install heredoc writes the same value from its
       * own literal (shell cannot import this table); `plugin/test/quay-init.test.mjs` pins the two to
       * each other, so a change here that is not mirrored there is RED.
       */
      board: "native",
      /**
       * The gate(s) the loop driver runs on each task (`readLoopParams().gates` → the `gate_run`
       * `gate` argument in `plugin/skills/loop-driver/SKILL.md`). REQUIRED for the same reason as
       * `board` above.
       *
       * `acceptance` is a BUILT-IN gate (`gate/registry.ts`), so it resolves on a workspace whose own
       * `gates:` section is still the commented-out scaffold — which is exactly the fresh-install state.
       * That matters twice over: `config-validate.ts` check 6 rejects an unresolved name, and an empty
       * list would leave the driver with no gate to run (`params.gates[0]` undefined). A project with a
       * real gate registry overrides this in its own config; the key is only a default, never a policy.
       *
       * ⛔ Mirror: same heredoc pin as `board` above.
       */
      gates: ["acceptance"],
      /** The branch a task worktree forks from (SPEC-branching-model current ruling: `develop`). */
      fork_baseline: "develop",
      /**
       * The doc/code declaration the mechanical fan-in reads to decide whether a task branch's delta may
       * skip the full suite (`select-static-checks-for-touches.ts --classify-delta`, through its
       * `resolveDocSurfaceDecision`; gap-fan-in-delta-classify-declared-doc-surfaces).
       *
       * A VERSION-LEVEL constant, not a detected value: quay can name the surfaces IT writes into every
       * workspace (the task board, the goal store, this config dir), and a project EXTENDS the list with
       * its own documentation/telemetry prefixes. Anything not listed is CODE (fail-closed), so the cost
       * of a too-short list is a suite run, while the cost of a missing entry is a lost verification.
       * ⛔ It only decides on a tree that carries no quay checker registry — that registry decides on
       * quay's own tree, where the declaration is inert.
       * ⛔ Mirror: `plugin/scripts/quay-init.sh`'s fresh-install heredoc writes the same value from its
       * own DEFAULT_DOC_SURFACES (shell cannot import this table) — change both together, as that file's
       * own note about mirroring version-level defaults requires.
       */
      doc_surfaces: ["tasks/", "goals/", ".quay/"]
    };
    LOOP_VALUE_MIGRATIONS = {
      merge_target: {
        from: ["integration"],
        to: "develop",
        why: "`integration` was the landing branch of the retired classic milestone loop (ADR-022); a config still naming it as the fan-in target points at a branch nothing maintains."
      }
    };
    RETIRED_CONFIG_KEYS = [
      {
        path: ["providers", "native", "path"],
        label: "providers.native.path",
        why: "The native provider is resolved from the plugin root (plugin-root.ts); a config-declared path freezes the runtime to the install-cache version that wrote it, so a plugin upgrade never takes effect (gap-config-provider-path-frozen-to-versioned-cache-dir)."
      },
      {
        path: ["providers", "native", "mcp_entry"],
        label: "providers.native.mcp_entry",
        why: "Same as providers.native.path \u2014 Core derives the native launcher from the plugin root; a declared mcp_entry pins the runtime to the version that wrote the config."
      }
    ];
    KNOWN_TOP_LEVEL_CONFIG_KEYS = /* @__PURE__ */ new Set([
      "providers",
      "gates",
      "loop",
      "serve",
      "suite",
      "goals"
    ]);
    GH_TOKEN_SHELL_REF = "${GITHUB_TOKEN}";
    SHIPPED_PROFILES_TEMPLATE = [
      "# plugin/.quay/profiles.yml \u2014 shipped fallback profile carrier (AC154 profile \u62BD\u5C42\uFF09\u3002",
      "# \u88F8\u673A / \u672A\u8FC1\u79FB\u76EE\u6807\u6CA1\u6709 dev-tree \u6839 .quay/profiles.yml \u65F6\uFF0Cquay-launch.sh \u56DE\u9000\u5230\u672C\u6587\u4EF6\uFF08\u540C settings \u7684",
      "# plugin/.claude/launch.settings.json \u56DE\u9000\u624B\u6CD5\uFF0C\u89C1 gap-manager-layer-no-verified-install-vector\uFF09\u3002",
      "# \u901A\u7528\u9ED8\u8BA4\uFF1Alauncher=claude\u3001model=null\u2014\u2014\u6D88\u8D39\u8005\u6309\u81EA\u5DF1\u7684\u6808\u7F16\u8F91\uFF08dev-tree \u7528 claude-fjdac +",
      "# deepseek-v4-pro-anthropic\uFF0C\u89C1\u6839 .quay/profiles.yml\uFF1B\u4E24\u4EFD profiles \u7ED3\u6784\u4E00\u81F4\uFF0C\u53EA\u5DEE launcher/model \u53D6\u503C\uFF09\u3002",
      "version: 1",
      "",
      "# flag-only \u542F\u52A8\u53C2\u6570\uFF08\u5BF9\u5168\u90E8 role \u751F\u6548\uFF1B\u4E0E dev-tree \u6839 profiles.yml \u4E00\u81F4\uFF09\u3002",
      "excludeDynamicSystemPromptSections: true",
      "promptSuggestions: false",
      "",
      "profiles:",
      "  worker-default:",
      "    launcher: claude",
      "    model: null",
      "    bare: false",
      "    auth: key              # \u539F\u751F claude \u8BFB ANTHROPIC_API_KEY",
      "  manager-local:",
      "    launcher: claude",
      "    model: null",
      "    bare: false",
      "    auth: key",
      "    # \u65E0 unset\uFF1A\u51FA\u5382 settings\uFF08plugin/.claude/launch.settings.json\uFF09\u7684 env \u672C\u5C31\u6CA1\u6709 917k \u4E09\u4EF6\u5957",
      "    # \uFF08\u88F8\u673A\u901A\u7528\u6A21\u677F\uFF09\uFF0Cmanager \u76F4\u63A5\u7EE7\u627F\u6587\u4EF6\u9010\u5B57\u3002dev-tree \u6839\u7684 manager-local \u624D\u9700\u8981 unset 917k",
      "    # \uFF08dev settings env \u542B 917k\uFF09\u3002",
      "",
      "roles:",
      "  manager:",
      "    profile: manager-local",
      "    name: quay-manager",
      "  outer:",
      "    profile: worker-default",
      "    name: quay-outer",
      "  # \u4E09\u4E2A worker role + pool-judge/meta-driver \u4E0E dev-tree \u6839 profiles.yml \u540C\u6784\uFF1A\u5171\u4EAB worker-default\uFF0C",
      "  # \u53EA\u58F0\u660E name \u5DEE\u5F02\uFF08launcher/model \u4ECE profile \u7EE7\u627F\uFF09\u3002role \u952E\u96C6\u4E00\u81F4\u662F DoD\u2014\u2014worker-driver \u6D3E\u53D1",
      '  # `launchArgv("task-worker", \u2026)` \u7ECF profile-policy.ts resolveRole\uFF0C\u7F3A\u5931 role \u629B `role not found`',
      "  # \uFF08fail-closed\uFF0C\u65E0\u56DE\u9000\uFF09\u21D2 \u7B2C\u4E09\u65B9\u9879\u76EE\u6C38\u4E0D\u6D3E\u53D1\uFF08gap-shipped-profiles-missing-worker-roles\uFF09\u3002",
      "  # \u26A0\uFE0F mcpBlacklist \u540C\u6837\u5FC5\u987B\u5728\u3010\u4E24\u4EFD carrier\u3011\u4E0A\u90FD\u843D\u5730\uFF08gap-worker-mcp-blacklist-strict-config\uFF09\uFF1A",
      "  #   \u672C\u6587\u4EF6\u662F quay-init \u9010\u5B57\u94FA\u8FDB\u6D88\u8D39\u8005 .quay/ \u7684\u90A3\u4E00\u4EFD\uFF1B\u53EA\u6539 dev-tree \u6839 \u21D2 \u7B2C\u4E09\u65B9\u9879\u76EE\u529F\u80FD\u9759\u9ED8\u5931\u6548",
      "  #   \u2014\u2014\u8FD9\u6B63\u662F profiles-role-coverage-check.ts \u5B58\u5728\u7684\u90A3\u4E2A\u300C\u4FEE\u4E86\u4E00\u4EFD\u3001init \u94FA\u7684\u662F\u53E6\u4E00\u4EFD\u300D\u7F3A\u9677\u5F62\u72B6\u3002",
      "  task-worker:",
      "    profile: worker-default",
      "    name: quay-task-worker",
      "    env:",
      '      CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: "0"    # \u9A71\u52A8\u7684\u5916\u90E8\u8D85\u65F6\u662F\u552F\u4E00\u515C\u5E95\uFF08\u65E0\u6B64\u952E claude -p \u6709 600s end_turn \u540E\u53F0\u4EFB\u52A1\u5BBD\u9650\uFF09',
      "    # \u89D2\u8272\u5C42\uFF08\u26D4 \u975E profile \u5C42\uFF09\uFF1Aouter \u4E0E\u5B83\u4EEC\u5171\u4EAB worker-default\uFF0C\u6302 profile \u4F1A\u8FDE\u5750 outer\u3002",
      "    # \u4E09\u4E2A role \u5404\u5199\u4E00\u4EFD\uFF08\u26D4 \u4E0D\u7528 YAML \u951A\u70B9\u2014\u2014\u672C\u6587\u4EF6\u88AB quay-launch.sh \u7684 python3+yaml \u4E0E TS \u7684",
      "    # profile-policy.ts \u4E24\u6761\u8DEF\u5F84\u8BFB\uFF0C\u4FDD\u6301\u4E0E\u4E24\u4EFD carrier \u65E2\u6709\u5199\u6CD5\u4E00\u81F4\u7684\u6734\u7D20\u5F62\u72B6\uFF09\u3002",
      "    mcpBlacklist:",
      "      - chrome-devtools",
      "      - playwright",
      "  selector:",
      "    profile: worker-default",
      "    name: quay-selector",
      "    mcpBlacklist:",
      "      - chrome-devtools",
      "      - playwright",
      "  fix-worker:",
      "    profile: worker-default",
      "    name: quay-fix-worker",
      "    env:",
      '      CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: "0"    # \u540C task-worker',
      "    mcpBlacklist:",
      "      - chrome-devtools",
      "      - playwright",
      "  pool-judge:",
      "    profile: worker-default",
      "    name: quay-pool-judge",
      "  meta-driver:",
      "    profile: worker-default",
      "    name: quay-meta-driver",
      ""
    ].join("\n");
    PYYAML_BEST_WIDTH = 80;
    PYYAML_DUMP_OPTS = {
      indent: 2,
      indentSeq: false,
      lineWidth: 0,
      defaultStringType: "PLAIN",
      defaultKeyType: "PLAIN",
      nullStr: "null"
    };
    PLAIN_LINE_RE = /^(\s*(?:- )?)(.*)$/;
    CARRIER_KINDS = [
      ["QUAY_NATIVE_ADR_DIR", "adr"],
      ["QUAY_NATIVE_GOAL_DIR", "goals"],
      ["QUAY_NATIVE_META_DIR", "meta"]
    ];
    DEFAULT_NEVER_LAYDOWN = "quay-init.sh";
    CLOSED_SET_ITEMS = [
      ".quay/config.yml",
      ".quay/profiles.yml",
      "tasks",
      "goals",
      ".gitignore",
      ".claude/launch.settings.json",
      ".claude/settings.json"
    ];
  }
});

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/core-src-import.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
var HERE = path.dirname(fileURLToPath(import.meta.url));
var MAX_DEPTH = 8;
function resolveCoreSrcFile(rel, startDir = HERE) {
  let dir = path.resolve(startDir);
  for (let i2 = 0; i2 < MAX_DEPTH; i2++) {
    const repoTree = path.join(dir, "packages", "quay", "src", rel);
    if (fs.existsSync(repoTree)) return repoTree;
    const staged = path.join(dir, "src", rel);
    if (fs.existsSync(staged)) return staged;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
async function acquireCoreSrc(primary, rel) {
  try {
    return await primary();
  } catch (err) {
    if (err?.code !== "ERR_MODULE_NOT_FOUND") throw err;
    const fallback = resolveCoreSrcFile(rel);
    if (!fallback) throw err;
    try {
      return await import(pathToFileURL(fallback).href);
    } catch {
      throw err;
    }
  }
}

// .tmp-dist-publish-worktrees/publish-h9Unns/scripts/quay-init-steps.ts
var USAGE = `usage: quay-init-steps.ts <step> [args\u2026]

steps (each mirrors the python3 invocation it replaced in plugin/scripts/quay-init.sh):
  loop-value          <cfg> <key>
  json-field          <json-path> <field> <fallback>
  has-npm-test        <package.json>
  ensure-loop-config  <cfg> <repo_root> <test_command> <tmux_session> <worktree_root> <dry_run:true|false>
  ensure-carrier-env  <cfg> <ws_root> <dry_run:true|false>
  reconcile-config    <cfg> <dry_run:true|false>
  refresh-plugin-link <ws_root> <plugin_root> <dry_run:true|false>
  migrate-mcp-entry   <cfg> <install_provider> <install_runtime> <install_core> <ws_root> <dry_run> <backup_ts>
  derive-loop-scripts <out-file> <plugin_root> <never-laydown-names>
  laydown-set         <plugin_root> [never-laydown-names]
  provider-entry-file <cfg> [plugin-root]
  write-claude-settings <dst> <plugin_name>
`;
async function main() {
  const [step, ...args] = process.argv.slice(2);
  if (!step || step === "--help" || step === "-h") {
    process.stdout.write(USAGE);
    return;
  }
  const core = await acquireCoreSrc(() => Promise.resolve().then(() => (init_init(), init_exports)), "init.ts");
  const need = (n) => {
    if (args.length < n) {
      process.stderr.write(`quay-init-steps: '${step}' needs ${n} argument(s), got ${args.length}
${USAGE}`);
      process.exitCode = 2;
      throw new Error("usage");
    }
  };
  switch (step) {
    case "loop-value": {
      need(2);
      process.stdout.write(core.readExistingLoopValue(args[0], args[1]) + "\n");
      return;
    }
    case "json-field": {
      need(3);
      process.stdout.write(core.readJsonField(args[0], args[1], args[2]) + "\n");
      return;
    }
    case "has-npm-test": {
      need(1);
      if (!core.hasNpmTestScript(args[0])) process.exitCode = 1;
      return;
    }
    case "ensure-loop-config": {
      need(6);
      core.ensureLoopConfig({
        cfgPath: args[0],
        repoRoot: args[1],
        testCommand: args[2],
        tmuxSession: args[3],
        worktreeRoot: args[4],
        dryRun: args[5] === "true"
      });
      return;
    }
    case "ensure-carrier-env": {
      need(3);
      core.ensureProviderCarrierEnv({ cfgPath: args[0], wsRoot: args[1], dryRun: args[2] === "true" });
      return;
    }
    case "reconcile-config": {
      need(2);
      core.reconcileConfigFile({ cfgPath: args[0], dryRun: args[1] === "true" });
      return;
    }
    case "refresh-plugin-link": {
      need(3);
      core.refreshProjectPluginLink({ wsRoot: args[0], pluginRoot: args[1] || null, dryRun: args[2] === "true" });
      return;
    }
    case "migrate-mcp-entry": {
      need(7);
      core.migrateStaleMcpEntry({
        cfgPath: args[0],
        installProvider: args[1],
        installRuntime: args[2],
        installCore: args[3],
        wsRoot: args[4],
        dryRun: args[5] === "true",
        backupTs: args[6]
      });
      return;
    }
    case "derive-loop-scripts": {
      need(3);
      core.deriveLoopScriptsClosure({ outPath: args[0], pluginRoot: args[1], neverLaydown: args[2] });
      return;
    }
    case "laydown-set": {
      need(1);
      const { names } = core.deriveLoopScripts({ pluginRoot: args[0], neverLaydown: args[1] ?? core.DEFAULT_NEVER_LAYDOWN });
      process.stdout.write(names.map((n) => n + "\n").join(""));
      return;
    }
    case "provider-entry-file": {
      need(1);
      process.stdout.write(core.providerEntryFile(args[0], args[1]) + "\n");
      return;
    }
    case "write-claude-settings": {
      need(2);
      core.writeClaudeSettings(args[0], args[1]);
      return;
    }
    default: {
      process.stderr.write(`quay-init-steps: unknown step '${step}'
${USAGE}`);
      process.exitCode = 2;
      return;
    }
  }
}
main().catch((err) => {
  if (err instanceof Error && err.message === "usage") return;
  process.stderr.write(`quay-init-steps: ${err instanceof Error ? err.message : String(err)}
`);
  process.exitCode = 1;
});
