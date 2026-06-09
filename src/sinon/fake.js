import commons from "@sinonjs/commons";
import createCallTracker from "./call-tracker.js";
import createProxy from "./proxy.js";
import extend from "./util/core/extend.js";
import nextTick from "./util/core/next-tick.js";

const { prototypes } = commons;
const { slice } = prototypes.array;

function fake(f) {
    if (arguments.length > 0 && typeof f !== "function") {
        throw new TypeError("Expected f argument to be a Function");
    }

    return wrapFunc(f);
}

fake.returns = function returns(value) {
    function f() {
        return value;
    }

    return wrapFunc(f);
};

fake.throws = function throws(value) {
    function f() {
        throw getError(value);
    }

    return wrapFunc(f);
};

fake.resolves = function resolves(value) {
    function f() {
        return Promise.resolve(value);
    }

    return wrapFunc(f);
};

fake.rejects = function rejects(value) {
    function f() {
        return Promise.reject(getError(value));
    }

    return wrapFunc(f);
};

fake.yields = function yields() {
    const values = slice(arguments);

    function f() {
        const callback = arguments[arguments.length - 1];
        if (typeof callback !== "function") {
            throw new TypeError("Expected last argument to be a function");
        }

        callback.apply(null, values);
    }

    return wrapFunc(f);
};

fake.yieldsAsync = function yieldsAsync() {
    const values = slice(arguments);

    function f() {
        const callback = arguments[arguments.length - 1];
        if (typeof callback !== "function") {
            throw new TypeError("Expected last argument to be a function");
        }
        nextTick(function () {
            callback.apply(null, values);
        });
    }

    return wrapFunc(f);
};

let uuid = 0;

function wrapFunc(f) {
    const fakeInstance = function () {
        let firstArg, lastArg;

        if (arguments.length > 0) {
            firstArg = arguments[0];
            lastArg = arguments[arguments.length - 1];
        }

        const callback =
            lastArg && typeof lastArg === "function" ? lastArg : undefined;

        proxy.firstArg = firstArg;
        proxy.lastArg = lastArg;
        proxy.callback = callback;

        return f && f.apply(this, arguments);
    };
    const proxy = createProxy(fakeInstance, f || fakeInstance);

    const tracker = createCallTracker();
    extend.nonEnum(proxy, tracker);

    Object.defineProperty(proxy, "name", {
        value: "fake",
        configurable: true,
    });

    proxy.displayName = "fake";
    proxy.id = `fake#${uuid++}`;

    return proxy;
}

function getError(value) {
    return value instanceof Error ? value : new Error(value);
}

export default fake;