import commons from "@sinonjs/commons";

const { prototypes, valueToString } = commons;
import getPropertyDescriptor from "./get-property-descriptor.js";
import extend from "./extend.js";
import sinonType from "./sinon-type.js";

const { hasOwnProperty } = prototypes.object;
const { push } = prototypes.array;

const noop = () => {};

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

function getAccessor(object, property, method) {
    const accessors = ["get", "set"];
    const descriptor = getPropertyDescriptor(object, property);

    for (let i = 0; i < accessors.length; i++) {
        if (
            descriptor[accessors[i]] &&
            descriptor[accessors[i]].name === method.name
        ) {
            return accessors[i];
        }
    }
    return null;
}

const hasES5Support = "keys" in Object;

// ===== WeakMap-based external registry for concurrent access isolation =====
//
// Problem: In Node.js parallel testing, multiple workers share the same module's
// memory references. The old approach stored original method/descriptor state as
// hidden properties on the wrapper function (e.g., wrapper.wrappedMethod,
// wrapper.restore). When Worker A and Worker B concurrently stub the same
// object's same method, the second stub's state overwrites the first; if A
// restores first, it incorrectly restores B's stub as the original, crashing B's
// tests.
//
// Solution: Replace hidden properties with a WeakMap-based external registry.
// Each (object, property) pair maintains a stack of wrappers. Different sandboxes
// can concurrently wrap the same method; each restore only affects its own entry,
// and the object's property always reflects the top of the stack.
//
// Data structures:
//
// wrapperState: WeakMap<function, WrapperState>
//   Stores per-wrapper state externally instead of on the wrapper itself.
//   WrapperState = {
//     object: object,                              // the target object
//     property: string | symbol,                   // the property name
//     wrappedMethods: function[],                  // the TRUE original methods
//     wrappedMethodDesc: PropertyDescriptor,       // the TRUE original descriptor
//     owned: boolean,                              // whether the property was originally owned
//     stackTraceError: Error,                      // stack trace for debugging
//   }
//
// objectPropertyStack: WeakMap<object, Map<propertyKey, StackData>>
//   Per-(object, property) stack of wrappers for concurrent access isolation.
//   StackData = {
//     originalDescriptor: PropertyDescriptor,      // the TRUE original descriptor before any wrapping
//     owned: boolean,                              // whether the property was originally owned
//     entries: Array<{                             // stack of wrappers in order (bottom = first, top = last)
//       wrapper: function | object,                // the wrapper function or descriptor object
//       methodDesc: PropertyDescriptor | null,     // the descriptor used to define this wrapper (null for non-ES5)
//     }>
//   }

const wrapperState = new WeakMap();

const objectPropertyStack = new WeakMap();

function getStack(object, property) {
    let propMap = objectPropertyStack.get(object);
    if (!propMap) {
        propMap = new Map();
        objectPropertyStack.set(object, propMap);
    }
    let stackData = propMap.get(property);
    if (!stackData) {
        stackData = {
            originalDescriptor: null,
            owned: false,
            entries: [],
        };
        propMap.set(property, stackData);
    }
    return stackData;
}

function extractOriginalMethods(descriptor) {
    if (!descriptor) {
        return [];
    }
    const methods = [];
    if ("value" in descriptor && isFunction(descriptor.value)) {
        methods.push(descriptor.value);
    }
    if (descriptor.get) {
        methods.push(descriptor.get);
    }
    if (descriptor.set) {
        methods.push(descriptor.set);
    }
    return methods;
}

export default function wrapMethod(object, property, method) {
    if (!object) {
        throw new TypeError("Should wrap property of object");
    }

    if (typeof method !== "function" && typeof method !== "object") {
        throw new TypeError(
            "Method wrapper should be a function or a property descriptor",
        );
    }

    function checkWrappedMethod(wrappedMethod) {
        if (wrapperState.has(wrappedMethod)) {
            return;
        }

        let error;

        if (!isFunction(wrappedMethod)) {
            error = new TypeError(
                `Attempted to wrap ${typeof wrappedMethod} property ${valueToString(
                    property,
                )} as function`,
            );
        } else if (wrappedMethod.restore && wrappedMethod.restore.sinon) {
            error = new TypeError(
                `Attempted to wrap ${valueToString(
                    property,
                )} which is already wrapped`,
            );
        } else if (wrappedMethod.calledBefore) {
            const verb = wrappedMethod.returns ? "stubbed" : "spied on";
            error = new TypeError(
                `Attempted to wrap ${valueToString(
                    property,
                )} which is already ${verb}`,
            );
        }

        if (error) {
            const stError = getStackTraceError(wrappedMethod);
            if (stError) {
                error.stack += `\n--------------\n${stError.stack}`;
            }
            throw error;
        }
    }

    let error, wrappedMethod, i, wrappedMethodDesc, target, accessor;

    const wrappedMethods = [];

    function simplePropertyAssignment() {
        wrappedMethod = object[property];
        checkWrappedMethod(wrappedMethod);
        object[property] = method;
        method.displayName = property;
    }

    const owned = object.hasOwnProperty
        ? object.hasOwnProperty(property)
        : hasOwnProperty(object, property);

    const stackData = getStack(object, property);

    if (hasES5Support) {
        const methodDesc =
            typeof method === "function" ? { value: method } : method;
        wrappedMethodDesc = getPropertyDescriptor(object, property);

        if (!wrappedMethodDesc) {
            error = new TypeError(
                `Attempted to wrap ${typeof wrappedMethod} property ${property} as function`,
            );
        }

        if (
            !error &&
            wrappedMethodDesc.restore &&
            wrappedMethodDesc.restore.sinon
        ) {
            const descValue =
                wrappedMethodDesc.value ||
                wrappedMethodDesc.get ||
                wrappedMethodDesc.set;
            if (!wrapperState.has(descValue)) {
                error = new TypeError(
                    `Attempted to wrap ${property} which is already wrapped`,
                );
            }
        }

        if (error) {
            const descValue =
                wrappedMethodDesc &&
                (wrappedMethodDesc.value ||
                    wrappedMethodDesc.get ||
                    wrappedMethodDesc.set);
            const stError = descValue
                ? getStackTraceError(descValue)
                : null;
            if (stError) {
                error.stack += `\n--------------\n${stError.stack}`;
            }
            throw error;
        }

        const types = Object.keys(methodDesc);
        for (i = 0; i < types.length; i++) {
            wrappedMethod = wrappedMethodDesc[types[i]];
            checkWrappedMethod(wrappedMethod);
            push(wrappedMethods, wrappedMethod);
        }

        if (stackData.entries.length === 0) {
            stackData.originalDescriptor = wrappedMethodDesc;
            stackData.owned = owned;
        }

        const trueOriginalMethods =
            stackData.entries.length > 0
                ? extractOriginalMethods(stackData.originalDescriptor)
                : wrappedMethods;

        mirrorProperties(methodDesc, wrappedMethodDesc);
        for (i = 0; i < types.length; i++) {
            mirrorProperties(methodDesc[types[i]], wrappedMethodDesc[types[i]]);
        }

        if (!owned) {
            methodDesc.configurable = true;
        }

        const storedMethodDesc = Object.assign({}, methodDesc);

        push(stackData.entries, {
            wrapper: method,
            methodDesc: storedMethodDesc,
        });

        Object.defineProperty(object, property, methodDesc);

        if (typeof method === "function" && object[property] !== method) {
            delete object[property];
            simplePropertyAssignment();
        }

        wrapperState.set(method, {
            object: object,
            property: property,
            wrappedMethods:
                trueOriginalMethods.length > 0
                    ? trueOriginalMethods
                    : wrappedMethods,
            wrappedMethodDesc:
                stackData.originalDescriptor || wrappedMethodDesc,
            owned: stackData.owned,
            stackTraceError: new Error("Stack Trace for original"),
        });
    } else {
        simplePropertyAssignment();

        if (stackData.entries.length === 0) {
            stackData.originalDescriptor = {
                value: wrappedMethod,
                writable: true,
                configurable: true,
                enumerable: true,
            };
            stackData.owned = owned;
        }

        push(stackData.entries, {
            wrapper: method,
            methodDesc: null,
        });

        wrapperState.set(method, {
            object: object,
            property: property,
            wrappedMethods: [wrappedMethod],
            wrappedMethodDesc: stackData.originalDescriptor,
            owned: stackData.owned,
            stackTraceError: new Error("Stack Trace for original"),
        });
    }

    function restore() {
        const state = wrapperState.get(this);
        if (!state) {
            return;
        }

        const {
            object: obj,
            property: prop,
            wrappedMethodDesc: desc,
            owned: isOwned,
        } = state;
        const currentStackData = getStack(obj, prop);

        const entryIndex = currentStackData.entries.findIndex(
            (entry) => entry.wrapper === this,
        );
        if (entryIndex === -1) {
            return;
        }

        currentStackData.entries.splice(entryIndex, 1);

        const wasTop = entryIndex === currentStackData.entries.length;

        if (wasTop) {
            if (currentStackData.entries.length === 0) {
                restoreOriginalDescriptor(
                    obj,
                    prop,
                    desc,
                    isOwned,
                    currentStackData,
                    this,
                );

                const propMap = objectPropertyStack.get(obj);
                if (propMap) {
                    propMap.delete(prop);
                }
            } else {
                const newTop =
                    currentStackData.entries[
                        currentStackData.entries.length - 1
                    ];
                if (newTop.methodDesc && hasES5Support) {
                    Object.defineProperty(obj, prop, newTop.methodDesc);
                } else {
                    obj[prop] = newTop.wrapper;
                }
            }
        }

        wrapperState.delete(this);
    }

    function restoreOriginalDescriptor(
        obj,
        prop,
        desc,
        isOwned,
        currentStackData,
        wrapper,
    ) {
        const trueOriginalMethods = extractOriginalMethods(
            currentStackData.originalDescriptor,
        );
        const originalMethod =
            trueOriginalMethods.length > 0
                ? trueOriginalMethods[0]
                : getWrappedMethod(wrapper);

        const accessorType = getAccessor(obj, prop, originalMethod);
        let descriptor;

        if (accessorType) {
            if (!isOwned) {
                try {
                    delete obj[prop][accessorType];
                } catch (e) {} // eslint-disable-line no-empty
            } else if (hasES5Support) {
                descriptor = getPropertyDescriptor(obj, prop);
                descriptor[accessorType] = desc[accessorType];
                Object.defineProperty(obj, prop, descriptor);
            }

            if (hasES5Support) {
                descriptor = getPropertyDescriptor(obj, prop);
                if (descriptor && descriptor.value === wrapper) {
                    obj[prop][accessorType] = originalMethod;
                }
            } else {
                if (obj[prop][accessorType] === wrapper) {
                    obj[prop][accessorType] = originalMethod;
                }
            }
        } else {
            if (!isOwned) {
                try {
                    delete obj[prop];
                } catch (e) {} // eslint-disable-line no-empty
            } else if (hasES5Support) {
                Object.defineProperty(obj, prop, desc);
            }

            if (hasES5Support) {
                descriptor = getPropertyDescriptor(obj, prop);
                if (descriptor && descriptor.value === wrapper) {
                    obj[prop] = originalMethod;
                }
            } else {
                if (obj[prop] === wrapper) {
                    obj[prop] = originalMethod;
                }
            }
        }

        if (sinonType.get(obj) === "stub-instance") {
            obj[prop] = noop;
        }
    }

    function extendObjectWithWrappedMethods() {
        const state = wrapperState.get(method);
        const methodsToExpose = state ? state.wrappedMethods : wrappedMethods;

        for (i = 0; i < methodsToExpose.length; i++) {
            accessor = getAccessor(object, property, methodsToExpose[i]);
            target = accessor ? method[accessor] : method;
            extend.nonEnum(target, {
                displayName: property,
                wrappedMethod: methodsToExpose[i],

                stackTraceError: state
                    ? state.stackTraceError
                    : new Error("Stack Trace for original"),

                restore: restore,
            });

            target.restore.sinon = true;
            if (!hasES5Support) {
                mirrorProperties(target, wrappedMethod);
            }
        }
    }

    extendObjectWithWrappedMethods();

    return method;
}

export function getWrappedMethod(wrapper) {
    const state = wrapperState.get(wrapper);
    if (state && state.wrappedMethods.length > 0) {
        return state.wrappedMethods[0];
    }
    if (wrapper && wrapper.wrappedMethod) {
        return wrapper.wrappedMethod;
    }
    return undefined;
}

export function getStackTraceError(wrapper) {
    const state = wrapperState.get(wrapper);
    if (state) {
        return state.stackTraceError;
    }
    if (wrapper && wrapper.stackTraceError) {
        return wrapper.stackTraceError;
    }
    return undefined;
}
