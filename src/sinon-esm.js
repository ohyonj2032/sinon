import sinon from "./sinon.js";

const passthroughProxyHandler = {
    get(target, property, receiver) {
        return Reflect.get(target, property, receiver);
    },
    has(target, property) {
        return Reflect.has(target, property);
    },
    ownKeys(target) {
        return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, property) {
        return Reflect.getOwnPropertyDescriptor(target, property);
    },
};

const sinonProxy = new Proxy(sinon, passthroughProxyHandler);

export default sinonProxy;
