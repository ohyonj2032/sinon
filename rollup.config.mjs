import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import fs from "node:fs";
import path from "node:path";

function getAllFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            getAllFiles(filePath, fileList);
        } else if (filePath.endsWith(".js")) {
            fileList.push(path.normalize(filePath));
        }
    }
    return fileList;
}

const SRC_ROOT = path.resolve("src");
const SINON_ESM_SRC = path.normalize("src/sinon-esm.js");

// ---------------------------------------------------------------------------
// External resolution
//
// We keep the same resolver logic as before — bare specifiers (npm modules)
// are external; relative/absolute paths that live inside `src/` are bundled
// together; relative paths outside `src/` are left as external. The one
// deliberate exception: the ESM proxy wrapper explicitly keeps `./sinon.js`
// (and friends) external so it does NOT re-bundle the whole CJS core.
// ---------------------------------------------------------------------------
function makeExternalResolver(extraExternalRelativePaths = []) {
    const extraSet = new Set(extraExternalRelativePaths);
    return function isExternal(id, parentId) {
        if (id.startsWith("node:")) {
            return true;
        }

        // Allow the ESM proxy to keep its one `./sinon.js` relative import
        // external. This is what makes the proxy *thin*.
        if (extraSet.has(id)) {
            return true;
        }

        let resolvedPath;
        if (id.startsWith("src/")) {
            resolvedPath = path.resolve(process.cwd(), id);
        } else if (path.isAbsolute(id)) {
            resolvedPath = id;
        } else if (id.startsWith(".")) {
            resolvedPath = parentId
                ? path.resolve(path.dirname(parentId), id)
                : path.resolve(process.cwd(), id);
        } else {
            // Named imports (node_modules) are external.
            return true;
        }

        if (resolvedPath.startsWith(SRC_ROOT)) {
            if (!parentId) {
                return false;
            }
            const exists =
                fs.existsSync(resolvedPath) ||
                fs.existsSync(`${resolvedPath}.js`) ||
                fs.existsSync(`${resolvedPath}.mjs`);
            return !exists;
        }

        return true;
    };
}

// ---------------------------------------------------------------------------
// Output 1 — CJS core (lib/*)
//
// Everything under `src/sinon/**` plus `src/create-sinon-api.js` and
// `src/sinon.js` is compiled to CommonJS. These files carry mutable shared
// state (the Sandbox collections, `wrapMethod` markers), so they must remain
// "single-instance" inside the compiled `lib/` tree. `build.cjs` later
// consumes `./lib/sinon.js` with `require(...)` and produces the UMD bundles.
// ---------------------------------------------------------------------------
const cjsCore = {
    input: getAllFiles("src").filter((f) => f !== SINON_ESM_SRC),
    output: {
        dir: "lib",
        format: "cjs",
        preserveModules: true,
        preserveModulesRoot: "src",
        // `sinon` exposes both default and named exports. Rollup must not
        // drop either, so we keep `exports: "auto"`.
        exports: "auto",
        interop: "auto",
    },
    plugins: [nodeResolve(), commonjs(), json()],
    external: makeExternalResolver(),
};

// ---------------------------------------------------------------------------
// Output 2 — ESM Proxy wrapper (lib/sinon-esm.js)
//
// `src/sinon-esm.js` is a thin re-export module. Critically it keeps
// `./sinon.js` (and therefore the whole CJS core) external, which means
// Rollup emits a tiny ESM file that downstream bundlers can tree-shake.
//
// The compiled file is placed in `lib/` on purpose: from there a relative
// `./sinon.js` resolves to the compiled CJS core at `lib/sinon.js`, which
// is exactly what Node.js loads via `module.createRequire(import.meta.url)`
// when the consumer imports the ESM entrypoint. That CJS core in turn
// constructs the default sandbox through `globalThis`-rooted storage in
// `src/create-sinon-api.js`, so CJS and ESM consumers always share the
// same instance.
// ---------------------------------------------------------------------------
const esmWrapper = {
    input: "src/sinon-esm.js",
    output: {
        file: "lib/sinon-esm.js",
        format: "esm",
        sourcemap: false,
    },
    // Keep `./sinon.js` external so we don't re-bundle the CJS core.
    external: makeExternalResolver(["./sinon.js"]),
    plugins: [json()],
    // Tree-shake hint for bundlers that consume this file as a library.
    moduleSideEffects: false,
};

export default [cjsCore, esmWrapper];
