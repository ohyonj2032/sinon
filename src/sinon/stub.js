import commons from "@sinonjs/commons";
import behavior from "./behavior.js";
import behaviors from "./default-behaviors.js";
import createProxy from "./proxy.js";
import isNonExistentProperty from "./util/core/is-non-existent-property.js";
import spy from "./spy.js";
import extend from "./util/core/extend.js";
import getPropertyDescriptor from "./util/core/get-property-descriptor.js";
import isEsModule from "./util/core/is-es-module.js";
import sinonType from "./util/core/sinon-type.js";
import wrapMethod from "./util/core/wrap-method.js";
import throwOnFalsyObject from "./throw-on-falsy-object.js";
import walkObject from "./util/core/walk-object.js";

const { prototypes: commonsPrototypes, functionName, valueToString } = commons;
const { array: arrayProto, object: objectProto } = commonsPrototypes;
const { hasOwnProperty } = objectProto;

const forEach = arrayProto.forEach;
const pop = arrayProto.pop;
const slice = arrayProto.slice;
const sort = arrayProto.sort;

let uuid = 0;

/* ---------------------------------------------------------------------------
 * ESM stub support
 * ------------------------------------------------------------------------- */

/**
 * Tracks the currently active ESM-namespace proxies so sandbox.restore() can
 * "switch them off" even though the underlying ESM binding is immutable.
 *
 * The map is keyed by the returned Proxy object (the user-facing one) and
 * holds a descriptor object:
 *   { namespace: object, prop: string, stub: function | null }
 * Setting `stub` to `null` has the effect of disabling the interception; the
 * proxy thereafter falls through to the real namespace binding.
 */
const esmStubRegistry = new WeakMap();
stub.__esmStubRegistry = esmStubRegistry;

/**
 * Create a stub backed by a Proxy that wraps an ESM namespace.
 *
 * The returned object acts as the namespace: reads of every property but
 * `prop` are forwarded unchanged to `namespace`.  Reads of `prop` return a
 * sinon stub function that goes through the normal `invoke` /
 * `getCurrentBehavior` pipeline, so `.callCount`, `.returns()`, `.resolves()`
 * etc. all work the same way they do for regular stubs.
 *
 * The proxy is registered with a WeakMap (see `esmStubRegistry`) so that
 * sandbox.restore() can sever the link between the proxy and the stub without
 * ever touching the (immutable) namespace object.
 *
 * @param {object} namespace  ESM namespace record
 * @param {string} prop       name of the export to stub
 * @returns {Proxy<object>}   the proxied namespace
 */
function stubESM(namespace, prop) {
    if (!namespace || typeof namespace !== "object") {
        throw new TypeError("stubESM requires a namespace object");
    }
    if (typeof prop !== "string" && typeof prop !== "symbol") {
        throw new TypeError("stubESM requires a property name");
    }

    // Make sure the property actually exists on the namespace; ESM
    // namespaces reflect every export as an own (and usually frozen) property.
    if (!(prop in namespace)) {
        throw new TypeError(
            `Cannot stub non-existent export ${valueToString(prop)}`,
        );
    }

    const originalFunc =
        typeof namespace[prop] === "function" ? namespace[prop] : null;
    const sinonStubInstance = createStub(originalFunc);

    // Mark the stub so sandbox.restore() knows about it.  The "restore"
    // method of a normal stub walks the original object via
    // Object.defineProperty – which is impossible on a frozen namespace.
    // Instead we expose a no-op restore; the real cleanup lives in the
    // WeakMap entry below.
    extend.nonEnum(sinonStubInstance, {
        rootObj: namespace,
        propName: prop,
        shadowsPropOnPrototype: false,
        isESMStub: true,
        restore: function restore() {
            // See esmStubRegistry – actual teardown happens in sandbox.js
            // via the shared WeakMap.  We still expose a restore() for
            // parity with regular stubs; calling it directly just severs
            // this particular proxy → stub link.
            const entry = esmStubRegistry.get(proxy);
            if (entry) {
                entry.stub = null;
            }
        },
    });

    const handler = {
        get(target, key, receiver) {
            if (key === prop) {
                const entry = esmStubRegistry.get(proxy);
                // If the stub has been "restored" (entry.stub === null),
                // fall through to the real namespace value.
                if (entry && entry.stub) {
                    return entry.stub;
                }
            }
            // Preserve `this`-binding for methods forwarded to the real
            // namespace (i.e. still point to the original namespace).
            const value = Reflect.get(target, key, target);
            if (typeof value === "function") {
                return value.bind(target);
            }
            return value;
        },

        has(target, key) {
            return Reflect.has(target, key);
        },

        ownKeys(target) {
            return Reflect.ownKeys(target);
        },

        getOwnPropertyDescriptor(target, key) {
            const desc = Reflect.getOwnPropertyDescriptor(target, key);
            if (!desc) return desc;
            // ESM namespaces expose enumerable own properties; keep them that
            // way, but lift configurable to true when returning the descriptor
            // for our stubbed property so consumers can still introspect it.
            if (key === prop) {
                return {
                    ...desc,
                    configurable: true,
                    writable: true,
                };
            }
            return desc;
        },
    };

    const proxy = new Proxy(namespace, handler);
    esmStubRegistry.set(proxy, {
        namespace,
        prop,
        stub: sinonStubInstance,
    });

    // Also expose the underlying stub on the proxy itself for advanced
    // callers that want to call `.withArgs()`, `.onCall()`, etc. on the
    // stub directly without going through `proxy[prop]` first.
    try {
        Object.defineProperty(proxy, "__sinonStub__", {
            value: sinonStubInstance,
            configurable: true,
            enumerable: false,
            writable: true,
        });
    } catch (e) {
        // ignore – frozen namespace; this is a best-effort convenience
    }

    return proxy;
}
stub.stubESM = stubESM;

function createStub(originalFunc) {
    // eslint-disable-next-line prefer-const
    let proxy;

    function functionStub() {
        const args = slice(arguments);
        const matchings = proxy.matchingFakes(args);

        const fnStub =
            pop(
                sort(matchings, function (a, b) {
                    return (
                        a.matchingArguments.length - b.matchingArguments.length
                    );
                }),
            ) || proxy;
        return getCurrentBehavior(fnStub).invoke(this, arguments);
    }

    proxy = createProxy(functionStub, originalFunc || functionStub);
    // Inherit spy API:
    extend.nonEnum(proxy, spy);
    // Inherit stub API:
    extend.nonEnum(proxy, stub);

    const name = originalFunc ? functionName(originalFunc) : null;
    extend.nonEnum(proxy, {
        fakes: [],
        instantiateFake: createStub,
        displayName: name || "stub",
        defaultBehavior: null,
        behaviors: [],
        id: `stub#${uuid++}`,
    });

    sinonType.set(proxy, "stub");

    return proxy;
}

export default function stub(object, property) {
    if (arguments.length > 2) {
        throw new TypeError(
            "stub(obj, 'meth', fn) has been removed, see documentation",
        );
    }

    if (isEsModule(object)) {
        throw new TypeError("ES Modules cannot be stubbed");
    }

    throwOnFalsyObject.apply(null, arguments);

    if (isNonExistentProperty(object, property)) {
        throw new TypeError(
            `Cannot stub non-existent property ${valueToString(property)}`,
        );
    }

    const actualDescriptor = getPropertyDescriptor(object, property);

    assertValidPropertyDescriptor(actualDescriptor, property);

    const isObjectOrFunction =
        typeof object === "object" || typeof object === "function";
    const isStubbingEntireObject =
        typeof property === "undefined" && isObjectOrFunction;
    const isCreatingNewStub = !object && typeof property === "undefined";
    const isStubbingNonFuncProperty =
        isObjectOrFunction &&
        typeof property !== "undefined" &&
        (typeof actualDescriptor === "undefined" ||
            typeof actualDescriptor.value !== "function");

    if (isStubbingEntireObject) {
        return walkObject(stub, object);
    }

    if (isCreatingNewStub) {
        return createStub();
    }

    const func =
        typeof actualDescriptor.value === "function"
            ? actualDescriptor.value
            : null;
    const s = createStub(func);

    extend.nonEnum(s, {
        rootObj: object,
        propName: property,
        shadowsPropOnPrototype: !actualDescriptor.isOwn,
        restore: function restore() {
            if (actualDescriptor !== undefined && actualDescriptor.isOwn) {
                Object.defineProperty(object, property, actualDescriptor);
                return;
            }

            delete object[property];
        },
    });

    return isStubbingNonFuncProperty ? s : wrapMethod(object, property, s);
}

function assertValidPropertyDescriptor(descriptor, property) {
    if (!descriptor || !property) {
        return;
    }
    if (descriptor.isOwn && !descriptor.configurable && !descriptor.writable) {
        throw new TypeError(
            `The descriptor for property \`${property}\` is non-configurable and non-writable. ` +
                `Sinon cannot stub properties that are immutable. ` +
                `See https://sinonjs.org/faq#property-descriptor-errors for help fixing this issue.`,
        );
    }
    if ((descriptor.get || descriptor.set) && !descriptor.configurable) {
        throw new TypeError(
            `Descriptor for accessor property ${property} is non-configurable`,
        );
    }
    if (isDataDescriptor(descriptor) && !descriptor.writable) {
        throw new TypeError(
            `Descriptor for data property ${property} is non-writable`,
        );
    }
}

function isDataDescriptor(descriptor) {
    return (
        !descriptor.value &&
        !descriptor.writable &&
        !descriptor.set &&
        !descriptor.get
    );
}

function getParentBehaviour(stubInstance) {
    return stubInstance.parent && getCurrentBehavior(stubInstance.parent);
}

function getDefaultBehavior(stubInstance) {
    return (
        stubInstance.defaultBehavior ||
        getParentBehaviour(stubInstance) ||
        behavior.create(stubInstance)
    );
}

function getCurrentBehavior(stubInstance) {
    const currentBehavior = stubInstance.behaviors[stubInstance.callCount - 1];
    return currentBehavior && currentBehavior.isPresent()
        ? currentBehavior
        : getDefaultBehavior(stubInstance);
}

const proto = {
    resetBehavior: function () {
        this.defaultBehavior = null;
        this.behaviors = [];

        delete this.returnValue;
        delete this.returnArgAt;
        delete this.throwArgAt;
        delete this.resolveArgAt;
        delete this.fakeFn;
        this.returnThis = false;
        this.resolveThis = false;

        forEach(this.fakes, function (fake) {
            fake.resetBehavior();
        });
    },

    reset: function () {
        this.resetHistory();
        this.resetBehavior();
    },

    onCall: function onCall(index) {
        if (!this.behaviors[index]) {
            this.behaviors[index] = behavior.create(this);
        }

        return this.behaviors[index];
    },

    onFirstCall: function onFirstCall() {
        return this.onCall(0);
    },

    onSecondCall: function onSecondCall() {
        return this.onCall(1);
    },

    onThirdCall: function onThirdCall() {
        return this.onCall(2);
    },

    withArgs: function withArgs() {
        const fake = spy.withArgs.apply(this, arguments);
        if (this.defaultBehavior && this.defaultBehavior.promiseLibrary) {
            fake.defaultBehavior =
                fake.defaultBehavior || behavior.create(fake);
            fake.defaultBehavior.promiseLibrary =
                this.defaultBehavior.promiseLibrary;
        }
        return fake;
    },
};

forEach(Object.keys(behavior), function (method) {
    if (
        hasOwnProperty(behavior, method) &&
        !hasOwnProperty(proto, method) &&
        method !== "create" &&
        method !== "invoke"
    ) {
        proto[method] = behavior.createBehavior(method);
    }
});

forEach(Object.keys(behaviors), function (method) {
    if (hasOwnProperty(behaviors, method) && !hasOwnProperty(proto, method)) {
        behavior.addBehavior(stub, method, behaviors[method]);
    }
});

extend(stub, proto);
