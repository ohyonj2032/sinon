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

// Public API
const proxyApi = {
    toString: functionToString,

    named: function named(name) {
        this.displayName = name;
        const nameDescriptor = Object.getOwnPropertyDescriptor(this, "name");
        if (nameDescriptor && nameDescriptor.configurable) {
            // IE 11 functions don't have a name.
            // Safari 9 has names that are not configurable.
            nameDescriptor.value = name;
            Object.defineProperty(this, "name", nameDescriptor);
        }
        return this;
    },

    invoke: proxyInvoke,

    /*
     * Hook for derived implementation to return fake instances matching the
     * given arguments.
     */
    matchingFakes: function (/*args, strict*/) {
        return emptyFakes;
    },

    getCall: function getCall(index) {
        let i = index;
        if (i < 0) {
            // Negative indices means counting backwards from the last call
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
    // Do not change this to use an eval. Projects that depend on sinon block the use of eval.
    // ref: https://github.com/sinonjs/sinon/issues/710
    switch (arity) {
        /*eslint-disable no-unused-vars*/
        case 0:
            p = function proxy() {
                "use strict";
                // new.target 是 ECMAScript 规范层面最可靠的 [[Construct]] 信号
                // 当且仅当通过 new/super 调用时 new.target 才会被设置，
                // 普通的 call/apply/bind([[Call]]) 路径下 new.target === undefined
                const isNew = typeof new.target !== "undefined";
                return p.invoke(func, this, slice(arguments), isNew);
            };
            break;
        case 1:
            p = function proxy(a) {
                "use strict";
                const isNew = typeof new.target !== "undefined";
                return p.invoke(func, this, slice(arguments), isNew);
            };
            break;
        case 2:
            p = function proxy(a, b) {
                "use strict";
                const isNew = typeof new.target !== "undefined";
                return p.invoke(func, this, slice(arguments), isNew);
            };
            break;
        case 3:
            p = function proxy(a, b, c) {
                "use strict";
                const isNew = typeof new.target !== "undefined";
                return p.invoke(func, this, slice(arguments), isNew);
            };
            break;
        case 4:
            p = function proxy(a, b, c, d) {
                "use strict";
                const isNew = typeof new.target !== "undefined";
                return p.invoke(func, this, slice(arguments), isNew);
            };
            break;
        case 5:
            p = function proxy(a, b, c, d, e) {
                "use strict";
                const isNew = typeof new.target !== "undefined";
                return p.invoke(func, this, slice(arguments), isNew);
            };
            break;
        case 6:
            p = function proxy(a, b, c, d, e, f) {
                "use strict";
                const isNew = typeof new.target !== "undefined";
                return p.invoke(func, this, slice(arguments), isNew);
            };
            break;
        case 7:
            p = function proxy(a, b, c, d, e, f, g) {
                "use strict";
                const isNew = typeof new.target !== "undefined";
                return p.invoke(func, this, slice(arguments), isNew);
            };
            break;
        case 8:
            p = function proxy(a, b, c, d, e, f, g, h) {
                "use strict";
                const isNew = typeof new.target !== "undefined";
                return p.invoke(func, this, slice(arguments), isNew);
            };
            break;
        case 9:
            p = function proxy(a, b, c, d, e, f, g, h, i) {
                "use strict";
                const isNew = typeof new.target !== "undefined";
                return p.invoke(func, this, slice(arguments), isNew);
            };
            break;
        case 10:
            p = function proxy(a, b, c, d, e, f, g, h, i, j) {
                "use strict";
                const isNew = typeof new.target !== "undefined";
                return p.invoke(func, this, slice(arguments), isNew);
            };
            break;
        case 11:
            p = function proxy(a, b, c, d, e, f, g, h, i, j, k) {
                "use strict";
                const isNew = typeof new.target !== "undefined";
                return p.invoke(func, this, slice(arguments), isNew);
            };
            break;
        case 12:
            p = function proxy(a, b, c, d, e, f, g, h, i, j, k, l) {
                "use strict";
                const isNew = typeof new.target !== "undefined";
                return p.invoke(func, this, slice(arguments), isNew);
            };
            break;
        default:
            p = function proxy() {
                "use strict";
                const isNew = typeof new.target !== "undefined";
                return p.invoke(func, this, slice(arguments), isNew);
            };
            break;
        /*eslint-enable*/
    }
    const nameDescriptor = Object.getOwnPropertyDescriptor(
        originalFunc,
        "name",
    );
    if (nameDescriptor && nameDescriptor.configurable) {
        // IE 11 functions don't have a name.
        // Safari 9 has names that are not configurable.
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

/**
 * Creates a proxy function.
 *
 * @param {SinonFunction} func The original function
 * @param {SinonFunction} originalFunc The original function (for arity and name)
 * @returns {SinonFunction} The proxy function
 */
export default function createProxy(func, originalFunc) {
    const proxy = wrapFunction(func, originalFunc);

    // Inherit function properties:
    extend(proxy, func);

    // 关键修复：
    // 1. 只有当原函数本身具有非空 prototype 时才把 proxy.prototype 指向它。
    //    ES2015 class 的 prototype 是不可写、不可配置、不可枚举的普通对象，
    //    它同时承载了 instanceof 的 [[GetPrototypeOf]] 链；
    // 2. 箭头函数 / 内置无构造函数的函数没有 prototype，保留 undefined，
    //    这防止了 new proxy() 时引擎把一个默认 prototype 挂到实例上，
    //    从而破坏 instanceof mod.MyClass 的判断；
    // 3. 这也是 ECMAScript 规范对 [[Construct]] -> OrdinaryCreateFromConstructor
    //    取出 constructor.prototype 作为实例 [[Prototype]] 的依赖点。
    // 4. 对于 stub 场景下（createStub 中调用 createProxy(functionStub, originalFunc)）：
    //    func 是 functionStub（它只是一个普通函数，其 prototype 是 Function 自带的 {}），
    //    originalFunc 才是用户的 class/构造函数。此时必须以 originalFunc.prototype
    //    为准，否则 instanceof OriginalClass 不会返回 true。
    let prototypeSource = originalFunc || func;
    const originalHasPrototype =
        prototypeSource != null &&
        typeof prototypeSource === "function" &&
        "prototype" in prototypeSource;
    if (originalHasPrototype && prototypeSource.prototype !== undefined) {
        try {
            proxy.prototype = prototypeSource.prototype;
        } catch (e) {
            // 某些严格模式下的冻结 prototype 会抛错，保持不破坏调用链即可。
        }
    }

    extend.nonEnum(proxy, proxyApi);

    return proxy;
}
