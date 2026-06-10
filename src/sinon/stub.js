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
import wrapMethod, { isWrapScope } from "./util/core/wrap-method.js";
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
    extend.nonEnum(proxy, spy);
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

export default function stub(object, property, wrapScope) {
    const activeWrapScope = isWrapScope(wrapScope) ? wrapScope : undefined;

    if (arguments.length > 2 && !activeWrapScope) {
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
        return activeWrapScope
            ? walkObject(
                  function stubProperty(target, key) {
                      return stub(target, key, activeWrapScope);
                  },
                  object,
              )
            : walkObject(stub, object);
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

    return isStubbingNonFuncProperty
        ? s
        : wrapMethod(object, property, s, activeWrapScope);
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

function resetBehavior() {
    const fakes = this.fakes || [];

    forEach(fakes, function (fake) {
        fake.resetBehavior();
    });

    this.defaultBehavior = null;
    this.behaviors = [];
    this.callArgAt = undefined;
    this.callbackArguments = [];
    this.callbackContext = undefined;
    this.callArgProp = undefined;
    this.callbackAsync = false;
    this.callsThrough = false;
    this.callsThroughWithNew = false;
    this.exception = undefined;
    this.exceptionCreator = undefined;
    this.fakeFn = undefined;
    this.promiseLibrary = undefined;
    this.reject = false;
    this.resolve = false;
    this.resolveArgAt = undefined;
    this.resolveThis = false;
    this.returnArgAt = undefined;
    this.returnThis = false;
    this.returnValue = undefined;
    this.returnValueDefined = false;
    this.throwArgAt = undefined;

    return this;
}

extend(stub, {
    create: createStub,
    resetBehavior: resetBehavior,
    reset: function reset() {
        this.resetBehavior();
        this.resetHistory();
        return this;
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
});

forEach(Object.keys(behaviors), function (method) {
    if (hasOwnProperty(behaviors, method) && !hasOwnProperty(stub, method)) {
        behavior.addBehavior(stub, method, behaviors[method]);
    }
});
