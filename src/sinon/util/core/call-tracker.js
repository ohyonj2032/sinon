import commons from "@sinonjs/commons";
import proxyCall from "../proxy-call.js";
import * as proxyCallUtil from "../proxy-call-util.js";

const { prototypes } = commons;
const { push, forEach } = prototypes.array;

const CALL_TRACKING_PROPERTIES = [
    "called",
    "notCalled",
    "calledOnce",
    "calledTwice",
    "calledThrice",
    "callCount",
    "firstCall",
    "secondCall",
    "thirdCall",
    "lastCall",
    "firstArg",
    "lastArg",
    "args",
    "returnValues",
    "thisValues",
    "exceptions",
    "callIds",
    "errorsWithCallStack",
];

export default class CallTracker {
    constructor() {
        this.called = false;
        this.notCalled = true;
        this.calledOnce = false;
        this.calledTwice = false;
        this.calledThrice = false;
        this.callCount = 0;
        this.firstCall = null;
        this.secondCall = null;
        this.thirdCall = null;
        this.lastCall = null;
        this.firstArg = null;
        this.lastArg = null;
        this.args = [];
        this.returnValues = [];
        this.thisValues = [];
        this.exceptions = [];
        this.callIds = [];
        this.errorsWithCallStack = [];
    }

    incrementCallCount() {
        this.called = true;
        this.callCount += 1;
        this.notCalled = false;
        this.calledOnce = this.callCount === 1;
        this.calledTwice = this.callCount === 2;
        this.calledThrice = this.callCount === 3;
    }

    recordCall(thisValue, args, callId) {
        push(this.thisValues, thisValue);
        push(this.args, args);
        push(this.callIds, callId);
    }

    recordResult(returnValue, exception, errorWithCallStack) {
        push(this.exceptions, exception);
        push(this.returnValues, returnValue);
        push(this.errorsWithCallStack, errorWithCallStack);
    }

    createCallProperties(proxy) {
        this.firstCall = proxy.getCall(0);
        this.secondCall = proxy.getCall(1);
        this.thirdCall = proxy.getCall(2);
        this.lastCall = proxy.getCall(this.callCount - 1);

        if (this.callCount > 0) {
            this.firstArg = this.args[0][0];
            this.lastArg = this.args[this.callCount - 1][this.args[this.callCount - 1].length - 1];
        } else {
            this.firstArg = null;
            this.lastArg = null;
        }
    }

    getCall(index, proxy) {
        let i = index;
        if (i < 0) {
            i += this.callCount;
        }
        if (i < 0 || i >= this.callCount) {
            return null;
        }

        return proxyCall(
            proxy,
            this.thisValues[i],
            this.args[i],
            this.returnValues[i],
            this.exceptions[i],
            this.callIds[i],
            this.errorsWithCallStack[i],
        );
    }

    getCalls(proxy) {
        const calls = [];
        for (let i = 0; i < this.callCount; i++) {
            push(calls, this.getCall(i, proxy));
        }
        return calls;
    }

    reset() {
        this.called = false;
        this.notCalled = true;
        this.calledOnce = false;
        this.calledTwice = false;
        this.calledThrice = false;
        this.callCount = 0;
        this.firstCall = null;
        this.secondCall = null;
        this.thirdCall = null;
        this.lastCall = null;
        this.firstArg = null;
        this.lastArg = null;
        this.args.length = 0;
        this.returnValues.length = 0;
        this.thisValues.length = 0;
        this.exceptions.length = 0;
        this.callIds.length = 0;
        this.errorsWithCallStack.length = 0;
    }

    static installDelegates(proxy, callTracker) {
        forEach(CALL_TRACKING_PROPERTIES, function (prop) {
            Object.defineProperty(proxy, prop, {
                get: function () {
                    return callTracker[prop];
                },
                set: function (val) {
                    callTracker[prop] = val;
                },
                enumerable: false,
                configurable: true,
            });
        });

        Object.defineProperty(proxy, "_callTracker", {
            value: callTracker,
            enumerable: false,
            configurable: false,
            writable: false,
        });
    }
}
