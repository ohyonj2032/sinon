import createApi from "./create-sinon-api.js";
import sinonStub from "./sinon/stub.js";

const sinon = createApi();

/**
 * Stubs a named export on an ES Module namespace object.
 *
 * Because ESM namespace bindings are immutable (non-writable,
 * non-configurable), the usual `Object.defineProperty` trick used by
 * `stub` cannot work.  Instead, `stubESM` returns a Proxy that wraps
 * the original namespace: reads to `prop` return a sinon stub function
 * (seamlessly integrated with the spy/stub API), while every other
 * property transparently falls through to the real namespace.
 *
 * @param {object} namespace  The ESM namespace record (e.g. the result of `import * as ns`)
 * @param {string} prop    The name of the exported binding to stub
 * @returns {Proxy<object>} A proxy around `namespace` that intercepts `prop`
 */
sinon.stubESM = function stubESM(namespace, prop) {
    return sinonStub.stubESM(namespace, prop);
};

export default sinon;
