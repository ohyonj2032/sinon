import commons from "@sinonjs/commons";
import createProxy from "./proxy.js";
import extend from "./util/core/extend.js";
import getPropertyDescriptor from "./util/core/get-property-descriptor.js";
import isEsModule from "./util/core/is-es-module.js";
import walkObject from "./util/core/walk-object.js";
import wrapMethod from "./util/core/wrap-method.js";
import { callTrackerApi } from "./call-tracker.js";

const { functionName } = commons;

let uuid = 0;

const spyApi = extend({}, callTrackerApi);

function createSpy(func) {
    let name;
    let funk = func;

    if (typeof funk !== "function") {
        funk = function () {
            return;
        };
    } else {
        name = functionName(funk);
    }

    const proxy = createProxy(funk, funk);

    extend.nonEnum(proxy, spyApi);
    extend.nonEnum(proxy, {
        displayName: name || "spy",
        instantiateFake: createSpy,
        id: `spy#${uuid++}`,
    });
    return proxy;
}

export default function spy(object, property, types) {
    if (isEsModule(object)) {
        throw new TypeError("ES Modules cannot be spied");
    }

    if (!property && typeof object === "function") {
        return createSpy(object);
    }

    if (!property && typeof object === "object") {
        return walkObject(spy, object);
    }

    if (!object && !property) {
        return createSpy(function () {
            return;
        });
    }

    if (!types) {
        return wrapMethod(object, property, createSpy(object[property]));
    }

    const descriptor = {};
    const methodDesc = getPropertyDescriptor(object, property);

    for (const type of types) {
        descriptor[type] = createSpy(methodDesc[type]);
    }

    return wrapMethod(object, property, descriptor);
}

extend(spy, spyApi);
