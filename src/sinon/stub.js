import commons from "@sinonjs/commons";
import samsam from "@sinonjs/samsam";
import Behavior from "./behavior.js";
import behaviors from "./default-behaviors.js";
import createProxy from "./proxy.js";
import isNonExistentProperty from "./util/core/is-non-existent-property.js";
import extend from "./util/core/extend.js";
import getPropertyDescriptor from "./util/core/get-property-descriptor.js";
import isEsModule from "./util/core/is-es-module.js";
import sinonType from "./util/core/sinon-type.js";
import wrapMethod from "./util/core/wrap-method.js";
import throwOnFalsyObject from "./throw-on-falsy-object.js";
import walkObject from "./util/core/walk-object.js";
import * as proxyCallUtil from "./proxy-call-util.js";

const { prototypes: commonsPrototypes, functionName, valueToString } = commons;
const { array: arrayProto, object: objectProto } = commonsPrototypes;
const { hasOwnProperty } = objectProto;
const { deepEqual } = samsam;

const forEach = arrayProto.forEach;
const pop = arrayProto.pop;
const push = arrayProto.push;
const slice = arrayProto.slice;
const sort = arrayProto.sort;
const filter = Array.prototype.filter;

let uuid = 0;

function matches(fake, args, strict) {
    const margs = fake.matchingArguments;
    if (
        margs.length <= args.length &&
        deepEqual(slice(args, 0, margs.length), margs)
    ) {
        return !strict || margs.length === args.length;
    }
    return false;
}

function createStub(originalFunc) {
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

    extend.nonEnum(proxy, stubApi);
    extend.nonEnum(proxy, stubProto);

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

const stubApi = {
    withArgs: function () {
        const args = slice(arguments);
        const matching = pop(this.matchingFakes(args, true));
        if (matching) {
            return matching;
        }

        const original = this;
        const fakeInstance = this.instantiateFake();
        fakeInstance.matchingArguments = args;
        fakeInstance.parent = this;
        push(this.fakes, fakeInstance);

        fakeInstance.withArgs = function () {
            return original.withArgs.apply(original, arguments);
        };

        forEach(original.args, function (arg, i) {
            if (!matches(fakeInstance, arg)) {
                return;
            }

            proxyCallUtil.incrementCallCount(fakeInstance);
            push(fakeInstance.thisValues, original.thisValues[i]);
            push(fakeInstance.args, arg);
            push(fakeInstance.returnValues, original.returnValues[i]);
            push(fakeInstance.exceptions, original.exceptions[i]);
            push(fakeInstance.callIds, original.callIds[i]);
        });

        proxyCallUtil.createCallProperties(fakeInstance);

        if (this.defaultBehavior && this.defaultBehavior.promiseLibrary) {
            fakeInstance.defaultBehavior =
                fakeInstance.defaultBehavior || Behavior.create(fakeInstance);
            fakeInstance.defaultBehavior.promiseLibrary =
                this.defaultBehavior.promiseLibrary;
        }

        return fakeInstance;
    },

    matchingFakes: function (args, strict) {
        return filter.call(this.fakes, function (fakeInstance) {
            return matches(fakeInstance, args, strict);
        });
    },
};

const delegateToCalls = proxyCallUtil.delegateToCalls;
delegateToCalls(stubApi, "callArg", false, "callArgWith", true, function () {
    throw new Error(
        `${this.toString()} cannot call arg since it was not yet invoked.`,
    );
});
stubApi.callArgWith = stubApi.callArg;
delegateToCalls(stubApi, "callArgOn", false, "callArgOnWith", true, function () {
    throw new Error(
        `${this.toString()} cannot call arg since it was not yet invoked.`,
    );
});
stubApi.callArgOnWith = stubApi.callArgOn;
delegateToCalls(stubApi, "throwArg", false, "throwArg", false, function () {
    throw new Error(
        `${this.toString()} cannot throw arg since it was not yet invoked.`,
    );
});
delegateToCalls(stubApi, "yield", false, "yield", true, function () {
    throw new Error(
        `${this.toString()} cannot yield since it was not yet invoked.`,
    );
});
stubApi.invokeCallback = stubApi.yield;
delegateToCalls(stubApi, "yieldOn", false, "yieldOn", true, function () {
    throw new Error(
        `${this.toString()} cannot yield since it was not yet invoked.`,
    );
});
delegateToCalls(stubApi, "yieldTo", false, "yieldTo", true, function (property) {
    throw new Error(
        `${this.toString()} cannot yield to '${valueToString(
            property,
        )}' since it was not yet invoked.`,
    );
});
delegateToCalls(
    stubApi,
    "yieldToOn",
    false,
    "yieldToOn",
    true,
    function (property) {
        throw new Error(
            `${this.toString()} cannot yield to '${valueToString(
                property,
            )}' since it was not yet invoked.`,
        );
    },
);

const stubProto = {
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
            this.behaviors[index] = Behavior.create(this);
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
};

forEach(Object.keys(Behavior.prototype), function (method) {
    if (
        hasOwnProperty(Behavior.prototype, method) &&
        !hasOwnProperty(stubProto, method) &&
        method !== "create" &&
        method !== "invoke" &&
        method !== "constructor"
    ) {
        stubProto[method] = Behavior.createBehavior(method);
    }
});

forEach(Object.keys(behaviors), function (method) {
    if (hasOwnProperty(behaviors, method) && !hasOwnProperty(stubProto, method)) {
        Behavior.addBehavior(stub, method, behaviors[method]);
    }
});

function getParentBehaviour(stubInstance) {
    return stubInstance.parent && getCurrentBehavior(stubInstance.parent);
}

function getDefaultBehavior(stubInstance) {
    return (
        stubInstance.defaultBehavior ||
        getParentBehaviour(stubInstance) ||
        Behavior.create(stubInstance)
    );
}

function getCurrentBehavior(stubInstance) {
    const currentBehavior = stubInstance.behaviors[stubInstance.callCount - 1];
    return currentBehavior && currentBehavior.isPresent()
        ? currentBehavior
        : getDefaultBehavior(stubInstance);
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

extend(stub, stubApi);
extend(stub, stubProto);
