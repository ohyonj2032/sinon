import commons from "@sinonjs/commons";

const { prototypes, valueToString } = commons;
import getPropertyDescriptor from "./get-property-descriptor.js";
import extend from "./extend.js";
import sinonType from "./sinon-type.js";
import {
    createDescriptorStrategy,
} from "./descriptor-strategy.js";

const { hasOwnProperty } = prototypes.object;
const { push } = prototypes.array;

const noop = () => {};

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

    const strategy = createDescriptorStrategy(object, property, method);

    const wrappedMethodDesc = getPropertyDescriptor(object, property);
    const wrappedMethods = [];
    const isAccessor =
        typeof method === "object" &&
        (typeof method.get === "function" || typeof method.set === "function");

    if (isAccessor) {
        const types = Object.keys(method);
        for (let i = 0; i < types.length; i++) {
            push(wrappedMethods, wrappedMethodDesc[types[i]]);
        }
        mirrorProperties(method, wrappedMethodDesc);
        for (let i = 0; i < types.length; i++) {
            mirrorProperties(method[types[i]], wrappedMethodDesc[types[i]]);
        }
    } else {
        push(wrappedMethods, wrappedMethodDesc.value);
    }

    strategy.apply();

    if (typeof method === "function" && object[property] !== method) {
        delete object[property];
        object[property] = method;
    }

    function restore() {
        strategy.restore();

        if (sinonType.get(object) === "stub-instance") {
            object[property] = noop;
        }
    }

    for (let i = 0; i < wrappedMethods.length; i++) {
        const accessor = getAccessor(object, property, wrappedMethods[i]);
        const target = accessor ? method[accessor] : method;

        extend.nonEnum(target, {
            displayName: property,
            wrappedMethod: wrappedMethods[i],

            stackTraceError: new Error("Stack Trace for original"),

            restore: restore,
        });

        target.restore.sinon = true;
    }

    return method;
}
