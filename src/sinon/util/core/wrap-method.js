import commons from "@sinonjs/commons";

const { prototypes, valueToString } = commons;
import getPropertyDescriptor from "./get-property-descriptor.js";
import sinonType from "./sinon-type.js";

const { hasOwnProperty } = prototypes.object;
const { push, splice } = prototypes.array;

/**
 * @callback SinonFunction
 * @param {...unknown} args
 * @returns {unknown}
 */

const propertyKeys = ["value", "get", "set"];
const wrapScopeMarker = Symbol("sinon.wrapScope");
const defaultWrapScope = createWrapScope();
const registry = new WeakMap();
const targetRegistry = new WeakMap();

// eslint-disable-next-line no-empty-function
const noop = () => {};

export function createWrapScope() {
    return Object.freeze({ [wrapScopeMarker]: true });
}

export function isWrapScope(value) {
    return Boolean(value && value[wrapScopeMarker]);
}

export function getWrappedMethod(target) {
    const state = targetRegistry.get(target);

    return state && state.key === "value" ? state.wrappedMethod : undefined;
}

function getManagedState(target) {
    return isFunction(target) ? targetRegistry.get(target) : undefined;
}

function getManagedStackTrace(target) {
    const state = getManagedState(target);

    return state && state.stackTraceError;
}

function isFunction(obj) {
    return (
        typeof obj === "function" ||
        Boolean(obj && obj.constructor && obj.call && obj.apply)
    );
}

function mirrorProperties(target, source) {
    for (const prop in source) {
        if (!hasOwnProperty(target, prop)) {
            target[prop] = source[prop];
        }
    }
}

function clonePropertyDescriptor(descriptor) {
    if (!descriptor) {
        return descriptor;
    }

    const clone = {};

    for (let i = 0; i < propertyKeys.length; i++) {
        const key = propertyKeys[i];

        if (key in descriptor) {
            clone[key] = descriptor[key];
        }
    }

    if ("configurable" in descriptor) {
        clone.configurable = descriptor.configurable;
    }

    if ("enumerable" in descriptor) {
        clone.enumerable = descriptor.enumerable;
    }

    if ("writable" in descriptor) {
        clone.writable = descriptor.writable;
    }

    if ("isOwn" in descriptor) {
        clone.isOwn = descriptor.isOwn;
    }

    return clone;
}

function descriptorForDefineProperty(descriptor) {
    const clone = clonePropertyDescriptor(descriptor);

    if (clone) {
        delete clone.isOwn;
    }

    return clone;
}

function updateDescriptorKey(descriptor, key, value, isOwn) {
    const nextDescriptor = clonePropertyDescriptor(descriptor) || {};

    if (key === "value") {
        nextDescriptor.value = value;
        delete nextDescriptor.get;
        delete nextDescriptor.set;
        if (!("writable" in nextDescriptor)) {
            nextDescriptor.writable = true;
        }
    } else {
        nextDescriptor[key] = value;
        delete nextDescriptor.value;
        delete nextDescriptor.writable;
    }

    if (typeof isOwn !== "undefined") {
        nextDescriptor.isOwn = isOwn;
    }

    return nextDescriptor;
}

function getPropertyStore(object, property, shouldCreate) {
    let objectStore = registry.get(object);

    if (!objectStore) {
        if (!shouldCreate) {
            return undefined;
        }

        objectStore = new Map();
        registry.set(object, objectStore);
    }

    let propertyStore = objectStore.get(property);

    if (!propertyStore && shouldCreate) {
        propertyStore = new Map();
        objectStore.set(property, propertyStore);
    }

    return propertyStore;
}

function getPropertyStack(object, property, key, shouldCreate) {
    const propertyStore = getPropertyStore(object, property, shouldCreate);

    if (!propertyStore) {
        return undefined;
    }

    let stack = propertyStore.get(key);

    if (!stack && shouldCreate) {
        stack = [];
        propertyStore.set(key, stack);
    }

    return stack;
}

function hasActiveStacks(object, property) {
    const propertyStore = getPropertyStore(object, property, false);

    if (!propertyStore) {
        return false;
    }

    for (const stack of propertyStore.values()) {
        if (stack.length > 0) {
            return true;
        }
    }

    return false;
}

function cleanupStackState(object, property, key) {
    const propertyStore = getPropertyStore(object, property, false);

    if (!propertyStore) {
        return;
    }

    const stack = propertyStore.get(key);

    if (stack && stack.length === 0) {
        propertyStore.delete(key);
    }

    if (propertyStore.size === 0) {
        const objectStore = registry.get(object);
        objectStore.delete(property);

        if (objectStore.size === 0) {
            registry.delete(object);
        }
    }
}

function defineTargetMetadata(target, property, key) {
    const properties = {
        displayName: {
            configurable: true,
            enumerable: false,
            writable: true,
            value: property,
        },
        restore: {
            configurable: true,
            enumerable: false,
            writable: true,
            value: restore,
        },
    };

    if (key === "value") {
        properties.wrappedMethod = {
            configurable: true,
            enumerable: false,
            get: function wrappedMethodGetter() {
                return getWrappedMethod(this);
            },
        };
    }

    Object.defineProperties(target, properties);
    target.restore.sinon = true;
}

function registerTargetState(state) {
    const stack = getPropertyStack(state.object, state.property, state.key, true);

    push(stack, state);
    targetRegistry.set(state.target, state);
}

function replaceWrappedMethod(state, descriptor) {
    state.previousDescriptor = updateDescriptorKey(
        state.previousDescriptor,
        state.key,
        descriptor && descriptor[state.key],
        descriptor && descriptor.isOwn,
    );
    state.wrappedMethod = descriptor && descriptor[state.key];
}

function restoreValueState(state) {
    const object = state.object;
    const property = state.property;
    const previousDescriptor = state.previousDescriptor;
    let descriptor;

    if (!previousDescriptor.isOwn) {
        try {
            delete object[property];
        } catch (e) {}
    } else if (hasES5Support) {
        Object.defineProperty(
            object,
            property,
            descriptorForDefineProperty(previousDescriptor),
        );
    }

    if (hasES5Support) {
        descriptor = getPropertyDescriptor(object, property);
        if (descriptor && descriptor.value === state.target) {
            object[property] = state.wrappedMethod;
        }
    } else if (object[property] === state.target) {
        object[property] = state.wrappedMethod;
    }
}

function restoreAccessorState(state) {
    const object = state.object;
    const property = state.property;
    const key = state.key;
    const previousDescriptor = state.previousDescriptor;
    const shouldKeepOwnDescriptor = hasActiveStacks(object, property);
    let descriptor;

    if (previousDescriptor.isOwn && !shouldKeepOwnDescriptor) {
        Object.defineProperty(
            object,
            property,
            descriptorForDefineProperty(previousDescriptor),
        );
    } else if (!previousDescriptor.isOwn && !shouldKeepOwnDescriptor) {
        try {
            delete object[property];
        } catch (e) {}
    } else {
        descriptor = getPropertyDescriptor(object, property);
        const nextDescriptor = updateDescriptorKey(
            descriptor && descriptor.isOwn
                ? descriptor
                : {
                      configurable: true,
                      enumerable: previousDescriptor.enumerable,
                  },
            key,
            previousDescriptor[key],
            true,
        );

        Object.defineProperty(
            object,
            property,
            descriptorForDefineProperty(nextDescriptor),
        );
    }

    descriptor = getPropertyDescriptor(object, property);

    if (descriptor && descriptor[key] === state.target) {
        const nextDescriptor = updateDescriptorKey(
            descriptor && descriptor.isOwn
                ? descriptor
                : {
                      configurable: true,
                      enumerable: previousDescriptor.enumerable,
                  },
            key,
            state.wrappedMethod,
            true,
        );

        Object.defineProperty(
            object,
            property,
            descriptorForDefineProperty(nextDescriptor),
        );
    }
}

function restore() {
    const state = targetRegistry.get(this);

    if (!state) {
        return;
    }

    const stack = getPropertyStack(state.object, state.property, state.key, false);
    const index = stack ? stack.indexOf(state) : -1;

    targetRegistry.delete(this);

    if (!stack || index === -1) {
        return;
    }

    if (index < stack.length - 1) {
        replaceWrappedMethod(stack[index + 1], state.previousDescriptor);
        splice(stack, index, 1);
        cleanupStackState(state.object, state.property, state.key);
        return;
    }

    stack.pop();
    cleanupStackState(state.object, state.property, state.key);

    if (state.key === "value") {
        restoreValueState(state);
    } else {
        restoreAccessorState(state);
    }

    if (sinonType.get(state.object) === "stub-instance") {
        state.object[state.property] = noop;
    }
}

const hasES5Support = "keys" in Object;

export default function wrapMethod(
    object,
    property,
    method,
    wrapScope = defaultWrapScope,
) {
    if (!object) {
        throw new TypeError("Should wrap property of object");
    }

    if (typeof method !== "function" && typeof method !== "object") {
        throw new TypeError(
            "Method wrapper should be a function or a property descriptor",
        );
    }

    function checkWrappedMethod(wrappedMethod) {
        let error;
        const managedState = getManagedState(wrappedMethod);

        if (!isFunction(wrappedMethod)) {
            error = new TypeError(
                `Attempted to wrap ${typeof wrappedMethod} property ${valueToString(
                    property,
                )} as function`,
            );
        } else if (managedState && managedState.wrapScope === wrapScope) {
            error = new TypeError(
                `Attempted to wrap ${valueToString(
                    property,
                )} which is already wrapped`,
            );
        } else if (
            !managedState &&
            wrappedMethod.restore &&
            wrappedMethod.restore.sinon
        ) {
            error = new TypeError(
                `Attempted to wrap ${valueToString(
                    property,
                )} which is already wrapped`,
            );
        } else if (!managedState && wrappedMethod.calledBefore) {
            const verb = wrappedMethod.returns ? "stubbed" : "spied on";
            error = new TypeError(
                `Attempted to wrap ${valueToString(
                    property,
                )} which is already ${verb}`,
            );
        }

        if (error) {
            const stackTraceError =
                getManagedStackTrace(wrappedMethod) ||
                (wrappedMethod && wrappedMethod.stackTraceError);

            if (stackTraceError) {
                error.stack += `\n--------------\n${stackTraceError.stack}`;
            }
            throw error;
        }
    }

    let error, wrappedMethod, i, wrappedMethodDesc;
    const wrappedMethods = [];

    function simplePropertyAssignment() {
        wrappedMethod = object[property];
        checkWrappedMethod(wrappedMethod);
        object[property] = method;
        method.displayName = property;
        push(wrappedMethods, { key: "value", wrappedMethod: wrappedMethod });
    }

    const owned = object.hasOwnProperty
        ? object.hasOwnProperty(property)
        : hasOwnProperty(object, property);

    if (hasES5Support) {
        const methodDesc =
            typeof method === "function" ? { value: method } : method;
        wrappedMethodDesc = getPropertyDescriptor(object, property);

        if (!wrappedMethodDesc) {
            error = new TypeError(
                `Attempted to wrap ${typeof wrappedMethod} property ${property} as function`,
            );
        }
        if (error) {
            throw error;
        }

        const types = Object.keys(methodDesc);
        for (i = 0; i < types.length; i++) {
            wrappedMethod = wrappedMethodDesc[types[i]];
            checkWrappedMethod(wrappedMethod);
            push(wrappedMethods, {
                key: types[i],
                wrappedMethod: wrappedMethod,
            });
        }

        mirrorProperties(methodDesc, wrappedMethodDesc);
        for (i = 0; i < types.length; i++) {
            mirrorProperties(methodDesc[types[i]], wrappedMethodDesc[types[i]]);
        }

        if (!owned) {
            methodDesc.configurable = true;
        }

        Object.defineProperty(object, property, methodDesc);

        if (typeof method === "function" && object[property] !== method) {
            delete object[property];
            wrappedMethods.length = 0;
            simplePropertyAssignment();
        }
    } else {
        simplePropertyAssignment();
    }

    for (i = 0; i < wrappedMethods.length; i++) {
        const wrappedEntry = wrappedMethods[i];
        const target =
            wrappedEntry.key === "value" ? method : method[wrappedEntry.key];
        const state = {
            key: wrappedEntry.key,
            object: object,
            property: property,
            previousDescriptor: clonePropertyDescriptor(wrappedMethodDesc),
            stackTraceError: new Error("Stack Trace for original"),
            target: target,
            wrapScope: wrapScope,
            wrappedMethod: wrappedEntry.wrappedMethod,
        };

        registerTargetState(state);
        defineTargetMetadata(target, property, wrappedEntry.key);

        if (!hasES5Support) {
            mirrorProperties(target, wrappedEntry.wrappedMethod);
        }
    }

    return method;
}
