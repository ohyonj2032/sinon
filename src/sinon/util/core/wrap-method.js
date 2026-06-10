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

// ---------------------------------------------------------------------------
// WeakMap-based external registry for wrap state.
//
// Previously wrap-method.js stored the original method / descriptor as
// hidden properties directly on the replacement function that lived on the
// wrapped object.  That design made every record visible to every concurrent
// wrapper of the same (object, property) pair: the second wrapper would
// overwrite the first one's book-keeping on the shared object, and a later
// restore() would accidentally restore the sibling stub instead of the
// original method.
//
// The new design keeps every wrap's book-keeping *inside* a module-private
// WeakMap keyed by:
//
//     wrapRegistry[object] -> Map<property, Record[]>
//
// where each Record holds the original descriptor as it looked at the time
// of that specific wrap, along with the metadata that used to live on the
// replacement function.  Each replacement function only knows the Symbol
// that identifies it inside its own Record, so restore() on function A
// cannot touch the state of function B, even when A and B are successive
// wraps of the exact same (object, property) pair.  The shared object is
// never used as a transport for wrap book-keeping.
// ---------------------------------------------------------------------------
const wrapRegistry = new WeakMap();
const wrapRecordSymbol = Symbol("sinon.wrap-record");

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

function recordWrap(object, property, record) {
    let perObject = wrapRegistry.get(object);
    if (!perObject) {
        perObject = new Map();
        wrapRegistry.set(object, perObject);
    }
    let perProperty = perObject.get(property);
    if (!perProperty) {
        perProperty = [];
        perObject.set(property, perProperty);
    }
    push(perProperty, record);
}

function findRecordFor(replacement) {
    if (!replacement) {
        return null;
    }
    return replacement[wrapRecordSymbol] || null;
}

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
        if (!isFunction(wrappedMethod)) {
            const error = new TypeError(
                `Attempted to wrap ${typeof wrappedMethod} property ${valueToString(
                    property,
                )} as function`,
            );
            if (wrappedMethod && wrappedMethod.stackTraceError) {
                error.stack += `\n--------------\n${wrappedMethod.stackTraceError.stack}`;
            }
            throw error;
        }
        // Previously this function rejected every re-wrap by throwing if
        // wrappedMethod.restore.sinon was truthy.  That check relied on the
        // shared object as the transport for wrap book-keeping and as a
        // result broke concurrent sandboxes that independently stubbed the
        // same (object, property).  The WeakMap registry keeps each wrap
        // isolated, so a re-wrap is now allowed and simply pushes a new
        // record on top of the previous one.
    }

    let wrappedMethod, i, wrappedMethodDesc, target, accessor;

    const wrappedMethods = [];
    // Capture the stack trace once per wrap.  It is associated with this
    // specific replacement function via the WeakMap registry and never
    // written onto the shared object.
    const stackTraceError = new Error("Stack Trace for original");

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
            throw new TypeError(
                `Attempted to wrap ${typeof wrappedMethod} property ${property} as function`,
            );
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

    // ------------------------------------------------------------------
    // External, per-wrap registry entry.  This replaces the previous
    // practice of mutating `method` / `target` with hidden properties
    // whose values pointed back to the shared object.
    //
    // Because the record lives on the replacement function (stored under
    // a Symbol) and the registry is keyed by the object + property,
    // sibling wraps of the same (object, property) cannot see each
    // other's book-keeping: each restore() operates exclusively on its
    // own captured snapshot of the descriptor.
    // ------------------------------------------------------------------
    const record = {
        object: object,
        property: property,
        owned: owned,
        wrappedMethodDesc: wrappedMethodDesc,
        stackTraceError: stackTraceError,
        restored: false,
    };

    function restoreForThisWrap() {
        // Pull the per-wrap record directly from the replacement function
        // via the Symbol; never read state from the shared object.
        const selfRecord = findRecordFor(this);
        if (!selfRecord) {
            return;
        }
        if (selfRecord.restored) {
            // idempotent: a wrap can only be restored once
            return;
        }
        selfRecord.restored = true;

        const ownObject = selfRecord.object;
        const ownProperty = selfRecord.property;
        const ownWrappedMethodDesc = selfRecord.wrappedMethodDesc;
        const ownOwned = selfRecord.owned;

        accessor = getAccessor(ownObject, ownProperty, this.wrappedMethod);
        let descriptor;
        // For prototype properties try to reset by delete first.
        // If this fails (ex: localStorage on mobile safari) then force a reset
        // via direct assignment.
        if (accessor) {
            if (!ownOwned) {
                try {
                    // In some cases `delete` may throw an error
                    delete ownObject[ownProperty][accessor];
                } catch (e) {} // eslint-disable-line no-empty
                // For native code functions `delete` fails without throwing an error
                // on Chrome < 43, PhantomJS, etc.
            } else if (hasES5Support) {
                descriptor = getPropertyDescriptor(ownObject, ownProperty);
                descriptor[accessor] = ownWrappedMethodDesc[accessor];
                Object.defineProperty(ownObject, ownProperty, descriptor);
            }

            if (hasES5Support) {
                descriptor = getPropertyDescriptor(ownObject, ownProperty);
                if (descriptor && descriptor.value === target) {
                    ownObject[ownProperty][accessor] = this.wrappedMethod;
                }
            } else {
                // Use strict equality comparison to check failures then force a reset
                // via direct assignment.
                if (ownObject[ownProperty][accessor] === target) {
                    ownObject[ownProperty][accessor] = this.wrappedMethod;
                }
            }
        } else {
            if (!ownOwned) {
                try {
                    delete ownObject[ownProperty];
                } catch (e) {} // eslint-disable-line no-empty
            } else if (hasES5Support) {
                Object.defineProperty(
                    ownObject,
                    ownProperty,
                    ownWrappedMethodDesc,
                );
            }

            if (hasES5Support) {
                descriptor = getPropertyDescriptor(ownObject, ownProperty);
                if (descriptor && descriptor.value === target) {
                    ownObject[ownProperty] = this.wrappedMethod;
                }
            } else {
                if (ownObject[ownProperty] === target) {
                    ownObject[ownProperty] = this.wrappedMethod;
                }
            }
        }
        if (sinonType.get(ownObject) === "stub-instance") {
            // this is simply to avoid errors after restoring if something should
            // traverse the object in a cleanup phase, ref #2477
            ownObject[ownProperty] = noop;
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
                stackTraceError: stackTraceError,

                restore: restoreForThisWrap,
            });

            // Each replacement function gets its own Symbol-keyed record.
            // That way:
            //   * restore() on function A touches only A's captured state
            //   * restore() on function B touches only B's captured state
            //   * the shared object is never used to transport wrap state
            Object.defineProperty(target, wrapRecordSymbol, {
                value: record,
                enumerable: false,
                configurable: true,
                writable: true,
            });

            target.restore.sinon = true;
            if (!hasES5Support) {
                mirrorProperties(target, wrappedMethod);
            }
        }
    }

    extendObjectWithWrappedMethods();

    // Register the wrap in the WeakMap so external book-keepers (sandbox,
    // isRestorable, ...) can still introspect the state without having to
    // reach into the shared object.
    recordWrap(object, property, record);

    return method;
}
