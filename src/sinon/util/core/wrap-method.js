import commons from "@sinonjs/commons";

const { prototypes, valueToString } = commons;
import getPropertyDescriptor from "./get-property-descriptor.js";
import extend from "./extend.js";
import sinonType from "./sinon-type.js";

const { hasOwnProperty } = prototypes.object;
const { push } = prototypes.array;

// Cross-module shared registry.
//
// When an application mixes `sinon` (CJS) with `sinon/esm` (ESM), Node.js
// instantiates two independent module graphs. The per-module `wrapMethod`
// therefore has its own closure state by default, which means a stub installed
// by the ESM copy becomes invisible to the CJS copy (and vice versa). We lift
// the "which objects/properties have been wrapped by which module" tracking
// onto `globalThis` using a well-known symbol so every copy of Sinon — CJS,
// ESM, or even duplicated copies from `node_modules/` — converges on a single
// WeakMap.
const SINON_REGISTRY_KEY =
    typeof Symbol !== "undefined" && Symbol.for
        ? Symbol.for("sinon.registry.sharedState")
        : "__sinon_shared_state_registry__";

function getSharedRegistry() {
    if (typeof globalThis === "undefined") {
        // Fallback for very old environments; a plain object is still better
        // than a per-module WeakMap.
        return {};
    }
    if (!globalThis[SINON_REGISTRY_KEY]) {
        // A WeakMap is used as the primary tracking store so that objects can
        // be garbage-collected normally. A secondary Map stores a handful of
        // module-level booleans (init guards, version markers) keyed by
        // strings.
        globalThis[SINON_REGISTRY_KEY] = {
            wrappedMethods: new WeakMap(),
            activeSandboxes: new WeakSet(),
        };
    }
    return globalThis[SINON_REGISTRY_KEY];
}

const sharedRegistry = getSharedRegistry();

function getWrappedMethodsForObject(object) {
    let entry = sharedRegistry.wrappedMethods.get(object);
    if (!entry) {
        entry = new Map();
        sharedRegistry.wrappedMethods.set(object, entry);
    }
    return entry;
}

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

    // Consult the cross-module shared registry BEFORE checking per-object
    // `.restore.sinon` markers. This is what fixes the CJS/ESM double-package
    // trap: the ESM copy of Sinon must be able to see that the CJS copy
    // already wrapped `object[property]` and vice versa.
    const sharedForObject = getWrappedMethodsForObject(object);
    if (sharedForObject.has(property)) {
        const error = new TypeError(
            `Attempted to wrap ${valueToString(
                property,
            )} which is already wrapped`,
        );
        const prior = sharedForObject.get(property);
        if (prior && prior.stackTraceError) {
            error.stack += `\n--------------\n${prior.stackTraceError.stack}`;
        }
        throw error;
    }

    function checkWrappedMethod(wrappedMethod) {
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
            if (wrappedMethod && wrappedMethod.stackTraceError) {
                error.stack += `\n--------------\n${wrappedMethod.stackTraceError.stack}`;
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

    // Firefox has a problem when using hasOwn.call on objects from other frames.
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
        } else if (
            wrappedMethodDesc.restore &&
            wrappedMethodDesc.restore.sinon
        ) {
            error = new TypeError(
                `Attempted to wrap ${property} which is already wrapped`,
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

        // Unregister the wrapped method from the cross-module shared registry
        // so the property can be re-wrapped later (by any copy of Sinon).
        // Guarded with `.has()` to avoid creating an empty entry for objects
        // that were never wrapped through the shared path.
        const current = sharedRegistry.wrappedMethods.get(object);
        if (current && current.has(property)) {
            current.delete(property);
        }
    }

    function extendObjectWithWrappedMethods() {
        for (i = 0; i < wrappedMethods.length; i++) {
            accessor = getAccessor(object, property, wrappedMethods[i]);
            target = accessor ? method[accessor] : method;
            extend.nonEnum(target, {
                displayName: property,
                wrappedMethod: wrappedMethods[i],

                // Set up an Error object for a stack trace which can be used later to find what line of
                // code the original method was created on.
                stackTraceError: new Error("Stack Trace for original"),

                restore: restore,
            });

            target.restore.sinon = true;
            if (!hasES5Support) {
                mirrorProperties(target, wrappedMethod);
            }
        }
    }

    extendObjectWithWrappedMethods();

    // Register the wrapped method in the cross-module shared registry so that
    // a different copy of Sinon (e.g. the ESM copy) can observe it.
    sharedForObject.set(property, method);

    return method;
}
