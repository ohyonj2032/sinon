import commons from "@sinonjs/commons";

const { prototypes, valueToString } = commons;
import getPropertyDescriptor from "./get-property-descriptor.js";
import extend from "./extend.js";
import sinonType from "./sinon-type.js";

const { hasOwnProperty } = prototypes.object;
const { push } = prototypes.array;

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

/** ========================================================================
 * 属性描述符策略 (Descriptor Strategy)
 *
 * 将原先在 wrapMethod 中硬编码的 Object.defineProperty 调用重构为:
 *   1. 对原始描述符执行"快照"的 snapshot() 策略 (用于 restore)
 *   2. 根据新描述符类型选择"替换"策略 —— FunctionStrategy / AccessorStrategy
 *
 * 策略接口:
 *   strategy.apply(object, property, replacement, originalDescriptor)
 *       对 object[property] 执行替换
 *   strategy.restore(object, property, snapshot, replacement)
 *       将 object[property] 恢复为快照中的描述符
 *
 * 这样做的好处:
 *   - 替换 getter/setter 时不再丢失 original descriptor 中的 enumerable/configurable
 *   - restore() 时可以精确还原原描述符, 而不是瞎猜
 * ======================================================================== */

const FunctionStrategy = {
    snapshot: function (object, property, descriptor) {
        // 对于普通方法 (data descriptor with a function value)
        // 我们保留整个 descriptor; 如果不存在 (即 object[prop] 通过原型继承而来),
        // 则记录一个 "should delete" 标记。
        if (!descriptor || !descriptor.isOwn) {
            return { mode: "delete" };
        }
        return { mode: "defineProperty", descriptor: descriptor };
    },

    apply: function (object, property, replacement, originalDesc, owned) {
        // 构造等价的 data descriptor, 保留 configurable/enumerable/writable 语义
        const desc = { value: replacement };
        if (originalDesc) {
            if ("configurable" in originalDesc) {
                desc.configurable = originalDesc.configurable;
            } else {
                desc.configurable = true;
            }
            if ("enumerable" in originalDesc) {
                desc.enumerable = originalDesc.enumerable;
            }
            if ("writable" in originalDesc) {
                desc.writable = originalDesc.writable;
            }
        }
        if (!owned) {
            // 原型继承属性 -> 使用 configurable:true 以保证可删除
            desc.configurable = true;
        }
        try {
            Object.defineProperty(object, property, desc);
        } catch (e) {
            // fallback: 某些 host 对象 (e.g. Storage) 不支持 defineProperty,
            // 退化到简单赋值
            object[property] = replacement;
        }

        // 捕获赋值失败的情况 (例如严格模式下的只读属性)
        if (typeof replacement === "function" && object[property] !== replacement) {
            delete object[property];
            object[property] = replacement;
        }
    },

    restore: function (object, property, snapshot) {
        if (snapshot.mode === "delete") {
            delete object[property];
            return;
        }
        // snapshot.descriptor 可能包含 get/set/value 等字段, 直接原样还原
        Object.defineProperty(object, property, snapshot.descriptor);
        if (sinonType.get(object) === "stub-instance") {
            object[property] = noop;
        }
    },
};

const AccessorStrategy = {
    snapshot: function (object, property, descriptor) {
        if (!descriptor || !descriptor.isOwn) {
            return { mode: "delete" };
        }
        // 对 accessor 我们保留 get/set 以及 configurable/enumerable
        return { mode: "defineProperty", descriptor: descriptor };
    },

    apply: function (object, property, replacementObj, originalDesc) {
        // replacementObj 是形如 { get: fn, set: fn } 的描述符
        const desc = {
            configurable: originalDesc ? !!originalDesc.configurable : true,
            enumerable: originalDesc ? !!originalDesc.enumerable : false,
        };
        if (replacementObj.get) {
            desc.get = replacementObj.get;
        }
        if (replacementObj.set) {
            desc.set = replacementObj.set;
        }
        Object.defineProperty(object, property, desc);
    },

    restore: function (object, property, snapshot) {
        if (snapshot.mode === "delete") {
            delete object[property];
            return;
        }
        Object.defineProperty(object, property, snapshot.descriptor);
        if (sinonType.get(object) === "stub-instance") {
            object[property] = noop;
        }
    },
};

/**
 * 根据 replacement 选择合适的策略对象。
 */
function pickStrategy(replacement, originalDesc) {
    if (typeof replacement === "object" && (replacement.get || replacement.set)) {
        return AccessorStrategy;
    }
    return FunctionStrategy;
}

/**
 * 对被替换的 method 做健壮性校验: 不能重复 wrap, 必须是函数 or 描述符对象。
 */
function checkWrappedMethod(wrappedMethod, wrappedMethodDesc, errorSink) {
    if (!isFunction(wrappedMethod) && !wrappedMethodDesc) {
        errorSink.err = new TypeError(
            `Attempted to wrap ${typeof wrappedMethod} property ${valueToString(
                wrappedMethod,
            )} as function`,
        );
        return false;
    }
    if (wrappedMethod && wrappedMethod.restore && wrappedMethod.restore.sinon) {
        errorSink.err = new TypeError(
            `Attempted to wrap ${valueToString(
                wrappedMethod,
            )} which is already wrapped`,
        );
        return false;
    }
    if (wrappedMethod && wrappedMethod.calledBefore) {
        const verb = wrappedMethod.returns ? "stubbed" : "spied on";
        errorSink.err = new TypeError(
            `Attempted to wrap ${valueToString(
                wrappedMethod,
            )} which is already ${verb}`,
        );
        return false;
    }
    return true;
}

/**
 * Wraps a method on an object with another function or accessor descriptor.
 *
 * @param {object} object
 * @param {string | symbol} property
 * @param {Function|{get?:Function, set?:Function}} method  被替换的值 (函数 or 访问器描述符)
 * @returns {Function|object} 被替换的值 (方便链式调用)
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

    const owned = object.hasOwnProperty
        ? object.hasOwnProperty(property)
        : hasOwnProperty(object, property);

    const originalDesc = getPropertyDescriptor(object, property);
    const strategy = pickStrategy(method, originalDesc);

    const wrappedMethods = [];
    const errorSink = {};

    // ---- 1) 先对要替换的值进行合法性校验 ----
    if (typeof method === "function") {
        const wrapped = object[property];
        if (!checkWrappedMethod(wrapped, null, errorSink)) {
            if (wrapped && wrapped.stackTraceError) {
                errorSink.err.stack +=
                    "\n--------------\n" + wrapped.stackTraceError.stack;
            }
            throw errorSink.err;
        }
        wrappedMethods.push(wrapped);
    } else {
        // accessor -> 检查每个 accessor 键
        const types = Object.keys(method);
        for (let i = 0; i < types.length; i++) {
            const wrapped = originalDesc ? originalDesc[types[i]] : undefined;
            if (!checkWrappedMethod(wrapped, null, errorSink)) {
                if (wrapped && wrapped.stackTraceError) {
                    errorSink.err.stack +=
                        "\n--------------\n" + wrapped.stackTraceError.stack;
                }
                throw errorSink.err;
            }
            wrappedMethods.push(wrapped);
        }
    }

    // ---- 2) 记录原始描述符 snapshot (用于 restore) ----
    const snapshot = strategy.snapshot(object, property, originalDesc);

    // ---- 3) 对 method 的内容镜像同步 (保留原有属性) ----
    // 对于访问器, 镜像各个 accessor 子对象的属性;
    // 对于函数, 镜像函数的属性.
    if (typeof method === "object" && (method.get || method.set)) {
        const keys = Object.keys(method);
        for (let i = 0; i < keys.length; i++) {
            if (originalDesc && originalDesc[keys[i]]) {
                mirrorProperties(method[keys[i]], originalDesc[keys[i]]);
            }
        }
    } else if (originalDesc) {
        mirrorProperties(method, originalDesc.value);
    }

    // ---- 4) 应用替换策略 ----
    strategy.apply(object, property, method, originalDesc, owned);

    // ---- 5) 为每个被 wrapped 的原方法挂载 restore / wrappedMethod ----
    for (let i = 0; i < wrappedMethods.length; i++) {
        const accessor =
            typeof method === "object" && (method.get || method.set)
                ? getAccessor(object, property, wrappedMethods[i])
                : null;
        const target = accessor ? method[accessor] : method;

        extend.nonEnum(target, {
            displayName: property,
            wrappedMethod: wrappedMethods[i],
            stackTraceError: new Error("Stack Trace for original"),
            restore: function restore() {
                if (accessor) {
                    // 对于访问器, 直接用 snapshot 还原
                    strategy.restore(object, property, snapshot);
                    return;
                }
                if (!owned) {
                    try {
                        delete object[property];
                    } catch (e) {
                        /* empty */
                    }
                } else {
                    strategy.restore(object, property, snapshot);
                }
            },
        });

        target.restore.sinon = true;
    }

    return method;
}
