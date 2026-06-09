import commons from "@sinonjs/commons";
import behavior from "./behavior.js";
import behaviors from "./default-behaviors.js";
import createProxy from "./proxy.js";
import isNonExistentProperty from "./util/core/is-non-existent-property.js";
import extend from "./util/core/extend.js";
import getPropertyDescriptor from "./util/core/get-property-descriptor.js";
import isEsModule from "./util/core/is-es-module.js";
import sinonType from "./util/core/sinon-type.js";
import wrapMethod from "./util/core/wrap-method.js";
import throwOnFalsyObject from "./throw-on-falsy-object.js";
import walkObject from "./util/core/walk-object.js";
import BehaviorContainer, {
    mountBehaviorContainerOnto,
} from "./behavior-container.js";

const { prototypes: commonsPrototypes, functionName, valueToString } = commons;
const { array: arrayProto, object: objectProto } = commonsPrototypes;
const { hasOwnProperty } = objectProto;

const forEach = arrayProto.forEach;
const pop = arrayProto.pop;
const slice = arrayProto.slice;
const sort = arrayProto.sort;

let uuid = 0;

/**
 * stub 不再"继承" spy。而是：
 *   - 通过 createProxy 获得与 spy 相同的底层 CallTracker
 *   - 显式挂载自己的 withArgs / instantiateFake (不依赖 spy 原型)
 *   - 通过组合 BehaviorContainer 获得行为配置能力
 */
function createStub(originalFunc) {
    let proxy;

    function functionStub() {
        const args = slice(arguments);
        const matchings = proxy.matchingFakes(args);

        const fnStub =
            pop(
                sort(matchings, function (a, b) {
                    return (
                        a.matchingArguments.length - b.matchingArguments.length
                    );
                }),
            ) || proxy;
        return getCurrentBehavior(fnStub).invoke(this, arguments);
    }

    proxy = createProxy(functionStub, originalFunc || functionStub);

    const name = originalFunc ? functionName(originalFunc) : null;

    extend.nonEnum(proxy, {
        displayName: name || "stub",
        fakes: [],
        instantiateFake: createStub,
        id: `stub#${uuid++}`,
        // 提供 withArgs/matchingFakes, 无需走 spy 原型
        withArgs: function () {
            const args = slice(arguments);
            const matching = pop(this.matchingFakes(args, true));
            if (matching) {
                return matching;
            }
            const original = this;
            const fakeInstance = this.instantiateFake();
            fakeInstance.matchingArguments = args;
            fakeInstance.parent = this;
            push(this.fakes, fakeInstance);

            fakeInstance.withArgs = function () {
                return original.withArgs.apply(original, arguments);
            };

            return fakeInstance;
        },
        matchingFakes: function (args, strict) {
            if (!args) return [];
            return (this.fakes || []).filter(function (fake) {
                if (!fake.matchingArguments) return false;
                if (fake.matchingArguments.length > args.length) return false;
                // 浅比较
                let eq = true;
                for (let i = 0; i < fake.matchingArguments.length; i++) {
                    if (fake.matchingArguments[i] !== args[i]) {
                        eq = false;
                        break;
                    }
                }
                if (!eq) return false;
                return !strict || fake.matchingArguments.length === args.length;
            });
        },
    });

    // 组合 BehaviorContainer, 获得 onCall / resetBehavior 等 API
    const container = BehaviorContainer(proxy);
    mountBehaviorContainerOnto(proxy, container);

    // 扩展 stub 自定义 API (链式调用)
    extend.nonEnum(proxy, buildStubApi(proxy, container));

    sinonType.set(proxy, "stub");

    return proxy;
}

function push(arr, v) {
    return arrayProto.push.call(arr, v);
}

function getParentBehaviour(stubInstance) {
    return stubInstance.parent && getCurrentBehavior(stubInstance.parent);
}

function getDefaultBehavior(stubInstance) {
    const bc = stubInstance._behaviorContainer;
    return (
        (bc && bc.defaultBehavior) ||
        getParentBehaviour(stubInstance) ||
        behavior.create(stubInstance)
    );
}

function getCurrentBehavior(stubInstance) {
    const bc = stubInstance._behaviorContainer;
    const currentBehavior = bc && bc.behaviors[stubInstance.callCount - 1];
    return currentBehavior && currentBehavior.isPresent()
        ? currentBehavior
        : getDefaultBehavior(stubInstance);
}

/**
 * 构造 stub 链式调用 API。该 API 不与 spy 原型耦合, 而是直接操作
 * BehaviorContainer 和 behavior 对象。
 */
function buildStubApi(proxy, container) {
    const api = {
        reset: function () {
            this.resetHistory();
            this.resetBehavior();
        },

        withArgs: function withArgs() {
            // 复用 proxy 上已挂载的 withArgs
            const fake = proxyWithArgs.apply(this, arguments);
            if (container.defaultBehavior && container.defaultBehavior.promiseLibrary) {
                fake._behaviorContainer.defaultBehavior =
                    fake._behaviorContainer.defaultBehavior ||
                    behavior.create(fake);
                fake._behaviorContainer.defaultBehavior.promiseLibrary =
                    container.defaultBehavior.promiseLibrary;
            }
            return fake;
        },
    };

    // 挂行为方法 (returns, throws, resolves, rejects, callsFake, callsThrough, yields, yieldsAsync, ...)
    forEach(Object.keys(behavior), function (method) {
        if (
            hasOwnProperty(behavior, method) &&
            !hasOwnProperty(api, method) &&
            method !== "create" &&
            method !== "invoke" &&
            method !== "isPresent"
        ) {
            api[method] = createBehaviorBridge(method);
        }
    });

    forEach(Object.keys(behaviors), function (method) {
        if (hasOwnProperty(behaviors, method) && !hasOwnProperty(api, method)) {
            api[method] = createBehaviorBridge2(method, behaviors[method]);
        }
    });

    return api;
}

function proxyWithArgs() {
    const args = slice(arguments);
    const matching = pop(this.matchingFakes(args, true));
    if (matching) {
        return matching;
    }
    const original = this;
    const fakeInstance = this.instantiateFake();
    fakeInstance.matchingArguments = args;
    fakeInstance.parent = this;
    push(this.fakes, fakeInstance);
    fakeInstance.withArgs = function () {
        return original.withArgs.apply(original, arguments);
    };
    return fakeInstance;
}

function createBehaviorBridge(methodName) {
    return function () {
        const container = this._behaviorContainer;
        container.defaultBehavior =
            container.defaultBehavior || behavior.create(this);
        container.defaultBehavior[methodName].apply(
            container.defaultBehavior,
            arguments,
        );
        return this;
    };
}

function createBehaviorBridge2(methodName, fn) {
    return function () {
        const container = this._behaviorContainer;
        container.defaultBehavior =
            container.defaultBehavior || behavior.create(this);
        fn.apply(container.defaultBehavior, slice(arguments));
        return this;
    };
}

/** ================= 顶层 stub(object, property) 入口 ================= */

export default function stub(object, property) {
    if (arguments.length > 2) {
        throw new TypeError(
            "stub(obj, 'meth', fn) has been removed, see documentation",
        );
    }

    if (isEsModule(object)) {
        throw new TypeError("ES Modules cannot be stubbed");
    }

    throwOnFalsyObject.apply(null, arguments);

    if (isNonExistentProperty(object, property)) {
        throw new TypeError(
            `Cannot stub non-existent property ${valueToString(property)}`,
        );
    }

    const actualDescriptor = getPropertyDescriptor(object, property);

    assertValidPropertyDescriptor(actualDescriptor, property);

    const isObjectOrFunction =
        typeof object === "object" || typeof object === "function";
    const isStubbingEntireObject =
        typeof property === "undefined" && isObjectOrFunction;
    const isCreatingNewStub = !object && typeof property === "undefined";
    const isStubbingNonFuncProperty =
        isObjectOrFunction &&
        typeof property !== "undefined" &&
        (typeof actualDescriptor === "undefined" ||
            typeof actualDescriptor.value !== "function");

    if (isStubbingEntireObject) {
        return walkObject(stub, object);
    }

    if (isCreatingNewStub) {
        return createStub();
    }

    const func =
        typeof actualDescriptor.value === "function"
            ? actualDescriptor.value
            : null;
    const s = createStub(func);

    extend.nonEnum(s, {
        rootObj: object,
        propName: property,
        shadowsPropOnPrototype: !actualDescriptor.isOwn,
        restore: function restore() {
            if (actualDescriptor !== undefined && actualDescriptor.isOwn) {
                Object.defineProperty(object, property, actualDescriptor);
                return;
            }

            delete object[property];
        },
    });

    return isStubbingNonFuncProperty ? s : wrapMethod(object, property, s);
}

function assertValidPropertyDescriptor(descriptor, property) {
    if (!descriptor || !property) {
        return;
    }
    if (descriptor.isOwn && !descriptor.configurable && !descriptor.writable) {
        throw new TypeError(
            `The descriptor for property \`${property}\` is non-configurable and non-writable. ` +
                `Sinon cannot stub properties that are immutable. ` +
                `See https://sinonjs.org/faq#property-descriptor-errors for help fixing this issue.`,
        );
    }
    if ((descriptor.get || descriptor.set) && !descriptor.configurable) {
        throw new TypeError(
            `Descriptor for accessor property ${property} is non-configurable`,
        );
    }
    if (isDataDescriptor(descriptor) && !descriptor.writable) {
        throw new TypeError(
            `Descriptor for data property ${property} is non-writable`,
        );
    }
}

function isDataDescriptor(descriptor) {
    return (
        !descriptor.value &&
        !descriptor.writable &&
        !descriptor.set &&
        !descriptor.get
    );
}
