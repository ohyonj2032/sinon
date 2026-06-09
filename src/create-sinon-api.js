import behavior from "./sinon/behavior.js";
import createConfiguredSandbox from "./sinon/create-sandbox.js";
import createStubInstanceImpl from "./sinon/create-stub-instance.js";
import collectOwnMethods from "./sinon/collect-own-methods.js";
import extend from "./sinon/util/core/extend.js";
import * as fakeTimers from "./sinon/util/fake-timers.js";
import Sandbox from "./sinon/sandbox.js";
import stub from "./sinon/stub.js";
import promise from "./sinon/promise.js";
import samsam from "@sinonjs/samsam";
import restoreObject from "./sinon/restore-object.js";
import expectation from "./sinon/mock-expectation.js";

// Cross-module shared default sandbox.
//
// When an application mixes `sinon` (CJS) with `sinon/esm` (ESM), each copy
// of `createApi()` would otherwise construct its own `Sandbox()`. That means
// `sinon.stub(obj, "m")` from CJS registers a fake in one collection, while
// `sinon.restore()` from ESM tries to restore from a different collection —
// and neither call sees the other's fake.
//
// We lift the default sandbox onto `globalThis` with a well-known symbol so
// every copy of Sinon returns the exact same object when `createApi()` is
// invoked without arguments. Sub-sandboxes created via `sinon.createSandbox()`
// remain isolated by design, so test files can still own their own lifetime.
const SINON_DEFAULT_SANDBOX_KEY =
    typeof Symbol !== "undefined" && Symbol.for
        ? Symbol.for("sinon.registry.defaultSandbox")
        : "__sinon_default_sandbox__";

function getSharedDefaultSandbox() {
    if (typeof globalThis === "undefined") {
        return new Sandbox();
    }
    if (!globalThis[SINON_DEFAULT_SANDBOX_KEY]) {
        globalThis[SINON_DEFAULT_SANDBOX_KEY] = new Sandbox();
    }
    return globalThis[SINON_DEFAULT_SANDBOX_KEY];
}

/**
 * Creates the Sinon API.
 *
 * @returns {object} The Sinon API object
 */
export default function createApi() {
    const sandbox = getSharedDefaultSandbox();

    const apiMethods = {
        // `createSandbox` returns an isolated sandbox: its fakes are tracked
        // on its own collection so consumers can rely on `subSandbox.restore()`
        // (and only that) for cleanup. Don't push it into the global sandbox's
        // collection — doing so caused `sinon.restore()` to cascade-restore
        // sub-sandboxes (regression in 21.1.0, see #2701).
        createSandbox: createConfiguredSandbox,
        match: samsam.createMatcher,
        restoreObject: restoreObject,
        expectation: expectation,
        timers: fakeTimers.timers,
        createStubInstance: function createStubInstance() {
            const stubbed = createStubInstanceImpl.apply(null, arguments);

            for (const method of collectOwnMethods(stubbed)) {
                sandbox.getFakes().push(method);
            }

            return stubbed;
        },

        addBehavior: function (name, fn) {
            behavior.addBehavior(stub, name, fn);
        },

        promise: promise,
    };

    Object.defineProperty(apiMethods.createSandbox, "name", {
        value: "createSandbox",
        configurable: true,
    });
    Object.defineProperty(apiMethods.createSandbox, "length", {
        value: 1,
        configurable: true,
    });

    Object.defineProperty(apiMethods.createStubInstance, "name", {
        value: "createStubInstance",
        configurable: true,
    });
    Object.defineProperty(apiMethods.createStubInstance, "length", {
        value: 1,
        configurable: true,
    });

    return extend(sandbox, apiMethods);
}
