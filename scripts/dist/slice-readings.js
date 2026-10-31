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
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
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
    function visit_(key, node, visitor, path7) {
      const ctrl = callVisitor(key, node, visitor, path7);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path7, ctrl);
        return visit_(key, ctrl, visitor, path7);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path7 = Object.freeze(path7.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = visit_(i, node.items[i], visitor, path7);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path7 = Object.freeze(path7.concat(node));
          const ck = visit_("key", node.key, visitor, path7);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = visit_("value", node.value, visitor, path7);
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
    async function visitAsync_(key, node, visitor, path7) {
      const ctrl = await callVisitor(key, node, visitor, path7);
      if (identity.isNode(ctrl) || identity.isPair(ctrl)) {
        replaceNode(key, path7, ctrl);
        return visitAsync_(key, ctrl, visitor, path7);
      }
      if (typeof ctrl !== "symbol") {
        if (identity.isCollection(node)) {
          path7 = Object.freeze(path7.concat(node));
          for (let i = 0; i < node.items.length; ++i) {
            const ci = await visitAsync_(i, node.items[i], visitor, path7);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              node.items.splice(i, 1);
              i -= 1;
            }
          }
        } else if (identity.isPair(node)) {
          path7 = Object.freeze(path7.concat(node));
          const ck = await visitAsync_("key", node.key, visitor, path7);
          if (ck === BREAK)
            return BREAK;
          else if (ck === REMOVE)
            node.key = null;
          const cv = await visitAsync_("value", node.value, visitor, path7);
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
    function callVisitor(key, node, visitor, path7) {
      if (typeof visitor === "function")
        return visitor(key, node, path7);
      if (identity.isMap(node))
        return visitor.Map?.(key, node, path7);
      if (identity.isSeq(node))
        return visitor.Seq?.(key, node, path7);
      if (identity.isPair(node))
        return visitor.Pair?.(key, node, path7);
      if (identity.isScalar(node))
        return visitor.Scalar?.(key, node, path7);
      if (identity.isAlias(node))
        return visitor.Alias?.(key, node, path7);
      return void 0;
    }
    function replaceNode(key, path7, node) {
      const parent = path7[path7.length - 1];
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
      for (let i = 1; true; ++i) {
        const name = `${prefix}${i}`;
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
          for (let i = 0, len = val.length; i < len; ++i) {
            const v0 = val[i];
            const v1 = applyReviver(reviver, val, String(i), v0);
            if (v1 === void 0)
              delete val[i];
            else if (v1 !== v0)
              val[i] = v1;
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
        return value.map((v, i) => toJS(v, String(i), ctx));
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
    function collectionFromPath(schema, path7, value) {
      let v = value;
      for (let i = path7.length - 1; i >= 0; --i) {
        const k = path7[i];
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
    var isEmptyPath = (path7) => path7 == null || typeof path7 === "object" && !!path7[Symbol.iterator]().next().done;
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
      addIn(path7, value) {
        if (isEmptyPath(path7))
          this.add(value);
        else {
          const [key, ...rest] = path7;
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
      deleteIn(path7) {
        const [key, ...rest] = path7;
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
      getIn(path7, keepScalar) {
        const [key, ...rest] = path7;
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
      hasIn(path7) {
        const [key, ...rest] = path7;
        if (rest.length === 0)
          return this.has(key);
        const node = this.get(key, true);
        return identity.isCollection(node) ? node.hasIn(rest) : false;
      }
      /**
       * Sets a value in this collection. For `!!set`, `value` needs to be a
       * boolean to add/remove the item from the set.
       */
      setIn(path7, value) {
        const [key, ...rest] = path7;
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
      let i = -1;
      let escStart = -1;
      let escEnd = -1;
      if (mode === FOLD_BLOCK) {
        i = consumeMoreIndentedLines(text, i, indent.length);
        if (i !== -1)
          end = i + endStep;
      }
      for (let ch; ch = text[i += 1]; ) {
        if (mode === FOLD_QUOTED && ch === "\\") {
          escStart = i;
          switch (text[i + 1]) {
            case "x":
              i += 3;
              break;
            case "u":
              i += 5;
              break;
            case "U":
              i += 9;
              break;
            default:
              i += 1;
          }
          escEnd = i;
        }
        if (ch === "\n") {
          if (mode === FOLD_BLOCK)
            i = consumeMoreIndentedLines(text, i, indent.length);
          end = i + indent.length + endStep;
          split = void 0;
        } else {
          if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
            const next = text[i + 1];
            if (next && next !== " " && next !== "\n" && next !== "	")
              split = i;
          }
          if (i >= end) {
            if (split) {
              folds.push(split);
              end = split + endStep;
              split = void 0;
            } else if (mode === FOLD_QUOTED) {
              while (prev === " " || prev === "	") {
                prev = ch;
                ch = text[i += 1];
                overflow = true;
              }
              const j = i > escEnd + 1 ? i - 2 : escStart - 1;
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
      for (let i2 = 0; i2 < folds.length; ++i2) {
        const fold = folds[i2];
        const end2 = folds[i2 + 1] || text.length;
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
    function consumeMoreIndentedLines(text, i, indent) {
      let end = i;
      let start = i + 1;
      let ch = text[start];
      while (ch === " " || ch === "	") {
        if (i < start + indent) {
          ch = text[++i];
        } else {
          do {
            ch = text[++i];
          } while (ch && ch !== "\n");
          end = i;
          start = i + 1;
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
      for (let i = 0, start = 0; i < strLen; ++i) {
        if (str[i] === "\n") {
          if (i - start > limit)
            return true;
          start = i + 1;
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
      for (let i = 0, ch = json[i]; ch; ch = json[++i]) {
        if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n") {
          str += json.slice(start, i) + "\\ ";
          i += 1;
          start = i;
          ch = "\\";
        }
        if (ch === "\\")
          switch (json[i + 1]) {
            case "u":
              {
                str += json.slice(start, i);
                const code = json.substr(i + 2, 4);
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
                      str += json.substr(i, 6);
                }
                i += 5;
                start = i + 1;
              }
              break;
            case "n":
              if (implicitKey || json[i + 2] === '"' || json.length < minMultiLineLength) {
                i += 1;
              } else {
                str += json.slice(start, i) + "\n\n";
                while (json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== '"') {
                  str += "\n";
                  i += 2;
                }
                str += indent;
                if (json[i + 2] === " ")
                  str += "\\";
                i += 1;
                start = i + 1;
              }
              break;
            default:
              i += 1;
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
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
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
        for (let i = 1; i < lines.length; ++i) {
          const line = lines[i];
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
      for (let i = 0; i < items.length; ++i) {
        const item = items[i];
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
        if (i < items.length - 1) {
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
          const i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
          if (i === -1)
            this.items.push(_pair);
          else
            this.items.splice(i, 0, _pair);
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
        let i = 0;
        for (const item of this.items)
          seq.push(toJS.toJS(item, String(i++), ctx));
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
          let i = 0;
          for (let it of obj) {
            if (typeof replacer === "function") {
              const key = obj instanceof Set ? it : String(i++);
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
      const num2 = typeof value === "number" ? value : Number(value);
      if (!isFinite(num2))
        return isNaN(num2) ? ".nan" : num2 < 0 ? "-.inf" : ".inf";
      let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
      if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n) && !n.includes("e")) {
        let i = n.indexOf(".");
        if (i < 0) {
          i = n.length;
          n += ".";
        }
        let d = minFractionDigits - (n.length - i - 1);
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
        const num2 = Number(node.value);
        return isFinite(num2) ? num2.toExponential() : stringifyNumber.stringifyNumber(node);
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
          for (let i = 0; i < str.length; ++i)
            buffer[i] = str.charCodeAt(i);
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
          for (let i = 0; i < buf.length; ++i)
            s += String.fromCharCode(buf[i]);
          str = btoa(s);
        } else {
          throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
        }
        type ?? (type = Scalar.Scalar.BLOCK_LITERAL);
        if (type !== Scalar.Scalar.QUOTE_DOUBLE) {
          const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
          const n = Math.ceil(str.length / lineWidth);
          const lines = new Array(n);
          for (let i = 0, o = 0; i < n; ++i, o += lineWidth) {
            lines[i] = str.substr(o, lineWidth);
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
        for (let i = 0; i < seq.items.length; ++i) {
          let item = seq.items[i];
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
          seq.items[i] = identity.isPair(item) ? item : new Pair.Pair(item);
        }
      } else
        onError("Expected a sequence for this tag");
      return seq;
    }
    function createPairs(schema, iterable, ctx) {
      const { replacer } = ctx;
      const pairs2 = new YAMLSeq.YAMLSeq(schema);
      pairs2.tag = "tag:yaml.org,2002:pairs";
      let i = 0;
      if (iterable && Symbol.iterator in Object(iterable))
        for (let it of iterable) {
          if (typeof replacer === "function")
            it = replacer.call(iterable, String(i++), it);
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
        const num2 = Number(node.value);
        return isFinite(num2) ? num2.toExponential() : stringifyNumber.stringifyNumber(node);
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
      const num2 = (n) => asBigInt ? BigInt(n) : Number(n);
      const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num2(60) + num2(p), num2(0));
      return sign === "-" ? num2(-1) * res : res;
    }
    function stringifySexagesimal(node) {
      let { value } = node;
      let num2 = (n) => n;
      if (typeof value === "bigint")
        num2 = (n) => BigInt(n);
      else if (isNaN(value) || !isFinite(value))
        return stringifyNumber.stringifyNumber(node);
      let sign = "";
      if (value < 0) {
        sign = "-";
        value *= num2(-1);
      }
      const _60 = num2(60);
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
      addIn(path7, value) {
        if (assertCollection(this.contents))
          this.contents.addIn(path7, value);
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
      deleteIn(path7) {
        if (Collection.isEmptyPath(path7)) {
          if (this.contents == null)
            return false;
          this.contents = null;
          return true;
        }
        return assertCollection(this.contents) ? this.contents.deleteIn(path7) : false;
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
      getIn(path7, keepScalar) {
        if (Collection.isEmptyPath(path7))
          return !keepScalar && identity.isScalar(this.contents) ? this.contents.value : this.contents;
        return identity.isCollection(this.contents) ? this.contents.getIn(path7, keepScalar) : void 0;
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
      hasIn(path7) {
        if (Collection.isEmptyPath(path7))
          return this.contents !== void 0;
        return identity.isCollection(this.contents) ? this.contents.hasIn(path7) : false;
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
      setIn(path7, value) {
        if (Collection.isEmptyPath(path7)) {
          this.contents = value;
        } else if (this.contents == null) {
          this.contents = Collection.collectionFromPath(this.schema, Array.from(path7), value);
        } else if (assertCollection(this.contents)) {
          this.contents.setIn(path7, value);
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
      for (let i = 0; i < fc.items.length; ++i) {
        const collItem = fc.items[i];
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
            if (i === 0 && props.comma)
              onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
            else if (i < fc.items.length - 1)
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
        if (i === 0) {
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
      for (let i = lines.length - 1; i >= 0; --i) {
        const content = lines[i][1];
        if (content === "" || content === "\r")
          chompStart = i;
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
      for (let i = 0; i < chompStart; ++i) {
        const [indent, content] = lines[i];
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
          contentStart = i;
          if (trimIndent === 0 && !ctx.atRoot) {
            const message = "Block scalar values in collections must be indented";
            onError(offset, "BAD_INDENT", message);
          }
          break;
        }
        offset += indent.length + content.length + 1;
      }
      for (let i = lines.length - 1; i >= chompStart; --i) {
        if (lines[i][0].length > trimIndent)
          chompStart = i + 1;
      }
      let value = "";
      let sep = "";
      let prevMoreIndented = false;
      for (let i = 0; i < contentStart; ++i)
        value += lines[i][0].slice(trimIndent) + "\n";
      for (let i = contentStart; i < chompStart; ++i) {
        let [indent, content] = lines[i];
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
          for (let i = chompStart; i < lines.length; ++i)
            value += "\n" + lines[i][0].slice(trimIndent);
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
      for (let i = 1; i < source.length; ++i) {
        const ch = source[i];
        if (!chomp && (ch === "-" || ch === "+"))
          chomp = ch;
        else {
          const n = Number(ch);
          if (!indent && n)
            indent = n;
          else if (error === -1)
            error = offset + i;
        }
      }
      if (error !== -1)
        onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
      let hasSpace = false;
      let comment = "";
      let length = source.length;
      for (let i = 1; i < props.length; ++i) {
        const token = props[i];
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
      for (let i = 1; i < split.length; i += 2)
        lines.push([split[i], split[i + 1]]);
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
      for (let i = 1; i < source.length - 1; ++i) {
        const ch = source[i];
        if (ch === "\r" && source[i + 1] === "\n")
          continue;
        if (ch === "\n") {
          const { fold, offset } = foldNewline(source, i);
          res += fold;
          i = offset;
        } else if (ch === "\\") {
          let next = source[++i];
          const cc = escapeCodes[next];
          if (cc)
            res += cc;
          else if (next === "\n") {
            next = source[i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "\r" && source[i + 1] === "\n") {
            next = source[++i + 1];
            while (next === " " || next === "	")
              next = source[++i + 1];
          } else if (next === "x" || next === "u" || next === "U") {
            const length = next === "x" ? 2 : next === "u" ? 4 : 8;
            res += parseCharCode(source, i + 1, length, onError);
            i += length;
          } else {
            const raw = source.substr(i - 1, 2);
            onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
            res += raw;
          }
        } else if (ch === " " || ch === "	") {
          const wsStart = i;
          let next = source[i + 1];
          while (next === " " || next === "	")
            next = source[++i + 1];
          if (next !== "\n" && !(next === "\r" && source[i + 2] === "\n"))
            res += i > wsStart ? source.slice(wsStart, i + 1) : ch;
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
        for (let i = pos - 1; i >= 0; --i) {
          let st = before[i];
          switch (st.type) {
            case "space":
            case "comment":
            case "newline":
              offset -= st.source.length;
              continue;
          }
          st = before[++i];
          while (st?.type === "space") {
            offset += st.source.length;
            st = before[++i];
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
      for (let i = 0; i < prelude.length; ++i) {
        const source = prelude[i];
        switch (source[0]) {
          case "#":
            comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
            atComment = true;
            afterEmptyLine = false;
            break;
          case "%":
            if (prelude[i + 1]?.[0] !== "#")
              i += 1;
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
          for (let i = 0; i < this.errors.length; ++i)
            doc.errors.push(this.errors[i]);
          for (let i = 0; i < this.warnings.length; ++i)
            doc.warnings.push(this.warnings[i]);
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
    visit.itemAtPath = (cst, path7) => {
      let item = cst;
      for (const [field, index] of path7) {
        const tok = item?.[field];
        if (tok && "items" in tok) {
          item = tok.items[index];
        } else
          return void 0;
      }
      return item;
    };
    visit.parentCollection = (cst, path7) => {
      const parent = visit.itemAtPath(cst, path7.slice(0, -1));
      const field = path7[path7.length - 1][0];
      const coll = parent?.[field];
      if (coll && "items" in coll)
        return coll;
      throw new Error("Parent collection not found");
    };
    function _visit(path7, item, visitor) {
      let ctrl = visitor(item, path7);
      if (typeof ctrl === "symbol")
        return ctrl;
      for (const field of ["key", "value"]) {
        const token = item[field];
        if (token && "items" in token) {
          for (let i = 0; i < token.items.length; ++i) {
            const ci = _visit(Object.freeze(path7.concat([[field, i]])), token.items[i], visitor);
            if (typeof ci === "number")
              i = ci - 1;
            else if (ci === BREAK)
              return BREAK;
            else if (ci === REMOVE) {
              token.items.splice(i, 1);
              i -= 1;
            }
          }
          if (typeof ctrl === "function" && field === "key")
            ctrl = ctrl(item, path7);
        }
      }
      return typeof ctrl === "function" ? ctrl(item, path7) : ctrl;
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
        let i = this.pos;
        let ch = this.buffer[i];
        while (ch === " " || ch === "	")
          ch = this.buffer[++i];
        if (!ch || ch === "#" || ch === "\n")
          return true;
        if (ch === "\r")
          return this.buffer[i + 1] === "\n";
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
        let i = this.pos;
        while (true) {
          const ch = this.buffer[++i];
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
        loop: for (let i2 = this.pos; ch = this.buffer[i2]; ++i2) {
          switch (ch) {
            case " ":
              indent += 1;
              break;
            case "\n":
              nl = i2;
              indent = 0;
              break;
            case "\r": {
              const next = this.buffer[i2 + 1];
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
        let i = nl + 1;
        ch = this.buffer[i];
        while (ch === " ")
          ch = this.buffer[++i];
        if (ch === "	") {
          while (ch === "	" || ch === " " || ch === "\r" || ch === "\n")
            ch = this.buffer[++i];
          nl = i - 1;
        } else if (!this.blockScalarKeep) {
          do {
            let i2 = nl - 1;
            let ch2 = this.buffer[i2];
            if (ch2 === "\r")
              ch2 = this.buffer[--i2];
            const lastChar = i2;
            while (ch2 === " ")
              ch2 = this.buffer[--i2];
            if (ch2 === "\n" && i2 >= this.pos && i2 + 1 + indent > lastChar)
              nl = i2;
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
        let i = this.pos - 1;
        let ch;
        while (ch = this.buffer[++i]) {
          if (ch === ":") {
            const next = this.buffer[i + 1];
            if (isEmpty(next) || inFlow && flowIndicatorChars.has(next))
              break;
            end = i;
          } else if (isEmpty(ch)) {
            let next = this.buffer[i + 1];
            if (ch === "\r") {
              if (next === "\n") {
                i += 1;
                ch = "\n";
                next = this.buffer[i + 1];
              } else
                end = i;
            }
            if (next === "#" || inFlow && flowIndicatorChars.has(next))
              break;
            if (ch === "\n") {
              const cs = this.continueScalar(i + 1);
              if (cs === -1)
                break;
              i = Math.max(i, cs - 2);
            }
          } else {
            if (inFlow && flowIndicatorChars.has(ch))
              break;
            end = i;
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
      *pushToIndex(i, allowEmpty) {
        const s = this.buffer.slice(this.pos, i);
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
          let i = this.pos + 2;
          let ch = this.buffer[i];
          while (!isEmpty(ch) && ch !== ">")
            ch = this.buffer[++i];
          return yield* this.pushToIndex(ch === ">" ? i + 1 : i, false);
        } else {
          let i = this.pos + 1;
          let ch = this.buffer[i];
          while (ch) {
            if (tagChars.has(ch))
              ch = this.buffer[++i];
            else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2])) {
              ch = this.buffer[i += 3];
            } else
              break;
          }
          return yield* this.pushToIndex(i, false);
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
        let i = this.pos - 1;
        let ch;
        do {
          ch = this.buffer[++i];
        } while (ch === " " || allowTabs && ch === "	");
        const n = i - this.pos;
        if (n > 0) {
          yield this.buffer.substr(this.pos, n);
          this.pos = i;
        }
        return n;
      }
      *pushUntil(test) {
        let i = this.pos;
        let ch = this.buffer[i];
        while (!test(ch))
          ch = this.buffer[++i];
        return yield* this.pushToIndex(i, false);
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
      for (let i = 0; i < list.length; ++i)
        if (list[i].type === type)
          return true;
      return false;
    }
    function findNonEmptyIndex(list) {
      for (let i = 0; i < list.length; ++i) {
        switch (list[i].type) {
          case "space":
          case "comment":
          case "newline":
            break;
          default:
            return i;
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
      let i = prev.length;
      loop: while (--i >= 0) {
        switch (prev[i].type) {
          case "doc-start":
          case "explicit-key-ind":
          case "map-value-ind":
          case "seq-item-ind":
          case "newline":
            break loop;
        }
      }
      while (prev[++i]?.type === "space") {
      }
      return prev.splice(i, prev.length);
    }
    function arrayPushArray(target, source) {
      if (source.length < 1e5)
        Array.prototype.push.apply(target, source);
      else
        for (let i = 0; i < source.length; ++i)
          target.push(source[i]);
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
            for (let i = 0; i < it.sep.length; ++i) {
              const st = it.sep[i];
              switch (st.type) {
                case "newline":
                  nl.push(i);
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
              const fs6 = this.flowScalar(this.type);
              if (atNextItem || it.value) {
                map.items.push({ start, key: fs6, sep: [] });
                this.onKeyLine = true;
              } else if (it.sep) {
                this.stack.push(fs6);
              } else {
                Object.assign(it, { key: fs6, sep: [] });
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
              const fs6 = this.flowScalar(this.type);
              if (!it || it.value)
                fc.items.push({ start: [], key: fs6, sep: [] });
              else if (it.sep)
                this.stack.push(fs6);
              else
                Object.assign(it, { key: fs6, sep: [] });
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

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/slice-readings.ts
import fs5 from "node:fs";
import os2 from "node:os";
import path6 from "node:path";
import { spawnSync as spawnSync2 } from "node:child_process";

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/gate-script-base.ts
import path from "node:path";
function helpExit(usage2) {
  process.stdout.write(usage2.endsWith("\n") ? usage2 : usage2 + "\n");
  process.exit(0);
}
function parseArgs(argv, spec) {
  const result = { args: [], flags: {} };
  const raw = argv.slice(2);
  const flagDefs = spec.flags || {};
  const unknownMode = spec.unknown ?? (spec.strict ? "reject" : "accept");
  const scriptName = path.basename(argv[1] || "script");
  if (raw.includes("--help") || raw.includes("-h")) {
    if (spec.help === "return") {
      result.help = true;
      return result;
    }
    helpExit(`usage: ${scriptName} ${spec.usage}`);
  }
  const usageError = (message) => {
    if (spec.errors === "return") {
      result.error = message;
      return result;
    }
    console.error(message);
    process.exit(2);
  };
  for (let i = 0; i < raw.length; i++) {
    const a = raw[i];
    if (a.startsWith("--")) {
      const eqIdx = a.indexOf("=");
      const name = eqIdx >= 0 ? a.slice(2, eqIdx) : a.slice(2);
      const def = flagDefs[name];
      if (!def && unknownMode === "reject") return usageError(`unknown argument: --${name}`);
      if (!def && unknownMode === "skip") continue;
      if (def?.type === "boolean") {
        result.flags[name] = true;
      } else if (def?.type === "string[]") {
        if (!result.lists) result.lists = {};
        const list = result.lists[name] ??= [];
        if (eqIdx >= 0) list.push(a.slice(eqIdx + 1));
        else if (def.greedy) {
          while (i + 1 < raw.length && !raw[i + 1].startsWith("--")) list.push(raw[++i]);
        } else if (i + 1 < raw.length) list.push(raw[++i]);
      } else if (eqIdx >= 0) {
        result.flags[name] = a.slice(eqIdx + 1);
      } else if (i + 1 < raw.length) {
        result.flags[name] = raw[++i];
      } else {
        result.flags[name] = "";
      }
    } else {
      result.args.push(a);
    }
  }
  const minArgs = spec.minArgs ?? 1;
  if (result.args.length < minArgs) {
    return usageError(`Usage: ${scriptName} ${spec.usage}`);
  }
  return result;
}
function isDirectEntry(importMeta, argv1, expectedBase) {
  void importMeta;
  const entry = argv1 || process.argv[1];
  if (!entry) return false;
  return path.basename(entry).replace(/\.(?:js|ts|mjs)$/, "") === expectedBase;
}

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/repo-root.ts
import fs from "node:fs";
import path2 from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
var MAX_DEPTH = 16;
function repoRoot(startDir = path2.dirname(fileURLToPath(import.meta.url))) {
  let dir = path2.resolve(startDir);
  for (let i = 0; i < MAX_DEPTH; i++) {
    const hasPkg = fs.existsSync(path2.join(dir, "package.json"));
    if (hasPkg && fs.existsSync(path2.join(dir, "plugin")) && fs.existsSync(path2.join(dir, "scripts", "test.sh"))) {
      return dir;
    }
    if (hasPkg && fs.existsSync(path2.join(dir, ".quay", "config.yml"))) {
      return dir;
    }
    if (fs.existsSync(path2.join(dir, ".git"))) {
      return dir;
    }
    const parent = path2.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      timeout: 5e3,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return process.cwd();
  }
}

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/archguard-runner.ts
import fs2 from "node:fs";
import os from "node:os";
import path3 from "node:path";
import { createRequire as nodeCreateRequire } from "node:module";
import { spawnSync } from "node:child_process";
var SCOPES = [
  { source: "packages/quay/src", label: "src" },
  { source: "plugin/scripts", label: "scripts" },
  { source: "packages/quay-native/src", label: "quay-native-src" },
  { source: "packages/quay-github/src", label: "quay-github-src" },
  { source: "packages/quay-backlog/src", label: "quay-backlog-src" },
  { source: "experiments/quay-perpetual-stream/scripts", label: "experiments-scripts" }
];
var CROSS_SCOPE_NOT_EVALUATED = {
  crossScope: "not-evaluated",
  crossScopeReason: "six scopes are analyzed independently (one scope per source \u21D2 no cross-scope edges); plugin/scripts \u2194 packages/*/src edges are absent from EVERY analysis \u2014 unmeasured, not measured-zero"
};
function fail(msg) {
  process.stderr.write(`archguard-runner: ${msg}
`);
  process.exit(1);
}
var USAGE_TEXT = "usage: node --experimental-strip-types plugin/scripts/archguard-runner.ts --root <repo-root> [--work-dir <dir>]\n";
function usage(msg) {
  process.stderr.write(`archguard-runner: ${msg}
`);
  process.stderr.write(USAGE_TEXT);
  process.exit(2);
}
var ARCHGUARD_PKG_NAME = "@yalehwang/archguard";
var ARCHGUARD_CLI_REL = path3.posix.join("dist", "cli", "index.js");
function isExecutableFile(p) {
  try {
    if (!fs2.statSync(p).isFile()) return false;
    fs2.accessSync(p, fs2.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
function isFile(p) {
  try {
    return fs2.statSync(p).isFile();
  } catch {
    return false;
  }
}
function claudePluginRoots() {
  const roots = [];
  const cfg = (process.env.CLAUDE_CONFIG_DIR ?? "").trim();
  if (cfg) roots.push(path3.join(cfg, "plugins"));
  try {
    roots.push(path3.join(os.homedir(), ".claude", "plugins"));
  } catch {
  }
  return [...new Set(roots)];
}
function archguardPluginCandidateRoots(pluginsRoot) {
  const out = [];
  const push = (p) => {
    if (typeof p === "string" && p.length > 0 && !out.includes(p) && fs2.existsSync(p)) out.push(p);
  };
  try {
    const rec = JSON.parse(fs2.readFileSync(path3.join(pluginsRoot, "installed_plugins.json"), "utf8"));
    const plugins = rec?.plugins;
    if (plugins && typeof plugins === "object" && !Array.isArray(plugins)) {
      for (const [key, entries] of Object.entries(plugins)) {
        if (!key.startsWith("archguard@")) continue;
        for (const e of Array.isArray(entries) ? entries : []) push(e?.installPath);
      }
    }
  } catch {
  }
  try {
    const cacheParent = path3.join(pluginsRoot, "cache");
    for (const marketplace of fs2.readdirSync(cacheParent)) {
      const pkgParent = path3.join(cacheParent, marketplace, "archguard");
      let versions = [];
      try {
        versions = fs2.readdirSync(pkgParent);
      } catch {
        continue;
      }
      for (const v of versions) push(path3.join(pkgParent, v));
    }
  } catch {
  }
  return out;
}
function resolveArchguardInPluginRoot(pluginRoot, searched) {
  const direct = path3.join(pluginRoot, "node_modules", ...ARCHGUARD_PKG_NAME.split("/"), ...ARCHGUARD_CLI_REL.split("/"));
  searched.push(direct);
  if (isFile(direct)) return direct;
  try {
    const req = nodeCreateRequire(path3.join(pluginRoot, "package.json"));
    const resolved = req.resolve(`${ARCHGUARD_PKG_NAME}/${ARCHGUARD_CLI_REL}`);
    searched.push(`createRequire(${pluginRoot}) \u2192 ${resolved}`);
    if (isFile(resolved)) return resolved;
  } catch (err) {
    searched.push(`createRequire(${pluginRoot}) \u2192 ${err?.message?.split("\n")[0] ?? "unresolvable"}`);
  }
  let cur = path3.resolve(pluginRoot);
  for (let i = 0; i < 8; i += 1) {
    const candidate = path3.join(cur, "npm-cache", "node_modules", ...ARCHGUARD_PKG_NAME.split("/"), ...ARCHGUARD_CLI_REL.split("/"));
    searched.push(candidate);
    if (isFile(candidate)) return candidate;
    const parent = path3.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return null;
}
function resolveArchguardCliWithSource() {
  const searched = [];
  const override = (process.env.ARCHGUARD_RUNNER_CLI ?? "").trim();
  if (override) {
    searched.push(`ARCHGUARD_RUNNER_CLI=${override}`);
    if (fs2.existsSync(override)) {
      return { cli: override, source: "env", viaNode: !isExecutableFile(override), searched };
    }
    return { cli: null, source: null, viaNode: false, searched };
  }
  searched.push("PATH (command -v archguard)");
  const r = spawnSync("sh", ["-c", "command -v archguard"], { encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) {
    const cli = r.stdout.trim();
    return { cli, source: "path", viaNode: !isExecutableFile(cli), searched };
  }
  for (const pluginsRoot of claudePluginRoots()) {
    const candidates = archguardPluginCandidateRoots(pluginsRoot);
    if (candidates.length === 0) searched.push(`${pluginsRoot} (no archguard plugin install recorded)`);
    for (const pluginRoot of candidates) {
      const found = resolveArchguardInPluginRoot(pluginRoot, searched);
      if (found) return { cli: found, source: "plugin", viaNode: !isExecutableFile(found), searched };
    }
  }
  return { cli: null, source: null, viaNode: false, searched };
}
function resolveArchguardCli() {
  return resolveArchguardCliWithSource().cli;
}
function readArchguardVersion(cli, viaNode = false) {
  const r = viaNode ? spawnSync(process.execPath, [cli, "--version"], { encoding: "utf8" }) : spawnSync(cli, ["--version"], { encoding: "utf8" });
  if (r.status !== 0) return null;
  const first = String(r.stdout ?? "").trim().split("\n")[0].trim();
  return first.length > 0 ? first : null;
}
function runAnalyze(cli, root, workDir, source, label, opts = {}) {
  const outputDir = path3.join(workDir, "output", opts.outputLabel ?? label);
  const argv = [
    "analyze",
    "--lang",
    "typescript",
    "--format",
    "json",
    ...opts.diagrams && opts.diagrams.length > 0 ? ["--diagrams", ...opts.diagrams] : [],
    ...opts.noCache ? ["--no-cache"] : [],
    "--work-dir",
    workDir,
    "--output-dir",
    outputDir,
    "-s",
    source
  ];
  const r = opts.viaNode ? spawnSync(process.execPath, [cli, ...argv], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) : spawnSync(cli, argv, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) {
    process.stderr.write(
      `archguard-runner: analyze failed for ${source} (exit ${r.status})
${(r.stderr || "").split("\n").slice(-5).join("\n")}
`
    );
  }
  return r.status ?? 1;
}
function gitTrackedFileCount(root, source) {
  const r = spawnSync("git", ["ls-files", "--", source], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) return null;
  return String(r.stdout ?? "").split("\n").filter((l) => l.trim().length > 0).length;
}
function gitTrackedFiles(root, source) {
  const r = spawnSync("git", ["ls-files", "-z", "--", source], { cwd: root, encoding: "utf8" });
  if (r.status !== 0) return null;
  return String(r.stdout ?? "").split("\0").filter((l) => l.length > 0);
}
var TS_SOURCE_FILE_RE = /\.(ts|tsx|mts|cts)$/;
var TS_TEST_FILE_RE = /\.(test|spec)\.[cm]?[tj]sx?$/;
function singleDirectoryBasis(root, source) {
  const all = gitTrackedFiles(root, source);
  if (all === null) {
    return { single: false, files: 0, dirs: [], reason: `git ls-files -- ${source} failed \u2014 the single-directory judgment is NOT evaluated` };
  }
  const srcDir = path3.posix.normalize(source.replace(/\/+$/, ""));
  const dirs = /* @__PURE__ */ new Set();
  let files = 0;
  for (const f of all) {
    if (!TS_SOURCE_FILE_RE.test(f) || TS_TEST_FILE_RE.test(f)) continue;
    if (/(^|\/)__tests__\//.test(f)) continue;
    files += 1;
    dirs.add(path3.posix.dirname(f));
  }
  if (files === 0) {
    return { single: false, files: 0, dirs: [], reason: `no tracked non-test TypeScript files under ${source}` };
  }
  const sorted = [...dirs].sort();
  return { single: sorted.length === 1 && sorted[0] === srcDir, files, dirs: sorted, reason: null };
}
function numeric(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function normalizeFsPath(p) {
  try {
    return fs2.realpathSync(p);
  } catch {
    return path3.resolve(p);
  }
}
function readQueryManifest(workDir) {
  const queryDir = path3.join(workDir, "query");
  const manifestFile = path3.join(queryDir, "manifest.json");
  let manifestRaw;
  try {
    manifestRaw = fs2.readFileSync(manifestFile, "utf8");
  } catch {
    return { ok: false, code: "unreadable", reason: `cannot read query manifest ${manifestFile}` };
  }
  try {
    return { ok: true, manifestFile, manifest: JSON.parse(manifestRaw) };
  } catch {
    return { ok: false, code: "malformed", reason: `query manifest ${manifestFile} is not valid JSON` };
  }
}
function readQueryScopeArch(workDir, key) {
  const archFile = path3.join(workDir, "query", key, "arch.json");
  let raw;
  try {
    raw = fs2.readFileSync(archFile, "utf8");
  } catch {
    return { ok: false, code: "unreadable", reason: `cannot read query scope artifact ${archFile}` };
  }
  try {
    return { ok: true, archFile, arch: JSON.parse(raw) };
  } catch {
    return { ok: false, code: "malformed", reason: `query scope artifact ${archFile} is not valid JSON` };
  }
}
function readDirectoryCycles(root, workDir, source) {
  const notEvaluated = (reason, artifactTimestamp2 = null) => ({
    directoryCyclesEvaluated: false,
    directoryCyclesReason: reason,
    directoryCycleCount: null,
    directoryCycles: null,
    directoryCyclesBasis: null,
    artifactTimestamp: artifactTimestamp2,
    readingFreshness: null,
    fileListReadAt: null
  });
  const manifestRead = readQueryManifest(workDir);
  if (!manifestRead.ok) {
    return notEvaluated(
      manifestRead.code === "unreadable" ? `${manifestRead.reason} \u2014 directory-level cycles are NOT evaluated (not "0 cycles")` : manifestRead.reason
    );
  }
  const { manifestFile, manifest } = manifestRead;
  const entries = Array.isArray(manifest?.scopes) ? manifest.scopes : [];
  if (entries.length === 0) {
    return notEvaluated(`query manifest ${manifestFile} lists no scopes`);
  }
  const wanted = normalizeFsPath(path3.resolve(root, source));
  const matches = entries.filter(
    (e) => Array.isArray(e?.sources) && e.sources.some((s) => typeof s === "string" && normalizeFsPath(s) === wanted)
  );
  if (matches.length === 0) {
    return notEvaluated(
      `query manifest ${manifestFile} has no scope covering ${source} \u2014 directory-level cycles are NOT evaluated`
    );
  }
  matches.sort((a, b) => String(b?.generatedAt ?? "").localeCompare(String(a?.generatedAt ?? "")));
  const entry = matches[0];
  if (typeof entry?.key !== "string" || entry.key.length === 0) {
    return notEvaluated(`query manifest ${manifestFile}: the matching scope has no key`);
  }
  const manifestTimestamp = typeof entry.generatedAt === "string" && entry.generatedAt !== "" ? entry.generatedAt : null;
  const archRead = readQueryScopeArch(workDir, entry.key);
  if (!archRead.ok) {
    return notEvaluated(
      archRead.code === "unreadable" ? `${archRead.reason} \u2014 directory-level cycles are NOT evaluated` : archRead.reason,
      manifestTimestamp
    );
  }
  const { arch } = archRead;
  const artifactTimestamp = typeof arch.timestamp === "string" && arch.timestamp !== "" ? arch.timestamp : manifestTimestamp;
  const moduleGraph = arch?.extensions?.tsAnalysis?.moduleGraph;
  if (moduleGraph == null || typeof moduleGraph !== "object") {
    const sd = singleDirectoryBasis(root, source);
    if (sd.single) {
      return {
        directoryCyclesEvaluated: true,
        directoryCyclesReason: null,
        directoryCycleCount: 0,
        directoryCycles: [],
        directoryCyclesBasis: "single-directory",
        artifactTimestamp,
        // The cycle conclusion comes from the file list just read — the artifact above is provenance
        // for "which analyze we looked at", NOT the evidence for `cycleCount: 0`.
        readingFreshness: "live-file-list",
        fileListReadAt: (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    const why = sd.reason ?? `${sd.files} tracked non-test TypeScript file(s) across ${sd.dirs.length} directories (${sd.dirs.slice(0, 4).join(", ")}${sd.dirs.length > 4 ? ", \u2026" : ""}) \u2014 NOT single-directory`;
    return notEvaluated(
      `moduleGraph not produced (package-level diagram not requested) \u2014 query scope ${entry.key} for ${source} has no extensions.tsAnalysis.moduleGraph (language: ${String(arch?.language ?? "unknown")}); ${why}; directory-level cycles are NOT evaluated (not "0 cycles")`,
      artifactTimestamp
    );
  }
  const rawCycles = moduleGraph.cycles;
  if (!Array.isArray(rawCycles)) {
    return notEvaluated(
      `query scope ${entry.key} for ${source}: moduleGraph.cycles is not an array \u2014 directory-level cycles are NOT evaluated`,
      artifactTimestamp
    );
  }
  const cycles = [];
  for (const c of rawCycles) {
    if (c == null || !Array.isArray(c.modules) || !c.modules.every((m) => typeof m === "string")) {
      return notEvaluated(
        `query scope ${entry.key} for ${source}: moduleGraph.cycles contains a malformed entry (modules must be string[])`,
        artifactTimestamp
      );
    }
    cycles.push({ size: c.modules.length, modules: [...c.modules] });
  }
  return {
    directoryCyclesEvaluated: true,
    directoryCyclesReason: null,
    directoryCycleCount: cycles.length,
    directoryCycles: cycles,
    directoryCyclesBasis: "module-graph",
    artifactTimestamp,
    // Read from the persisted artifact ⇒ its age is meaningful (it can fall behind the tree).
    readingFreshness: "artifact",
    fileListReadAt: null
  };
}
function readScopeSignal(root, workDir, label, source, analyzeRc) {
  const base = {
    scope: label,
    evaluated: false,
    reason: null,
    entitySccCount: null,
    entityCount: null,
    totalRelations: null,
    maxInDegree: null,
    maxOutDegree: null,
    sourceFiles: null,
    gitSourceFiles: null,
    directoryCyclesEvaluated: false,
    directoryCyclesReason: null,
    directoryCycleCount: null,
    directoryCycles: null,
    directoryCyclesBasis: null
  };
  const directory = analyzeRc === 0 ? readDirectoryCycles(root, workDir, source) : {
    directoryCyclesEvaluated: false,
    directoryCyclesReason: `analyze exited ${analyzeRc} \u2014 no product to read`,
    directoryCycleCount: null,
    directoryCycles: null,
    directoryCyclesBasis: null
  };
  const withDirectory = { ...base, ...directory };
  const unevaluated = (reason) => ({ ...withDirectory, reason });
  if (analyzeRc !== 0) return unevaluated(`analyze exited ${analyzeRc} \u2014 no product to read`);
  const file = path3.join(workDir, "output", label, path3.basename(source), "class", "all-classes.json");
  let raw;
  try {
    raw = fs2.readFileSync(file, "utf8");
  } catch {
    return unevaluated(`cannot read archguard output ${file} \u2014 did analyze actually run?`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return unevaluated(`archguard output ${file} is not valid JSON`);
  }
  const mv = data?.metricVector;
  if (mv == null || typeof mv !== "object") {
    return unevaluated(`archguard output ${file} has no metricVector`);
  }
  const entitySccCount = numeric(mv.sccCount);
  const entityCount = numeric(mv.totalEntities);
  const missingMetrics = [
    entitySccCount === null ? "sccCount" : null,
    entityCount === null ? "totalEntities" : null
  ].filter((k) => k !== null);
  if (missingMetrics.length > 0) {
    return unevaluated(`archguard output ${file}: metricVector lacks numeric ${missingMetrics.join(", ")}`);
  }
  if (!Array.isArray(data.sourceFiles)) {
    return unevaluated(`archguard output ${file}: artifact has no sourceFiles array \u2014 analysis coverage cannot be reconciled`);
  }
  const entries = data.sourceFiles.filter((e) => typeof e === "string");
  if (entries.length !== data.sourceFiles.length) {
    return unevaluated(`archguard output ${file}: sourceFiles contains non-string entries`);
  }
  const unique = /* @__PURE__ */ new Set();
  const duplicateSamples = [];
  for (const entry of entries) {
    let key;
    try {
      key = fs2.realpathSync(entry);
    } catch {
      key = path3.resolve(root, entry);
    }
    if (unique.has(key)) {
      if (duplicateSamples.length < 3) duplicateSamples.push(entry);
    } else {
      unique.add(key);
    }
  }
  const gitSourceFiles = gitTrackedFileCount(root, source);
  if (gitSourceFiles === null) {
    return unevaluated(`git ls-files -- ${source} failed \u2014 sourceFiles cannot be reconciled (not evaluated, not "clean")`);
  }
  if (gitSourceFiles > 0 && entityCount === 0) {
    return unevaluated(
      `${source}: ${gitSourceFiles} git-tracked file(s) but analyze produced 0 entities \u2014 analysis did not cover its input`
    );
  }
  const notes = [];
  const duplicateCount = entries.length - unique.size;
  if (duplicateCount > 0) {
    notes.push(
      `${duplicateCount} duplicate sourceFiles entr${duplicateCount === 1 ? "y" : "ies"} (same realpath resolved twice \u2014 symlink double-resolution?): ${duplicateSamples.join(", ")}`
    );
  }
  if (unique.size !== gitSourceFiles) {
    notes.push(
      `sourceFiles=${unique.size} vs git ls-files ${source}=${gitSourceFiles} (diff ${unique.size - gitSourceFiles})`
    );
  }
  return {
    ...withDirectory,
    evaluated: true,
    reason: notes.length > 0 ? `reconciliation: ${notes.join("; ")}` : null,
    entitySccCount,
    entityCount,
    totalRelations: numeric(mv.totalRelations),
    maxInDegree: numeric(mv.maxInDegree),
    maxOutDegree: numeric(mv.maxOutDegree),
    sourceFiles: unique.size,
    gitSourceFiles
  };
}
function currentCommitSha(root) {
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}
function appendHistory(workDir, record) {
  const file = path3.join(workDir, "metrics-history.jsonl");
  try {
    fs2.mkdirSync(path3.dirname(file), { recursive: true });
    fs2.appendFileSync(file, JSON.stringify(record) + "\n");
  } catch (e) {
    fail(`cannot append to ${file}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
function fmt(v) {
  return v === null ? "null" : String(v);
}
function main() {
  const args = process.argv.slice(2);
  let root = "";
  let workDirArg = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--root") {
      root = args[i + 1] ?? "";
      i++;
    } else if (args[i] === "--work-dir") {
      workDirArg = args[i + 1] ?? "";
      i++;
    } else if (args[i] === "--help" || args[i] === "-h") {
      process.stdout.write(USAGE_TEXT);
      process.exit(0);
    } else {
      usage(`unknown argument: ${args[i]}`);
    }
  }
  if (!root) usage("--root is required");
  root = path3.resolve(root);
  const workDir = workDirArg ? path3.resolve(workDirArg) : path3.join(root, ".archguard");
  if (!fs2.existsSync(path3.join(root, ".quay", "config.yml")) && !fs2.existsSync(path3.join(root, ".git"))) {
    usage(`--root ${root} is not a repo worktree`);
  }
  const resolution = resolveArchguardCliWithSource();
  const cli = resolution.cli;
  if (!cli) {
    const reason = `archguard CLI not found \u2014 probed: ${resolution.searched.join(" ; ")} \u2014 the meter must be runnable`;
    appendHistory(workDir, {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      tool: "archguard-runner",
      commitSha: currentCommitSha(root),
      archguardVersion: null,
      evaluated: false,
      reason,
      entitySccCount: null,
      entitySccEvaluated: false,
      entitySccReason: reason,
      directoryCycleCount: null,
      directoryCyclesEvaluated: false,
      directoryCyclesReason: reason,
      sourceFiles: null,
      entityCount: null,
      verdict: "fail",
      ...CROSS_SCOPE_NOT_EVALUATED,
      scopes: []
    });
    fail(`${reason} (fail-closed)`);
  }
  const archguardVersion = readArchguardVersion(cli, resolution.viaNode);
  const versionReason = archguardVersion === null ? "archguard --version produced no readable version \u2014 record is not version-anchored" : null;
  const scopes = SCOPES.map(({ source, label }) => {
    process.stdout.write(`archguard-runner: analyzing ${label} (${source})
`);
    const rc = runAnalyze(cli, root, workDir, source, label, { viaNode: resolution.viaNode });
    return readScopeSignal(root, workDir, label, source, rc);
  });
  const entityUnevaluated = scopes.filter((s) => !s.evaluated);
  const directoryUnevaluated = scopes.filter((s) => !s.directoryCyclesEvaluated);
  const entityViolated = scopes.filter((s) => s.evaluated && s.entitySccCount !== 0);
  const directoryViolated = scopes.filter(
    (s) => s.directoryCyclesEvaluated && (s.directoryCycleCount ?? 0) > 0
  );
  const entityEvaluated = versionReason === null && entityUnevaluated.length === 0;
  const directoryEvaluated = versionReason === null && directoryUnevaluated.length === 0;
  const evaluated = entityEvaluated && directoryEvaluated;
  const violated = entityViolated.length > 0 || directoryViolated.length > 0;
  const verdict = evaluated && !violated ? "pass" : "fail";
  const reasons = [];
  if (versionReason) reasons.push(versionReason);
  for (const s of scopes) {
    if (s.reason) reasons.push(`${s.scope}: ${s.reason}`);
  }
  const entityReasons = [
    ...versionReason ? [versionReason] : [],
    ...entityUnevaluated.map((s) => `${s.scope}: ${s.reason ?? "not evaluated"}`)
  ];
  const directoryReasons = [
    ...versionReason ? [versionReason] : [],
    ...directoryUnevaluated.map((s) => `${s.scope}: ${s.directoryCyclesReason ?? "not evaluated"}`)
  ];
  const complete = entityUnevaluated.length === 0;
  const directoryComplete = directoryUnevaluated.length === 0;
  const record = {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    tool: "archguard-runner",
    commitSha: currentCommitSha(root),
    archguardVersion,
    evaluated,
    reason: reasons.length > 0 ? reasons.join("; ") : null,
    entitySccCount: complete ? scopes.reduce((n, s) => n + (s.entitySccCount ?? 0), 0) : null,
    entitySccEvaluated: entityEvaluated,
    entitySccReason: entityReasons.length > 0 ? entityReasons.join("; ") : null,
    directoryCycleCount: directoryComplete ? scopes.reduce((n, s) => n + (s.directoryCycleCount ?? 0), 0) : null,
    directoryCyclesEvaluated: directoryEvaluated,
    directoryCyclesReason: directoryReasons.length > 0 ? directoryReasons.join("; ") : null,
    sourceFiles: complete ? scopes.reduce((n, s) => n + (s.sourceFiles ?? 0), 0) : null,
    entityCount: complete ? scopes.reduce((n, s) => n + (s.entityCount ?? 0), 0) : null,
    verdict,
    ...CROSS_SCOPE_NOT_EVALUATED,
    scopes
  };
  appendHistory(workDir, record);
  for (const s of scopes) {
    process.stdout.write(
      `archguard-runner: ${s.scope} \u2014 evaluated=${s.evaluated} entitySccCount=${fmt(s.entitySccCount)} directoryCycleCount=${fmt(s.directoryCycleCount)} directoryCyclesEvaluated=${s.directoryCyclesEvaluated} entities=${fmt(s.entityCount)} relations=${fmt(s.totalRelations)} sourceFiles=${fmt(s.sourceFiles)} gitSourceFiles=${fmt(s.gitSourceFiles)} maxInDegree=${fmt(s.maxInDegree)} maxOutDegree=${fmt(s.maxOutDegree)}${s.reason ? ` reason=${s.reason}` : ""}${s.directoryCyclesReason ? ` directoryReason=${s.directoryCyclesReason}` : ""}
`
    );
  }
  if (!evaluated) {
    const detail = [
      entityEvaluated ? null : `entity: ${entityReasons.join("; ")}`,
      directoryEvaluated ? null : `directory: ${directoryReasons.join("; ")}`
    ].filter((v) => v !== null).join(" | ");
    fail(`NOT EVALUATED \u2014 at least one scope could not be read; refusing to report "0 cycles" (\u786C\u89C4\u5219 3b): ${detail}`);
  }
  if (entityViolated.length > 0) {
    fail(
      `structural violation: entity-level dependency cycles detected in ${entityViolated.map((s) => s.scope).join(", ")} \u2014 entitySccCount must be 0`
    );
  }
  if (directoryViolated.length > 0) {
    const detail = directoryViolated.map((s) => `${s.scope}: ${(s.directoryCycles ?? []).map((c) => JSON.stringify(c.modules)).join(" ")}`).join("; ");
    fail(
      `structural violation: directory-level dependency cycles detected \u2014 ${detail} \u2014 directoryCycleCount must be 0`
    );
  }
  process.stdout.write("archguard-runner: PASS \u2014 no dependency cycles in any scope\n");
}
if (isDirectEntry(import.meta, process.argv[1], "archguard-runner")) main();

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/design-evolution-readings.ts
var import_yaml = __toESM(require_dist());
import fs4 from "node:fs";
import path5 from "node:path";
import { execFileSync as execFileSync3 } from "node:child_process";

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/phase-declare.ts
import fs3 from "node:fs";
import path4 from "node:path";
import { execFileSync as execFileSync2 } from "node:child_process";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var STATE_FILE_REL = ".quay/two-phase-state.json";
var PHASES = ["expansion", "convergence"];
var MIN_REASON_CHARS = 8;
var DEFAULT_WINDOW = 50;
var EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
var FLAG_THRESHOLD = 3;
var MIN_DOC_LINES = 20;
var DOC_RE = /\.(md|txt)$/i;
function parseNumstat(text) {
  const rows = [];
  for (const line of String(text).split("\n")) {
    if (!line.trim()) continue;
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/);
    if (!m) continue;
    const [, addedRaw, deletedRaw, p] = m;
    rows.push({
      added: addedRaw === "-" ? 0 : parseInt(addedRaw, 10),
      deleted: deletedRaw === "-" ? 0 : parseInt(deletedRaw, 10),
      path: p
    });
  }
  return rows;
}
function classify(filePath) {
  return DOC_RE.test(filePath) ? "doc" : "code";
}
function computeRatio(rows, opts = {}) {
  const flagThreshold = opts.flagThreshold ?? FLAG_THRESHOLD;
  const minDocLines = opts.minDocLines ?? MIN_DOC_LINES;
  let docLines = 0;
  let codeLines = 0;
  for (const r of rows) {
    const total = r.added + r.deleted;
    if (classify(r.path) === "doc") docLines += total;
    else codeLines += total;
  }
  if (docLines === 0 && codeLines === 0) {
    return { docLines, codeLines, ratio: null, verdict: "N/A", flagged: false };
  }
  const ratio = codeLines === 0 ? Infinity : docLines / codeLines;
  const flagged = docLines > minDocLines && ratio > flagThreshold;
  return { docLines, codeLines, ratio, verdict: flagged ? "FLAGGED (prose-heavy)" : "PASS", flagged };
}
function git(args, root) {
  return execFileSync2("git", args, { cwd: root, encoding: "utf8" });
}
function takeLdReading(root, window = DEFAULT_WINDOW) {
  const head = git(["rev-parse", "HEAD"], root).trim();
  const commitCount = parseInt(git(["rev-list", "--count", "HEAD"], root).trim(), 10);
  const base = commitCount > window ? `HEAD~${window}` : EMPTY_TREE;
  const range = `${base}..HEAD`;
  const rows = parseNumstat(git(["diff", "--numstat", range], root));
  const r = computeRatio(rows);
  return {
    rule: "L_D code:doc line-delta ratio (archived git-lens-l-d-code-doc-ratio rule: doc=/.(md|txt)$/i, ratio=docLines/codeLines, flagged = ratio > 3.0 AND docLines > 20)",
    range,
    head,
    commitCount,
    docLines: r.docLines,
    codeLines: r.codeLines,
    // JSON has no Infinity literal; a code-less range records null + the verdict says why.
    ratio: r.ratio === Infinity ? null : r.ratio,
    verdict: r.ratio === Infinity ? "FLAGGED (prose-heavy: codeLines=0)" : r.verdict,
    flagged: r.flagged || r.ratio === Infinity
  };
}
function carrierPath(root) {
  return path4.join(root, STATE_FILE_REL);
}
function readCarrier(root) {
  const p = carrierPath(root);
  if (!fs3.existsSync(p)) return { exists: false, history: [] };
  const raw = fs3.readFileSync(p, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`${STATE_FILE_REL} exists but is not valid JSON (${e.message}) \u2014 refusing to overwrite; fix or remove it first`);
  }
  const history = parsed.history;
  if (!Array.isArray(history)) {
    throw new Error(`${STATE_FILE_REL} has no \`history\` array \u2014 refusing to overwrite an unrecognized shape`);
  }
  return { exists: true, history };
}
function buildState(prev, d) {
  const history = [...prev, d];
  return { phase: d.phase, declaredAt: d.declaredAt, reason: d.reason, reading: d.reading, history };
}
var GOAL_ID_RE = /^(GOAL-\d+)/;
var DAY_MS = 864e5;
function stalenessNotEvaluated(reason) {
  return {
    evaluated: false,
    reason,
    phase: null,
    declaredAt: null,
    declarations: null,
    commitsSince: null,
    newGoalsSince: null,
    daysSince: null
  };
}
function readPhaseStaleness(root, opts = {}) {
  const repo = path4.resolve(root);
  const p = carrierPath(repo);
  let raw;
  try {
    raw = fs3.readFileSync(p, "utf8");
  } catch (e) {
    const code = e.code;
    return code === "ENOENT" ? stalenessNotEvaluated(
      `carrier-missing: ${STATE_FILE_REL} does not exist under ${repo} \u2014 there is no declaration to measure the distance from`
    ) : stalenessNotEvaluated(`carrier-unreadable: ${STATE_FILE_REL} could not be read (${e.message})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return stalenessNotEvaluated(
      `carrier-unparseable: ${STATE_FILE_REL} is not valid JSON (${e.message}) \u2014 the declaration exists but could not be read`
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return stalenessNotEvaluated(`carrier-shape-unrecognized: ${STATE_FILE_REL} is not a JSON object`);
  }
  const state = parsed;
  if (typeof state.phase !== "string" || !PHASES.includes(state.phase)) {
    return stalenessNotEvaluated(
      `carrier-shape-unrecognized: ${STATE_FILE_REL} has no legal phase value (${JSON.stringify(state.phase ?? null)})`
    );
  }
  if (typeof state.declaredAt !== "string" || !Number.isFinite(Date.parse(state.declaredAt))) {
    return stalenessNotEvaluated(
      `carrier-shape-unrecognized: ${STATE_FILE_REL} has no parseable declaredAt (${JSON.stringify(state.declaredAt ?? null)})`
    );
  }
  if (!Array.isArray(state.history)) {
    return stalenessNotEvaluated(`carrier-shape-unrecognized: ${STATE_FILE_REL} has no history array`);
  }
  const declaredAt = state.declaredAt;
  let commitsSince;
  try {
    const out = git(["rev-list", "--count", `--since=${declaredAt}`, "HEAD"], repo).trim();
    const n = Number(out);
    if (!Number.isInteger(n) || n < 0) throw new Error(`unexpected output ${JSON.stringify(out)}`);
    commitsSince = n;
  } catch (e) {
    return stalenessNotEvaluated(
      `git-unavailable: git rev-list --count --since=${declaredAt} HEAD failed in ${repo} (${e.message})`
    );
  }
  let newGoalsSince;
  try {
    const out = git(["log", `--since=${declaredAt}`, "--diff-filter=A", "--name-only", "--format=", "--", "goals/"], repo);
    const ids = /* @__PURE__ */ new Set();
    for (const line of out.split("\n")) {
      const rel = line.trim();
      if (!rel) continue;
      const m = path4.posix.basename(rel).match(GOAL_ID_RE);
      if (m) ids.add(m[1]);
    }
    newGoalsSince = [...ids].sort();
  } catch (e) {
    return stalenessNotEvaluated(
      `git-unavailable: git log --diff-filter=A --name-only -- goals/ failed in ${repo} (${e.message})`
    );
  }
  const nowMs = (opts.now ?? /* @__PURE__ */ new Date()).getTime();
  const daysSince = Number.isFinite(nowMs) ? Math.round((nowMs - Date.parse(declaredAt)) / DAY_MS * 100) / 100 : null;
  return {
    evaluated: true,
    reason: null,
    phase: state.phase,
    declaredAt,
    declarations: state.history.length,
    commitsSince,
    newGoalsSince,
    daysSince
  };
}
function takeLdFileReading(numstatFile) {
  const text = fs3.readFileSync(numstatFile, "utf8");
  const r = computeRatio(parseNumstat(text));
  return {
    rule: "L_D code:doc line-delta ratio (archived git-lens-l-d-code-doc-ratio rule: doc=/.(md|txt)$/i, ratio=docLines/codeLines, flagged = ratio > 3.0 AND docLines > 20)",
    numstatFile,
    docLines: r.docLines,
    codeLines: r.codeLines,
    ratio: r.ratio === Infinity ? null : r.ratio,
    verdict: r.ratio === Infinity ? "FLAGGED (prose-heavy: codeLines=0)" : r.verdict,
    flagged: r.flagged || r.ratio === Infinity
  };
}
function parseArgs2(argv) {
  const parsed = parseArgs(["node", "phase-declare", ...argv], {
    minArgs: 0,
    usage: '--to <expansion|convergence> --reason "<one sentence>" [--root <repo>] [--window <n>] [--json]\n       --staleness [--root <repo>] [--json]\n       --ld-reading --numstat-file <f> [--json]',
    help: "return",
    errors: "return",
    unknown: "reject",
    flags: {
      to: { type: "string" },
      reason: { type: "string" },
      root: { type: "string" },
      window: { type: "string" },
      staleness: { type: "boolean" },
      "ld-reading": { type: "boolean" },
      "numstat-file": { type: "string" },
      json: { type: "boolean" }
    }
  });
  const str = (v) => typeof v === "string" ? v : void 0;
  const out = {
    to: str(parsed.flags.to),
    reason: str(parsed.flags.reason),
    root: str(parsed.flags.root),
    staleness: parsed.flags.staleness === true,
    ldReading: parsed.flags["ld-reading"] === true,
    json: parsed.flags.json === true
  };
  const numstatFile = str(parsed.flags["numstat-file"]);
  if (numstatFile !== void 0 && numstatFile !== "") out.numstatFile = numstatFile;
  if (parsed.help) return { ...out, error: "help" };
  if (parsed.error) return { ...out, error: parsed.error };
  if (parsed.args.length > 0) return { ...out, error: `unknown argument: ${parsed.args[0]}` };
  if (parsed.flags.window !== void 0) {
    const raw = parsed.flags.window;
    const v = raw === "" ? void 0 : String(raw);
    const n = Number(v);
    if (!Number.isInteger(n) || n <= 0) return { ...out, error: `--window expects a positive integer, got ${JSON.stringify(v)}` };
    out.window = n;
  }
  return out;
}
var USAGE = `phase-declare.ts \u2014 declare the ADR-008 two-phase breathing state (record only, no auto switch).

Usage:
  node --experimental-strip-types plugin/scripts/phase-declare.ts \\
       --to <expansion|convergence> --reason "<one sentence>" [--root <repo>] [--window <n>] [--json]
  node --experimental-strip-types plugin/scripts/phase-declare.ts \\
       --staleness [--root <repo>] [--json]      (READ-ONLY: no file is written)
  node --experimental-strip-types plugin/scripts/phase-declare.ts \\
       --ld-reading --numstat-file <f> [--json] (READ-ONLY: the L_D reading over a numstat file)

Exit: 0 written | 1 refused (no/thin --reason, or unreadable carrier) | 2 usage | 3 no reading
      (with --staleness / --ld-reading: 0 = read and evaluated (--ld-reading: NOT flagged),
       1 = --ld-reading: FLAGGED, 3 = NOT-EVALUATED \u2014 a distinct value, see its reason)`;
function main2() {
  const opts = parseArgs2(process.argv.slice(2));
  if (opts.error === "help") {
    console.log(USAGE);
    process.exit(0);
  }
  if (opts.error) {
    console.error(`phase-declare: ${opts.error}

${USAGE}`);
    process.exit(2);
  }
  const repoRoot2 = opts.root ? path4.resolve(opts.root) : path4.resolve(path4.dirname(fileURLToPath2(import.meta.url)), "..", "..");
  if (opts.ldReading) {
    if (opts.to !== void 0 || opts.reason !== void 0 || opts.staleness) {
      console.error(`phase-declare: --ld-reading is a read-only reading and cannot be combined with --to/--reason/--staleness

${USAGE}`);
      process.exit(2);
    }
    if (!opts.numstatFile) {
      console.error(`phase-declare: --ld-reading requires --numstat-file <f>

${USAGE}`);
      process.exit(2);
    }
    let ld;
    try {
      ld = takeLdFileReading(opts.numstatFile);
    } catch (e) {
      console.error(`phase-declare: NO-READING \u2014 cannot read --numstat-file ${opts.numstatFile}: ${e.message}`);
      process.exit(3);
    }
    if (opts.json) {
      console.log(JSON.stringify(ld, null, 2));
    } else {
      console.log(
        `phase-declare: L_D docLines=${ld.docLines} codeLines=${ld.codeLines} ratio=${ld.ratio === null ? "n/a" : ld.ratio.toFixed(3)} verdict=${ld.verdict} (${ld.numstatFile})`
      );
    }
    process.exitCode = ld.flagged ? 1 : 0;
    return;
  }
  if (opts.numstatFile !== void 0) {
    console.error(`phase-declare: --numstat-file is only meaningful with --ld-reading

${USAGE}`);
    process.exit(2);
  }
  if (opts.staleness) {
    if (opts.to !== void 0 || opts.reason !== void 0) {
      console.error(`phase-declare: --staleness is a read-only reading and cannot be combined with --to/--reason

${USAGE}`);
      process.exit(2);
    }
    const staleness = readPhaseStaleness(repoRoot2);
    if (opts.json) {
      console.log(JSON.stringify(staleness, null, 2));
    } else if (!staleness.evaluated) {
      console.log(`phase-declare: NOT-EVALUATED \u2014 ${staleness.reason}`);
    } else {
      console.log(
        `phase-declare: phase=${staleness.phase} declaredAt=${staleness.declaredAt} (${staleness.daysSince} days ago, ${staleness.declarations} declaration(s) recorded)`
      );
      console.log(
        `  since then: commits=${staleness.commitsSince} newGoals=${staleness.newGoalsSince?.length ?? 0}` + (staleness.newGoalsSince && staleness.newGoalsSince.length > 0 ? ` [${staleness.newGoalsSince.join(", ")}]` : "")
      );
    }
    process.exit(staleness.evaluated ? 0 : 3);
  }
  if (!opts.to || !PHASES.includes(opts.to)) {
    console.error(`phase-declare: --to must be one of ${PHASES.join("|")} (got ${JSON.stringify(opts.to ?? null)})

${USAGE}`);
    process.exit(2);
  }
  const reason = (opts.reason ?? "").trim();
  const reasonChars = reason.replace(/\s+/g, "").length;
  if (reasonChars < MIN_REASON_CHARS) {
    console.error(
      `phase-declare: REFUSED \u2014 --reason is missing or below ${MIN_REASON_CHARS} non-whitespace chars (got ${reasonChars}). A phase switch without a recorded trigger is not auditable; nothing was written.`
    );
    process.exit(1);
  }
  const root = repoRoot2;
  let prev;
  try {
    prev = readCarrier(root).history;
  } catch (e) {
    console.error(`phase-declare: REFUSED \u2014 ${e.message}`);
    process.exit(1);
  }
  let reading;
  try {
    reading = takeLdReading(root, opts.window ?? DEFAULT_WINDOW);
  } catch (e) {
    console.error(`phase-declare: NO-READING \u2014 git could not produce the L_D snapshot: ${e.message}`);
    process.exit(3);
  }
  const declaration = {
    phase: opts.to,
    declaredAt: (/* @__PURE__ */ new Date()).toISOString(),
    reason,
    reading
  };
  const state = buildState(prev, declaration);
  const p = carrierPath(root);
  fs3.mkdirSync(path4.dirname(p), { recursive: true });
  fs3.writeFileSync(p, JSON.stringify(state, null, 2) + "\n", "utf8");
  if (opts.json) {
    console.log(JSON.stringify(declaration, null, 2));
  } else {
    console.log(`phase-declare: phase=${declaration.phase} at ${declaration.declaredAt}`);
    console.log(`  reason : ${declaration.reason}`);
    console.log(
      `  L_D    : docLines=${reading.docLines} codeLines=${reading.codeLines} ratio=${reading.ratio === null ? "n/a" : reading.ratio.toFixed(3)} verdict=${reading.verdict} (${reading.range})`
    );
    console.log(`  carrier: ${path4.relative(root, p)} (${state.history.length} declaration(s) recorded)`);
  }
  process.exit(0);
}
if (isDirectEntry(import.meta, void 0, "phase-declare")) {
  main2();
}

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/design-evolution-readings.ts
var DESIGN_EVOLUTION_HISTORY_REL = path5.posix.join(".quay", "design-evolution-history.jsonl");
var DESIGN_EVOLUTION_ROUTINE_NAME = "design-evolution-readings";
var DESIGN_EVOLUTION_INTERVAL_MIN_DEFAULT = 360;
var DESIGN_EVOLUTION_MIN_INTERVAL_MINUTES = 60;
var CONTENTION_TOKENS = Object.freeze([
  "contention",
  "avoid",
  "\u907F\u5F00",
  "\u4E89\u7528",
  "\u540C\u6837\u89E6\u53CA",
  "\u5148\u4E8E",
  "\u4E32\u884C",
  "\u90FD touch"
]);
var CONTENTION_SAMPLE_LIMIT = 3;
var CONTENTION_TOP_N_DEFAULT = 10;
var OUTCOME_CARRIER_REL = path5.posix.join(".quay", "worker-outcome.jsonl");
function gitRead(root, args) {
  try {
    const stdout = execFileSync3("git", ["-C", root, ...args], {
      encoding: "utf8",
      timeout: 3e4,
      maxBuffer: 256 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { ok: true, stdout, error: null };
  } catch (e) {
    const err = e;
    const stderr = typeof err.stderr === "string" ? err.stderr.trim() : "";
    const short = stderr !== "" ? stderr : typeof err.status === "number" ? `git ${args[0]} exited ${err.status}` : err.message || String(e);
    return { ok: false, stdout: "", error: short };
  }
}
function resolveCommit(root, rev) {
  const r = gitRead(root, ["rev-parse", "--verify", "--quiet", `${rev}^{commit}`]);
  if (!r.ok || r.stdout.trim() === "") {
    return { sha: null, error: r.error ?? `'${rev}' does not resolve to a commit` };
  }
  return { sha: r.stdout.trim(), error: null };
}
function globToRegExp(glob) {
  let out = "^";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
    } else if (ch === "?") {
      out += "[^/]";
    } else if ("\\^$+.|()[]{}".includes(ch)) {
      out += `\\${ch}`;
    } else {
      out += ch;
    }
  }
  return new RegExp(out + "$");
}
function listTrackedPaths(root, rev) {
  const r = gitRead(root, ["ls-tree", "-r", "--name-only", "-z", rev]);
  if (!r.ok) return null;
  return r.stdout.split("\0").filter((p) => p !== "");
}
function stripWorktreePrefix(p) {
  const m = /(?:^|\/)quay-worktrees\/[^/]+\/(.+)$/.exec(p);
  return m === null ? null : m[1];
}
function rootSpellings(root) {
  const abs = path5.resolve(root);
  const out = /* @__PURE__ */ new Set();
  const push = (p) => {
    const stripped = p.replace(/\/+$/, "").replace(/^\/+/, "");
    if (stripped !== "") out.add(stripped);
  };
  push(abs);
  try {
    push(fs4.realpathSync(abs));
  } catch {
  }
  return [...out];
}
function createPathIdentityResolver(root, opts = {}) {
  const roots = rootSpellings(root);
  const index = opts.repoPaths !== void 0 ? opts.repoPaths : listTrackedPaths(root, "HEAD");
  const byBasename = /* @__PURE__ */ new Map();
  const tracked = index === null ? null : new Set(index);
  if (index !== null) {
    for (const p of index) {
      const b = path5.posix.basename(p);
      const arr = byBasename.get(b);
      if (arr === void 0) byBasename.set(b, [p]);
      else arr.push(p);
    }
  }
  const resolve = (rawInput) => {
    const raw = rawInput.trim();
    if (raw === "") return { rel: null, reason: "empty-path-token" };
    const p = raw.replace(/^(\.\/)+/, "");
    const wt = stripWorktreePrefix(p);
    if (wt !== null) {
      const rel = wt.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
      return rel === "" ? { rel: null, reason: `empty-after-worktree-prefix: ${raw}` } : { rel, reason: null };
    }
    if (p.startsWith("/")) {
      const stripped = p.replace(/^\/+/, "").replace(/\/{2,}/g, "/");
      for (const rootRel of roots) {
        if (stripped === rootRel) return { rel: null, reason: `points-at-repo-root: ${raw}` };
        if (stripped.startsWith(rootRel + "/")) return { rel: stripped.slice(rootRel.length + 1), reason: null };
      }
      if (tracked !== null) {
        const segs = stripped.split("/");
        for (let i = 0; i < segs.length; i++) {
          const candidate = segs.slice(i).join("/");
          if (tracked.has(candidate)) return { rel: candidate, reason: null };
        }
      }
      return { rel: null, reason: `absolute-path-outside-repo: ${raw}` };
    }
    if (!p.includes("/")) {
      if (index === null) return { rel: p, reason: null };
      const matches = byBasename.get(p) ?? [];
      if (matches.length === 1) return { rel: matches[0], reason: null };
      if (matches.length === 0) return { rel: p, reason: null };
      const named = matches.slice(0, 3).join(", ") + (matches.length > 3 ? ", \u2026" : "");
      return { rel: null, reason: `ambiguous-bare-name: ${raw} matches ${matches.length} repo paths (${named})` };
    }
    return { rel: p.replace(/\/{2,}/g, "/").replace(/\/+$/, ""), reason: null };
  };
  return { resolve, indexSize: index === null ? null : index.length };
}
function lineCountAt(root, rev, relPath, presentPaths) {
  if (presentPaths !== null && !presentPaths.has(relPath)) return { lines: null, error: null };
  const r = gitRead(root, ["show", `${rev}:${relPath}`]);
  if (!r.ok) return { lines: null, error: r.error ?? "git show failed" };
  return { lines: (r.stdout.match(/\n/g) ?? []).length, error: null };
}
var pct = (share) => Math.round(share * 100 * 100) / 100;
function measureSubsystem(root, spec, opts = {}) {
  const headRef = opts.head ?? spec.head ?? "HEAD";
  const base = {
    name: spec.name,
    evaluated: false,
    reason: null,
    baseline: spec.baseline,
    head: headRef,
    baselineSha: null,
    headSha: null,
    central: spec.central,
    modules: spec.modules,
    centralDelta: null,
    nonCentralDelta: null,
    denominator: null,
    share: null,
    shareBasis: null,
    shareReason: null,
    additionsNumerator: null,
    additionsDenominator: null,
    additionsShare: null,
    additionsSharePercent: null,
    additionsReason: null,
    sharePercent: null,
    sharePercentRounded: null,
    centralFiles: [],
    moduleFileCount: null,
    newModuleFiles: null,
    maxCentralChangeCommit: null,
    oppositeSignCommits: null
  };
  const unevaluated = (reason, extra = {}) => ({
    ...base,
    shareReason: `not-taken: ${reason}`,
    additionsReason: `not-taken: ${reason}`,
    ...extra,
    evaluated: false,
    reason
  });
  const head = resolveCommit(root, headRef);
  const baseline = resolveCommit(root, spec.baseline);
  const shas = { baselineSha: baseline.sha, headSha: head.sha };
  if (baseline.sha === null) return unevaluated(`baseline-unresolvable: ${spec.baseline} \u2014 ${baseline.error ?? "does not resolve"}`, shas);
  if (head.sha === null) return unevaluated(`head-unresolvable: ${headRef} \u2014 ${head.error ?? "does not resolve"}`, shas);
  const baselinePaths = listTrackedPaths(root, baseline.sha);
  if (baselinePaths === null) return unevaluated(`baseline-tree-unreadable: git ls-tree failed at ${baseline.sha}`, shas);
  const headPaths = listTrackedPaths(root, head.sha);
  if (headPaths === null) return unevaluated(`head-tree-unreadable: git ls-tree failed at ${head.sha}`, shas);
  const baseSet = new Set(baselinePaths);
  const headSet = new Set(headPaths);
  const moduleRes = spec.modules.map(globToRegExp);
  const matchesModules = (p) => moduleRes.some((re) => re.test(p));
  const moduleFiles = [.../* @__PURE__ */ new Set([...baselinePaths, ...headPaths])].filter(matchesModules).sort();
  const newModuleFiles = moduleFiles.filter((p) => !baseSet.has(p) && headSet.has(p));
  const centralPaths = /* @__PURE__ */ new Set();
  const centralFiles = [];
  let centralDelta = 0;
  for (const c of spec.central) {
    centralPaths.add(c.atBaseline);
    centralPaths.add(c.atHead);
    const atBase = lineCountAt(root, baseline.sha, c.atBaseline, baseSet);
    if (atBase.lines === null) {
      return unevaluated(
        atBase.error !== null ? `central-unreadable-at-baseline: ${c.atBaseline} \u2014 ${atBase.error}` : `central-absent-at-baseline: ${c.atBaseline} (declared central path does not exist at ${spec.baseline})`,
        { ...shas, moduleFileCount: moduleFiles.length, newModuleFiles }
      );
    }
    const atHead = lineCountAt(root, head.sha, c.atHead, headSet);
    if (atHead.lines === null) {
      return unevaluated(
        atHead.error !== null ? `central-unreadable-at-head: ${c.atHead} \u2014 ${atHead.error}` : `central-absent-at-head: ${c.atHead} (declared central path does not exist at ${headRef})`,
        { ...shas, moduleFileCount: moduleFiles.length, newModuleFiles }
      );
    }
    const delta = atHead.lines - atBase.lines;
    centralDelta += delta;
    centralFiles.push({ atBaseline: c.atBaseline, atHead: c.atHead, baselineLines: atBase.lines, headLines: atHead.lines, delta });
  }
  let nonCentralDelta = 0;
  for (const p of moduleFiles) {
    if (centralPaths.has(p)) continue;
    const b = lineCountAt(root, baseline.sha, p, baseSet);
    if (b.error !== null) return unevaluated(`module-unreadable-at-baseline: ${p} \u2014 ${b.error}`, { ...shas, moduleFileCount: moduleFiles.length, newModuleFiles });
    const h = lineCountAt(root, head.sha, p, headSet);
    if (h.error !== null) return unevaluated(`module-unreadable-at-head: ${p} \u2014 ${h.error}`, { ...shas, moduleFileCount: moduleFiles.length, newModuleFiles });
    nonCentralDelta += (h.lines ?? 0) - (b.lines ?? 0);
  }
  const commitStats = readCommitStats(
    root,
    baseline.sha,
    head.sha,
    centralPaths,
    matchesModules,
    [.../* @__PURE__ */ new Set([...centralPaths, ...spec.modules])]
  );
  const maxCentralChangeCommit = pickLargestCentralChange(commitStats);
  const opposite = pickOppositeSignCommits(commitStats);
  const denominator = centralDelta + nonCentralDelta;
  const netReason = denominator <= 0 ? `non-positive-denominator: central\u0394=${centralDelta} nonCentral\u0394=${nonCentralDelta} (sum ${denominator}) \u2014 a share of a non-growing subsystem is not a reading` : null;
  const share = netReason === null ? centralDelta / denominator : null;
  const add = readWindowAdditions(root, baseline.sha, head.sha, centralPaths, matchesModules, [
    .../* @__PURE__ */ new Set([...centralPaths, ...spec.modules])
  ]);
  const additionsNumerator = add.ok ? add.central : null;
  const additionsDenominator = add.ok ? add.central + add.nonCentral : null;
  const additionsReason = !add.ok ? `additions-unreadable: ${add.error}` : additionsDenominator === 0 ? "additions-no-new-lines: the window added no line to the central files or to the modules (a share of zero additions is not a reading)" : null;
  const additionsShareRaw = additionsReason === null && additionsDenominator !== null && additionsNumerator !== null ? additionsNumerator / additionsDenominator : null;
  const additionsShareAboveOne = additionsShareRaw !== null && additionsShareRaw > 1 ? `additions-share-above-one: additionsNumerator=${additionsNumerator} > additionsDenominator=${additionsDenominator} \u2014 the additions caliber cannot exceed 1 by construction, so this is an accounting bug, not a reading` : null;
  const additionsShare = additionsShareAboveOne === null ? additionsShareRaw : null;
  const carried = {
    ...shas,
    centralFiles,
    moduleFileCount: moduleFiles.length,
    newModuleFiles,
    maxCentralChangeCommit,
    oppositeSignCommits: opposite,
    shareReason: netReason,
    additionsNumerator,
    additionsDenominator,
    additionsReason: additionsShareAboveOne ?? additionsReason
  };
  if (share === null && additionsShare === null) {
    return unevaluated(
      `both-calibers-unavailable: net(${netReason}) | additions(${additionsShareAboveOne ?? additionsReason}) \u2014 neither caliber could be taken over ${spec.baseline}..${headRef}`,
      carried
    );
  }
  return {
    ...base,
    ...carried,
    evaluated: true,
    reason: null,
    centralDelta,
    nonCentralDelta,
    denominator,
    share,
    shareBasis: share === null ? null : "net",
    sharePercent: share === null ? null : pct(share),
    sharePercentRounded: share === null ? null : Math.round(share * 100),
    additionsShare,
    additionsSharePercent: additionsShare === null ? null : pct(additionsShare)
  };
}
function parseNumstatPath(raw) {
  const arrow = raw.indexOf(" => ");
  if (arrow === -1) return { from: raw, to: raw };
  const braceOpen = raw.indexOf("{");
  const braceClose = braceOpen === -1 ? -1 : raw.indexOf("}", arrow);
  if (braceOpen !== -1 && braceOpen < arrow && braceClose !== -1) {
    const prefix = raw.slice(0, braceOpen);
    const suffix = raw.slice(braceClose + 1);
    const inner = raw.slice(braceOpen + 1, braceClose);
    const half = inner.split(" => ");
    const join = (mid) => `${prefix}${mid}${suffix}`.replace(/\/{2,}/g, "/");
    return { from: join(half[0] ?? ""), to: join(half[1] ?? "") };
  }
  return { from: raw.slice(0, arrow), to: raw.slice(arrow + 4) };
}
function readWindowAdditions(root, baseSha, headSha, centralPaths, matchesModules, pathFilter = []) {
  const spec = pathFilter.length > 0 ? ["--", ...pathFilter] : [];
  const r = gitRead(root, ["diff", "--numstat", "--no-ext-diff", "-M", baseSha, headSha, ...spec]);
  if (!r.ok) return { ok: false, error: r.error ?? "git diff --numstat failed" };
  let central = 0;
  let nonCentral = 0;
  for (const row of r.stdout.split("\n")) {
    if (row === "") continue;
    const [ins, del, file] = row.split("	");
    if (!file || ins === "-" || del === "-") continue;
    const n = Number(ins);
    if (!Number.isFinite(n)) continue;
    const { to } = parseNumstatPath(file);
    if (centralPaths.has(to)) central += n;
    else if (matchesModules(to)) nonCentral += n;
  }
  return { ok: true, central, nonCentral };
}
function readCommitStats(root, baseSha, headSha, centralPaths, matchesModules, pathFilter = []) {
  const spec = pathFilter.length > 0 ? ["--", ...pathFilter] : [];
  const r = gitRead(root, ["log", "--numstat", "--no-renames", "--format=%x00%H%x1f%s", `${baseSha}..${headSha}`, ...spec]);
  if (!r.ok) return null;
  const out = [];
  for (const chunk of r.stdout.split("\0")) {
    const lines = chunk.split("\n");
    const header = lines.shift() ?? "";
    const sep = header.indexOf("");
    const sha = (sep === -1 ? header : header.slice(0, sep)).trim();
    if (sha === "") continue;
    const subject = sep === -1 ? "" : header.slice(sep + 1).trim();
    let centralDelta = 0;
    let nonCentralDelta = 0;
    for (const row of lines) {
      if (row === "") continue;
      const [ins, del, file] = row.split("	");
      if (!file || ins === "-" || del === "-") continue;
      const delta = Number(ins) - Number(del);
      if (!Number.isFinite(delta)) continue;
      if (centralPaths.has(file)) centralDelta += delta;
      else if (matchesModules(file)) nonCentralDelta += delta;
    }
    out.push({ sha, subject, centralDelta, nonCentralDelta });
  }
  return out;
}
function pickLargestCentralChange(stats) {
  if (stats === null) return null;
  let best = null;
  for (const s of stats) {
    if (best === null || Math.abs(s.centralDelta) > Math.abs(best.centralDelta)) {
      best = { sha: s.sha, centralDelta: s.centralDelta, nonCentralDelta: s.nonCentralDelta };
    }
  }
  return best;
}
function pickOppositeSignCommits(stats) {
  if (stats === null) return null;
  return stats.filter((s) => s.centralDelta < 0 && s.nonCentralDelta > 0).map((s) => ({ sha: s.sha, centralDelta: s.centralDelta, nonCentralDelta: s.nonCentralDelta, subject: s.subject }));
}
var PATH_TOKEN_RE = /[A-Za-z0-9_./-]+\.(?:jsonl|json|tsx|mts|cts|ts|mjs|cjs|js|yaml|yml|sh|md|py|toml)\b/g;
var MERGE_CONFLICT_RE = /Merge conflict in ([^\s\\"']+)/g;
function collectStrings(value, out = []) {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value !== null && typeof value === "object") for (const v of Object.values(value)) collectStrings(v, out);
  return out;
}
function pathTokens(text) {
  const seen = /* @__PURE__ */ new Set();
  for (const m of text.match(PATH_TOKEN_RE) ?? []) {
    const t = m.replace(/^(\.\/)+/, "");
    if (t !== "") seen.add(t);
  }
  return [...seen];
}
var DEFAULT_CONTENTION_PREDICATES = {
  form1Files(record) {
    const reason = record["selector_reason"];
    if (typeof reason !== "string" || reason === "") return [];
    if (!CONTENTION_TOKENS.some((t) => reason.includes(t))) return [];
    return pathTokens(reason);
  },
  form2Files(record) {
    const files = /* @__PURE__ */ new Set();
    for (const s of collectStrings(record)) {
      for (const m of s.matchAll(MERGE_CONFLICT_RE)) {
        const p = m[1].replace(/^(\.\/)+/, "");
        if (p !== "") files.add(p);
      }
    }
    return [...files];
  }
};
var PREDICATE_SELFCHECK_SAMPLE = Object.freeze({
  task: "predicate-selfcheck-sample",
  ts: "1970-01-01T00:00:00.000Z",
  selector_reason: "\u5185\u7F6E\u5DF2\u77E5\u4E3A\u771F\u7684\u6837\u672C\u884C\uFF1A\u907F\u5F00 plugin/scripts/design-evolution-selfcheck.ts \u7684\u4E89\u7528\uFF08predicate self-check, not a real dispatch\uFF09",
  mechanical_fan_in: {
    reason: "Auto-merging plugin/scripts/design-evolution-selfcheck.ts\nCONFLICT (content): Merge conflict in plugin/scripts/design-evolution-selfcheck.ts"
  }
});
var PREDICATE_SELFCHECK_PATH = "plugin/scripts/design-evolution-selfcheck.ts";
function scanContention(root, opts = {}) {
  const carrierPath2 = opts.carrierPath ? path5.resolve(opts.carrierPath) : path5.join(path5.resolve(root), OUTCOME_CARRIER_REL);
  const topN = opts.topN ?? CONTENTION_TOP_N_DEFAULT;
  const predicates = opts.predicates ?? DEFAULT_CONTENTION_PREDICATES;
  const windowStartIndex = opts.windowStartIndex ?? 0;
  const windowSource = opts.windowSource ?? "no-previous-record";
  const resolver = opts.resolver ?? createPathIdentityResolver(path5.resolve(root), opts.repoPaths !== void 0 ? { repoPaths: opts.repoPaths } : {});
  const pathIndex = { available: resolver.indexSize !== null, files: resolver.indexSize };
  const form1Self = predicates.form1Files(PREDICATE_SELFCHECK_SAMPLE).includes(PREDICATE_SELFCHECK_PATH);
  const form2Self = predicates.form2Files(PREDICATE_SELFCHECK_SAMPLE).includes(PREDICATE_SELFCHECK_PATH);
  const predicateSelfCheck = { ok: form1Self && form2Self, form1: form1Self, form2: form2Self };
  if (!predicateSelfCheck.ok) {
    const broken = [!form1Self ? "form1" : null, !form2Self ? "form2" : null].filter(Boolean).join("+");
    return {
      evaluated: false,
      reason: `predicate-selfcheck-failed: ${broken} did not match the built-in known-true sample (${PREDICATE_SELFCHECK_PATH}) \u2014 \u300C\u8C13\u8BCD\u574F\u4E86\u300D must not look like \u300C\u96F6\u4E89\u7528\u300D`,
      carrierPath: carrierPath2,
      carrierExists: fs4.existsSync(carrierPath2),
      carrierRecords: null,
      windowStartIndex,
      windowSource,
      topN,
      pathIndex,
      predicateSelfCheck,
      unresolvedPaths: [],
      files: []
    };
  }
  let text;
  try {
    text = fs4.readFileSync(carrierPath2, "utf8");
  } catch (e) {
    const code = e.code;
    return {
      evaluated: false,
      reason: code === "ENOENT" ? `carrier-missing: ${carrierPath2} (no dispatch has been logged yet \u2014 this is NOT \u300C\u96F6\u4E89\u7528\u300D)` : `carrier-unreadable: ${carrierPath2} \u2014 ${e.message}`,
      carrierPath: carrierPath2,
      carrierExists: false,
      carrierRecords: null,
      windowStartIndex,
      windowSource,
      topN,
      pathIndex,
      predicateSelfCheck,
      unresolvedPaths: [],
      files: []
    };
  }
  const rows = [];
  let malformed = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) rows.push(parsed);
      else malformed++;
    } catch {
      malformed++;
    }
  }
  const agg = /* @__PURE__ */ new Map();
  const touch = (file, record, index, form) => {
    let a = agg.get(file);
    if (a === void 0) {
      a = { form1: 0, form2: 0, windowForm1: 0, windowForm2: 0, samples: { form1: [], form2: [] }, observedPaths: /* @__PURE__ */ new Set() };
      agg.set(file, a);
    }
    a.observedPaths.add(file);
    a[form]++;
    if (index >= windowStartIndex) {
      if (form === "form1") a.windowForm1++;
      else a.windowForm2++;
    }
    if (a.samples[form].length < CONTENTION_SAMPLE_LIMIT) {
      a.samples[form].push({
        task: typeof record["task"] === "string" ? record["task"] : null,
        ts: typeof record["ts"] === "string" ? record["ts"] : null,
        recordIndex: index
      });
    }
  };
  const unresolved = /* @__PURE__ */ new Map();
  const resolveHits = (raws) => {
    const keys = /* @__PURE__ */ new Set();
    for (const raw of raws) {
      const id = resolver.resolve(raw);
      if (id.rel !== null) keys.add(id.rel);
      else if (!unresolved.has(raw)) unresolved.set(raw, id.reason ?? "unresolved");
    }
    return [...keys];
  };
  rows.forEach((record, index) => {
    for (const file of resolveHits(predicates.form1Files(record))) touch(file, record, index, "form1");
    for (const file of resolveHits(predicates.form2Files(record))) touch(file, record, index, "form2");
  });
  const hotBasenames = new Set([...agg.keys()].map((f) => path5.posix.basename(f)));
  for (const record of rows) {
    for (const s of collectStrings(record)) {
      for (const token of s.match(PATH_TOKEN_RE) ?? []) {
        const raw = token.replace(/^(\.\/)+/, "");
        const id = resolver.resolve(raw);
        if (id.rel !== null) {
          agg.get(id.rel)?.observedPaths.add(id.rel);
        } else if (hotBasenames.has(path5.posix.basename(raw)) && !unresolved.has(raw)) {
          unresolved.set(raw, id.reason ?? "unresolved");
        }
      }
    }
  }
  const files = [...agg.entries()].map(([file, a]) => ({
    file,
    basename: path5.posix.basename(file),
    form1: a.form1,
    form2: a.form2,
    total: a.form1 + a.form2,
    windowForm1: a.windowForm1,
    windowForm2: a.windowForm2,
    windowTotal: a.windowForm1 + a.windowForm2,
    samples: a.samples,
    observedPaths: [...a.observedPaths].sort()
  })).sort((x, y) => y.total - x.total || x.file.localeCompare(y.file)).slice(0, Math.max(1, topN));
  return {
    evaluated: true,
    reason: malformed > 0 ? `carrier-partially-unparsed: ${malformed} line(s) skipped (counts are over the ${rows.length} parseable records)` : null,
    carrierPath: carrierPath2,
    carrierExists: true,
    carrierRecords: rows.length,
    windowStartIndex,
    windowSource,
    topN,
    pathIndex,
    predicateSelfCheck,
    unresolvedPaths: [...unresolved.entries()].map(([raw, reason]) => ({ raw, reason })).sort((a, b) => a.raw.localeCompare(b.raw)),
    files
  };
}
var DESIGN_EVOLUTION_MODE = "design-evolution-readings-round";
function buildReadings(root, opts) {
  const subsystems = opts.subsystems.map((s) => measureSubsystem(root, s, opts.head ? { head: opts.head } : {}));
  const rm1Evaluated = subsystems.length > 0 && subsystems.every((s) => s.evaluated);
  const rm1Reason = subsystems.length === 0 ? "rm1-no-subsystems-declared: no subsystem is declared, so there is no decomposition reading to take" : rm1Evaluated ? null : subsystems.filter((s) => !s.evaluated).map((s) => `${s.name}: ${s.reason ?? "not evaluated"}`).join("; ");
  const rm2 = scanContention(root, {
    ...opts.carrierPath ? { carrierPath: opts.carrierPath } : {},
    ...opts.topN !== void 0 ? { topN: opts.topN } : {},
    ...opts.windowStartIndex !== void 0 ? { windowStartIndex: opts.windowStartIndex } : {},
    ...opts.windowSource ? { windowSource: opts.windowSource } : {},
    ...opts.predicates ? { predicates: opts.predicates } : {}
  });
  const evaluated = rm1Evaluated && rm2.evaluated;
  const reason = evaluated ? null : [rm1Evaluated ? null : `rm1: ${rm1Reason}`, rm2.evaluated ? null : `rm2: ${rm2.reason ?? "not evaluated"}`].filter(Boolean).join(" | ");
  const ts = opts.ts ?? (/* @__PURE__ */ new Date()).toISOString();
  const now = new Date(ts);
  return {
    ts,
    mode: DESIGN_EVOLUTION_MODE,
    evaluated,
    reason,
    head: subsystems[0]?.headSha ?? null,
    rm1: { evaluated: rm1Evaluated, reason: rm1Reason, subsystems },
    rm2,
    carrierRecords: rm2.carrierRecords,
    phaseStaleness: readPhaseStaleness(root, Number.isFinite(now.getTime()) ? { now } : {}),
    reportOnly: true
  };
}
function appendHistoryRecord(root, record, opts = {}) {
  const file = opts.historyPath ? path5.resolve(opts.historyPath) : path5.join(path5.resolve(root), DESIGN_EVOLUTION_HISTORY_REL);
  try {
    fs4.mkdirSync(path5.dirname(file), { recursive: true });
    fs4.appendFileSync(file, JSON.stringify(record) + "\n");
    return { path: file, ok: true, error: null };
  } catch (e) {
    return { path: file, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
function readPreviousWindow(root, opts = {}) {
  const file = opts.historyPath ? path5.resolve(opts.historyPath) : path5.join(path5.resolve(root), DESIGN_EVOLUTION_HISTORY_REL);
  let text;
  try {
    text = fs4.readFileSync(file, "utf8");
  } catch {
    return { windowStartIndex: 0, windowSource: "no-previous-record" };
  }
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return { windowStartIndex: 0, windowSource: "no-previous-record" };
  try {
    const last = JSON.parse(lines[lines.length - 1]);
    if (last.mode !== DESIGN_EVOLUTION_MODE || typeof last.carrierRecords !== "number" || !Number.isFinite(last.carrierRecords)) {
      return { windowStartIndex: 0, windowSource: "previous-record-unusable" };
    }
    return { windowStartIndex: Math.max(0, Math.trunc(last.carrierRecords)), windowSource: "previous-record" };
  } catch {
    return { windowStartIndex: 0, windowSource: "previous-record-unusable" };
  }
}
var DESIGN_EVOLUTION_DARK_STREAK_ROUNDS_DEFAULT = 2;
var EVOLUTION_FINDINGS_REL = path5.posix.join(".quay", "routine-findings.jsonl");
var EVOLUTION_STATE_STABLE = "stable";
var EVOLUTION_STATE_REGRESSION = "regression";
var EVOLUTION_STATE_NO_PRIOR = "no-prior";
var EVOLUTION_STATE_NOT_EVALUATED = "not-evaluated";
var EVOLUTION_TRIGGER_SHARE_UP = "share-up";
var EVOLUTION_TRIGGER_DARK_STREAK = "dark-streak";
var EVOLUTION_TRIGGER_SOURCE_MISSING = "source-missing";
var EVOLUTION_RM2_TARGET = "rm2";
function evolutionFindingKey(target, trigger) {
  return `evolution:${target}:${trigger}`;
}
function isRoundRecord(x) {
  if (x === null || typeof x !== "object" || Array.isArray(x)) return false;
  const r = x;
  if (r.mode !== DESIGN_EVOLUTION_MODE) return false;
  if (typeof r.ts !== "string" || typeof r.evaluated !== "boolean") return false;
  const rm1 = r.rm1;
  if (rm1 === null || typeof rm1 !== "object" || !Array.isArray(rm1?.subsystems)) return false;
  const rm2 = r.rm2;
  return rm2 !== null && typeof rm2 === "object" && typeof rm2?.evaluated === "boolean";
}
function readDesignEvolutionHistory(root, opts = {}) {
  const file = opts.historyPath ? path5.resolve(opts.historyPath) : path5.join(path5.resolve(root), DESIGN_EVOLUTION_HISTORY_REL);
  let text;
  try {
    text = fs4.readFileSync(file, "utf8");
  } catch (e) {
    const code = e.code;
    if (code === "ENOENT") return { state: "carrier-missing", records: [], malformed: 0, reason: `${file} does not exist` };
    return { state: "unreadable", records: [], malformed: 0, reason: `${file} is unreadable \u2014 ${e.message}` };
  }
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  const records = [];
  let malformed = 0;
  for (const line of lines) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      malformed += 1;
      continue;
    }
    if (!isRoundRecord(parsed)) {
      malformed += 1;
      continue;
    }
    records.push(parsed);
  }
  if (lines.length > 0 && records.length === 0) {
    return { state: "unreadable", records: [], malformed, reason: `${file} carries ${lines.length} line(s) but none is a round record` };
  }
  return { state: "ok", records, malformed, reason: null };
}
function trailingDarkRounds(records, name) {
  let n = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    const s = records[i].rm1.subsystems.find((x) => x.name === name);
    if (!s || s.evaluated !== false) break;
    n += 1;
  }
  return n;
}
function trailingRm2DarkRounds(records) {
  let n = 0;
  for (let i = records.length - 1; i >= 0; i--) {
    if (records[i].rm2.evaluated !== false) break;
    n += 1;
  }
  return n;
}
function priorDarkRoundsFor(records, names) {
  const out = {};
  for (const name of names) out[name] = trailingDarkRounds(records, name);
  out[EVOLUTION_RM2_TARGET] = trailingRm2DarkRounds(records);
  return out;
}
function subsystemIdentity(s) {
  const baseline = s.baselineSha ?? s.baseline;
  return `${baseline}|${s.central.map((c) => c.atHead).slice().sort().join(",")}`;
}
var num = (v) => typeof v === "number" && Number.isFinite(v) ? v : null;
var sub = (a, b) => a === null || b === null ? null : a - b;
function judgeEvolutionRegression(prev, curr, opts = {}) {
  const threshold = opts.darkStreakRounds ?? DESIGN_EVOLUTION_DARK_STREAK_ROUNDS_DEFAULT;
  const priorState = opts.prevState ?? (prev === null ? "no-prior-record" : "ok");
  const derivedDark = opts.priorDarkRounds ?? (prev === null ? {} : Object.fromEntries(
    prev.rm1.subsystems.map((s) => [s.name, s.evaluated === false ? 1 : 0])
  ));
  const base = {
    currTs: curr.ts,
    currEvaluated: curr.evaluated === true,
    priorTs: prev?.ts ?? null,
    priorState,
    darkStreakRounds: threshold
  };
  if (!isRoundRecord(curr)) {
    return {
      ...base,
      state: EVOLUTION_STATE_NOT_EVALUATED,
      triggers: null,
      subsystems: [],
      summary: `${EVOLUTION_STATE_NOT_EVALUATED} @${String(curr?.ts ?? "?")} \u2014 the round record could not be read`,
      reason: "current-record-unreadable: the argument is not a design-evolution round record (mode/ts/evaluated/rm1.subsystems/rm2.evaluated missing)"
    };
  }
  if (priorState === "previous-record-unusable") {
    return {
      ...base,
      state: EVOLUTION_STATE_NOT_EVALUATED,
      triggers: null,
      subsystems: [],
      summary: `${EVOLUTION_STATE_NOT_EVALUATED} @${curr.ts} \u2014 the previous round could not be read, so no comparison exists`,
      reason: opts.prevStateReason ?? "previous-record-unusable: the last carrier line is not a round record, so there is no baseline to compare against (\u26D4 not the same as a first round)"
    };
  }
  const rows = [];
  const prevSubs = prev?.rm1.subsystems ?? null;
  const usedPrev = /* @__PURE__ */ new Set();
  const judgeOne = (cs, ps) => {
    const dark = derivedDark[cs.name] ?? 0;
    if (cs.evaluated !== true) {
      const darkRounds = dark + 1;
      if (darkRounds >= threshold) {
        return {
          name: cs.name,
          state: EVOLUTION_TRIGGER_DARK_STREAK,
          deltaCentral: null,
          deltaNonCentral: null,
          deltaDenominator: null,
          sharePercent: null,
          additionsSharePercent: null,
          darkRounds,
          reason: cs.reason ?? "the reading reports evaluated:false without a reason"
        };
      }
      return {
        name: cs.name,
        state: EVOLUTION_STATE_NOT_EVALUATED,
        deltaCentral: null,
        deltaNonCentral: null,
        deltaDenominator: null,
        sharePercent: null,
        additionsSharePercent: null,
        darkRounds,
        reason: cs.reason ?? "the reading reports evaluated:false without a reason"
      };
    }
    const sharePercent = num(cs.sharePercent);
    const additionsSharePercent = num(cs.additionsSharePercent);
    if (ps === null) {
      return {
        name: cs.name,
        state: prev === null ? EVOLUTION_STATE_NO_PRIOR : "new",
        deltaCentral: null,
        deltaNonCentral: null,
        deltaDenominator: null,
        sharePercent,
        additionsSharePercent,
        darkRounds: null,
        reason: prev === null ? "first round \u2014 there is no previous reading to compare against" : "this subsystem is absent from the previous round"
      };
    }
    if (ps.evaluated !== true) {
      return {
        name: cs.name,
        state: EVOLUTION_STATE_NO_PRIOR,
        deltaCentral: null,
        deltaNonCentral: null,
        deltaDenominator: null,
        sharePercent,
        additionsSharePercent,
        darkRounds: null,
        reason: `the previous round could not evaluate this subsystem (${ps.reason ?? "no reason recorded"}) \u21D2 the increment is not computable`
      };
    }
    const deltaCentral = sub(num(cs.centralDelta), num(ps.centralDelta));
    const deltaNonCentral = sub(num(cs.nonCentralDelta), num(ps.nonCentralDelta));
    const deltaDenominator = sub(num(cs.denominator), num(ps.denominator));
    const sameBaseline = subsystemIdentity(cs) === subsystemIdentity(ps);
    const shareUp = sameBaseline && deltaDenominator !== null && deltaCentral !== null && deltaDenominator > 0 && deltaCentral > 0;
    return {
      name: cs.name,
      state: shareUp ? EVOLUTION_TRIGGER_SHARE_UP : EVOLUTION_STATE_STABLE,
      deltaCentral,
      deltaNonCentral,
      deltaDenominator,
      sharePercent,
      additionsSharePercent,
      darkRounds: null,
      reason: shareUp ? null : sameBaseline ? "no new lines landed in the central file this round (\u0394central <= 0 or \u0394denominator <= 0)" : "the subsystem's baseline identity changed between the two rounds \u21D2 the increment is not comparable"
    };
  };
  for (const cs of curr.rm1.subsystems) {
    let pi = -1;
    if (prevSubs !== null) {
      pi = prevSubs.findIndex((p, i) => !usedPrev.has(i) && p.name === cs.name);
      if (pi < 0) pi = prevSubs.findIndex((p, i) => !usedPrev.has(i) && subsystemIdentity(p) === subsystemIdentity(cs));
      if (pi >= 0) usedPrev.add(pi);
    }
    rows.push(judgeOne(cs, pi >= 0 ? prevSubs[pi] : null));
  }
  if (prevSubs !== null) {
    for (const [i, ps] of prevSubs.entries()) {
      if (usedPrev.has(i)) continue;
      rows.push({
        name: ps.name,
        state: EVOLUTION_TRIGGER_SOURCE_MISSING,
        deltaCentral: null,
        deltaNonCentral: null,
        deltaDenominator: null,
        sharePercent: null,
        additionsSharePercent: null,
        darkRounds: null,
        reason: `the previous round measured this subsystem (${subsystemIdentity(ps)}) and this round does not declare it`
      });
    }
  }
  const rm2Dark = (derivedDark[EVOLUTION_RM2_TARGET] ?? 0) + (curr.rm2.evaluated === true ? 0 : 1);
  if (curr.rm2.evaluated !== true) {
    rows.push({
      name: EVOLUTION_RM2_TARGET,
      state: rm2Dark >= threshold ? EVOLUTION_TRIGGER_DARK_STREAK : EVOLUTION_STATE_NOT_EVALUATED,
      deltaCentral: null,
      deltaNonCentral: null,
      deltaDenominator: null,
      sharePercent: null,
      additionsSharePercent: null,
      darkRounds: rm2Dark,
      reason: curr.rm2.reason ?? "rm2 reports evaluated:false without a reason"
    });
  } else if (prev !== null && prev.rm2.evaluated !== true) {
    rows.push({
      name: EVOLUTION_RM2_TARGET,
      state: EVOLUTION_STATE_NO_PRIOR,
      deltaCentral: null,
      deltaNonCentral: null,
      deltaDenominator: null,
      sharePercent: null,
      additionsSharePercent: null,
      darkRounds: null,
      reason: "the previous round could not take the contention reading"
    });
  } else {
    rows.push({
      name: EVOLUTION_RM2_TARGET,
      state: EVOLUTION_STATE_STABLE,
      deltaCentral: null,
      deltaNonCentral: null,
      deltaDenominator: null,
      sharePercent: null,
      additionsSharePercent: null,
      darkRounds: null,
      reason: null
    });
  }
  const triggers = rows.filter((r) => r.state === EVOLUTION_TRIGGER_SHARE_UP || r.state === EVOLUTION_TRIGGER_DARK_STREAK || r.state === EVOLUTION_TRIGGER_SOURCE_MISSING).map((r) => ({
    trigger: r.state,
    target: r.name,
    deltaCentral: r.deltaCentral,
    deltaNonCentral: r.deltaNonCentral,
    deltaDenominator: r.deltaDenominator,
    sharePercent: r.sharePercent,
    additionsSharePercent: r.additionsSharePercent,
    darkRounds: r.darkRounds
  }));
  const notEvaluatedRows = rows.filter((r) => r.state === EVOLUTION_STATE_NOT_EVALUATED);
  const state = triggers.length > 0 ? EVOLUTION_STATE_REGRESSION : notEvaluatedRows.length > 0 || curr.evaluated !== true ? EVOLUTION_STATE_NOT_EVALUATED : prev === null ? EVOLUTION_STATE_NO_PRIOR : EVOLUTION_STATE_STABLE;
  const reason = state === EVOLUTION_STATE_NOT_EVALUATED ? curr.evaluated !== true ? `current-round-not-evaluated: ${curr.reason ?? "the round reports evaluated:false without a reason"}` : `sub-readings-not-evaluated: ${notEvaluatedRows.map((r) => `${r.name} (${r.reason ?? "no reason recorded"})`).join("; ")} \u2014 one dark round is not yet a streak (threshold ${threshold})` : null;
  const summary = `${state} @${curr.ts} vs ${prev === null ? "(no prior reading)" : prev.ts}` + (triggers.length > 0 ? ` \u2014 ${triggers.map(
    (t) => t.trigger === EVOLUTION_TRIGGER_SHARE_UP ? `${t.trigger}:${t.target} (\u0394central=${t.deltaCentral} \u0394denominator=${t.deltaDenominator} \u0394non-central=${t.deltaNonCentral} netShare=${t.sharePercent}% additionsShare=${t.additionsSharePercent}%)` : t.trigger === EVOLUTION_TRIGGER_DARK_STREAK ? `${t.trigger}:${t.target} (${t.darkRounds} consecutive rounds evaluated:false)` : `${t.trigger}:${t.target} (measured by the previous round, not declared now)`
  ).join(", ")}` : reason !== null ? ` \u2014 ${reason}` : "");
  return {
    ...base,
    state,
    triggers: triggers.length > 0 ? triggers : null,
    subsystems: rows,
    summary,
    reason
  };
}
function evolutionFindings(record, verdict) {
  if (verdict.state !== EVOLUTION_STATE_REGRESSION || verdict.triggers === null) return [];
  const hist = DESIGN_EVOLUTION_HISTORY_REL;
  return verdict.triggers.map((t) => {
    const reading = record.rm1.subsystems.find((s) => s.name === t.target) ?? null;
    const files = reading ? [.../* @__PURE__ */ new Set([...reading.centralFiles.map((c) => c.atHead), ...reading.central.map((c) => c.atHead)])] : t.target === EVOLUTION_RM2_TARGET ? [OUTCOME_CARRIER_REL] : [];
    const where = `\u8BFB\u6570\u8F7D\u4F53 \`${hist}\` \u7684 ts=\`${record.ts}\`\uFF08\u4E0A\u4E00\u6761 \`${verdict.priorTs ?? "<none>"}\`\uFF09`;
    if (t.trigger === EVOLUTION_TRIGGER_SHARE_UP) {
      return {
        key: evolutionFindingKey(t.target, t.trigger),
        target: t.target,
        trigger: t.trigger,
        readingTs: record.ts,
        priorReadingTs: verdict.priorTs,
        deltaCentral: t.deltaCentral,
        deltaNonCentral: t.deltaNonCentral,
        deltaDenominator: t.deltaDenominator,
        sharePercent: t.sharePercent,
        additionsSharePercent: t.additionsSharePercent,
        darkRounds: null,
        rationale: `\u5B50\u7CFB\u7EDF \`${t.target}\` \u672C\u8F6E\u76F8\u5BF9\u4E0A\u4E00\u6761\u8BFB\u6570\u5206\u6BCD\u589E\u52A0 \`${t.deltaDenominator}\`\u3001\u4E2D\u5FC3\u589E\u91CF \`${t.deltaCentral}\`\u3001\u975E\u4E2D\u5FC3\u589E\u91CF \`${t.deltaNonCentral}\` \u21D2 \u65B0\u589E\u7684\u51C0\u884C\u6570\u843D\u8FDB\u4E86\u4E2D\u5FC3\u6587\u4EF6\uFF08\u5206\u89E3\u6CA1\u6709\u628A\u65B0\u4EE3\u7801\u6321\u5728\u5916\u9762\uFF09\u3002\u7D2F\u8BA1\u51C0\u53E3\u5F84 \`netShare\` \`${t.sharePercent}%\`\uFF08central\u0394=\`${reading?.centralDelta ?? "?"}\` / denominator=\`${reading?.denominator ?? "?"}\`\uFF09\uFF1B\u540C\u4E00\u7A97\u53E3\u53EA\u8BA1\u65B0\u589E\u53E3\u5F84 \`additionsShare\` \`${t.additionsSharePercent}%\`\uFF08additionsNumerator=\`${reading?.additionsNumerator ?? "?"}\` / additionsDenominator=\`${reading?.additionsDenominator ?? "?"}\`\uFF09\u3002\u26D4 \u4E24\u79CD\u53E3\u5F84\u4E0D\u53EF\u4E92\u5F15\uFF1A\`netShare\` \u662F\u7A97\u53E3\u4E24\u7AEF\u7684\u884C\u6570\u51C0\u5DEE\uFF08\u53EF\u4E3A\u8D1F\u3001\u53EF >100%\uFF09\uFF0C\`additionsShare\` \u662F \`git diff --numstat\` \u7684\u65B0\u589E\u884C\uFF08\u7ED3\u6784\u4E0A \u2264100%\uFF0C\u4E0E claudecodeui \u53E3\u5F84\u53EF\u6BD4\uFF09\u3002${where}\u3002`,
        // ⚠️ NO backticks inside `suggestedAction`: the renderer wraps the WHOLE action in one pair
        // (routine-file-gate's candidate text), so an inner pair would break the reader's structure.
        suggestedAction: `\u590D\u6838 ${t.target} \u672C\u8F6E\u65B0\u589E\u7684\u4E2D\u5FC3\u6587\u4EF6\u884C\u662F\u5426\u672C\u5E94\u843D\u5728\u6269\u5C55\u70B9\u4E4B\u5916\u7684\u6A21\u5757\u91CC\uFF1B\u82E5\u662F\uFF0C\u628A\u65B0\u589E\u903B\u8F91\u79FB\u5230\u6A21\u5757\u6587\u4EF6\u5E76\u5728 ${hist} \u7684\u540E\u7EED\u8BFB\u6570\u4E0A\u770B\u5230\u4E2D\u5FC3\u589E\u91CF\u56DE\u843D\uFF1B\u82E5\u5426\uFF0C\u5728\u4EFB\u52A1\u4F53\u5199\u660E\u300C\u8FD9\u8F6E\u589E\u957F\u786E\u5B9E\u5C5E\u4E8E\u4E2D\u5FC3\u6587\u4EF6\u7684\u804C\u8D23\u300D\u3002`,
        files
      };
    }
    if (t.trigger === EVOLUTION_TRIGGER_DARK_STREAK) {
      return {
        key: evolutionFindingKey(t.target, t.trigger),
        target: t.target,
        trigger: t.trigger,
        readingTs: record.ts,
        priorReadingTs: verdict.priorTs,
        deltaCentral: null,
        deltaNonCentral: null,
        deltaDenominator: null,
        sharePercent: null,
        additionsSharePercent: null,
        darkRounds: t.darkRounds,
        rationale: `\`${t.target}\` \u8FDE\u7EED \`${t.darkRounds}\` \u8F6E\u8BFB\u6570 \`evaluated:false\`\uFF08\u9608\u503C \`${verdict.darkStreakRounds}\` \u8F6E\uFF0C\u7B56\u7565\u9009\u62E9\uFF09\u3002\u6700\u8FD1\u4E00\u6761\u539F\u56E0\uFF1A\`${reading?.reason ?? (t.target === EVOLUTION_RM2_TARGET ? record.rm2.reason : null) ?? "no reason recorded"}\`\u3002${where}\u3002`,
        suggestedAction: `\u8BFB ${hist} \u7684\u6700\u8FD1\u8BB0\u5F55\uFF0C\u5B9A\u4F4D ${t.target} \u8BFB\u4E0D\u51FA\u7684\u786E\u5207\u6761\u4EF6\uFF08baseline \u4E0D\u53EF\u89E3\u6790 / \u4E2D\u5FC3\u6587\u4EF6\u5728\u67D0\u7AEF\u7F3A\u5931 / \u5206\u6BCD\u975E\u6B63 / \u8F7D\u4F53\u7F3A\u5931\uFF09\uFF0C\u4FEE\u597D\u4EEA\u5668\u6216\u6539\u6B63\u58F0\u660E\uFF1B\u26D4 \u4E0D\u8981\u9760\u8C03\u9AD8 dark_streak_rounds \u8BA9\u8FD9\u6761\u6D88\u6389\u3002`,
        files
      };
    }
    return {
      key: evolutionFindingKey(t.target, t.trigger),
      target: t.target,
      trigger: t.trigger,
      readingTs: record.ts,
      priorReadingTs: verdict.priorTs,
      deltaCentral: null,
      deltaNonCentral: null,
      deltaDenominator: null,
      sharePercent: null,
      additionsSharePercent: null,
      darkRounds: null,
      rationale: `\u4E0A\u4E00\u8F6E\uFF08\`${verdict.priorTs ?? "<none>"}\`\uFF09\u6D4B\u91CF\u7684\u5B50\u7CFB\u7EDF \`${t.target}\` \u5728\u672C\u8F6E\u8BFB\u6570\u4E2D\u4E0D\u5B58\u5728\uFF08identity=\`${reading === null ? "unavailable" : subsystemIdentity(reading)}\`\uFF09\u21D2 \u8FD9\u6761\u8BFB\u6570\u6765\u6E90\u6D88\u5931\u4E86\u3002\u26D4 \u6539\u540D\u4E0D\u7B97\u6D88\u5931\uFF08identity \u7531 baseline + \u4E2D\u5FC3\u6587\u4EF6\u96C6\u6784\u6210\uFF09\uFF1B\u8FD9\u662F\u300C\u58F0\u660E\u91CC\u4E0D\u518D\u6709\u5B83\u300D\u3002${where}\u3002`,
      suggestedAction: `\u786E\u8BA4 ${t.target} \u662F\u6709\u610F\u4ECE .quay/config.yml \u7684 loop.design_evolution_readings.subsystems \u79FB\u9664\u7684\uFF1A\u662F \u21D2 \u5728\u4EFB\u52A1\u4F53\u5199\u660E\u79FB\u9664\u7406\u7531\u5E76\u7ED3\u6848\uFF1B\u5426 \u21D2 \u6062\u590D\u8BE5\u5B50\u7CFB\u7EDF\u58F0\u660E\uFF0C\u5E76\u8BA9 ${hist} \u7684\u4E0B\u4E00\u6761\u8BB0\u5F55\u91CD\u65B0\u5217\u51FA\u5B83\u3002`,
      files
    };
  });
}
function evolutionFindingRecord(f, ts) {
  const ms = Date.parse(ts);
  return {
    ts,
    kind: "finding",
    routine: DESIGN_EVOLUTION_ROUTINE_NAME,
    probe: DESIGN_EVOLUTION_ROUTINE_NAME,
    runId: `${DESIGN_EVOLUTION_ROUTINE_NAME}-${Number.isFinite(ms) ? ms : ts}`,
    findingId: `${f.target}-${f.trigger}`,
    dupKind: "evolution-regression",
    subject: f.target,
    symbols: [f.key],
    files: f.files,
    verdict: "confirmed",
    rationale: f.rationale,
    suggestedAction: f.suggestedAction,
    // The trigger's own numbers, carried verbatim so a reader never has to re-derive them from prose.
    target: f.target,
    trigger: f.trigger,
    readingTs: f.readingTs,
    priorReadingTs: f.priorReadingTs,
    deltaCentral: f.deltaCentral,
    deltaNonCentral: f.deltaNonCentral,
    deltaDenominator: f.deltaDenominator,
    sharePercent: f.sharePercent,
    // The caliber is part of the number: `sharePercent` is the NET reading; `additionsSharePercent`
    // is the additions-only reading over the same window (⛔ never substitute one for the other).
    shareBasis: f.sharePercent === null ? null : "net",
    additionsSharePercent: f.additionsSharePercent,
    darkRounds: f.darkRounds,
    margin: null
  };
}
function appendEvolutionFindings(root, record, findings, opts = {}) {
  const file = opts.carrierPath ? path5.resolve(opts.carrierPath) : path5.join(path5.resolve(root), EVOLUTION_FINDINGS_REL);
  if (findings.length === 0) return { path: file, appended: 0, ok: true, error: null };
  try {
    fs4.mkdirSync(path5.dirname(file), { recursive: true });
    fs4.appendFileSync(file, findings.map((f) => JSON.stringify(evolutionFindingRecord(f, record.ts)) + "\n").join(""));
    return { path: file, appended: findings.length, ok: true, error: null };
  } catch (e) {
    return { path: file, appended: 0, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
function takeEvolutionRound(root, opts) {
  const resolvedRoot = path5.resolve(root);
  const historyPath = opts.historyPath ? path5.resolve(opts.historyPath) : path5.join(resolvedRoot, DESIGN_EVOLUTION_HISTORY_REL);
  const prior = readDesignEvolutionHistory(resolvedRoot, { historyPath });
  const previous = readPreviousWindow(resolvedRoot, { historyPath });
  const record = buildReadings(resolvedRoot, {
    ...opts.ts ? { ts: opts.ts } : {},
    subsystems: opts.subsystems,
    ...opts.carrierPath ? { carrierPath: opts.carrierPath } : {},
    ...opts.topN !== void 0 ? { topN: opts.topN } : {},
    windowStartIndex: previous.windowStartIndex,
    windowSource: previous.windowSource,
    ...opts.predicates ? { predicates: opts.predicates } : {},
    ...opts.head ? { head: opts.head } : {}
  });
  const names = record.rm1.subsystems.map((s) => s.name);
  const verdict = judgeEvolutionRegression(prior.state === "ok" ? prior.records[prior.records.length - 1] ?? null : null, record, {
    ...opts.darkStreakRounds !== void 0 ? { darkStreakRounds: opts.darkStreakRounds } : {},
    priorDarkRounds: prior.state === "ok" ? priorDarkRoundsFor(prior.records, names) : {},
    prevState: prior.state === "ok" ? prior.records.length === 0 ? "no-prior-record" : "ok" : prior.state === "carrier-missing" ? "no-prior-record" : "previous-record-unusable",
    ...prior.state === "unreadable" ? { prevStateReason: `previous-record-unusable: ${prior.reason}` } : {}
  });
  record.evolution = verdict;
  if (opts.persist === false) {
    return {
      record,
      verdict,
      findings: [],
      history: { path: historyPath, appended: false, error: null },
      findingsCarrier: { path: opts.findingsPath ?? path5.join(resolvedRoot, EVOLUTION_FINDINGS_REL), appended: 0, ok: true, error: null },
      priorUnreadable: prior.state === "unreadable",
      historyMalformed: prior.malformed
    };
  }
  const appended = appendHistoryRecord(resolvedRoot, record, { historyPath });
  const findings = appended.ok ? evolutionFindings(record, verdict) : [];
  const findingsCarrier = appendEvolutionFindings(resolvedRoot, record, findings, opts.findingsPath ? { carrierPath: opts.findingsPath } : {});
  return {
    record,
    verdict,
    findings,
    history: { path: appended.path, appended: appended.ok, error: appended.error },
    findingsCarrier,
    priorUnreadable: prior.state === "unreadable",
    historyMalformed: prior.malformed
  };
}
var EXIT_OK = 0;
var EXIT_USAGE = 2;
var EXIT_NOT_EVALUATED = 3;
var EXIT_HISTORY_WRITE_FAILED = 4;
var EXIT_FINDINGS_WRITE_FAILED = 5;
var USAGE2 = `usage: design-evolution-readings [--root <repo>] [--config <section.yml>] [--head <rev>]
                                   [--top-n <n>] [--history <path>] [--findings <path>]
                                   [--carrier <worker-outcome.jsonl>] [--no-history] [--json]

  RM1 (decomposition share) is taken for every subsystem declared in the \`design_evolution_readings\`
  section (--config points at a file holding the SECTION BODY; default: the \`loop.\` section of
  <root>/.quay/config.yml). RM2 (hot-file contention) is zero-config and always taken from
  <root>/.quay/worker-outcome.jsonl.

  The round is then JUDGED against the previous record in the history carrier (stable / regression /
  no-prior / not-evaluated). A \`regression\` appends one finding per trigger to the routine-findings
  carrier (default <root>/.quay/routine-findings.jsonl, --findings overrides); the existing
  routine-file-gate decides whether it becomes a task \u2014 this command never files one.

  --no-history  take the reading and the judgment but write NOTHING (no record \u21D2 no finding: a finding
                cites a record that must exist).

  exit 0 = record produced, evaluated:true   exit 3 = record produced, NOT-EVALUATED (a distinct value)
  exit 4 = history carrier not writable      exit 5 = findings carrier not writable
  exit 2 = usage / input error`;
var cfgBad = (msg) => `loop.design_evolution_readings ${msg}`;
function parseSubsystemEntry(raw, index) {
  const where = `subsystems[${index}]`;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { spec: null, error: cfgBad(`${where} must be a mapping`) };
  }
  const rec = raw;
  const known = /* @__PURE__ */ new Set(["name", "baseline", "head", "central", "modules"]);
  const unknown = Object.keys(rec).filter((k) => !known.has(k));
  if (unknown.length > 0) return { spec: null, error: cfgBad(`${where} has unknown key(s): ${unknown.join(", ")}`) };
  if (typeof rec.name !== "string" || rec.name.trim() === "") return { spec: null, error: cfgBad(`${where}.name must be a non-empty string`) };
  if (typeof rec.baseline !== "string" || rec.baseline.trim() === "") return { spec: null, error: cfgBad(`${where}.baseline must be a non-empty commit-ish string`) };
  if (rec.head !== void 0 && (typeof rec.head !== "string" || rec.head.trim() === "")) {
    return { spec: null, error: cfgBad(`${where}.head must be a non-empty commit-ish string when present`) };
  }
  if (!Array.isArray(rec.central) || rec.central.length === 0) {
    return { spec: null, error: cfgBad(`${where}.central must be a non-empty list (a path, or {at_baseline, at_head})`) };
  }
  const central = [];
  for (const [j, c] of rec.central.entries()) {
    if (typeof c === "string" && c !== "") {
      central.push({ atBaseline: c, atHead: c });
      continue;
    }
    if (c !== null && typeof c === "object" && !Array.isArray(c)) {
      const o = c;
      const extra = Object.keys(o).filter((k) => k !== "at_baseline" && k !== "at_head");
      if (extra.length > 0) return { spec: null, error: cfgBad(`${where}.central[${j}] has unknown key(s): ${extra.join(", ")}`) };
      if (typeof o.at_baseline !== "string" || o.at_baseline === "" || typeof o.at_head !== "string" || o.at_head === "") {
        return { spec: null, error: cfgBad(`${where}.central[${j}] needs non-empty 'at_baseline' and 'at_head'`) };
      }
      central.push({ atBaseline: o.at_baseline, atHead: o.at_head });
      continue;
    }
    return { spec: null, error: cfgBad(`${where}.central[${j}] must be a path or a mapping with 'at_baseline'/'at_head'`) };
  }
  if (!Array.isArray(rec.modules) || rec.modules.length === 0 || !rec.modules.every((m) => typeof m === "string" && m !== "")) {
    return { spec: null, error: cfgBad(`${where}.modules must be a non-empty list of path globs`) };
  }
  return {
    spec: {
      name: rec.name,
      baseline: rec.baseline,
      ...typeof rec.head === "string" ? { head: rec.head } : {},
      central,
      modules: rec.modules
    },
    error: null
  };
}
function parseDesignEvolutionSection(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { config: null, error: cfgBad(`must be a mapping (got ${Array.isArray(raw) ? "array" : raw === null ? "null" : typeof raw})`) };
  }
  const rec = raw;
  const known = /* @__PURE__ */ new Set(["enabled", "interval", "subsystems", "top_n", "dark_streak_rounds"]);
  const unknown = Object.keys(rec).filter((k) => !known.has(k));
  if (unknown.length > 0) return { config: null, error: cfgBad(`has unknown key(s): ${unknown.join(", ")} \u2014 a silently ignored key would make the reading lie`) };
  if (typeof rec.enabled !== "boolean") {
    return { config: null, error: cfgBad(`needs a boolean 'enabled' (got ${rec.enabled === void 0 ? "missing" : JSON.stringify(rec.enabled)})`) };
  }
  if (rec.enabled === false) {
    return {
      config: { enabled: false, intervalMinutes: null, subsystems: [], topN: CONTENTION_TOP_N_DEFAULT, darkStreakRounds: DESIGN_EVOLUTION_DARK_STREAK_ROUNDS_DEFAULT },
      error: null
    };
  }
  let intervalMinutes = DESIGN_EVOLUTION_INTERVAL_MIN_DEFAULT;
  if (rec.interval !== void 0 && rec.interval !== null) {
    if (typeof rec.interval !== "string") {
      return { config: null, error: cfgBad(`'interval' must be a string of the form interval:<N>m (got ${JSON.stringify(rec.interval)})`) };
    }
    const m = /^interval:(\d+)m$/.exec(rec.interval);
    if (m === null) return { config: null, error: cfgBad(`'interval' must be interval:<N>m (got '${rec.interval}')`) };
    intervalMinutes = Number(m[1]);
    if (!Number.isFinite(intervalMinutes) || intervalMinutes < DESIGN_EVOLUTION_MIN_INTERVAL_MINUTES) {
      return { config: null, error: cfgBad(`interval ${rec.interval} is below the ${DESIGN_EVOLUTION_MIN_INTERVAL_MINUTES}m floor \u2014 refused, not silently rounded`) };
    }
  }
  let topN = CONTENTION_TOP_N_DEFAULT;
  if (rec.top_n !== void 0 && rec.top_n !== null) {
    if (typeof rec.top_n !== "number" || !Number.isInteger(rec.top_n) || rec.top_n < 1) {
      return { config: null, error: cfgBad(`'top_n' must be a positive integer (got ${JSON.stringify(rec.top_n)})`) };
    }
    topN = rec.top_n;
  }
  let darkStreakRounds = DESIGN_EVOLUTION_DARK_STREAK_ROUNDS_DEFAULT;
  if (rec.dark_streak_rounds !== void 0 && rec.dark_streak_rounds !== null) {
    if (typeof rec.dark_streak_rounds !== "number" || !Number.isInteger(rec.dark_streak_rounds) || rec.dark_streak_rounds < 1) {
      return { config: null, error: cfgBad(`'dark_streak_rounds' must be a positive integer (got ${JSON.stringify(rec.dark_streak_rounds)})`) };
    }
    darkStreakRounds = rec.dark_streak_rounds;
  }
  const subsystems = [];
  if (rec.subsystems !== void 0 && rec.subsystems !== null) {
    if (!Array.isArray(rec.subsystems)) return { config: null, error: cfgBad(`'subsystems' must be a list`) };
    for (const [i, entry] of rec.subsystems.entries()) {
      const parsed = parseSubsystemEntry(entry, i);
      if (parsed.error !== null || parsed.spec === null) return { config: null, error: parsed.error ?? cfgBad(`subsystems[${i}] is invalid`) };
      if (subsystems.some((s) => s.name === parsed.spec.name)) {
        return { config: null, error: cfgBad(`duplicate subsystem name '${parsed.spec.name}' \u2014 the carrier would carry two rows with one key`) };
      }
      subsystems.push(parsed.spec);
    }
  }
  return { config: { enabled: true, intervalMinutes, subsystems, topN, darkStreakRounds }, error: null };
}
function readDesignEvolutionConfig(workspaceRoot) {
  const file = path5.join(workspaceRoot, ".quay", "config.yml");
  let text;
  try {
    text = fs4.readFileSync(file, "utf8");
  } catch {
    return { present: false, config: null, error: null };
  }
  let parsed;
  try {
    parsed = (0, import_yaml.parse)(text);
  } catch (e) {
    return { present: true, config: null, error: `.quay/config.yml is not valid YAML \u2014 ${e.message}` };
  }
  const loop = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed.loop : void 0;
  if (loop === null || loop === void 0) return { present: false, config: null, error: null };
  if (typeof loop !== "object" || Array.isArray(loop)) return { present: true, config: null, error: "FAIL-CLOSED: .quay/config.yml 'loop:' must be a mapping" };
  const raw = loop.design_evolution_readings;
  if (raw === void 0 || raw === null) return { present: false, config: null, error: null };
  const { config, error } = parseDesignEvolutionSection(raw);
  return { present: true, config, error };
}
function readStandaloneSection(file) {
  let text;
  try {
    text = fs4.readFileSync(file, "utf8");
  } catch (e) {
    return { present: true, config: null, error: `--config ${file} is unreadable \u2014 ${e.message}` };
  }
  let parsed;
  try {
    parsed = (0, import_yaml.parse)(text);
  } catch (e) {
    return { present: true, config: null, error: `--config ${file} is not valid YAML \u2014 ${e.message}` };
  }
  const { config, error } = parseDesignEvolutionSection(parsed);
  return { present: true, config, error };
}
function renderHuman(record, findings = []) {
  const out = [];
  out.push(`design-evolution-readings  evaluated=${record.evaluated}  ts=${record.ts}`);
  if (record.reason !== null) out.push(`  reason: ${record.reason}`);
  const v = record.evolution;
  out.push("JUDGMENT \u2014 \u672C\u8F6E\u76F8\u5BF9\u4E0A\u4E00\u6761\u8BFB\u6570");
  if (v === void 0) {
    out.push("  (not taken \u2014 this record predates the judgment)");
  } else {
    out.push(`  state=${v.state}  prior=${v.priorTs ?? "(none)"}  priorState=${v.priorState}  darkStreakRounds=${v.darkStreakRounds}`);
    out.push(`  ${v.summary}`);
    if (v.reason !== null) out.push(`  reason: ${v.reason}`);
    for (const r of v.subsystems) {
      const d = r.deltaCentral === null ? "" : `  \u0394central=${r.deltaCentral >= 0 ? "+" : ""}${r.deltaCentral} \u0394nonCentral=${r.deltaNonCentral === null ? "?" : (r.deltaNonCentral >= 0 ? "+" : "") + r.deltaNonCentral} \u0394denominator=${r.deltaDenominator === null ? "?" : (r.deltaDenominator >= 0 ? "+" : "") + r.deltaDenominator}`;
      out.push(`    ${r.name}: ${r.state}${d}${r.sharePercent === null ? "" : `  netShare=${r.sharePercent}%`}${r.additionsSharePercent === null ? "" : ` additionsShare=${r.additionsSharePercent}%`}${r.reason === null ? "" : `  \u2014 ${r.reason}`}`);
    }
    out.push(`  findings: ${findings.length}`);
    for (const f of findings) out.push(`    ${f.key}  files=${f.files.length > 0 ? f.files.join(", ") : "(none)"}`);
  }
  out.push("RM1 \u2014 \u5206\u89E3\u540E\u589E\u91CF\u843D\u56DE\u4E2D\u5FC3\u6587\u4EF6\u7684\u5360\u6BD4    netShare = central\u0394 / (central\u0394 + nonCentral\u0394)    additionsShare = additions/(central+nonCentral additions)");
  if (record.rm1.subsystems.length === 0) out.push(`  (none declared) ${record.rm1.reason ?? ""}`);
  for (const s of record.rm1.subsystems) {
    if (!s.evaluated) {
      out.push(`  ${s.name}: NOT-EVALUATED \u2014 ${s.reason}`);
      continue;
    }
    const cp = s.centralDelta ?? 0;
    const np = s.nonCentralDelta ?? 0;
    const netPart = s.share === null ? `netShare=n/a (${s.shareReason ?? "no net reading"})` : `netShare=${s.sharePercentRounded}% (${s.sharePercent?.toFixed(2)}%)`;
    const addPart = s.additionsShare === null ? `additionsShare=n/a (${s.additionsReason ?? "no additions reading"})` : `additionsShare=${s.additionsSharePercent?.toFixed(2)}% (${s.additionsNumerator} / ${s.additionsDenominator})`;
    out.push(
      `  ${s.name}: central\u0394=${cp >= 0 ? "+" : ""}${cp} nonCentral\u0394=${np >= 0 ? "+" : ""}${np} ${netPart}  ${addPart}  [${s.baseline} \u2192 ${s.head} (${s.headSha?.slice(0, 9)}), ${s.moduleFileCount} module files]`
    );
    for (const c of s.centralFiles) {
      out.push(`    central ${c.atBaseline}${c.atHead !== c.atBaseline ? ` \u2192 ${c.atHead}` : ""}: ${c.baselineLines} \u2192 ${c.headLines} (${c.delta >= 0 ? "+" : ""}${c.delta})`);
    }
    const m = s.maxCentralChangeCommit;
    out.push(m === null ? "    largest central change in window: (unavailable)" : `    largest central change in window: ${m.sha.slice(0, 9)} central\u0394=${m.centralDelta >= 0 ? "+" : ""}${m.centralDelta} nonCentral\u0394=${m.nonCentralDelta >= 0 ? "+" : ""}${m.nonCentralDelta}`);
    if (s.oppositeSignCommits === null) out.push("    opposite-sign commits in window: (unavailable)");
    else if (s.oppositeSignCommits.length === 0) out.push("    opposite-sign commits in window: (none)");
    else {
      out.push(`    opposite-sign commits in window (central\u0394<0 \u2227 nonCentral\u0394>0): ${s.oppositeSignCommits.length}`);
      for (const c of s.oppositeSignCommits) {
        out.push(`      ${c.sha.slice(0, 9)} central\u0394=${c.centralDelta} nonCentral\u0394=+${c.nonCentralDelta}  ${c.subject}`);
      }
    }
  }
  out.push(`RM2 \u2014 \u70ED\u70B9\u6587\u4EF6\u5E76\u53D1\u4E89\u7528  carrier=${record.rm2.carrierPath}`);
  if (!record.rm2.evaluated) out.push(`  NOT-EVALUATED \u2014 ${record.rm2.reason}`);
  else {
    out.push(`  ${record.rm2.carrierRecords} records, window starts at #${record.rm2.windowStartIndex} (${record.rm2.windowSource}); predicate self-check ${record.rm2.predicateSelfCheck.ok ? "PASS" : "FAIL"}`);
    if (record.rm2.reason !== null) out.push(`  note: ${record.rm2.reason}`);
    for (const f of record.rm2.files) {
      out.push(`  ${f.file}: form1=${f.form1} form2=${f.form2} total=${f.total} (window ${f.windowTotal})`);
      out.push(`    observed: ${f.observedPaths.length > 0 ? f.observedPaths.join(", ") : "(none)"}`);
      for (const form of ["form1", "form2"]) {
        for (const smp of f.samples[form]) out.push(`    [${form}] #${smp.recordIndex} ${smp.task ?? "?"} ${smp.ts ?? "?"}`);
      }
    }
    if (record.rm2.unresolvedPaths.length > 0) {
      out.push(`  unresolved paths (\u26D4 not merged into any key): ${record.rm2.unresolvedPaths.length}`);
      for (const u of record.rm2.unresolvedPaths) out.push(`    ${u.raw} \u2014 ${u.reason}`);
    }
  }
  const ps = record.phaseStaleness;
  out.push(`PHASE-STALENESS (ADR-008 declaration, read-only; \u26D4 never a gate)`);
  if (!ps.evaluated) out.push(`  NOT-EVALUATED \u2014 ${ps.reason}`);
  else out.push(`  phase=${ps.phase} declaredAt=${ps.declaredAt} commits=${ps.commitsSince} newGoals=${ps.newGoalsSince?.length ?? 0} days=${ps.daysSince}`);
  return out.join("\n");
}
function main3(argv) {
  let rootArg;
  let configPath;
  let historyPath;
  let findingsPath;
  let carrierPath2;
  let head;
  let topN;
  let json = false;
  let noHistory = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") {
      rootArg = argv[++i];
      if (rootArg === void 0) {
        process.stderr.write(`design-evolution-readings: --root requires a path
${USAGE2}
`);
        return EXIT_USAGE;
      }
      continue;
    }
    if (a === "--config") {
      configPath = argv[++i];
      if (configPath === void 0) {
        process.stderr.write(`design-evolution-readings: --config requires a path
${USAGE2}
`);
        return EXIT_USAGE;
      }
      continue;
    }
    if (a === "--history") {
      historyPath = argv[++i];
      if (historyPath === void 0) {
        process.stderr.write(`design-evolution-readings: --history requires a path
${USAGE2}
`);
        return EXIT_USAGE;
      }
      continue;
    }
    if (a === "--findings") {
      findingsPath = argv[++i];
      if (findingsPath === void 0) {
        process.stderr.write(`design-evolution-readings: --findings requires a path
${USAGE2}
`);
        return EXIT_USAGE;
      }
      continue;
    }
    if (a === "--carrier") {
      carrierPath2 = argv[++i];
      if (carrierPath2 === void 0) {
        process.stderr.write(`design-evolution-readings: --carrier requires a path
${USAGE2}
`);
        return EXIT_USAGE;
      }
      continue;
    }
    if (a === "--head") {
      head = argv[++i];
      if (head === void 0) {
        process.stderr.write(`design-evolution-readings: --head requires a rev
${USAGE2}
`);
        return EXIT_USAGE;
      }
      continue;
    }
    if (a === "--top-n") {
      const raw = argv[++i];
      const n = raw === void 0 ? NaN : Number(raw);
      if (!Number.isInteger(n) || n < 1) {
        process.stderr.write(`design-evolution-readings: --top-n requires a positive integer
${USAGE2}
`);
        return EXIT_USAGE;
      }
      topN = n;
      continue;
    }
    if (a === "--json") {
      json = true;
      continue;
    }
    if (a === "--no-history") {
      noHistory = true;
      continue;
    }
    if (a.startsWith("--")) {
      process.stderr.write(`design-evolution-readings: unknown flag ${a}
${USAGE2}
`);
      return EXIT_USAGE;
    }
    if (rootArg !== void 0) {
      process.stderr.write(`design-evolution-readings: unexpected extra argument ${a}
${USAGE2}
`);
      return EXIT_USAGE;
    }
    rootArg = a;
  }
  const root = path5.resolve(rootArg ?? repoRoot());
  const section = configPath !== void 0 ? readStandaloneSection(configPath) : readDesignEvolutionConfig(root);
  if (section.error !== null) {
    process.stderr.write(`design-evolution-readings: ${section.error}
`);
    return EXIT_USAGE;
  }
  if (!section.present || section.config === null) {
    process.stderr.write(
      "design-evolution-readings: no design_evolution_readings section declared (neither --config nor .quay/config.yml). RM1 needs declared subsystems; RTFM the task body's config example.\n"
    );
    return EXIT_USAGE;
  }
  if (!section.config.enabled) {
    process.stderr.write("design-evolution-readings: enabled:false \u2014 kill switch engaged, zero reading, zero write\n");
    return EXIT_OK;
  }
  const taken = takeEvolutionRound(root, {
    subsystems: section.config.subsystems,
    topN: topN ?? section.config.topN,
    darkStreakRounds: section.config.darkStreakRounds,
    ...head ? { head } : {},
    ...historyPath ? { historyPath } : {},
    ...findingsPath ? { findingsPath } : {},
    ...carrierPath2 ? { carrierPath: carrierPath2 } : {},
    ...noHistory ? { persist: false } : {}
  });
  const { record } = taken;
  process.stdout.write((json ? JSON.stringify(record, null, 2) : renderHuman(record, taken.findings)) + "\n");
  if (!noHistory) {
    if (!taken.history.appended) {
      process.stderr.write(`design-evolution-readings: history carrier not writable at ${taken.history.path} \u2014 ${taken.history.error}
`);
      return EXIT_HISTORY_WRITE_FAILED;
    }
    process.stderr.write(`design-evolution-readings: record appended to ${taken.history.path}
`);
    if (!taken.findingsCarrier.ok) {
      process.stderr.write(
        `design-evolution-readings: findings carrier not writable at ${taken.findingsCarrier.path} \u2014 ${taken.findingsCarrier.error} (the reading landed; ${taken.findings.length} finding(s) did NOT)
`
      );
      return EXIT_FINDINGS_WRITE_FAILED;
    }
    if (taken.findingsCarrier.appended > 0) {
      process.stderr.write(`design-evolution-readings: ${taken.findingsCarrier.appended} finding(s) appended to ${taken.findingsCarrier.path}
`);
    }
  }
  return record.evaluated ? EXIT_OK : EXIT_NOT_EVALUATED;
}
if (isDirectEntry(import.meta, process.argv[1], "design-evolution-readings")) {
  process.exitCode = main3(process.argv.slice(2));
}

// packages/quay/src/kernel/touches-annotation.ts
function stripTrailingFullWidthAnnotation(s) {
  const t = s.trimEnd();
  const i = t.length - 1;
  if (t[i] !== "\uFF09") return s;
  let depth = 0;
  let open = -1;
  for (let j = i; j >= 0; j--) {
    const c = t[j];
    if (c === "\uFF09") depth++;
    else if (c === "\uFF08" && --depth === 0) {
      open = j;
      break;
    }
  }
  if (open === -1) return s;
  let k = open;
  while (k > 0 && /\s/.test(t[k - 1])) k--;
  return t.slice(0, k);
}
var TOUCH_PATH_TOKEN_RE = /^[^\s`'"()（）]+/;
var TOUCH_CONCRETE_PATH_RE = /\/|\.[A-Za-z0-9]{1,10}$/;
var TOUCH_ANNOTATION_HEAD_RE = /^[`'"（(]/;
function stripTouchAnnotation(entry) {
  const raw = String(entry);
  const t = raw.trim();
  const m = TOUCH_PATH_TOKEN_RE.exec(t);
  if (m && TOUCH_CONCRETE_PATH_RE.test(m[0])) {
    const tail = t.slice(m[0].length).replace(/^\s+/, "");
    if (tail && TOUCH_ANNOTATION_HEAD_RE.test(tail)) return m[0];
  }
  let s = raw.trimEnd();
  for (; ; ) {
    const before = s;
    s = stripTrailingFullWidthAnnotation(s);
    s = s.replace(/\s*\([^)]*\)\s*$/, "").trimEnd();
    if (s === before) break;
  }
  return s.trim();
}
var TOUCH_QUOTE_STRIP_RE = /^[`"']+|[`"']+$/g;
function stripTouchQuotes(entry) {
  return String(entry).replace(TOUCH_QUOTE_STRIP_RE, "").trim();
}
function normalizeTouchEntry(entry) {
  const stripped = stripTouchAnnotation(stripTouchQuotes(entry));
  const cleaned = stripTouchQuotes(stripped);
  return cleaned.replace(/^\.\//, "").trim();
}
function parseTouchBulletPaths(touchesSection) {
  if (!touchesSection) return [];
  return String(touchesSection).split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[-*]\s+/.test(l)).map((l) => l.replace(/^[-*]\s+/, "").trim()).map(normalizeTouchEntry).filter(Boolean);
}

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/touches-parser.ts
function extractTouchesSection(fullText) {
  const lines = String(fullText).split(/\r?\n/);
  const candidates = [];
  for (let i = 0; i < lines.length; i++) {
    const heading = lines[i].trimEnd().match(/^(#{1,6})\s+(.*)$/);
    if (!heading) continue;
    const text = heading[2].trim();
    if (/^touches\b/i.test(text)) candidates.push({ line: i, level: heading[1].length, text });
  }
  if (candidates.length === 0) {
    return { hasSection: false, section: "", heading: null, startLine: null, level: null };
  }
  const exact = candidates.filter((c) => c.text.toLowerCase() === "touches");
  const chosen = exact.length ? exact[0] : candidates.slice().sort((a, b) => a.level - b.level || a.line - b.line)[0];
  const out = [];
  for (let i = chosen.line + 1; i < lines.length; i++) {
    const line = lines[i].trimEnd();
    if (/^#{1,6}\s+/.test(line)) break;
    out.push(line);
  }
  return {
    hasSection: true,
    section: out.join("\n"),
    heading: chosen.text,
    startLine: chosen.line + 1,
    level: chosen.level
  };
}
if (isDirectEntry(import.meta, void 0, "touches-parser")) {
  process.stdout.write("Usage: touches-parser.ts is a shared module, not a CLI \u2014 import { parseTouchEntries, extractTouchesSection, stripTouchAnnotation } from it.\n");
}

// .tmp-dist-publish-worktrees/publish-CAeSy4/scripts/slice-readings.ts
var SLICE_READINGS_DIR_REL = path6.posix.join(".quay", "slice-readings");
var SLICE_READINGS_SCHEMA = "slice-readings-v1";
var METRIC_KEYS = Object.freeze([
  "centralFileLines",
  "centralFileBodyLines",
  "callOutDegree",
  "methodCount",
  "methodShellCount",
  "cycles",
  "centralChurnShare",
  "centralSlimRatio"
]);
var METRIC_BASIS = Object.freeze({
  centralFileLines: "git",
  centralFileBodyLines: "summary",
  callOutDegree: "summary",
  methodCount: "summary",
  methodShellCount: "summary",
  cycles: "summary",
  centralChurnShare: "git",
  centralSlimRatio: "git"
});
var fail2 = (reason) => ({ ok: false, reason });
function gitRead2(root, args) {
  try {
    const stdout = spawnSync2("git", ["-C", root, ...args], {
      encoding: "utf8",
      timeout: 6e4,
      maxBuffer: 256 * 1024 * 1024
    });
    if (stdout.status !== 0) {
      return { ok: false, stdout: "", error: (stdout.stderr || stdout.stdout || `git ${args[0]} exited ${stdout.status}`).trim() };
    }
    return { ok: true, stdout: stdout.stdout ?? "", error: null };
  } catch (e) {
    return { ok: false, stdout: "", error: e instanceof Error ? e.message : String(e) };
  }
}
function treeHead(tree) {
  const r = gitRead2(tree, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]);
  if (!r.ok || r.stdout.trim() === "") return fail2(`tree-head-unresolvable: git rev-parse HEAD failed in ${tree}${r.error ? ` \u2014 ${r.error}` : ""}`);
  return { ok: true, value: r.stdout.trim() };
}
function countLines(text) {
  return (text.match(/\n/g) ?? []).length;
}
function staticPrefix(glob) {
  const i = glob.search(/[*?]/);
  return i === -1 ? glob : glob.slice(0, i);
}
function deriveAnalyzeSource(spec) {
  const dirs = [];
  for (const c of spec.central) {
    dirs.push(path6.posix.dirname(c.atHead), path6.posix.dirname(c.atBaseline));
  }
  for (const m of spec.modules) {
    const pref = staticPrefix(m);
    const dir = pref.endsWith("/") ? pref.replace(/\/+$/, "") : path6.posix.dirname(pref);
    dirs.push(dir === "" ? "." : dir);
  }
  if (dirs.length === 0) return ".";
  const split = dirs.map((d) => d === "." ? [] : d.split("/").filter((s) => s !== ""));
  const first = split[0];
  let common = first.length;
  for (let i = 1; i < split.length; i++) {
    let n = 0;
    while (n < common && n < split[i].length && split[i][n] === first[n]) n++;
    common = n;
  }
  return common === 0 ? "." : first.slice(0, common).join("/");
}
function resolveScopeForTask(root, taskId, subsystems) {
  const taskFile = path6.join(root, "tasks", `${taskId}.md`);
  let text;
  try {
    text = fs5.readFileSync(taskFile, "utf8");
  } catch (e) {
    return fail2(`task-unreadable: ${taskFile} \u2014 ${e.message}`);
  }
  const declared = /^extra:[\s\S]*?^\s+slice_scope:\s*["']?([A-Za-z0-9_.-]+)["']?\s*$/m.exec(text);
  if (declared !== null) {
    const spec = subsystems.find((s) => s.name === declared[1]);
    if (spec === void 0) return fail2(`scope-undeclared: extra.slice_scope '${declared[1]}' is not a declared subsystem`);
    return {
      ok: true,
      value: { scope: spec.name, spec, taskFile: `tasks/${taskId}.md`, exactCentralMatches: 0, moduleGlobMatches: 0 }
    };
  }
  const { hasSection, section } = extractTouchesSection(text);
  if (!hasSection) return fail2(`touches-missing: ${taskFile} has no '## Touches' section \u2014 cannot pick a scope`);
  const touches = parseTouchBulletPaths(section);
  if (touches.length === 0) return fail2(`touches-empty: ${taskFile}'s '## Touches' yields no entries`);
  const touchSet = new Set(touches);
  let best = null;
  for (const spec of subsystems) {
    const central = spec.central.flatMap((c) => [c.atBaseline, c.atHead]);
    const centralSet = new Set(central);
    const moduleRes = spec.modules.map(globToRegExp);
    let exact = 0;
    let glob = 0;
    for (const t of touchSet) {
      if (centralSet.has(t)) exact++;
      if (moduleRes.some((re) => re.test(t))) glob++;
    }
    if (exact === 0 && glob === 0) continue;
    const candidate = {
      scope: spec.name,
      spec,
      taskFile: `tasks/${taskId}.md`,
      exactCentralMatches: exact,
      moduleGlobMatches: glob
    };
    if (best === null) best = candidate;
    else if (exact > best.exactCentralMatches || exact === best.exactCentralMatches && glob > best.moduleGlobMatches) {
      best = candidate;
    }
  }
  if (best === null) {
    return fail2(
      `no-subsystem-matches-task-touches: none of ${subsystems.map((s) => s.name).join(", ") || "(no subsystems declared)"} covers ${touches.join(", ")}`
    );
  }
  return { ok: true, value: best };
}
function discoverPluginCacheArchguard(pluginsRoot = defaultPluginsRoot()) {
  if (pluginsRoot === null) return fail2("plugin-cache-discovery: cannot locate the Claude plugins root (no $HOME)");
  const candidates = [];
  const entryRel = path6.join("@yalehwang", "archguard", "dist", "cli", "index.js");
  const hoisted = path6.join(pluginsRoot, "npm-cache", "node_modules", entryRel);
  if (fs5.existsSync(hoisted)) candidates.push(hoisted);
  const cacheDir = path6.join(pluginsRoot, "cache");
  let markets = [];
  try {
    markets = fs5.readdirSync(cacheDir);
  } catch {
    markets = [];
  }
  for (const market of markets) {
    const pluginDir = path6.join(cacheDir, market, "archguard");
    let versions = [];
    try {
      versions = fs5.readdirSync(pluginDir);
    } catch {
      continue;
    }
    versions.filter((v) => /^\d+\.\d+\.\d+/.test(v)).sort((a, b) => {
      const pa = a.split(".").map(Number);
      const pb = b.split(".").map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pb[i] ?? 0) - (pa[i] ?? 0);
        if (d !== 0) return d;
      }
      return a.localeCompare(b);
    }).forEach((v) => {
      const nested = path6.join(pluginDir, v, "node_modules", entryRel);
      if (fs5.existsSync(nested)) candidates.push(nested);
    });
  }
  if (candidates.length === 0) {
    return fail2(
      `archguard-cli-unresolvable: ARCHGUARD_RUNNER_CLI unset, no archguard on PATH, and no plugin-cache runtime under ${path6.join(pluginsRoot, "npm-cache", "node_modules", entryRel)} or ${cacheDir}/*/archguard/*/node_modules/${entryRel}`
    );
  }
  const cli = candidates[0];
  return { ok: true, value: { argv: [process.execPath, cli], display: cli, source: "plugin-cache" } };
}
function defaultPluginsRoot() {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  return home ? path6.join(home, ".claude", "plugins") : null;
}
function resolveArchguardCommand() {
  const explicit = (process.env.ARCHGUARD_RUNNER_CLI ?? "").trim();
  const viaRunner = resolveArchguardCli();
  if (viaRunner !== null) {
    return { ok: true, value: { argv: [viaRunner], display: viaRunner, source: "env-or-path" } };
  }
  if (explicit !== "") {
    return fail2(`archguard-cli-unresolvable: ARCHGUARD_RUNNER_CLI=${explicit} does not exist (explicit override is authoritative; not falling back)`);
  }
  return discoverPluginCacheArchguard();
}
function readArchguardVersion2(cmd) {
  const r = spawnSync2(cmd.argv[0], [...cmd.argv.slice(1), "--version"], { encoding: "utf8", timeout: 6e4 });
  if (r.status !== 0) return null;
  const first = String(r.stdout ?? "").trim().split("\n")[0].trim();
  return first === "" ? null : first;
}
function prepareAnalysisTree(opts) {
  if (!fs5.existsSync(opts.tree)) {
    return fail2(
      opts.treeExplicit ? `worktree-missing: ${opts.tree} does not exist \u2014 a post reading must be taken while the worktree is alive (\u26D4 never backfilled from the main checkout)` : `tree-missing: ${opts.tree} does not exist`
    );
  }
  const head = treeHead(opts.tree);
  if (head.ok && head.value === opts.headSha) {
    return { ok: true, value: { root: opts.tree, kind: "in-place", cleanup: () => {
    } } };
  }
  const tmp = fs5.mkdtempSync(path6.join(os2.tmpdir(), "slice-readings-tree-"));
  const add = gitRead2(opts.root, ["worktree", "add", "--detach", tmp, opts.headSha]);
  if (!add.ok) {
    fs5.rmSync(tmp, { recursive: true, force: true });
    return fail2(`temp-worktree-add-failed: git worktree add --detach ${opts.headSha} failed \u2014 ${add.error ?? "unknown"}`);
  }
  return {
    ok: true,
    value: {
      root: tmp,
      kind: "temp-worktree",
      cleanup: () => {
        const rm = gitRead2(opts.root, ["worktree", "remove", "--force", tmp]);
        if (!rm.ok) fs5.rmSync(tmp, { recursive: true, force: true });
      }
    }
  };
}
function runAnalyze2(cmd, analyzedRoot, source, label) {
  let workDir;
  try {
    workDir = fs5.mkdtempSync(path6.join(os2.tmpdir(), "slice-readings-archguard-"));
  } catch (e) {
    return fail2(`analyze-workdir-failed: ${e.message}`);
  }
  const outputDir = path6.join(workDir, "output", label.replace(/[^A-Za-z0-9_.-]/g, "_"));
  const r = spawnSync2(
    cmd.argv[0],
    [
      ...cmd.argv.slice(1),
      "analyze",
      "--lang",
      "typescript",
      "--format",
      "json",
      "--work-dir",
      workDir,
      "--output-dir",
      outputDir,
      "-s",
      source
    ],
    { cwd: analyzedRoot, encoding: "utf8", timeout: 20 * 6e4, maxBuffer: 64 * 1024 * 1024 }
  );
  const exit = r.status ?? 1;
  if (exit !== 0) {
    fs5.rmSync(workDir, { recursive: true, force: true });
    return fail2(
      `analyze-failed: archguard analyze exited ${exit} for source '${source}'${r.stderr ? ` \u2014 ${String(r.stderr).split("\n").slice(-3).join(" ").trim()}` : ""}`
    );
  }
  return { ok: true, value: { workDir, exit, stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? "") } };
}
function readScopeArch(workDir, analyzedRoot, source) {
  const queryDir = path6.join(workDir, "query");
  const manifestFile = path6.join(queryDir, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(fs5.readFileSync(manifestFile, "utf8"));
  } catch (e) {
    return fail2(`query-manifest-unreadable: ${manifestFile} \u2014 ${e.message}`);
  }
  const entries = Array.isArray(manifest?.scopes) ? manifest.scopes : [];
  const abs = path6.resolve(analyzedRoot, source);
  let real = abs;
  try {
    real = fs5.realpathSync(abs);
  } catch {
  }
  const norm = (p) => {
    if (typeof p !== "string") return "";
    try {
      return fs5.realpathSync(p);
    } catch {
      return path6.resolve(p);
    }
  };
  const matches = entries.filter(
    (e) => Array.isArray(e?.sources) && e.sources.some((s) => norm(s) === real || norm(s) === abs)
  );
  if (matches.length === 0) {
    return fail2(`query-scope-missing: manifest ${manifestFile} has no scope covering ${source} (analyzed ${entries.length} scope(s))`);
  }
  matches.sort((a, b) => String(b?.generatedAt ?? "").localeCompare(String(a?.generatedAt ?? "")));
  const key = matches[0]?.key;
  if (typeof key !== "string" || key === "") return fail2(`query-scope-missing-key: the matching scope in ${manifestFile} has no key`);
  const archFile = path6.join(queryDir, key, "arch.json");
  let arch;
  try {
    arch = JSON.parse(fs5.readFileSync(archFile, "utf8"));
  } catch (e) {
    return fail2(`query-artifact-unreadable: ${archFile} \u2014 ${e.message}`);
  }
  return { ok: true, value: { arch, scopeKey: key } };
}
function computeArchMetrics(analyzedRoot, centralFiles, arch) {
  if (arch === null || typeof arch !== "object") return fail2("artifact-not-an-object");
  if (!Array.isArray(arch.entities)) return fail2("artifact-has-no-entities-array");
  if (!Array.isArray(arch.relations)) return fail2("artifact-has-no-relations-array");
  const cyclesRaw = arch?.extensions?.tsAnalysis?.moduleGraph?.cycles;
  if (!Array.isArray(cyclesRaw)) {
    return fail2("artifact-has-no-moduleGraph-cycles: directory-level cycles are NOT evaluated (not '0 cycles')");
  }
  const byBase = /* @__PURE__ */ new Map();
  for (const rel of centralFiles) {
    const base = path6.posix.basename(rel);
    const arr = byBase.get(base);
    if (arr === void 0) byBase.set(base, [rel]);
    else arr.push(rel);
  }
  const sourceCache = /* @__PURE__ */ new Map();
  const linesFor = (rel) => {
    const cached = sourceCache.get(rel);
    if (cached !== void 0) return { ok: true, value: cached };
    try {
      const lines = fs5.readFileSync(path6.join(analyzedRoot, rel), "utf8").split("\n");
      sourceCache.set(rel, lines);
      return { ok: true, value: lines };
    } catch (e) {
      return fail2(`central-file-unreadable: ${rel} \u2014 ${e.message}`);
    }
  };
  const callableTypes = /* @__PURE__ */ new Set(["function", "method", "constructor"]);
  const callables = arch.entities.filter((e) => {
    if (e === null || typeof e !== "object" || !callableTypes.has(e.type)) return false;
    const file = typeof e?.sourceLocation?.file === "string" ? path6.posix.basename(e.sourceLocation.file) : "";
    return byBase.has(file);
  });
  let bodyLines = 0;
  let shells = 0;
  for (const e of callables) {
    const loc = e?.sourceLocation;
    const start = Number(loc?.startLine);
    const end = Number(loc?.endLine);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) {
      return fail2(`entity-missing-sourceLocation: ${String(e?.id ?? e?.name ?? "?")} \u2014 method metrics are NOT evaluated`);
    }
    const base = path6.posix.basename(loc.file);
    const rels = byBase.get(base) ?? [];
    const rel = rels[0];
    const lines = linesFor(rel);
    if (!lines.ok) return lines;
    const span = lines.value.slice(start - 1, end).join("\n");
    if (span.includes("{")) bodyLines += end - start + 1;
    else shells += 1;
  }
  const callableIds = new Set(callables.map((e) => e.id));
  const callEdges = /* @__PURE__ */ new Set();
  for (const r of arch.relations) {
    if (r === null || typeof r !== "object" || r.type !== "call") continue;
    if (!callableIds.has(r.source)) continue;
    callEdges.add(typeof r.id === "string" ? r.id : `${String(r.source)}\u2192${String(r.target)}`);
  }
  return {
    ok: true,
    value: {
      centralFileBodyLines: bodyLines,
      callOutDegree: callEdges.size,
      methodCount: callables.length,
      methodShellCount: shells,
      cycles: cyclesRaw.length
    }
  };
}
function computeGitShareMetrics(root, centralPaths, window) {
  const nullReasons = {};
  const centralSet = new Set(centralPaths);
  const diff = gitRead2(root, ["diff", "--numstat", "--no-renames", window.from, window.to]);
  if (!diff.ok) {
    nullReasons.centralChurnShare = `git-diff-unreadable: ${window.from}..${window.to} \u2014 ${diff.error ?? "unknown"}`;
    nullReasons.centralSlimRatio = nullReasons.centralChurnShare;
    return { centralChurnShare: null, centralSlimRatio: null, nullReasons };
  }
  let centralChanged = 0;
  let centralDeleted = 0;
  let allChanged = 0;
  for (const row of diff.stdout.split("\n")) {
    if (row.trim() === "") continue;
    const [ins, del, file] = row.split("	");
    if (file === void 0 || ins === "-" || del === "-") continue;
    const n = Number(ins) + Number(del);
    if (!Number.isFinite(n)) continue;
    allChanged += n;
    if (centralSet.has(file)) {
      centralChanged += n;
      centralDeleted += Number(del);
    }
  }
  const churnShare = allChanged > 0 ? centralChanged / allChanged : null;
  if (churnShare === null) nullReasons.centralChurnShare = `zero-changed-lines: ${window.from}..${window.to} has no line changes \u2014 a share of nothing is not a reading`;
  let beforeLines = 0;
  const fromPaths = listTrackedPaths(root, window.from);
  if (fromPaths === null) {
    nullReasons.centralSlimRatio = `central-tree-unreadable-at-window-start: git ls-tree failed at ${window.from}`;
  } else {
    const present = new Set(fromPaths);
    for (const rel of centralPaths) {
      const r = lineCountAt(root, window.from, rel, present);
      if (r.error !== null) {
        nullReasons.centralSlimRatio = `central-lines-unreadable-at-window-start: ${rel} \u2014 ${r.error}`;
        break;
      }
      beforeLines += r.lines ?? 0;
    }
  }
  const slimRatio = beforeLines > 0 && nullReasons.centralSlimRatio === void 0 ? centralDeleted / beforeLines : null;
  if (slimRatio === null && nullReasons.centralSlimRatio === void 0) {
    nullReasons.centralSlimRatio = `zero-central-lines-at-window-start: ${window.from} has 0 central lines \u2014 a ratio of nothing is not a reading`;
  }
  return { centralChurnShare: churnShare, centralSlimRatio: slimRatio, nullReasons };
}
var NULL_METRICS = Object.freeze({
  centralFileLines: null,
  centralFileBodyLines: null,
  callOutDegree: null,
  methodCount: null,
  methodShellCount: null,
  cycles: null,
  centralChurnShare: null,
  centralSlimRatio: null
});
function unevaluatedRecord(opts) {
  return {
    schema: SLICE_READINGS_SCHEMA,
    taskId: opts.taskId,
    phase: opts.phase,
    evaluated: false,
    reason: opts.reason,
    ts: (/* @__PURE__ */ new Date()).toISOString(),
    headSha: opts.headSha,
    baselineHeadSha: opts.baselineHeadSha,
    scope: opts.scope,
    scopeSpec: opts.scopeSpec ?? null,
    metricBasis: METRIC_BASIS,
    metrics: { ...NULL_METRICS },
    churnWindow: null,
    metricNullReasons: {},
    archguardCli: null,
    archguardVersion: null,
    analyzedTree: null,
    ...opts.phase === "post" ? { delta: null } : {}
  };
}
function takeReading(opts) {
  const tree = opts.tree ?? opts.root;
  const treeExplicit = opts.treeExplicit ?? false;
  const scopeSpec = {
    source: deriveAnalyzeSource(opts.spec),
    central: opts.spec.central.map((c) => ({ atBaseline: c.atBaseline, atHead: c.atHead })),
    modules: [...opts.spec.modules]
  };
  const baselineHeadSha = opts.phase === "post" ? opts.baseline?.headSha ?? null : null;
  if (treeExplicit && !fs5.existsSync(tree)) {
    return unevaluatedRecord({
      taskId: opts.taskId,
      phase: opts.phase,
      scope: opts.scopeName,
      headSha: null,
      baselineHeadSha,
      reason: `worktree-missing: ${tree} does not exist \u2014 a post reading must be taken while the worktree is alive (\u26D4 never backfilled from the main checkout)`,
      scopeSpec
    });
  }
  let headSha;
  if (opts.head !== void 0) {
    const headResolved = resolveCommit(opts.root, opts.head);
    if (headResolved.sha === null) {
      return unevaluatedRecord({
        taskId: opts.taskId,
        phase: opts.phase,
        scope: opts.scopeName,
        headSha: null,
        baselineHeadSha,
        reason: `head-unresolvable: ${opts.head} \u2014 ${headResolved.error ?? "does not resolve"}`,
        scopeSpec
      });
    }
    headSha = headResolved.sha;
  } else {
    const headOfTree = treeHead(tree);
    if (!headOfTree.ok) {
      return unevaluatedRecord({
        taskId: opts.taskId,
        phase: opts.phase,
        scope: opts.scopeName,
        headSha: null,
        baselineHeadSha,
        reason: headOfTree.reason,
        scopeSpec
      });
    }
    headSha = headOfTree.value;
  }
  if (opts.phase === "post" && opts.baseline !== null && opts.baseline !== void 0 && opts.baseline.scopeSpec !== null) {
    const a = JSON.stringify(opts.baseline.scopeSpec);
    const b = JSON.stringify(scopeSpec);
    if (a !== b) {
      return unevaluatedRecord({
        taskId: opts.taskId,
        phase: opts.phase,
        scope: opts.scopeName,
        headSha,
        baselineHeadSha,
        reason: `scope-declaration-changed: baseline snapshot ${a} vs current ${b} \u2014 same caliber is required`,
        scopeSpec
      });
    }
  }
  const treeRes = prepareAnalysisTree({ root: opts.root, tree, treeExplicit, headSha });
  if (!treeRes.ok) {
    return unevaluatedRecord({
      taskId: opts.taskId,
      phase: opts.phase,
      scope: opts.scopeName,
      headSha,
      baselineHeadSha,
      reason: treeRes.reason,
      scopeSpec
    });
  }
  const analysisTree = treeRes.value;
  try {
    const cmdRes = opts.archguard !== void 0 ? { ok: true, value: opts.archguard } : resolveArchguardCommand();
    if (!cmdRes.ok) {
      return unevaluatedRecord({
        taskId: opts.taskId,
        phase: opts.phase,
        scope: opts.scopeName,
        headSha,
        baselineHeadSha,
        reason: cmdRes.reason,
        scopeSpec
      });
    }
    const cmd = cmdRes.value;
    const version = readArchguardVersion2(cmd);
    const analyze = runAnalyze2(cmd, analysisTree.root, scopeSpec.source, opts.scopeName);
    if (!analyze.ok) {
      return unevaluatedRecord({
        taskId: opts.taskId,
        phase: opts.phase,
        scope: opts.scopeName,
        headSha,
        baselineHeadSha,
        reason: analyze.reason,
        scopeSpec
      });
    }
    try {
      const artifact = readScopeArch(analyze.value.workDir, analysisTree.root, scopeSpec.source);
      if (!artifact.ok) {
        return unevaluatedRecord({
          taskId: opts.taskId,
          phase: opts.phase,
          scope: opts.scopeName,
          headSha,
          baselineHeadSha,
          reason: artifact.reason,
          scopeSpec
        });
      }
      const headPaths = centralPathsAt(analysisTree.root, opts.spec, "head");
      if (!headPaths.ok) {
        return unevaluatedRecord({
          taskId: opts.taskId,
          phase: opts.phase,
          scope: opts.scopeName,
          headSha,
          baselineHeadSha,
          reason: headPaths.reason,
          scopeSpec
        });
      }
      const centralFiles = headPaths.value;
      const archMetrics = computeArchMetrics(analysisTree.root, centralFiles, artifact.value.arch);
      if (!archMetrics.ok) {
        return unevaluatedRecord({
          taskId: opts.taskId,
          phase: opts.phase,
          scope: opts.scopeName,
          headSha,
          baselineHeadSha,
          reason: `archguard-metrics-unevaluated: ${archMetrics.reason}`,
          scopeSpec
        });
      }
      let centralFileLines = 0;
      for (const rel of centralFiles) {
        try {
          centralFileLines += countLines(fs5.readFileSync(path6.join(analysisTree.root, rel), "utf8"));
        } catch (e) {
          return unevaluatedRecord({
            taskId: opts.taskId,
            phase: opts.phase,
            scope: opts.scopeName,
            headSha,
            baselineHeadSha,
            reason: `central-file-unreadable: ${rel} \u2014 ${e.message}`,
            scopeSpec
          });
        }
      }
      const window = churnWindowFor(opts.root, headSha);
      const allCentral = [...new Set(opts.spec.central.flatMap((c) => [c.atBaseline, c.atHead]))];
      const shares = window === null ? {
        centralChurnShare: null,
        centralSlimRatio: null,
        nullReasons: { centralChurnShare: `window-unresolvable: ${headSha} has no parent commit`, centralSlimRatio: `window-unresolvable: ${headSha} has no parent commit` }
      } : computeGitShareMetrics(opts.root, allCentral, window);
      const metrics = {
        centralFileLines,
        centralFileBodyLines: archMetrics.value.centralFileBodyLines,
        callOutDegree: archMetrics.value.callOutDegree,
        methodCount: archMetrics.value.methodCount,
        methodShellCount: archMetrics.value.methodShellCount,
        cycles: archMetrics.value.cycles,
        centralChurnShare: shares.centralChurnShare,
        centralSlimRatio: shares.centralSlimRatio
      };
      const record = {
        schema: SLICE_READINGS_SCHEMA,
        taskId: opts.taskId,
        phase: opts.phase,
        evaluated: true,
        reason: null,
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        headSha,
        baselineHeadSha,
        scope: opts.scopeName,
        scopeSpec,
        metricBasis: METRIC_BASIS,
        metrics,
        churnWindow: window,
        metricNullReasons: shares.nullReasons,
        archguardCli: cmd.display,
        archguardVersion: version,
        analyzedTree: { kind: analysisTree.kind, path: analysisTree.root }
      };
      if (opts.phase === "post") {
        record.delta = computeDelta(metrics, opts.baseline?.metrics ?? null);
      }
      return record;
    } finally {
      fs5.rmSync(analyze.value.workDir, { recursive: true, force: true });
    }
  } finally {
    analysisTree.cleanup();
  }
}
function centralPathsAt(analyzedRoot, spec, _end) {
  const out = [];
  for (const c of spec.central) {
    if (fs5.existsSync(path6.join(analyzedRoot, c.atHead))) out.push(c.atHead);
    else if (fs5.existsSync(path6.join(analyzedRoot, c.atBaseline))) out.push(c.atBaseline);
    else {
      return fail2(
        `central-file-absent: neither '${c.atHead}' nor '${c.atBaseline}' exists in the analyzed tree ${analyzedRoot}`
      );
    }
  }
  return { ok: true, value: out };
}
function churnWindowFor(root, headSha) {
  const parent = gitRead2(root, ["rev-parse", "--verify", "--quiet", `${headSha}^{commit}^`]);
  if (!parent.ok || parent.stdout.trim() === "") return null;
  return { from: parent.stdout.trim(), to: headSha };
}
function computeDelta(post, baseline) {
  const out = {};
  for (const k of METRIC_KEYS) {
    const p = post[k];
    const b = baseline === null ? null : baseline[k];
    out[k] = typeof p === "number" && typeof b === "number" ? normalizeZero(p - b) : null;
  }
  return out;
}
function normalizeZero(n) {
  return Object.is(n, -0) ? 0 : n;
}
function carrierPathFor(root, taskId) {
  return path6.join(root, SLICE_READINGS_DIR_REL, `${taskId}.json`);
}
function readCarrier2(file) {
  let text;
  try {
    text = fs5.readFileSync(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return { ok: true, value: null };
    return fail2(`carrier-unreadable: ${file} \u2014 ${e.message}`);
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object") return fail2(`carrier-malformed: ${file} is not an object`);
    return { ok: true, value: parsed };
  } catch (e) {
    return fail2(`carrier-malformed: ${file} is not valid JSON \u2014 ${e.message}`);
  }
}
function writeCarrier(file, doc) {
  try {
    fs5.mkdirSync(path6.dirname(file), { recursive: true });
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
    fs5.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}
`);
    fs5.renameSync(tmp, file);
    return { ok: true, value: file };
  } catch (e) {
    return fail2(`carrier-write-failed: ${file} \u2014 ${e.message}`);
  }
}
var EXIT_OK2 = 0;
var EXIT_USAGE2 = 2;
var EXIT_NOT_EVALUATED2 = 3;
var EXIT_CARRIER_WRITE_FAILED = 4;
var USAGE3 = `usage: slice-readings --baseline --task-id <id> [--scope <subsystem>] [--head <rev>]
                               [--root <repo>] [--tree <path>] [--config <section.yml>] [--json]
       slice-readings --post --task-id <id> [--head <rev>]
                               [--root <repo>] [--tree <path>] [--config <section.yml>] [--json]

  --baseline  write the dispatch-time reading into <root>/${SLICE_READINGS_DIR_REL}/<taskId>.json
              (scope auto-resolves from the task's ## Touches when --scope is omitted)
  --post      read that baseline, take the same scope/caliber again, write post + per-metric delta

  exit 0 = evaluated:true   exit 3 = NOT-EVALUATED (a distinct value, not "failed")
  exit 4 = carrier not writable   exit 2 = usage / input error`;
function parseArgs3(argv) {
  const parsed = parseArgs(["node", "slice-readings.ts", ...argv], {
    minArgs: 0,
    usage: "--baseline|--post --task-id <id> [--scope <name>] [--head <rev>] [--root <dir>] [--tree <dir>] [--config <file>] [--json]",
    help: "return",
    errors: "return",
    unknown: "reject",
    flags: {
      baseline: { type: "boolean" },
      post: { type: "boolean" },
      "task-id": { type: "string" },
      scope: { type: "string" },
      head: { type: "string" },
      root: { type: "string" },
      tree: { type: "string" },
      config: { type: "string" },
      json: { type: "boolean" }
    }
  });
  if (parsed.help) return fail2("help");
  if (parsed.error) return fail2(parsed.error);
  if (parsed.args.length > 0) return fail2(`unexpected argument ${parsed.args[0]}`);
  const baseline = parsed.flags.baseline === true;
  const post = parsed.flags.post === true;
  if (baseline && post) return fail2("both --baseline and --post given (exactly one phase per invocation)");
  const phase = baseline ? "baseline" : post ? "post" : null;
  const str = (v) => typeof v === "string" ? v : void 0;
  if (phase === null) return fail2("one of --baseline / --post is required");
  const taskId = str(parsed.flags["task-id"]);
  if (taskId === void 0 || taskId === "") return fail2("--task-id requires a non-empty id");
  const scope = str(parsed.flags.scope);
  if (scope === "") return fail2("--scope requires a non-empty subsystem name");
  const head = str(parsed.flags.head);
  if (head === "") return fail2("--head requires a rev");
  const root = str(parsed.flags.root);
  if (root === "") return fail2("--root requires a path");
  const tree = str(parsed.flags.tree);
  if (tree === "") return fail2("--tree requires a path");
  const configPath = str(parsed.flags.config);
  if (configPath === "") return fail2("--config requires a path");
  return {
    ok: true,
    value: {
      phase,
      taskId,
      scope,
      head,
      root,
      tree,
      treeExplicit: tree !== void 0,
      configPath,
      json: parsed.flags.json === true
    }
  };
}
function loadSubsystems(root, configPath) {
  const section = configPath !== void 0 ? readStandaloneSection(configPath) : readDesignEvolutionConfig(root);
  if (section.error !== null) return fail2(`config-error: ${section.error}`);
  if (!section.present || section.config === null) {
    return fail2(
      "no-subsystems-declared: neither --config nor .quay/config.yml loop.design_evolution_readings declares a subsystem \u2014 a slice reading needs an explicit scope"
    );
  }
  if (!section.config.enabled) return fail2("config-disabled: loop.design_evolution_readings.enabled=false \u2014 kill switch engaged");
  if (section.config.subsystems.length === 0) return fail2("no-subsystems-declared: loop.design_evolution_readings.subsystems is empty");
  return { ok: true, value: section.config.subsystems };
}
function main4(argv) {
  const parsed = parseArgs3(argv);
  if (!parsed.ok) {
    if (parsed.reason === "help") {
      process.stdout.write(`${USAGE3}
`);
      return EXIT_OK2;
    }
    process.stderr.write(`slice-readings: ${parsed.reason}
${USAGE3}
`);
    return EXIT_USAGE2;
  }
  const args = parsed.value;
  const root = path6.resolve(args.root ?? repoRoot());
  const tree = args.tree !== void 0 ? path6.resolve(args.tree) : root;
  const carrierFile = carrierPathFor(root, args.taskId);
  const subsystems = loadSubsystems(root, args.configPath);
  if (!subsystems.ok) {
    process.stderr.write(`slice-readings: ${subsystems.reason}
`);
    return EXIT_USAGE2;
  }
  const existing = readCarrier2(carrierFile);
  if (!existing.ok) {
    process.stderr.write(`slice-readings: ${existing.reason}
`);
    return EXIT_USAGE2;
  }
  if (args.phase === "baseline") {
    let scopeName;
    let spec2;
    if (args.scope !== void 0) {
      const found = subsystems.value.find((s) => s.name === args.scope);
      if (found === void 0) {
        process.stderr.write(`slice-readings: scope-undeclared: '${args.scope}' is not in ${subsystems.value.map((s) => s.name).join(", ")}
`);
        return EXIT_USAGE2;
      }
      spec2 = found;
      scopeName = found.name;
    } else {
      const resolved = resolveScopeForTask(root, args.taskId, subsystems.value);
      if (!resolved.ok) {
        process.stderr.write(`slice-readings: ${resolved.reason}
`);
        return EXIT_USAGE2;
      }
      spec2 = resolved.value.spec;
      scopeName = resolved.value.scope;
    }
    const record2 = takeReading({
      root,
      tree,
      treeExplicit: args.treeExplicit,
      taskId: args.taskId,
      phase: "baseline",
      spec: spec2,
      scopeName,
      ...args.head !== void 0 ? { head: args.head } : {}
    });
    const doc = {
      schema: SLICE_READINGS_SCHEMA,
      taskId: args.taskId,
      scope: scopeName,
      baseline: record2,
      post: null,
      delta: null
    };
    const wrote2 = writeCarrier(carrierFile, doc);
    if (!wrote2.ok) {
      process.stderr.write(`slice-readings: ${wrote2.reason}
`);
      return EXIT_CARRIER_WRITE_FAILED;
    }
    process.stdout.write((args.json ? JSON.stringify(record2, null, 2) : renderHuman2(record2)) + "\n");
    return record2.evaluated ? EXIT_OK2 : EXIT_NOT_EVALUATED2;
  }
  if (existing.value === null || existing.value.baseline === null) {
    const record2 = unevaluatedRecord({
      taskId: args.taskId,
      phase: "post",
      scope: args.scope ?? existing.value?.scope ?? "unknown",
      headSha: null,
      baselineHeadSha: null,
      reason: `baseline-missing: ${carrierFile} has no baseline \u2014 a post without a baseline cannot be bound`
    });
    const wrote2 = writeCarrier(carrierFile, {
      schema: SLICE_READINGS_SCHEMA,
      taskId: args.taskId,
      scope: record2.scope,
      baseline: null,
      post: record2,
      delta: null
    });
    if (!wrote2.ok) {
      process.stderr.write(`slice-readings: ${wrote2.reason}
`);
      return EXIT_CARRIER_WRITE_FAILED;
    }
    process.stdout.write((args.json ? JSON.stringify(record2, null, 2) : renderHuman2(record2)) + "\n");
    return EXIT_NOT_EVALUATED2;
  }
  const baseline = existing.value.baseline;
  const spec = subsystems.value.find((s) => s.name === baseline.scope);
  if (spec === void 0) {
    const record2 = unevaluatedRecord({
      taskId: args.taskId,
      phase: "post",
      scope: baseline.scope,
      headSha: null,
      baselineHeadSha: baseline.headSha,
      reason: `scope-undeclared: the baseline's scope '${baseline.scope}' is no longer declared \u2014 cannot re-read the same caliber`,
      scopeSpec: baseline.scopeSpec
    });
    const wrote2 = writeCarrier(carrierFile, {
      schema: SLICE_READINGS_SCHEMA,
      taskId: args.taskId,
      scope: baseline.scope,
      baseline,
      post: record2,
      delta: null
    });
    if (!wrote2.ok) {
      process.stderr.write(`slice-readings: ${wrote2.reason}
`);
      return EXIT_CARRIER_WRITE_FAILED;
    }
    process.stdout.write((args.json ? JSON.stringify(record2, null, 2) : renderHuman2(record2)) + "\n");
    return EXIT_NOT_EVALUATED2;
  }
  const record = takeReading({
    root,
    tree,
    treeExplicit: args.treeExplicit,
    taskId: args.taskId,
    phase: "post",
    spec,
    scopeName: baseline.scope,
    baseline,
    ...args.head !== void 0 ? { head: args.head } : {}
  });
  const delta = record.delta ?? null;
  const wrote = writeCarrier(carrierFile, {
    schema: SLICE_READINGS_SCHEMA,
    taskId: args.taskId,
    scope: baseline.scope,
    baseline,
    post: record,
    delta
  });
  if (!wrote.ok) {
    process.stderr.write(`slice-readings: ${wrote.reason}
`);
    return EXIT_CARRIER_WRITE_FAILED;
  }
  process.stdout.write((args.json ? JSON.stringify(record, null, 2) : renderHuman2(record)) + "\n");
  return record.evaluated ? EXIT_OK2 : EXIT_NOT_EVALUATED2;
}
function renderHuman2(r) {
  const out = [];
  out.push(`slice-readings ${r.phase}  evaluated=${r.evaluated}  task=${r.taskId}  scope=${r.scope}`);
  out.push(`  head=${r.headSha ?? "(unresolved)"}${r.baselineHeadSha !== null ? `  baselineHead=${r.baselineHeadSha}` : ""}`);
  if (r.reason !== null) out.push(`  reason: ${r.reason}`);
  for (const k of METRIC_KEYS) {
    const v = r.metrics[k];
    const why = r.metricNullReasons[k];
    out.push(`  ${k}=${v === null ? "null" : String(v)}  [${r.metricBasis[k]}]${v === null && why ? ` \u2014 ${why}` : ""}`);
  }
  if (r.churnWindow !== null) out.push(`  churnWindow=${r.churnWindow.from}..${r.churnWindow.to}`);
  if (r.delta !== void 0 && r.delta !== null) {
    for (const k of METRIC_KEYS) out.push(`  \u0394${k}=${r.delta[k] === null ? "null" : String(r.delta[k])}`);
  }
  return out.join("\n");
}
if (isDirectEntry(import.meta, process.argv[1], "slice-readings")) {
  process.exitCode = main4(process.argv.slice(2));
}
export {
  EXIT_CARRIER_WRITE_FAILED,
  EXIT_NOT_EVALUATED2 as EXIT_NOT_EVALUATED,
  EXIT_OK2 as EXIT_OK,
  EXIT_USAGE2 as EXIT_USAGE,
  METRIC_BASIS,
  METRIC_KEYS,
  SLICE_READINGS_DIR_REL,
  SLICE_READINGS_SCHEMA,
  carrierPathFor,
  churnWindowFor,
  computeArchMetrics,
  computeDelta,
  computeGitShareMetrics,
  countLines,
  deriveAnalyzeSource,
  discoverPluginCacheArchguard,
  main4 as main,
  prepareAnalysisTree,
  readArchguardVersion2 as readArchguardVersion,
  readCarrier2 as readCarrier,
  readScopeArch,
  resolveArchguardCommand,
  resolveScopeForTask,
  runAnalyze2 as runAnalyze,
  takeReading,
  treeHead,
  writeCarrier
};
