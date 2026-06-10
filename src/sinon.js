import createApi from "./create-sinon-api.js";

const GLOBAL_KEY = "__SINON_SINGLETON__";

var sinon;
if (typeof globalThis !== "undefined" && globalThis[GLOBAL_KEY]) {
    sinon = globalThis[GLOBAL_KEY];
} else {
    sinon = createApi();

    if (typeof globalThis !== "undefined") {
        Object.defineProperty(globalThis, GLOBAL_KEY, {
            value: sinon,
            writable: false,
            configurable: false,
            enumerable: false,
        });
    }
}

export default sinon;