import commons from "@sinonjs/commons";
import getPropertyDescriptor from "./get-property-descriptor.js";

const { valueToString } = commons;

const hasOwnProperty =
    Object.prototype.hasOwnProperty;

function isFunction(obj) {
    return (
        typeof obj === "function" ||
        Boolean(obj && obj.constructor && obj.call && obj.apply)
    );
}

function mirrorProperties(target, source) {
    for (const prop in source) {
        if (!hasOwnProperty.call(target, prop)) {
            target[prop] = source[prop];
        }
    }
}

class DescriptorStrategy {
    constructor(object, property, method, originalDescriptor, owned) {
        this.object = object;
        this.property = property;
        this.method = method;
        this.originalDescriptor = originalDescriptor;
        this.owned = owned;
    }

    apply() {
        throw new Error("DescriptorStrategy.apply() must be implemented by subclass");
    }

    restore() {
        throw new Error("DescriptorStrategy.restore() must be implemented by subclass");
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
}

export class DataDescriptorStrategy extends DescriptorStrategy {
    constructor(object, property, method, originalDescriptor, owned) {
        super(object, property, method, originalDescriptor, owned);
        this.wrappedMethod = originalDescriptor.value;
        this.target = method;
    }

    apply() {
        this.checkWrappedMethod(this.wrappedMethod);

        const methodDesc = {
            value: this.method,
            writable: this.originalDescriptor.writable,
            enumerable: this.originalDescriptor.enumerable,
            configurable: true,
        };

        if (!this.owned) {
            methodDesc.configurable = true;
        }

        Object.defineProperty(this.object, this.property, methodDesc);

        if (typeof this.method === "function" && this.object[this.property] !== this.method) {
            delete this.object[this.property];
            this.object[this.property] = this.method;
        }
    }

    restore() {
        if (!this.owned) {
            try {
                delete this.object[this.property];
            } catch (e) {} // eslint-disable-line no-empty
        } else {
            Object.defineProperty(this.object, this.property, this.originalDescriptor);
        }

        const descriptor = getPropertyDescriptor(this.object, this.property);
        if (descriptor && descriptor.value === this.target) {
            this.object[this.property] = this.wrappedMethod;
        }
    }
}

export class AccessorDescriptorStrategy extends DescriptorStrategy {
    constructor(object, property, method, originalDescriptor, owned) {
        super(object, property, method, originalDescriptor, owned);
        this.accessorTypes = Object.keys(method);
        this.wrappedMethods = [];
        this.targets = [];

        for (let i = 0; i < this.accessorTypes.length; i++) {
            const type = this.accessorTypes[i];
            this.wrappedMethods.push(originalDescriptor[type]);
            this.targets.push(method[type]);
        }
    }

    apply() {
        for (let i = 0; i < this.accessorTypes.length; i++) {
            this.checkWrappedMethod(this.wrappedMethods[i]);
        }

        const methodDesc = {};
        for (let i = 0; i < this.accessorTypes.length; i++) {
            const type = this.accessorTypes[i];
            methodDesc[type] = this.method[type];
            mirrorProperties(methodDesc[type], this.originalDescriptor[type]);
        }

        methodDesc.enumerable = this.originalDescriptor.enumerable;
        methodDesc.configurable = true;

        if (!this.owned) {
            methodDesc.configurable = true;
        }

        Object.defineProperty(this.object, this.property, methodDesc);
    }

    restore() {
        for (let i = 0; i < this.accessorTypes.length; i++) {
            const type = this.accessorTypes[i];
            const wrappedMethod = this.wrappedMethods[i];

            if (!this.owned) {
                try {
                    delete this.object[this.property];
                } catch (e) {} // eslint-disable-line no-empty
            } else {
                const descriptor = getPropertyDescriptor(this.object, this.property);
                descriptor[type] = this.originalDescriptor[type];
                Object.defineProperty(this.object, this.property, descriptor);
            }

            const currentDescriptor = getPropertyDescriptor(this.object, this.property);
            if (currentDescriptor && currentDescriptor.value === this.targets[i]) {
                this.object[this.property][type] = wrappedMethod;
            }
        }
    }
}

export function createDescriptorStrategy(object, property, method) {
    const owned = object.hasOwnProperty
        ? object.hasOwnProperty(property)
        : hasOwnProperty.call(object, property);

    const originalDescriptor = getPropertyDescriptor(object, property);

    if (!originalDescriptor) {
        throw new TypeError(
            `Attempted to wrap ${typeof object[property]} property ${property} as function`,
        );
    }

    if (originalDescriptor.restore && originalDescriptor.restore.sinon) {
        const error = new TypeError(
            `Attempted to wrap ${property} which is already wrapped`,
        );
        if (originalDescriptor.stackTraceError) {
            error.stack += `\n--------------\n${originalDescriptor.stackTraceError.stack}`;
        }
        throw error;
    }

    const isAccessor =
        typeof method === "object" &&
        (typeof method.get === "function" || typeof method.set === "function");

    if (isAccessor) {
        return new AccessorDescriptorStrategy(
            object,
            property,
            method,
            originalDescriptor,
            owned,
        );
    }

    return new DataDescriptorStrategy(
        object,
        property,
        method,
        originalDescriptor,
        owned,
    );
}
