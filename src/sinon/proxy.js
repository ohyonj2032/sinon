import commons from "@sinonjs/commons";
import extend from "./util/core/extend.js";
import functionToString from "./util/core/function-to-string.js";
import proxyCall from "./proxy-call.js";
import * as proxyCallUtil from "./proxy-call-util.js";
import proxyInvoke from "./proxy-invoke.js";
import CallTracker from "./util/core/call-tracker.js";
import { inspect } from "util";
import formatters from "./spy-formatters.js";

const { prototypes } = commons;
const { push, forEach, slice } = prototypes.array;

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

    matchingFakes: function () {
        return emptyFakes;
    },

    getCall: function getCall(index) {
        return this._callTracker.getCall(index, this);
    },

    getCalls: function () {
        return this._callTracker.getCalls(this);
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

        this._callTracker.reset();

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
                return p.invoke(func, this, slice(arguments));
            };
            break;
        case 1:
            p = function proxy(a) {
                "use strict";
                return p.invoke(func, this, slice(arguments));
            };
            break;
        case 2:
            p = function proxy(a, b) {
                "use strict";
                return p.invoke(func, this, slice(arguments));
            };
            break;
        case 3:
            p = function proxy(a, b, c) {
                "use strict";
                return p.invoke(func, this, slice(arguments));
            };
            break;
        case 4:
            p = function proxy(a, b, c, d) {
                "use strict";
                return p.invoke(func, this, slice(arguments));
            };
            break;
        case 5:
            p = function proxy(a, b, c, d, e) {
                "use strict";
                return p.invoke(func, this, slice(arguments));
            };
            break;
        case 6:
            p = function proxy(a, b, c, d, e, f) {
                "use strict";
                return p.invoke(func, this, slice(arguments));
            };
            break;
        case 7:
            p = function proxy(a, b, c, d, e, f, g) {
                "use strict";
                return p.invoke(func, this, slice(arguments));
            };
            break;
        case 8:
            p = function proxy(a, b, c, d, e, f, g, h) {
                "use strict";
                return p.invoke(func, this, slice(arguments));
            };
            break;
        case 9:
            p = function proxy(a, b, c, d, e, f, g, h, i) {
                "use strict";
                return p.invoke(func, this, slice(arguments));
            };
            break;
        case 10:
            p = function proxy(a, b, c, d, e, f, g, h, i, j) {
                "use strict";
                return p.invoke(func, this, slice(arguments));
            };
            break;
        case 11:
            p = function proxy(a, b, c, d, e, f, g, h, i, j, k) {
                "use strict";
                return p.invoke(func, this, slice(arguments));
            };
            break;
        case 12:
            p = function proxy(a, b, c, d, e, f, g, h, i, j, k, l) {
                "use strict";
                return p.invoke(func, this, slice(arguments));
            };
            break;
        default:
            p = function proxy() {
                "use strict";
                return p.invoke(func, this, slice(arguments));
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

    const callTracker = new CallTracker();
    CallTracker.installDelegates(p, callTracker);

    extend.nonEnum(p, {
        isSinonProxy: true,
    });

    return p;
}

export default function createProxy(func, originalFunc) {
    const proxy = wrapFunction(func, originalFunc);

    extend(proxy, func);

    proxy.prototype = func.prototype;

    extend.nonEnum(proxy, proxyApi);

    return proxy;
}
