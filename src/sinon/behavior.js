import commons from "@sinonjs/commons";
import extend from "./util/core/extend.js";
import nextTick from "./util/core/next-tick.js";
import exportAsyncBehaviors from "./util/core/export-async-behaviors.js";

const { prototypes: commonsPrototypes, functionName, valueToString } = commons;
const { array: arrayProto } = commonsPrototypes;

const concat = arrayProto.concat;
const join = arrayProto.join;
const reverse = arrayProto.reverse;
const slice = arrayProto.slice;

const useLeftMostCallback = -1;
const useRightMostCallback = -2;

function isThenable(value) {
    return (
        value !== null &&
        value !== undefined &&
        typeof value.then === "function"
    );
}

function wrapThenableForStub(thenable, behavior) {
    var wrappedThenable = {
        then: function (onFulfilled, onRejected) {
            var result;

            try {
                result = thenable.then(onFulfilled, onRejected);
            } catch (e) {
                if (typeof onRejected === "function") {
                    return onRejected(e);
                }
                throw e;
            }

            if (result && typeof result.then === "function") {
                return wrapThenableForStub(result, behavior);
            }

            return result;
        },
    };

    if (typeof thenable.catch === "function") {
        wrappedThenable.catch = function (onRejected) {
            return wrappedThenable.then(null, onRejected);
        };
    }

    return wrappedThenable;
}

function getCallback(behavior, args) {
    const callArgAt = behavior.callArgAt;

    if (callArgAt >= 0) {
        return args[callArgAt];
    }

    let argumentList;

    if (callArgAt === useLeftMostCallback) {
        argumentList = args;
    }

    if (callArgAt === useRightMostCallback) {
        argumentList = reverse(slice(args));
    }

    const callArgProp = behavior.callArgProp;

    for (let i = 0, l = argumentList.length; i < l; ++i) {
        if (!callArgProp && typeof argumentList[i] === "function") {
            return argumentList[i];
        }

        if (
            callArgProp &&
            argumentList[i] &&
            typeof argumentList[i][callArgProp] === "function"
        ) {
            return argumentList[i][callArgProp];
        }
    }

    return null;
}

function getCallbackError(behavior, func, args) {
    if (behavior.callArgAt < 0) {
        let msg;

        if (behavior.callArgProp) {
            msg = `${functionName(
                behavior.stub,
            )} expected to yield to '${valueToString(
                behavior.callArgProp,
            )}', but no object with such a property was passed.`;
        } else {
            msg = `${functionName(
                behavior.stub,
            )} expected to yield, but no callback was passed.`;
        }

        if (args.length > 0) {
            msg += ` Received [${join(args, ", ")}]`;
        }

        return msg;
    }

    return `argument at index ${behavior.callArgAt} is not a function: ${func}`;
}

function ensureArgs(name, behavior, args) {
    // map function name to internal property
    //   callsArg => callArgAt
    const property = name.replace(/sArg/, "ArgAt");
    const index = behavior[property];

    if (index >= args.length) {
        throw new TypeError(
            `${name} failed: ${index + 1} arguments required but only ${
                args.length
            } present`,
        );
    }
}

function callCallback(behavior, args) {
    if (typeof behavior.callArgAt === "number") {
        ensureArgs("callsArg", behavior, args);
        const func = getCallback(behavior, args);

        if (typeof func !== "function") {
            throw new TypeError(getCallbackError(behavior, func, args));
        }

        if (behavior.callbackAsync) {
            nextTick(function () {
                func.apply(
                    behavior.callbackContext,
                    behavior.callbackArguments,
                );
            });
        } else {
            return func.apply(
                behavior.callbackContext,
                behavior.callbackArguments,
            );
        }
    }

    return undefined;
}

const proto = {
    create: function create(stub) {
        const behavior = extend({}, proto);
        delete behavior.create;
        delete behavior.addBehavior;
        delete behavior.createBehavior;
        behavior.stub = stub;

        if (stub.defaultBehavior && stub.defaultBehavior.promiseLibrary) {
            behavior.promiseLibrary = stub.defaultBehavior.promiseLibrary;
        }

        return behavior;
    },

    isPresent: function isPresent() {
        return (
            typeof this.callArgAt === "number" ||
            this.exception ||
            this.exceptionCreator ||
            typeof this.returnArgAt === "number" ||
            this.returnThis ||
            typeof this.resolveArgAt === "number" ||
            this.resolveThis ||
            typeof this.throwArgAt === "number" ||
            this.fakeFn ||
            this.returnValueDefined
        );
    },

    /*eslint complexity: ["error", 20]*/
    invoke: function invoke(context, args) {
        /*
         * callCallback (conditionally) calls ensureArgs
         *
         * Note: callCallback intentionally happens before
         * everything else and cannot be moved lower
         */
        const returnValue = callCallback(this, args);

        if (this.exception) {
            throw this.exception;
        } else if (this.exceptionCreator) {
            this.exception = this.exceptionCreator();
            this.exceptionCreator = undefined;
            throw this.exception;
        } else if (typeof this.returnArgAt === "number") {
            ensureArgs("returnsArg", this, args);
            return args[this.returnArgAt];
        } else if (this.returnThis) {
            return context;
        } else if (typeof this.throwArgAt === "number") {
            ensureArgs("throwsArg", this, args);
            throw args[this.throwArgAt];
        } else if (this.fakeFn) {
            return this.fakeFn.apply(context, args);
        } else if (typeof this.resolveArgAt === "number") {
            ensureArgs("resolvesArg", this, args);
            return (this.promiseLibrary || Promise).resolve(
                args[this.resolveArgAt],
            );
        } else if (this.resolveThis) {
            return (this.promiseLibrary || Promise).resolve(context);
        } else if (this.resolve) {
            return (this.promiseLibrary || Promise).resolve(this.returnValue);
        } else if (this.reject) {
            return (this.promiseLibrary || Promise).reject(this.returnValue);
        } else if (this.callsThrough) {
            const wrappedMethod = this.effectiveWrappedMethod();

            const originalResult = wrappedMethod.apply(context, args);

            if (
                this.returnValueDefined &&
                isThenable(this.returnValue)
            ) {
                return wrapThenableForStub(this.returnValue, this);
            }

            return originalResult;
        } else if (this.callsThroughWithNew) {
            // Get the original method (assumed to be a constructor in this case)
            const WrappedClass = this.effectiveWrappedMethod();
            // Turn the arguments object into a normal array
            const argsArray = slice(args);
            // Call the constructor
            const F = WrappedClass.bind.apply(
                WrappedClass,
                concat([null], argsArray),
            );
            return new F();
        } else if (this.returnValueDefined) {
            if (isThenable(this.returnValue)) {
                return wrapThenableForStub(this.returnValue, this);
            }
            return this.returnValue;
        } else if (typeof this.callArgAt === "number") {
            return returnValue;
        }

        return this.returnValue;
    },

    effectiveWrappedMethod: function effectiveWrappedMethod() {
        for (let stubb = this.stub; stubb; stubb = stubb.parent) {
            if (stubb.wrappedMethod) {
                return stubb.wrappedMethod;
            }
        }
        throw new Error("Unable to find wrapped method");
    },

    onCall: function onCall(index) {
        return this.stub.onCall(index);
    },

    onFirstCall: function onFirstCall() {
        return this.stub.onFirstCall();
    },

    onSecondCall: function onSecondCall() {
        return this.stub.onSecondCall();
    },

    onThirdCall: function onThirdCall() {
        return this.stub.onThirdCall();
    },

    withArgs: function withArgs(/* arguments */) {
        throw new Error(
            'Defining a stub by invoking "stub.onCall(...).withArgs(...)" ' +
                'is not supported. Use "stub.withArgs(...).onCall(...)" ' +
                "to define sequential behavior for calls with certain arguments.",
        );
    },
};

function createBehavior(behaviorMethod) {
    return function () {
        this.defaultBehavior = this.defaultBehavior || proto.create(this);
        this.defaultBehavior[behaviorMethod].apply(
            this.defaultBehavior,
            arguments,
        );
        return this;
    };
}

function addBehavior(stub, name, fn) {
    proto[name] = function () {
        fn.apply(this, concat([this], slice(arguments)));
        return this.stub || this;
    };

    stub[name] = createBehavior(name);
}

proto.addBehavior = addBehavior;
proto.createBehavior = createBehavior;

const asyncBehaviors = exportAsyncBehaviors(proto);

export default extend.nonEnum({}, proto, asyncBehaviors);
