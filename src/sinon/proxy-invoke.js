import commons from "@sinonjs/commons";
import * as proxyCallUtil from "./proxy-call-util.js";

const { prototypes } = commons;
const { push, forEach, concat } = prototypes.array;
const ErrorConstructor = Error.prototype.constructor;
const { bind } = Function.prototype;

let callId = 0;
const maxSafeInteger = Number.MAX_SAFE_INTEGER;

export default function invoke(func, thisValue, args) {
    const matchings = this.matchingFakes(args);
    const currentCallId = callId;
    callId = callId >= maxSafeInteger ? 0 : callId + 1;
    let exception, returnValue;

    const tracker = this._callTracker;
    tracker.incrementCallCount();
    tracker.recordCall(thisValue, args, currentCallId);

    forEach(matchings, function (matching) {
        const matchingTracker = matching._callTracker;
        matchingTracker.incrementCallCount();
        matchingTracker.recordCall(thisValue, args, currentCallId);
    });

    proxyCallUtil.createCallProperties(this);
    forEach(matchings, proxyCallUtil.createCallProperties);

    try {
        this.invoking = true;

        const thisCall = this.getCall(this.callCount - 1);

        if (thisCall.calledWithNew()) {
            returnValue = new (bind.apply(
                this.func || func,
                concat([thisValue], args),
            ))();

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

    const err = new ErrorConstructor();
    try {
        throw err;
    } catch (e) {
        /* empty */
    }

    tracker.recordResult(returnValue, exception, err);
    forEach(matchings, function (matching) {
        const matchingTracker = matching._callTracker;
        push(matchingTracker.exceptions, exception);
        push(matchingTracker.returnValues, returnValue);
        push(matchingTracker.errorsWithCallStack, err);
    });

    proxyCallUtil.createCallProperties(this);
    forEach(matchings, proxyCallUtil.createCallProperties);

    if (exception !== undefined) {
        throw exception;
    }

    return returnValue;
}
