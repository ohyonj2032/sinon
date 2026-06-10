import commons from "@sinonjs/commons";

const { prototypes, valueToString } = commons;
import getPropertyDescriptor from "./get-property-descriptor.js";
import extend from "./extend.js";
import sinonType from "./sinon-type.js";

const { hasOwnProperty } = prototypes.object;
const { push } = prototypes.array;

/**
 * @callback SinonFunction
 * @param {...unknown} args
 * @returns {unknown}
 */

// eslint-disable-next-line no-empty-function
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

// Cheap way to detect if we have ES5 support.
const hasES5Support = "keys" in Object;

// The external registry for isolating concurrent stubs on the same object
const wrapRegistry = new WeakMap();

/**
 * Wraps a method on an object with another function.
 *
 * @param {object} object The object containing the method
 * @param {string | symbol} property The property name of the method to wrap
 * @param {SinonFunction|object} method The wrapper function or a property descriptor
 * @returns {SinonFunction} The wrapped method
 */
export default function wrapMethod(object, property, method) {
    if (!object) {
        throw new TypeError("Should wrap property of object");
    }

    if (typeof method !== "function" && typeof method !== "object") {
        throw new TypeError(
            "Method wrapper should be a function or a property descriptor",
        );
    }

    let objectState = wrapRegistry.get(object);
    if (!objectState) {
        objectState = new Map();
        wrapRegistry.set(object, objectState);
    }

    let propState = objectState.get(property);
    if (!propState) {
        propState = {
            originalDescriptor: getPropertyDescriptor(object, property),
            wrappers: new Set(),
            owned: object.hasOwnProperty
                ? object.hasOwnProperty(property)
                : hasOwnProperty(object, property)
        };
        objectState.set(property, propState);
    }

    function checkWrappedMethod(wrappedMethod) {
        let error;

        if (!isFunction(wrappedMethod)) {
            error = new TypeError(
                `Attempted to wrap ${typeof wrappedMethod} property ${valueToString(
                    property,
                )} as function`,
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
            if (wrappedMethod && wrappedMethod.stackTraceError) {
                error.stack += `\n--------------\n${wrappedMethod.stackTraceError.stack}`;
            }
            throw error;
        }
    }

    let error, wrappedMethod, i, target, accessor;

    const wrappedMethods = [];
    const wrappedMethodDesc = propState.originalDescriptor;
    const owned = propState.owned;

    propState.wrappers.add(method);

    function simplePropertyAssignment() {
        wrappedMethod = object[property];
        checkWrappedMethod(wrappedMethod);
        object[property] = method;
        method.displayName = property;
    }

    if (hasES5Support) {
        const methodDesc =
            typeof method === "function" ? { value: method } : method;

        if (!wrappedMethodDesc) {
            error = new TypeError(
                `Attempted to wrap ${typeof wrappedMethod} property ${property} as function`,
            );
        }
        if (error) {
            if (wrappedMethodDesc && wrappedMethodDesc.stackTraceError) {
                error.stack += `\n--------------\n${wrappedMethodDesc.stackTraceError.stack}`;
            }
            throw error;
        }

        const types = Object.keys(methodDesc);
        for (i = 0; i < types.length; i++) {
            wrappedMethod = wrappedMethodDesc[types[i]];
            checkWrappedMethod(wrappedMethod);
            push(wrappedMethods, wrappedMethod);
        }

        mirrorProperties(methodDesc, wrappedMethodDesc);
        for (i = 0; i < types.length; i++) {
            mirrorProperties(methodDesc[types[i]], wrappedMethodDesc[types[i]]);
        }

        // you are not allowed to flip the configurable prop on an
        // existing descriptor to anything but false (#2514)
        if (!owned) {
            methodDesc.configurable = true;
        }

        Object.defineProperty(object, property, methodDesc);

        // catch failing assignment
        // this is the converse of the check in `.restore` below
        if (typeof method === "function" && object[property] !== method) {
            // correct any wrongdoings caused by the defineProperty call above,
            // such as adding new items (if object was a Storage object)
            delete object[property];
            simplePropertyAssignment();
        }
    } else {
        simplePropertyAssignment();
    }

    function restore() {
        accessor = getAccessor(object, property, this.wrappedMethod);
        let descriptor;

        propState.wrappers.delete(method);

        if (propState.wrappers.size > 0) {
            return;
        }

        objectState.delete(property);
        if (objectState.size === 0) {
            wrapRegistry.delete(object);
        }

        // For prototype properties try to reset by delete first.
        // If this fails (ex: localStorage on mobile safari) then force a reset
        // via direct assignment.
        if (accessor) {
            if (!owned) {
                try {
                    // In some cases `delete` may throw an error
                    delete object[property][accessor];
                } catch (e) {} // eslint-disable-line no-empty
                // For native code functions `delete` fails without throwing an error
                // on Chrome < 43, PhantomJS, etc.
            } else if (hasES5Support) {
                descriptor = getPropertyDescriptor(object, property);
                descriptor[accessor] = wrappedMethodDesc[accessor];
                Object.defineProperty(object, property, descriptor);
            }

            if (hasES5Support) {
                descriptor = getPropertyDescriptor(object, property);
                if (descriptor && descriptor.value === target) {
                    object[property][accessor] = this.wrappedMethod;
                }
            } else {
                // Use strict equality comparison to check failures then force a reset
                // via direct assignment.
                if (object[property][accessor] === target) {
                    object[property][accessor] = this.wrappedMethod;
                }
            }
        } else {
            if (!owned) {
                try {
                    delete object[property];
                } catch (e) {} // eslint-disable-line no-empty
            } else if (hasES5Support) {
                Object.defineProperty(object, property, wrappedMethodDesc);
            }

            if (hasES5Support) {
                descriptor = getPropertyDescriptor(object, property);
                if (descriptor && descriptor.value === target) {
                    object[property] = this.wrappedMethod;
                }
            } else {
                if (object[property] === target) {
                    object[property] = this.wrappedMethod;
                }
            }
        }
        if (sinonType.get(object) === "stub-instance") {
            // this is simply to avoid errors after restoring if something should
            // traverse the object in a cleanup phase, ref #2477
            object[property] = noop;
        }
    }

    function extendObjectWithWrappedMethods() {
        for (i = 0; i < wrappedMethods.length; i++) {
            accessor = getAccessor(object, property, wrappedMethods[i]);
            target = accessor ? method[accessor] : method;
            extend.nonEnum(target, {
                displayName: property,
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
