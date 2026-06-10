import { nodeResolve } from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();
const sourceRoot = path.resolve(projectRoot, "src");
const esmProxyEntry = "src/sinon-esm.js";

function normalizeFilePath(filePath) {
    return path.normalize(filePath).split(path.sep).join("/");
}

function getAllFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        if (fs.statSync(filePath).isDirectory()) {
            getAllFiles(filePath, fileList);
        } else if (filePath.endsWith(".js")) {
            fileList.push(normalizeFilePath(filePath));
        }
    }
    return fileList;
}

function resolveSourceImport(id, parentId) {
    if (id.startsWith("src/")) {
        return path.resolve(projectRoot, id);
    }

    if (path.isAbsolute(id)) {
        return id;
    }

    if (id.startsWith(".")) {
        return path.resolve(parentId ? path.dirname(parentId) : projectRoot, id);
    }

    return null;
}

function sourceFileExists(filePath) {
    return (
        fs.existsSync(filePath) ||
        fs.existsSync(`${filePath}.js`) ||
        fs.existsSync(`${filePath}.mjs`)
    );
}

function createExternalPredicate(options = {}) {
    const { externalizeSourceInternals = false } = options;

    return function external(id, parentId) {
        if (id.startsWith("node:")) {
            return true;
        }

        const resolvedPath = resolveSourceImport(id, parentId);
        if (!resolvedPath) {
            return true;
        }

        if (!resolvedPath.startsWith(sourceRoot)) {
            return true;
        }

        if (!parentId) {
            return false;
        }

        if (!sourceFileExists(resolvedPath)) {
            return true;
        }

        return externalizeSourceInternals;
    };
}

const coreInputs = getAllFiles("src").filter(function (filePath) {
    return filePath !== esmProxyEntry;
});

const sharedPlugins = [nodeResolve(), json()];

export default [
    {
        input: coreInputs,
        output: {
            dir: "lib",
            format: "cjs",
            preserveModules: true,
            preserveModulesRoot: "src",
            exports: "auto",
            interop: "auto",
        },
        plugins: [commonjs(), ...sharedPlugins],
        external: createExternalPredicate(),
        preserveEntrySignatures: "exports-only",
    },
    {
        input: esmProxyEntry,
        output: {
            file: "lib/sinon-esm.mjs",
            format: "esm",
            exports: "named",
        },
        plugins: sharedPlugins,
        external: createExternalPredicate({ externalizeSourceInternals: true }),
        treeshake: {
            moduleSideEffects: false,
            propertyReadSideEffects: false,
        },
        preserveEntrySignatures: "strict",
    },
];
