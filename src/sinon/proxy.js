import commons from "@sinonjs/commons";
import extend from "./util/core/extend.js";
import functionToString from "./util/core/function-to-string.js";
import proxyInvoke from "./proxy-invoke.js";

const { prototypes } = commons;
const { slice } = prototypes.array;

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
};

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

    p.prototype = originalFunc.prototype;

    return p;
}

export default function createProxy(func, originalFunc) {
    const p = wrapFunction(func, originalFunc);

    extend.nonEnum(p, proxyApi);

    return p;
}