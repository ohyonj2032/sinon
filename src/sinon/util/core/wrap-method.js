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

/**
 * WeakMap-based external registry for wrapper state.
 *
 * Design:
 *   Key: wrapper function (the stub/spy placed on object[property])
 *   Value: { object, property, descriptor, owned, wrappedMethods }
 *
 * By using the wrapper function (which is unique per wrapMethod call) as the
 * WeakMap key, each sandbox/worker's wrapMethod call gets its own isolated
 * storage cell.  The WeakMap ensures automatic GC when the wrapper is collected.
 *
 * This replaces the previous approach of capturing state in closures and
 * hanging hidden properties on the replaced object.
 */
const wrapperStateRegistry = new WeakMap();

/**
 * Per-(object, property) stub chain.
 *
 * Design:
 *   Key: object (WeakMap for GC)
 *   Value: Map<property, ChainEntry[]>
 *   ChainEntry: { wrapper }
 *
 * The array acts as a LIFO stack.  When wrapping, a new entry is pushed.
 * When restoring, the entry is located: if it is the top (last) entry,
 * the object is actually restored; if it is not top, the entry is merely
 * removed from the chain without touching the object (another wrapper has
 * taken over in the meantime).
 *
 * This ensures multi-worker concurrent restore operations are safe:
 * a restore() call from one sandbox will never accidentally destroy the
 * stub put in place by another sandbox.
 */
const stubChainRegistry = new WeakMap();

function getChain(object, property) {
    let perObj = stubChainRegistry.get(object);
    if (!perObj) {
        perObj = new Map();
        stubChainRegistry.set(object, perObj);
    }
    let chain = perObj.get(property);
    if (!chain) {
        chain = [];
        perObj.set(property, chain);
    }
    return chain;
}

function pushChain(object, property, wrapper) {
    const chain = getChain(object, property);
    push(chain, { wrapper });
}

/**
 * Removes this wrapper from the chain.
 * Returns true if this wrapper was the TOP (last) entry, meaning the caller
 * should actually restore the object property.
 * Returns false if this wrapper was NOT top, meaning another wrapper has
 * taken over and the caller should NOT modify the object.
 */
function popChain(object, property, wrapper) {
    const chain = getChain(object, property);
    const len = chain.length;
    for (let i = len - 1; i >= 0; i--) {
        if (chain[i].wrapper === wrapper) {
            const isTop = i === len - 1;
            chain.splice(i, 1);
            return isTop;
        }
    }
    return false;
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

    function checkWrappedMethod(wrappedMethod) {
        let error;

        if (!isFunction(wrappedMethod)) {
            error = new TypeError(
                `Attempted to wrap ${typeof wrappedMethod} property ${valueToString(
                    property,
                )} as function`,
            );
        } else if (
            wrappedMethod.restore &&
            wrappedMethod.restore.sinon &&
            !wrappedMethod.calledBefore
        ) {
            // Only throw "already wrapped" for plain function wrappers
            // (non-proxy) that were placed by a previous direct wrapMethod
            // call without going through spy()/stub().  Spy/stub proxies
            // (which have `calledBefore`) are intentionally allowed to be
            // re-wrapped so that different sandboxes or parallel test
            // workers can concurrently stub the same object method.
            // The stub chain registry (LIFO stack) ensures safe restore
            // ordering even when multiple wrappers coexist.
            error = new TypeError(
                `Attempted to wrap ${valueToString(
                    property,
                )} which is already wrapped`,
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

        // Retrieve the state that was stored for THIS specific wrapper.
        const state = wrapperStateRegistry.get(this);
        if (!state) {
            // Already restored – nothing to do.
            return;
        }

        // Check whether this wrapper is allowed to actually restore the
        // object property.  The chain-based check ensures that only the
        // top-most (most recently applied) wrapper gets to touch the
        // object.  If another wrapper was applied later, this wrapper
        // simply removes itself from the chain without modifying the
        // object – thereby leaving the other wrapper's stub intact.
        const isTop = popChain(object, property, this);

        if (!isTop) {
            // Another wrapper has taken over.  Do NOT touch the object.
            wrapperStateRegistry.delete(this);
            return;
        }

        const storedDesc = state.descriptor;
        const storedOwned = state.owned;
        const storedWrappedMethods = state.wrappedMethods;

        let descriptor;

        if (accessor) {
            if (!storedOwned) {
                try {
                    // In some cases `delete` may throw an error
                    delete object[property][accessor];
                } catch (e) {} // eslint-disable-line no-empty
                // For native code functions `delete` fails without throwing an error
                // on Chrome < 43, PhantomJS, etc.
            } else if (hasES5Support) {
                descriptor = getPropertyDescriptor(object, property);
                descriptor[accessor] = storedDesc[accessor];
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
            if (!storedOwned) {
                try {
                    delete object[property];
                } catch (e) {} // eslint-disable-line no-empty
            } else if (hasES5Support) {
                Object.defineProperty(object, property, storedDesc);
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

        // Clean up the registry – this wrapper is done.
        wrapperStateRegistry.delete(this);
    }

    function extendObjectWithWrappedMethods() {
        for (i = 0; i < wrappedMethods.length; i++) {
            accessor = getAccessor(object, property, wrappedMethods[i]);
            target = accessor ? method[accessor] : method;

            // Store wrapper state in the external WeakMap registry instead of
            // relying on closure-captured variables.  Each target (the actual
            // function placed on the object) gets its own entry keyed by the
            // target function itself.
            wrapperStateRegistry.set(target, {
                object: object,
                property: property,
                descriptor: wrappedMethodDesc,
                owned: owned,
                wrappedMethods: wrappedMethods,
            });

            // Push this wrapper onto the per-(object, property) stub chain.
            pushChain(object, property, target);

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

    return method;
}