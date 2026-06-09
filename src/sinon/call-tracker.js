import commons from "@sinonjs/commons";
import proxyCall from "./proxy-call.js";
import * as proxyCallUtil from "./proxy-call-util.js";
import { inspect } from "util";
import formatters from "./spy-formatters.js";

const { prototypes } = commons;
const { push } = prototypes.array;

const delegateToCalls = proxyCallUtil.delegateToCalls;

function createCallTracker() {
    const tracker = {
        called: false,
        notCalled: true,
        calledOnce: false,
        calledTwice: false,
        calledThrice: false,
        callCount: 0,
        firstCall: null,
        secondCall: null,
        thirdCall: null,
        lastCall: null,
        lastArg: null,
        args: [],
        firstArg: null,
        returnValues: [],
        thisValues: [],
        exceptions: [],
        callIds: [],
        errorsWithCallStack: [],

        getCall: function getCall(index) {
            let i = index;
            if (i < 0) {
                i += this.callCount;
            }
            if (i < 0 || i >= this.callCount) {
                return null;
            }

            return proxyCall(
                this,
                this.thisValues[i],
                this.args[i],
                this.returnValues[i],
                this.exceptions[i],
                this.callIds[i],
                this.errorsWithCallStack[i],
            );
        },

        getCalls: function () {
            const calls = [];
            let i;

            for (i = 0; i < this.callCount; i++) {
                push(calls, this.getCall(i));
            }

            return calls;
        },

        calledBefore: function calledBefore(proxy) {
            if (!this.called) {
                return false;
            }

            if (!proxy.called) {
                return true;
            }

            return this.callIds[0] < proxy.callIds[proxy.callIds.length - 1];
        },

        calledAfter: function calledAfter(proxy) {
            if (!this.called || !proxy.called) {
                return false;
            }

            return this.callIds[this.callCount - 1] > proxy.callIds[0];
        },

        calledImmediatelyBefore: function calledImmediatelyBefore(proxy) {
            if (!this.called || !proxy.called) {
                return false;
            }

            return (
                this.callIds[this.callCount - 1] ===
                proxy.callIds[proxy.callCount - 1] - 1
            );
        },

        calledImmediatelyAfter: function calledImmediatelyAfter(proxy) {
            if (!this.called || !proxy.called) {
                return false;
            }

            return (
                this.callIds[this.callCount - 1] ===
                proxy.callIds[proxy.callCount - 1] + 1
            );
        },

        formatters: formatters,

        printf: function (format) {
            const spyInstance = this;
            const args = Array.prototype.slice.call(arguments, 1);
            let formatter;

            return (format || "").replace(/%(.)/g, function (match, specifier) {
                formatter = tracker.formatters[specifier];

                if (typeof formatter === "function") {
                    return String(formatter(spyInstance, args));
                } else if (!isNaN(parseInt(specifier, 10))) {
                    return inspect(args[specifier - 1]);
                }

                return `%${specifier}`;
            });
        },

        resetHistory: function () {
            if (this.invoking) {
                const err = new Error(
                    "Cannot reset Sinon function while invoking it. " +
                        "Move the call to .resetHistory outside of the callback.",
                );
                err.name = "InvalidResetException";
                throw err;
            }

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

            if (this.fakes) {
                const forEach = Array.prototype.forEach;
                forEach.call(this.fakes, function (fake) {
                    fake.resetHistory();
                });
            }

            return this;
        },
    };

    delegateToCalls(tracker, "calledOn", true);
    delegateToCalls(tracker, "alwaysCalledOn", false, "calledOn");
    delegateToCalls(tracker, "calledWith", true);
    delegateToCalls(
        tracker,
        "calledOnceWith",
        true,
        "calledWith",
        false,
        undefined,
        1,
    );
    delegateToCalls(tracker, "calledWithMatch", true);
    delegateToCalls(tracker, "alwaysCalledWith", false, "calledWith");
    delegateToCalls(tracker, "alwaysCalledWithMatch", false, "calledWithMatch");
    delegateToCalls(tracker, "calledWithExactly", true);
    delegateToCalls(
        tracker,
        "calledOnceWithExactly",
        true,
        "calledWithExactly",
        false,
        undefined,
        1,
    );
    delegateToCalls(
        tracker,
        "calledOnceWithMatch",
        true,
        "calledWithMatch",
        false,
        undefined,
        1,
    );
    delegateToCalls(
        tracker,
        "alwaysCalledWithExactly",
        false,
        "calledWithExactly",
    );
    delegateToCalls(
        tracker,
        "neverCalledWith",
        false,
        "notCalledWith",
        false,
        function () {
            return true;
        },
    );
    delegateToCalls(
        tracker,
        "neverCalledWithMatch",
        false,
        "notCalledWithMatch",
        false,
        function () {
            return true;
        },
    );
    delegateToCalls(tracker, "threw", true);
    delegateToCalls(tracker, "alwaysThrew", false, "threw");
    delegateToCalls(tracker, "returned", true);
    delegateToCalls(tracker, "alwaysReturned", false, "returned");
    delegateToCalls(tracker, "calledWithNew", true);
    delegateToCalls(tracker, "alwaysCalledWithNew", false, "calledWithNew");

    return tracker;
}

export default createCallTracker;