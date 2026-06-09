import commons from "@sinonjs/commons";
import getPropertyDescriptor from "./get-property-descriptor.js";
import extend from "./extend.js";
import sinonType from "./sinon-type.js";

const { prototypes, valueToString } = commons;
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

class WrapStrategy {
    constructor(object, property, method, originalDescriptor) {
        this.object = object;
        this.property = property;
        this.method = method;
        this.originalDescriptor = originalDescriptor;
        this.owned = object.hasOwnProperty
            ? object.hasOwnProperty(property)
            : hasOwnProperty.call(object, property);
        this.wrappedMethods = [];
    }

    checkWrappedMethod(wrappedMethod) {
        let error;

        if (!isFunction(wrappedMethod)) {
            error = new TypeError(
                `Attempted to wrap ${typeof wrappedMethod} property ${valueToString(
                    this.property,
                )} as function`,
            );
        } else if (wrappedMethod.restore && wrappedMethod.restore.sinon) {
            error = new TypeError(
                `Attempted to wrap ${valueToString(
                    this.property,
                )} which is already wrapped`,
            );
        } else if (wrappedMethod.calledBefore) {
            const verb = wrappedMethod.returns ? "stubbed" : "spied on";
            error = new TypeError(
                `Attempted to wrap ${valueToString(
                    this.property,
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

    checkAllWrappedMethods() {
        const types = this.getMethodTypes();
        for (let i = 0; i < types.length; i++) {
            const wrappedMethod = this.originalDescriptor[types[i]];
            this.checkWrappedMethod(wrappedMethod);
            push(this.wrappedMethods, wrappedMethod);
        }
    }

    getMethodTypes() {
        if (typeof this.method === "function") {
            return ["value"];
        }
        return Object.keys(this.method);
    }

    createMethodDescriptor() {
        if (typeof this.method === "function") {
            return {
                value: this.method,
            };
        }
        return this.method;
    }

    mirrorDescriptorProperties(methodDesc) {
        const types = Object.keys(methodDesc);
        for (let i = 0; i < types.length; i++) {
            if (this.originalDescriptor[types[i]] !== undefined) {
                mirrorProperties(methodDesc[types[i]], this.originalDescriptor[types[i]]);
            }
        }
        mirrorProperties(methodDesc, this.originalDescriptor);
        if (!this.owned) {
            methodDesc.configurable = true;
        }
    }

    applyWrap() {
        const methodDesc = this.createMethodDescriptor();
        this.mirrorDescriptorProperties(methodDesc);
        Object.defineProperty(this.object, this.property, methodDesc);
        return methodDesc;
    }

    restore() {
        if (!this.owned) {
            try {
                delete this.object[this.property];
            } catch (e) {}
        } else if (hasES5Support) {
            Object.defineProperty(this.object, this.property, this.originalDescriptor);
        }

        if (hasES5Support) {
            const currentDesc = getPropertyDescriptor(this.object, this.property);
            if (currentDesc && this.isValueDescriptor(currentDesc)) {
                if (currentDesc.value === this.getTarget()) {
                    this.object[this.property] = this.getWrappedValue();
                }
            }
        } else {
            if (this.object[this.property] === this.getTarget()) {
                this.object[this.property] = this.getWrappedValue();
            }
        }

        if (sinonType.get(this.object) === "stub-instance") {
            this.object[this.property] = noop;
        }
    }

    isValueDescriptor(descriptor) {
        return "value" in descriptor;
    }

    getTarget() {
        throw new Error("Not implemented");
    }

    getWrappedValue() {
        throw new Error("Not implemented");
    }

    extendWrappedMethods() {
        throw new Error("Not implemented");
    }
}

class DataPropertyStrategy extends WrapStrategy {
    constructor(object, property, method, originalDescriptor) {
        super(object, property, method, originalDescriptor);
        this.wrappedMethod = originalDescriptor.value;
        this.target = method;
    }

    checkAllWrappedMethods() {
        this.checkWrappedMethod(this.wrappedMethod);
        push(this.wrappedMethods, this.wrappedMethod);
    }

    getMethodTypes() {
        return ["value"];
    }

    getTarget() {
        return this.target;
    }

    getWrappedValue() {
        return this.wrappedMethod;
    }

    extendWrappedMethods() {
        this.extendSingleWrapped(this.target, this.wrappedMethod);
    }

    extendSingleWrapped(target, wrappedMethod) {
        extend.nonEnum(target, {
            displayName: this.property,
            wrappedMethod: wrappedMethod,
            stackTraceError: new Error("Stack Trace for original"),
            restore: this.restore.bind(this),
        });
        target.restore.sinon = true;
    }
}

class AccessorPropertyStrategy extends WrapStrategy {
    constructor(object, property, method, originalDescriptor) {
        super(object, property, method, originalDescriptor);
    }

    getTarget() {
        const types = this.getMethodTypes();
        return this.method[types[0]];
    }

    getWrappedValue() {
        const types = this.getMethodTypes();
        return this.originalDescriptor[types[0]];
    }

    extendWrappedMethods() {
        const types = this.getMethodTypes();
        for (let i = 0; i < types.length; i++) {
            const wrappedMethod = this.wrappedMethods[i];
            const accessor = types[i];
            const target = this.method[accessor];
            this.extendSingleAccessor(target, wrappedMethod);
        }
    }

    extendSingleAccessor(target, wrappedMethod) {
        extend.nonEnum(target, {
            displayName: this.property,
            wrappedMethod: wrappedMethod,
            stackTraceError: new Error("Stack Trace for original"),
            restore: this.restore.bind(this),
        });
        target.restore.sinon = true;
    }

    restore() {
        const accessors = this.getMethodTypes();
        for (const accessor of accessors) {
            const descriptor = getPropertyDescriptor(this.object, this.property);
            descriptor[accessor] = this.originalDescriptor[accessor];
            if (descriptor && descriptor[accessor] === this.method[accessor]) {
                descriptor[accessor] = this.originalDescriptor[accessor];
            }
        }
        if (this.owned) {
            Object.defineProperty(this.object, this.property, descriptor);
        } else {
            try {
                for (const accessor of accessors) {
                    delete this.object[this.property][accessor];
                }
            } catch (e) {}
        }

        if (sinonType.get(this.object) === "stub-instance") {
            this.object[this.property] = noop;
        }
    }
}

class MixedPropertyStrategy extends WrapStrategy {
    constructor(object, property, method, originalDescriptor) {
        super(object, property, method, originalDescriptor);
    }

    getTarget() {
        if ("value" in this.method) {
            return this.method.value;
        }
        return this.method.get || this.method.set;
    }

    getWrappedValue() {
        if ("value" in this.originalDescriptor) {
            return this.originalDescriptor.value;
        }
        return this.originalDescriptor.get || this.originalDescriptor.set;
    }

    extendWrappedMethods() {
        const types = this.getMethodTypes();
        for (let i = 0; i < types.length; i++) {
            const type = types[i];
            const wrappedMethod = this.originalDescriptor[type];
            const target = this.method[type];
            if (type === "value") {
                this.extendDataTarget(target, wrappedMethod);
            } else {
                this.extendAccessorTarget(target, wrappedMethod);
            }
        }
    }

    extendDataTarget(target, wrappedMethod) {
        extend.nonEnum(target, {
            displayName: this.property,
            wrappedMethod: wrappedMethod,
            stackTraceError: new Error("Stack Trace for original"),
            restore: this.restore.bind(this),
        });
        target.restore.sinon = true;
    }

    extendAccessorTarget(target, wrappedMethod) {
        extend.nonEnum(target, {
            displayName: this.property,
            wrappedMethod: wrappedMethod,
            stackTraceError: new Error("Stack Trace for original"),
            restore: this.restore.bind(this),
        });
        target.restore.sinon = true;
    }
}

function createStrategy(object, property, method, originalDescriptor) {
    const isDataMethod = typeof method === "function";
    const isDataOriginal = "value" in originalDescriptor;
    const isAccessorMethod = typeof method === "object" && ("get" in method || "set" in method);

    if (isDataMethod || (isDataOriginal && isDataMethod)) {
        return new DataPropertyStrategy(object, property, method, originalDescriptor);
    }

    if (isAccessorMethod) {
        const hasGetOrSet = "get" in originalDescriptor || "set" in originalDescriptor;
        if (hasGetOrSet) {
            return new AccessorPropertyStrategy(object, property, method, originalDescriptor);
        }
    }

    return new MixedPropertyStrategy(object, property, method, originalDescriptor);
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

    const originalDescriptor = getPropertyDescriptor(object, property);
    if (!originalDescriptor) {
        const error = new TypeError(
            `Attempted to wrap undefined property ${valueToString(property)} as function`,
        );
        throw error;
    }

    if (originalDescriptor.restore && originalDescriptor.restore.sinon) {
        const error = new TypeError(
            `Attempted to wrap ${valueToString(property)} which is already wrapped`,
        );
        if (originalDescriptor.stackTraceError) {
            error.stack += `\n--------------\n${originalDescriptor.stackTraceError.stack}`;
        }
        throw error;
    }

    const strategy = createStrategy(object, property, method, originalDescriptor);
    strategy.checkAllWrappedMethods();
    strategy.checkWrappedMethod = null;

    const methodDesc = strategy.applyWrap();

    function checkFailingAssignment() {
        if (typeof method === "function" && object[property] !== method) {
            delete object[property];
            object[property] = method;
        }
    }

    if (typeof method === "function") {
        checkFailingAssignment();
    }

    strategy.extendWrappedMethods();

    return method;
}