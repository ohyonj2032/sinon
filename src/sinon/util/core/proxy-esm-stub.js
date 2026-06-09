const esmStubMap = new WeakMap();

export { esmStubMap };

export function createESMProxy(namespace, prop, stubInstance) {
    let isRestored = false;

    const proxy = new Proxy(namespace, {
        get: function get(target, p, receiver) {
            if (p === prop) {
                if (isRestored) {
                    return target[p];
                }
                return stubInstance;
            }
            return Reflect.get(target, p, receiver);
        },

        set: function set(target, p, value, receiver) {
            return Reflect.set(target, p, value, receiver);
        },
    });

    const esmRecord = {
        proxy: proxy,
        stub: stubInstance,
        prop: prop,
        namespace: namespace,
    };

    esmRecord.isRestored = function getIsRestored() {
        return isRestored;
    };

    esmRecord.setRestored = function setRestored(v) {
        isRestored = v;
    };

    esmStubMap.set(proxy, esmRecord);

    return esmRecord;
}

export function restoreESMProxy(proxy) {
    const record = esmStubMap.get(proxy);
    if (record) {
        record.setRestored(true);
        esmStubMap.delete(proxy);
    }
}

export function getStubFromProxy(proxy) {
    const record = esmStubMap.get(proxy);
    return record ? record.stub : null;
}

export default createESMProxy;