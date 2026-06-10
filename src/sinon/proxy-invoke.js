import commons from "@sinonjs/commons";

const { prototypes } = commons;
import * as proxyCallUtil from "./proxy-call-util.js";

const { push, forEach, concat } = prototypes.array;
const ErrorConstructor = Error.prototype.constructor;
const { bind } = Function.prototype;

let callId = 0;
const maxSafeInteger = Number.MAX_SAFE_INTEGER;

/**
 * @callback SinonFunction
 * @param {...unknown} args
 * @returns {unknown}
 */

/**
 * Invokes a proxy function.
 *
 * @param {SinonFunction} func The original function
 * @param {unknown} thisValue The `this` context for the call
 * @param {Array} args The arguments for the call
 * @param {boolean} [isNewCall] true 当且仅当本次调用通过 new/super 触发（来自 wrapFunction 的 new.target 信号）。
 *   这是 ECMAScript 层面 [[Construct]] 与 [[Call]] 的唯一可靠区分点；
 *   相比原来依赖 thisValue instanceof this.proxy 的启发式判断，它能
 *   在 ES2015 class、严格模式以及 Proxy get 陷阱透传时仍正确工作。
 * @returns {unknown} The return value of the function call
 */
export default function invoke(func, thisValue, args, isNewCall) {
    const matchings = this.matchingFakes(args);
    const currentCallId = callId;
    callId = callId >= maxSafeInteger ? 0 : callId + 1;
    let exception, returnValue;

    proxyCallUtil.incrementCallCount(this);
    push(this.thisValues, thisValue);
    push(this.args, args);
    push(this.callIds, currentCallId);
    forEach(matchings, function (matching) {
        proxyCallUtil.incrementCallCount(matching);
        push(matching.thisValues, thisValue);
        push(matching.args, args);
        push(matching.callIds, currentCallId);
    });

    // Make call properties available from within the spied function:
    proxyCallUtil.createCallProperties(this);
    forEach(matchings, proxyCallUtil.createCallProperties);

    // 把 [[Construct]] 信号在 proxy 自身上留一个瞬时标记，
    // 这样 proxy-call.js 的 calledWithNew() 在同一帧内仍可以
    // 通过 this.proxy.calledWithNewLast 回退判断，保持兼容外部代码。
    if (isNewCall) {
        this.calledWithNewLast = true;
    } else {
        delete this.calledWithNewLast;
    }

    try {
        this.invoking = true;

        // 优先使用 wrapFunction 通过 new.target 传递的 isNewCall 信号；
        // 回退到原来的 thisValue instanceof this.proxy 启发式判断，
        // 以兼容直接调用 p.invoke(...) 的老用户。
        const usedNew =
            Boolean(isNewCall) ||
            (this.getCall &&
                this.callCount > 0 &&
                this.getCall(this.callCount - 1) &&
                this.getCall(this.callCount - 1).calledWithNew());

        if (usedNew) {
            // Call through with `new`
            // 关键：即使 func 是 ES2015 class（其 [[Construct]] 是内置的、
            // 且禁止被 apply/call 直接唤起），bind + new 的组合仍能
            // 正常触发它的 [[Construct]]。这里保留 thisValue 作为
            // thisArg 的第一位置，对 class 构造器本身无副作用，但
            // 对自定义构造函数的返回值语义与旧版一致。
            const bound = bind.apply(this.func || func, concat([thisValue], args));
            returnValue = new bound();

            // 当构造函数返回值是非对象/函数时，引擎会返回由 OrdinaryCreateFromConstructor
            // 创建的 thisValue（继承自 constructor.prototype），我们保持这一语义。
            if (
                typeof returnValue !== "object" &&
                typeof returnValue !== "function"
            ) {
                returnValue = thisValue;
            }
        } else {
            returnValue = (this.func || func).apply(thisValue, args);
        }
    } catch (e) {
        exception = e;
    } finally {
        delete this.invoking;
        delete this.calledWithNewLast;
    }

    push(this.exceptions, exception);
    push(this.returnValues, returnValue);
    forEach(matchings, function (matching) {
        push(matching.exceptions, exception);
        push(matching.returnValues, returnValue);
    });

    const err = new ErrorConstructor();
    // 1. Please do not get stack at this point. It may be so very slow, and not actually used
    // 2. PhantomJS does not serialize the stack trace until the error has been thrown:
    // https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Error/Stack
    try {
        throw err;
    } catch (e) {
        /* empty */
    }
    push(this.errorsWithCallStack, err);
    forEach(matchings, function (matching) {
        push(matching.errorsWithCallStack, err);
    });

    // Make return value and exception available in the calls:
    proxyCallUtil.createCallProperties(this);
    forEach(matchings, proxyCallUtil.createCallProperties);

    if (exception !== undefined) {
        throw exception;
    }

    return returnValue;
}
