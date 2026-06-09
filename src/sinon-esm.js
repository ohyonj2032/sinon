// Thin ESM proxy wrapper for Sinon.
//
// This file is compiled to `lib/sinon-esm.js` by Rollup and advertised as
// the ESM entrypoint via `package.json#exports`. It has two jobs:
//
// 1. Be a tiny, tree-shake-friendly re-export surface. The only code that
//    runs at top-level is a `createRequire` call and a `default` export of
//    the already-initialised core object — bundlers (Webpack, Vite, esbuild,
//    Rollup) treat this as "no side effects" when combined with the
//    `package.json#sideEffects: false` hint, and can dead-code-elide any
//    named-export subset the consumer does not touch.
//
// 2. Defeat the "double-package trap". When the same Node process loads
//    `sinon` via both `require('sinon')` and `import 'sinon'` we would
//    otherwise end up with two independent module graphs and therefore two
//    unrelated default sandboxes. Instead we *always* delegate to the
//    already-built CJS core at `./sinon.js` using `module.createRequire`,
//    which forces both entrypoints to share the same module instance.
//    `create-sinon-api.js` then roots that single instance in `globalThis`
//    as a final safety net.

// `module` is a CommonJS object even in ESM files evaluated by Node.js when
// `createRequire` is used (Node injects a shim). In pure-browser builds the
// bundler sees this branch as dead code and elides it automatically.
const nodeRequire =
    typeof module !== "undefined" &&
    module !== null &&
    typeof module.createRequire === "function"
        ? module.createRequire(import.meta.url)
        : null;

let core;
if (nodeRequire) {
    // Node.js ESM: reuse the same CJS module. `./sinon.js` resolves to the
    // Rollup-compiled `lib/sinon.js` because this file itself lives in
    // `lib/`.
    core = nodeRequire("./sinon.js");
} else {
    // Pure-browser / bundler fallback — handled statically below via
    // `export { default, ... } from './sinon.js'`. The bundler resolves
    // `./sinon.js` through the package `exports` map.
    core = await import("./sinon.js");
}

// `createApi()` returns a plain object; `lib/sinon.js` exposes it as both a
// default export and as `module.exports`. Unwrap the ESM namespace form in
// the pure-browser path.
const sinon = core && typeof core === "object" && core.default ? core.default : core;

export default sinon;

// Named re-exports — kept static so bundlers can see them. We explicitly
// list everything the CJS core is known to expose; any property added to
// the default sandbox at runtime remains reachable through `sinon.*`.
//
// NOTE: These accessors are evaluated lazily by the consumer and forward
// through to the shared default sandbox, so `sinon.stub`, `sinon.restore`,
// etc. all operate on the same instance whether you arrived here via CJS
// or ESM.
export const stub = sinon.stub;
export const spy = sinon.spy;
export const fake = sinon.fake;
export const mock = sinon.mock;
export const createSandbox = sinon.createSandbox;
export const createStubInstance = sinon.createStubInstance;
export const restoreObject = sinon.restoreObject;
export const addBehavior = sinon.addBehavior;
export const match = sinon.match;
export const timers = sinon.timers;
export const promise = sinon.promise;
export const expectation = sinon.expectation;
