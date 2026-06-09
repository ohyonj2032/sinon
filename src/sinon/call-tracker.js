import commons from "@sinonjs/commons";
import samsam from "@sinonjs/samsam";
import * as proxyCallUtil from "./proxy-call-util.js";

const { prototypes, valueToString } = commons;
const { deepEqual } = samsam;
const { forEach, pop, push, slice } = prototypes.array;
const filter = Array.prototype.filter;

const statePropertyNames = [
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
    "lastArg",
    "args",
    "firstArg",
    "returnValues",
    "thisValues",
    "exceptions",
    "callIds",
    "errorsWithCallStack",
    "fakes",
    "matchingArguments",
];

function matches(fake, args, strict) {
    const margs = fake.matchingArguments;
    if (
        margs.length <= args.length &&
        deepEqual(slice(args, 0, margs.length), margs)
    ) {
        return !strict || margs.length === args.length;
    }
    return false;
}

export default class CallTracker {
    constructor(proxy) {
        this.proxy = proxy;
        this.withArgsHost = proxy;
        this.resetState();
    }

    resetState() {
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
        this.lastArg = null;
        this.args = [];
        this.firstArg = null;
        this.returnValues = [];
        this.thisValues = [];
        this.exceptions = [];
        this.callIds = [];
        this.errorsWithCallStack = [];
        this.fakes = [];
        this.matchingArguments = [];
    }

    attach(proxy) {
        Object.defineProperty(proxy, "callTracker", {
            value: this,
            configurable: true,
            enumerable: false,
            writable: true,
        });

        forEach(statePropertyNames, function (property) {
            Object.defineProperty(proxy, property, {
                configurable: true,
                enumerable: false,
                get: function () {
                    return proxy.callTracker[property];
                },
                set: function (value) {
                    proxy.callTracker[property] = value;
                },
            });
        });

        return proxy;
    }

    resetHistory() {
        if (this.proxy.invoking) {
            const err = new Error(
                "Cannot reset Sinon function while invoking it. " +
                    "Move the call to .resetHistory outside of the callback.",
            );
            err.name = "InvalidResetException";
            throw err;
        }

        const fakes = this.fakes;
        const matchingArguments = this.matchingArguments;
        this.resetState();
        this.fakes = fakes;
        this.matchingArguments = matchingArguments;

        forEach(this.fakes, function (fake) {
            fake.resetHistory();
        });

        return this.proxy;
    }

    matchingFakes(args, strict) {
        return filter.call(this.fakes, function (fakeInstance) {
            return matches(fakeInstance, args, strict);
        });
    }

    withArgs() {
        const args = slice(arguments);
        const host = this.withArgsHost || this.proxy;
        const matching = pop(host.matchingFakes(args, true));
        if (matching) {
            return matching;
        }

        const fakeInstance = host.instantiateFake();
        fakeInstance.matchingArguments = args;
        fakeInstance.parent = host;
        fakeInstance.callTracker.withArgsHost = host;
        push(host.fakes, fakeInstance);

        this.replayMatchingCalls(host, fakeInstance);

        return fakeInstance;
    }

    replayMatchingCalls(source, fakeInstance) {
        forEach(source.args, function (arg, i) {
            if (!matches(fakeInstance, arg)) {
                return;
            }

            proxyCallUtil.incrementCallCount(fakeInstance);
            push(fakeInstance.thisValues, source.thisValues[i]);
            push(fakeInstance.args, arg);
            push(fakeInstance.returnValues, source.returnValues[i]);
            push(fakeInstance.exceptions, source.exceptions[i]);
            push(fakeInstance.callIds, source.callIds[i]);
            push(fakeInstance.errorsWithCallStack, source.errorsWithCallStack[i]);
        });

        proxyCallUtil.createCallProperties(fakeInstance);
    }
}

export const callTrackerApi = {
    withArgs: function () {
        return this.callTracker.withArgs.apply(this.callTracker, arguments);
    },

    matchingFakes: function (args, strict) {
        return this.callTracker.matchingFakes(args, strict);
    },
};

const delegateToCalls = proxyCallUtil.delegateToCalls;
delegateToCalls(callTrackerApi, "callArg", false, "callArgWith", true, function () {
    throw new Error(
        `${this.toString()} cannot call arg since it was not yet invoked.`,
    );
});
callTrackerApi.callArgWith = callTrackerApi.callArg;
delegateToCalls(
    callTrackerApi,
    "callArgOn",
    false,
    "callArgOnWith",
    true,
    function () {
        throw new Error(
            `${this.toString()} cannot call arg since it was not yet invoked.`,
        );
    },
);
callTrackerApi.callArgOnWith = callTrackerApi.callArgOn;
delegateToCalls(callTrackerApi, "throwArg", false, "throwArg", false, function () {
    throw new Error(
        `${this.toString()} cannot throw arg since it was not yet invoked.`,
    );
});
delegateToCalls(callTrackerApi, "yield", false, "yield", true, function () {
    throw new Error(
        `${this.toString()} cannot yield since it was not yet invoked.`,
    );
});
callTrackerApi.invokeCallback = callTrackerApi.yield;
delegateToCalls(callTrackerApi, "yieldOn", false, "yieldOn", true, function () {
    throw new Error(
        `${this.toString()} cannot yield since it was not yet invoked.`,
    );
});
delegateToCalls(callTrackerApi, "yieldTo", false, "yieldTo", true, function (property) {
    throw new Error(
        `${this.toString()} cannot yield to '${valueToString(
            property,
        )}' since it was not yet invoked.`,
    );
});
delegateToCalls(
    callTrackerApi,
    "yieldToOn",
    false,
    "yieldToOn",
    true,
    function (property) {
        throw new Error(
            `${this.toString()} cannot yield to '${valueToString(
                property,
            )}' since it was not yet invoked.`,
        );
    },
);
