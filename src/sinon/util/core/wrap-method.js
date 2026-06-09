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
    if (!source || typeof target !== "function") {
        return;
    }

    for (const prop in source) {
        if (!hasOwnProperty(target, prop)) {
            target[prop] = source[prop];
        }
    }
}

function checkWrappedMethod(wrappedMethod, property) {
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

function toPropertyDescriptor(descriptor) {
    if (!descriptor) {
        return descriptor;
    }

    const copy = {};
    const keys = [
        "configurable",
        "enumerable",
        "writable",
        "value",
        "get",
        "set",
    ];

    for (const key of keys) {
        if (Object.prototype.hasOwnProperty.call(descriptor, key)) {
            copy[key] = descriptor[key];
        }
    }

    return copy;
}

function getMethodDescriptor(method) {
    return typeof method === "function" ? { value: method } : method;
}

function isAccessorDescriptor(descriptor) {
    return descriptor && ("get" in descriptor || "set" in descriptor);
}

function getReplacementKeys(methodDescriptor) {
    if (isAccessorDescriptor(methodDescriptor)) {
        return ["get", "set"].filter(function (key) {
            return typeof methodDescriptor[key] === "function";
        });
    }

    return ["value"];
}

function composeReplacementDescriptor(originalDescriptor, methodDescriptor, owned) {
    const descriptor = toPropertyDescriptor(originalDescriptor) || {};

    for (const key of Object.keys(methodDescriptor)) {
        descriptor[key] = methodDescriptor[key];
    }

    if (isAccessorDescriptor(methodDescriptor)) {
        delete descriptor.value;
        delete descriptor.writable;
    } else {
        delete descriptor.get;
        delete descriptor.set;
    }

    if (!owned) {
        descriptor.configurable = true;
    }

    return descriptor;
}

function getWrappedMethodRecords(originalDescriptor, methodDescriptor, property) {
    const records = [];

    for (const key of getReplacementKeys(methodDescriptor)) {
        const wrappedMethod = originalDescriptor[key];
        checkWrappedMethod(wrappedMethod, property);
        push(records, {
            accessor: key === "value" ? null : key,
            wrappedMethod: wrappedMethod,
            target: key === "value" ? methodDescriptor.value : methodDescriptor[key],
        });
    }

    return records;
}

function attachRestoreMetadata(method, records, property, restore) {
    for (const record of records) {
        extend.nonEnum(record.target, {
            displayName: property,
            wrappedMethod: record.wrappedMethod,
            stackTraceError: new Error("Stack Trace for original"),
            restore: restore,
        });

        record.target.restore.sinon = true;
    }

    if (typeof method === "object") {
        const target = records[0] && records[0].target;
        if (target && target.restore) {
            extend.nonEnum(method, {
                restore: target.restore,
            });
        }
    }
}

const hasES5Support = "keys" in Object;

const replacementStrategies = {
    assignment: {
        match: function () {
            return !hasES5Support;
        },
        apply: function (context) {
            const wrappedMethod = context.object[context.property];
            checkWrappedMethod(wrappedMethod, context.property);
            context.object[context.property] = context.method;
            context.method.displayName = context.property;
            context.records = [
                {
                    accessor: null,
                    wrappedMethod: wrappedMethod,
                    target: context.method,
                },
            ];
        },
        restore: function (context, target) {
            if (!context.owned) {
                try {
                    delete context.object[context.property];
                } catch (e) {}
            }

            if (context.object[context.property] === target) {
                context.object[context.property] = context.originalDescriptor.value;
            }
        },
    },
    accessorDescriptor: {
        match: function (context) {
            return isAccessorDescriptor(context.methodDescriptor);
        },
        apply: function (context) {
            context.records = getWrappedMethodRecords(
                context.originalDescriptor,
                context.methodDescriptor,
                context.property,
            );

            for (const record of context.records) {
                mirrorProperties(record.target, record.wrappedMethod);
            }

            context.appliedDescriptor = composeReplacementDescriptor(
                context.originalDescriptor,
                context.methodDescriptor,
                context.owned,
            );

            Object.defineProperty(
                context.object,
                context.property,
                context.appliedDescriptor,
            );
        },
        restore: function (context) {
            if (context.owned) {
                Object.defineProperty(
                    context.object,
                    context.property,
                    toPropertyDescriptor(context.originalDescriptor),
                );
                return;
            }

            try {
                delete context.object[context.property];
            } catch (e) {}

            if (Object.getOwnPropertyDescriptor(context.object, context.property)) {
                Object.defineProperty(
                    context.object,
                    context.property,
                    toPropertyDescriptor(context.originalDescriptor),
                );
            }
        },
    },
    dataDescriptor: {
        match: function () {
            return true;
        },
        apply: function (context) {
            context.records = getWrappedMethodRecords(
                context.originalDescriptor,
                context.methodDescriptor,
                context.property,
            );
            const wrappedMethod = context.records[0].wrappedMethod;

            mirrorProperties(context.methodDescriptor.value, wrappedMethod);

            context.appliedDescriptor = composeReplacementDescriptor(
                context.originalDescriptor,
                context.methodDescriptor,
                context.owned,
            );

            Object.defineProperty(
                context.object,
                context.property,
                context.appliedDescriptor,
            );

            if (
                typeof context.method === "function" &&
                context.object[context.property] !== context.method
            ) {
                delete context.object[context.property];
                replacementStrategies.assignment.apply(context);
                context.strategy = replacementStrategies.assignment;
            }
        },
        restore: function (context, target) {
            if (context.owned) {
                Object.defineProperty(
                    context.object,
                    context.property,
                    toPropertyDescriptor(context.originalDescriptor),
                );
            } else {
                try {
                    delete context.object[context.property];
                } catch (e) {}
            }

            const descriptor = getPropertyDescriptor(context.object, context.property);
            if (descriptor && descriptor.value === target) {
                context.object[context.property] = context.originalDescriptor.value;
            }
        },
    },
};

function getReplacementStrategy(context) {
    if (!context.originalDescriptor) {
        throw new TypeError(
            `Attempted to wrap ${typeof context.object[context.property]} property ${valueToString(
                context.property,
            )} as function`,
        );
    }

    if (
        context.originalDescriptor.restore &&
        context.originalDescriptor.restore.sinon
    ) {
        const error = new TypeError(
            `Attempted to wrap ${valueToString(
                context.property,
            )} which is already wrapped`,
        );
        if (context.originalDescriptor.stackTraceError) {
            error.stack +=
                `\n--------------\n${context.originalDescriptor.stackTraceError.stack}`;
        }
        throw error;
    }

    const strategies = [
        replacementStrategies.assignment,
        replacementStrategies.accessorDescriptor,
        replacementStrategies.dataDescriptor,
    ];

    for (const strategy of strategies) {
        if (strategy.match(context)) {
            return strategy;
        }
    }

    return replacementStrategies.dataDescriptor;
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

    const owned = object.hasOwnProperty
        ? object.hasOwnProperty(property)
        : hasOwnProperty(object, property);
    const methodDescriptor = getMethodDescriptor(method);
    const originalDescriptor = hasES5Support
        ? getPropertyDescriptor(object, property)
        : { value: object[property] };
    const context = {
        object: object,
        property: property,
        method: method,
        methodDescriptor: methodDescriptor,
        originalDescriptor: originalDescriptor,
        owned: owned,
        records: [],
    };
    const strategy = getReplacementStrategy(context);
    context.strategy = strategy;

    strategy.apply(context);

    function restore() {
        context.strategy.restore(context, this);

        if (sinonType.get(object) === "stub-instance") {
            object[property] = noop;
        }
    }

    attachRestoreMetadata(method, context.records, property, restore);

    return method;
}
