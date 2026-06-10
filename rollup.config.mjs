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

const srcPath = path.resolve(process.cwd(), "src");

const proxyLayerModules = [
    "src/sinon/proxy.js",
    "src/sinon/proxy-call.js",
    "src/sinon/proxy-call-util.js",
    "src/sinon/proxy-invoke.js",
    "src/sinon/spy-formatters.js",
];

const pureModulesNoSideEffects = [
    "src/sinon/proxy.js",
    "src/sinon/proxy-call.js",
    "src/sinon/proxy-call-util.js",
    "src/sinon/spy-formatters.js",
    "src/sinon/colorizer.js",
    "src/sinon/collect-own-methods.js",
    "src/sinon/throw-on-falsy-object.js",
    "src/sinon/restore-object.js",
    "src/sinon/promise.js",
    "src/sinon/mock-expectation.js",
    "src/sinon/util/core/extend.js",
    "src/sinon/util/core/get-property-descriptor.js",
    "src/sinon/util/core/function-to-string.js",
    "src/sinon/util/core/is-non-existent-property.js",
    "src/sinon/util/core/is-es-module.js",
    "src/sinon/util/core/is-restorable.js",
    "src/sinon/util/core/sinon-type.js",
    "src/sinon/util/core/walk.js",
    "src/sinon/util/core/walk-object.js",
    "src/sinon/util/core/times-in-words.js",
    "src/sinon/util/core/export-async-behaviors.js",
    "src/sinon/util/core/is-property-configurable.js",
];

function createExternal(id, parentId) {
    if (id.startsWith("node:")) {
        return true;
    }

    let resolvedPath;
    if (id.startsWith("src/")) {
        resolvedPath = path.resolve(process.cwd(), id);
    } else if (path.isAbsolute(id)) {
        resolvedPath = id;
    } else if (id.startsWith(".")) {
        resolvedPath = path.resolve(
            parentId ? path.dirname(parentId) : ".",
            id,
        );
    } else {
        return true;
    }

    if (resolvedPath.startsWith(srcPath)) {
        if (!parentId) {
            return false;
        }

        const exists =
            fs.existsSync(resolvedPath) ||
            fs.existsSync(`${resolvedPath}.js`) ||
            fs.existsSync(`${resolvedPath}.mjs`);

        if (exists) {
            return false;
        }

        return true;
    }

    return true;
}

export default [
    {
        input: getAllFiles("src"),
        output: {
            dir: "lib",
            format: "cjs",
            preserveModules: true,
            preserveModulesRoot: "src",
            exports: "auto",
            interop: "auto",
            generatedCode: {
                constBindings: true,
            },
        },
        plugins: [nodeResolve(), commonjs(), json()],
        treeshake: {
            preset: "recommended",
            moduleSideEffects: (id) => {
                const normalizedId = path
                    .relative(process.cwd(), id)
                    .replace(/\\/g, "/");

                if (
                    pureModulesNoSideEffects.some(
                        (mod) => normalizedId === mod || normalizedId.endsWith(`/${mod}`),
                    )
                ) {
                    return false;
                }

                return true;
            },
        },
        external: createExternal,
    },

    {
        input: proxyLayerModules.map((mod) =>
            path.resolve(process.cwd(), mod),
        ),
        output: {
            dir: "lib/esm-proxy",
            format: "esm",
            preserveModules: true,
            preserveModulesRoot: path.resolve(process.cwd(), "src"),
            exports: "named",
            interop: "auto",
            generatedCode: {
                constBindings: true,
            },
        },
        plugins: [nodeResolve(), commonjs(), json()],
        treeshake: {
            preset: "smallest",
            moduleSideEffects: (id) => {
                const normalizedId = path
                    .relative(process.cwd(), id)
                    .replace(/\\/g, "/");

                if (
                    pureModulesNoSideEffects.some(
                        (mod) => normalizedId === mod || normalizedId.endsWith(`/${mod}`),
                    )
                ) {
                    return false;
                }

                return true;
            },
        },
        external: createExternal,
    },
];