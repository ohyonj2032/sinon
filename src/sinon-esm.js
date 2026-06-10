import getSharedState from "./sinon/util/core/shared-state.js";
import createApi from "./create-sinon-api.js";

const shared = getSharedState();

const GLOBAL_SANDBOX_KEY = Symbol.for("@sinonjs/default-sandbox");

function getDefaultSandbox() {
    if (!globalThis[GLOBAL_SANDBOX_KEY]) {
        globalThis[GLOBAL_SANDBOX_KEY] = createApi();
    }
    return globalThis[GLOBAL_SANDBOX_KEY];
}

let sinon;

try {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const cjsSinon = require("../lib/sinon.js");
    sinon = cjsSinon.default || cjsSinon;
} catch {
    sinon = getDefaultSandbox();
}

if (!sinon || typeof sinon.spy !== "function") {
    sinon = getDefaultSandbox();
}

export default sinon;
