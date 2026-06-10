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

function makeExternal() {
    return (id, parentId) => {
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

        const srcPath = path.resolve(process.cwd(), "src");
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
    };
}

const cjsCoreConfig = {
    input: getAllFiles("src").filter(
        (f) => !f.includes(path.normalize("src/sinon-esm.js")),
    ),
    output: {
        dir: "lib",
        format: "cjs",
        preserveModules: true,
        preserveModulesRoot: "src",
        exports: "named",
        interop: "auto",
    },
    plugins: [
        nodeResolve({
            moduleSideEffects: (id) => {
                if (id.includes("shared-state")) {
                    return true;
                }
                if (id.includes("proxy-invoke") || id.includes("proxy-call")) {
                    return false;
                }
                return true;
            },
        }),
        commonjs(),
        json(),
    ],
    external: makeExternal(),
};

const esmProxyConfig = {
    input: "src/sinon-esm.js",
    output: {
        dir: "pkg",
        format: "esm",
        exports: "named",
        entryFileNames: "sinon-esm.js",
    },
    plugins: [
        nodeResolve({
            moduleSideEffects: (id, external) => {
                if (external) {
                    return false;
                }
                if (
                    id.includes("sinon-esm") ||
                    id.includes("proxy-invoke") ||
                    id.includes("proxy-call") ||
                    id.includes("proxy-call-util") ||
                    id.includes("spy-formatters") ||
                    id.includes("colorizer")
                ) {
                    return false;
                }
                if (
                    id.includes("shared-state") ||
                    id.includes("sandbox") ||
                    id.includes("wrap-method")
                ) {
                    return true;
                }
                return true;
            },
        }),
        commonjs(),
        json(),
    ],
    external: (id, parentId) => {
        if (id.startsWith("node:")) {
            return true;
        }
        if (id.startsWith("@sinonjs/")) {
            return true;
        }
        if (id === "util") {
            return true;
        }
        if (
            parentId &&
            parentId.includes("sinon-esm") &&
            (id.startsWith("./sinon/") || id === "./sinon.js")
        ) {
            return true;
        }
        return false;
    },
};

export default [cjsCoreConfig, esmProxyConfig];
