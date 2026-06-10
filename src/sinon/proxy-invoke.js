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

function isClassConstructor(func) {
    if (typeof func !== "function") {
        return false;
    }

    const descriptor = Object.getOwnPropertyDescriptor(func, "prototype");

    return Boolean(descriptor && descriptor.writable === false);
}

function invokeWithConstructor(func, thisValue, args, newTarget) {
    if (!isClassConstructor(func)) {
        return func.apply(thisValue, args);
    }

    if (typeof Reflect !== "undefined" && typeof Reflect.construct === "function") {
        return Reflect.construct(func, args, newTarget);
    }

    return new (bind.apply(func, concat([thisValue], args)))();
}

/**
 * Invokes a proxy function.
 *
 * @param {SinonFunction} func The original function
 * @param {unknown} thisValue The `this` context for the call
 * @param {Array} args The arguments for the call
 * @param {Function} [newTarget] The constructor used with `new`
 * @returns {unknown} The return value of the function call
 */
export default function invoke(func, thisValue, args, newTarget) {
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

    proxyCallUtil.createCallProperties(this);
    forEach(matchings, proxyCallUtil.createCallProperties);

    try {
        this.invoking = true;

        const thisCall = this.getCall(this.callCount - 1);

        if (thisCall.calledWithNew()) {
            returnValue = invokeWithConstructor(
                this.func || func,
                thisValue,
                args,
                newTarget || this,
            );

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
    }

    push(this.exceptions, exception);
    push(this.returnValues, returnValue);
    forEach(matchings, function (matching) {
        push(matching.exceptions, exception);
        push(matching.returnValues, returnValue);
    });

    const err = new ErrorConstructor();
    try {
        throw err;
    } catch (e) {
        /* empty */
    }
    push(this.errorsWithCallStack, err);
    forEach(matchings, function (matching) {
        push(matching.errorsWithCallStack, err);
    });

    proxyCallUtil.createCallProperties(this);
    forEach(matchings, proxyCallUtil.createCallProperties);

    if (exception !== undefined) {
        throw exception;
    }

    return returnValue;
}
