import commons from "@sinonjs/commons";
import extend from "./util/core/extend.js";
import functionToString from "./util/core/function-to-string.js";
import proxyCall from "./proxy-call.js";
import * as proxyCallUtil from "./proxy-call-util.js";
import proxyInvoke from "./proxy-invoke.js";
import { inspect } from "util";
import formatters from "./spy-formatters.js";

const { prototypes } = commons;
const { push, forEach, slice } = prototypes.array;

/**
 * @callback SinonFunction
 * @param {...unknown} args
 * @returns {unknown}
 */

const emptyFakes = [];

const proxyApi = {
    toString: functionToString,

    named: function named(name) {
        this.displayName = name;
        const nameDescriptor = Object.getOwnPropertyDescriptor(this, "name");
        if (nameDescriptor && nameDescriptor.configurable) {
            nameDescriptor.value = name;
            Object.defineProperty(this, "name", nameDescriptor);
        }
        return this;
    },

    invoke: proxyInvoke,

    matchingFakes: function (/*args, strict*/) {
        return emptyFakes;
    },

    getCall: function getCall(index) {
        let i = index;
        if (i < 0) {
            i += this.callCount;
        }
        if (i < 0 || i >= this.callCount) {
            return null;
        }

        return proxyCall(
            this,
            this.thisValues[i],
            this.args[i],
            this.returnValues[i],
            this.exceptions[i],
            this.callIds[i],
            this.errorsWithCallStack[i],
        );
    },

    getCalls: function () {
        const calls = [];
        let i;

        for (i = 0; i < this.callCount; i++) {
            push(calls, this.getCall(i));
        }

        return calls;
    },

    calledBefore: function calledBefore(proxy) {
        if (!this.called) {
            return false;
        }

        if (!proxy.called) {
            return true;
        }

        return this.callIds[0] < proxy.callIds[proxy.callIds.length - 1];
    },

    calledAfter: function calledAfter(proxy) {
        if (!this.called || !proxy.called) {
            return false;
        }

        return this.callIds[this.callCount - 1] > proxy.callIds[0];
    },

    calledImmediatelyBefore: function calledImmediatelyBefore(proxy) {
        if (!this.called || !proxy.called) {
            return false;
        }

        return (
            this.callIds[this.callCount - 1] ===
            proxy.callIds[proxy.callCount - 1] - 1
        );
    },

    calledImmediatelyAfter: function calledImmediatelyAfter(proxy) {
        if (!this.called || !proxy.called) {
            return false;
        }

        return (
            this.callIds[this.callCount - 1] ===
            proxy.callIds[proxy.callCount - 1] + 1
        );
    },

    formatters: formatters,
    printf: function (format) {
        const spyInstance = this;
        const args = slice(arguments, 1);
        let formatter;

        return (format || "").replace(/%(.)/g, function (match, specifier) {
            formatter = proxyApi.formatters[specifier];

            if (typeof formatter === "function") {
                return String(formatter(spyInstance, args));
            } else if (!isNaN(parseInt(specifier, 10))) {
                return inspect(args[specifier - 1]);
            }

            return `%${specifier}`;
        });
    },

    resetHistory: function () {
        if (this.invoking) {
            const err = new Error(
                "Cannot reset Sinon function while invoking it. " +
                    "Move the call to .resetHistory outside of the callback.",
            );
            err.name = "InvalidResetException";
            throw err;
        }

        this.called = false;
        this.notCalled = true;
        this.calledOnce = false;
        this.calledTwice = false;
        this.calledThrice = false;
        this.callCount = 0;
        this.firstCall = null;
        this.secondCall = null;
        this.thirdCall = null;
        this.lastCall = null;
        this.lastArg = null;
        this.args = [];
        this.firstArg = null;
        this.returnValues = [];
        this.thisValues = [];
        this.exceptions = [];
        this.callIds = [];
        this.errorsWithCallStack = [];

        if (this.fakes) {
            forEach(this.fakes, function (fake) {
                fake.resetHistory();
            });
        }

        return this;
    },
};

const delegateToCalls = proxyCallUtil.delegateToCalls;
delegateToCalls(proxyApi, "calledOn", true);
delegateToCalls(proxyApi, "alwaysCalledOn", false, "calledOn");
delegateToCalls(proxyApi, "calledWith", true);
delegateToCalls(
    proxyApi,
    "calledOnceWith",
    true,
    "calledWith",
    false,
    undefined,
    1,
);
delegateToCalls(proxyApi, "calledWithMatch", true);
delegateToCalls(proxyApi, "alwaysCalledWith", false, "calledWith");
delegateToCalls(proxyApi, "alwaysCalledWithMatch", false, "calledWithMatch");
delegateToCalls(proxyApi, "calledWithExactly", true);
delegateToCalls(
    proxyApi,
    "calledOnceWithExactly",
    true,
    "calledWithExactly",
    false,
    undefined,
    1,
);
delegateToCalls(
    proxyApi,
    "calledOnceWithMatch",
    true,
    "calledWithMatch",
    false,
    undefined,
    1,
);
delegateToCalls(
    proxyApi,
    "alwaysCalledWithExactly",
    false,
    "calledWithExactly",
);
delegateToCalls(
    proxyApi,
    "neverCalledWith",
    false,
    "notCalledWith",
    false,
    function () {
        return true;
    },
);
delegateToCalls(
    proxyApi,
    "neverCalledWithMatch",
    false,
    "notCalledWithMatch",
    false,
    function () {
        return true;
    },
);
delegateToCalls(proxyApi, "threw", true);
delegateToCalls(proxyApi, "alwaysThrew", false, "threw");
delegateToCalls(proxyApi, "returned", true);
delegateToCalls(proxyApi, "alwaysReturned", false, "returned");
delegateToCalls(proxyApi, "calledWithNew", true);
delegateToCalls(proxyApi, "alwaysCalledWithNew", false, "calledWithNew");

function wrapFunction(func, originalFunc) {
    const arity = originalFunc.length;
    let p;
    switch (arity) {
        case 0:
            p = function proxy() {
                "use strict";
                return p.invoke(func, this, slice(arguments), new.target);
            };
            break;
        case 1:
            p = function proxy(a) {
                "use strict";
                return p.invoke(func, this, slice(arguments), new.target);
            };
            break;
        case 2:
            p = function proxy(a, b) {
                "use strict";
                return p.invoke(func, this, slice(arguments), new.target);
            };
            break;
        case 3:
            p = function proxy(a, b, c) {
                "use strict";
                return p.invoke(func, this, slice(arguments), new.target);
            };
            break;
        case 4:
            p = function proxy(a, b, c, d) {
                "use strict";
                return p.invoke(func, this, slice(arguments), new.target);
            };
            break;
        case 5:
            p = function proxy(a, b, c, d, e) {
                "use strict";
                return p.invoke(func, this, slice(arguments), new.target);
            };
            break;
        case 6:
            p = function proxy(a, b, c, d, e, f) {
                "use strict";
                return p.invoke(func, this, slice(arguments), new.target);
            };
            break;
        case 7:
            p = function proxy(a, b, c, d, e, f, g) {
                "use strict";
                return p.invoke(func, this, slice(arguments), new.target);
            };
            break;
        case 8:
            p = function proxy(a, b, c, d, e, f, g, h) {
                "use strict";
                return p.invoke(func, this, slice(arguments), new.target);
            };
            break;
        case 9:
            p = function proxy(a, b, c, d, e, f, g, h, i) {
                "use strict";
                return p.invoke(func, this, slice(arguments), new.target);
            };
            break;
        case 10:
            p = function proxy(a, b, c, d, e, f, g, h, i, j) {
                "use strict";
                return p.invoke(func, this, slice(arguments), new.target);
            };
            break;
        case 11:
            p = function proxy(a, b, c, d, e, f, g, h, i, j, k) {
                "use strict";
                return p.invoke(func, this, slice(arguments), new.target);
            };
            break;
        case 12:
            p = function proxy(a, b, c, d, e, f, g, h, i, j, k, l) {
                "use strict";
                return p.invoke(func, this, slice(arguments), new.target);
            };
            break;
        default:
            p = function proxy() {
                "use strict";
                return p.invoke(func, this, slice(arguments), new.target);
            };
            break;
    }
    const nameDescriptor = Object.getOwnPropertyDescriptor(
        originalFunc,
        "name",
    );
    if (nameDescriptor && nameDescriptor.configurable) {
        Object.defineProperty(p, "name", nameDescriptor);
    }
    extend.nonEnum(p, {
        isSinonProxy: true,

        called: false,
        notCalled: true,
        calledOnce: false,
        calledTwice: false,
        calledThrice: false,
        callCount: 0,
        firstCall: null,
        firstArg: null,
        secondCall: null,
        thirdCall: null,
        lastCall: null,
        lastArg: null,
        args: [],
        returnValues: [],
        thisValues: [],
        exceptions: [],
        callIds: [],
        errorsWithCallStack: [],
    });
    return p;
}

function getOriginalPrototype(originalFunc, func) {
    if (
        typeof originalFunc === "function" &&
        originalFunc.prototype &&
        typeof originalFunc.prototype === "object"
    ) {
        return originalFunc.prototype;
    }

    return func.prototype;
}

export default function createProxy(func, originalFunc) {
    const proxy = wrapFunction(func, originalFunc);

    extend(proxy, func);

    proxy.prototype = getOriginalPrototype(originalFunc, func);

    extend.nonEnum(proxy, proxyApi, {
        func: func,
        originalFunc: originalFunc,
    });

    return proxy;
}
