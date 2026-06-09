import createProxy from "./proxy.js";
import spy from "./spy.js";
import extend from "./util/core/extend.js";
import behavior from "./behavior.js";
import behaviors from "./default-behaviors.js";
import { prototypes } from "@sinonjs/commons";

const { forEach, slice } = prototypes.array;
const { hasOwnProperty } = prototypes.object;

let uuid = 0;

function createEsmStub(namespace, prop) {
    // Create a stub that uses Proxy to intercept property access
    const target = namespace[prop];
    const stubInfo = {
        callCount: 0,
        called: false,
        calledOnce: false,
        calledTwice: false,
        calledThrice: false,
        args: [],
        returnValues: [],
        thisValues: [],
        exceptions: [],
        callIds: [],
        errorsWithCallStack: [],
        firstCall: null,
        secondCall: null,
        thirdCall: null,
        lastCall: null,
        firstArg: null,
        lastArg: null,
        notCalled: true,
        // Behavior-related properties
        fakes: [],
        instantiateFake: createEsmStub,
        displayName: `${String(prop)} (ESM)`,
        defaultBehavior: null,
        behaviors: [],
        id: `stubESM#${uuid++}`,
        // Track the original function
        originalFn: target,
        // Track the proxy reference for restoration
        namespace: namespace,
        propName: prop
    };

    // Create the stub function that will handle calls
    function functionStub() {
        const args = slice(arguments);
        const matchings = functionStub.matchingFakes ? functionStub.matchingFakes(args) : [];

        const fnStub =
            matchings.length > 0
                ? matchings[matchings.length - 1] // Last matching fake
                : functionStub;

        return getCurrentBehavior(fnStub).invoke.call(fnStub, this, arguments);
    }

    // Create the proxy that wraps the stub function
    const proxyStub = createProxy(functionStub, target || functionStub);
    
    // Extend with spy API
    extend.nonEnum(proxyStub, spy);
    
    // Extend with stub API
    extend.nonEnum(proxyStub, stub);

    // Set up the proxy handler to return the stub when accessing the property
    const handler = {
        get: function(targetNS, key) {
            if (key === prop) {
                return proxyStub;
            }
            // For all other properties, return the original value
            return targetNS[key];
        }
    };

    // Store the original namespace and create the proxy
    const proxiedNamespace = new Proxy(namespace, handler);

    // Extend the proxy stub with the stub info
    extend.nonEnum(proxyStub, stubInfo);

    // Add restore method to clean up the proxy reference
    proxyStub.restore = function() {
        // Clear references to prevent memory leaks
        stubInfo.callCount = 0;
        stubInfo.called = false;
        stubInfo.calledOnce = false;
        stubInfo.calledTwice = false;
        stubInfo.calledThrice = false;
        stubInfo.args = [];
        stubInfo.returnValues = [];
        stubInfo.thisValues = [];
        stubInfo.exceptions = [];
        stubInfo.callIds = [];
        stubInfo.errorsWithCallStack = [];
        stubInfo.firstCall = null;
        stubInfo.secondCall = null;
        stubInfo.thirdCall = null;
        stubInfo.lastCall = null;
        stubInfo.firstArg = null;
        stubInfo.lastArg = null;
        stubInfo.notCalled = true;
        stubInfo.fakes = [];
        stubInfo.defaultBehavior = null;
        stubInfo.behaviors = [];
        
        // Note: We can't restore the original namespace since it's immutable in ESM,
        // but we can clear internal references to prevent memory leaks
    };

    return {
        namespace: proxiedNamespace,
        stub: proxyStub
    };
}

// Get current behavior for the stub
function getCurrentBehavior(stubInstance) {
    if (!stubInstance.callCount || stubInstance.callCount <= 0) {
        return getDefaultBehavior(stubInstance);
    }
    
    const currentBehavior = stubInstance.behaviors[stubInstance.callCount - 1];
    return currentBehavior && currentBehavior.isPresent()
        ? currentBehavior
        : getDefaultBehavior(stubInstance);
}

function getDefaultBehavior(stubInstance) {
    return (
        stubInstance.defaultBehavior ||
        behavior.create(stubInstance)
    );
}

// Stub API methods
const stub = {
    resetBehavior: function () {
        this.defaultBehavior = null;
        this.behaviors = [];

        delete this.returnValue;
        delete this.returnArgAt;
        delete this.throwArgAt;
        delete this.resolveArgAt;
        delete this.fakeFn;
        this.returnThis = false;
        this.resolveThis = false;

        forEach(this.fakes, function (fake) {
            fake.resetBehavior();
        });
    },

    reset: function () {
        this.resetHistory();
        this.resetBehavior();
    },

    onCall: function onCall(index) {
        if (!this.behaviors[index]) {
            this.behaviors[index] = behavior.create(this);
        }

        return this.behaviors[index];
    },

    onFirstCall: function onFirstCall() {
        return this.onCall(0);
    },

    onSecondCall: function onSecondCall() {
        return this.onCall(1);
    },

    onThirdCall: function onThirdCall() {
        return this.onCall(2);
    },

    withArgs: function withArgs() {
        const fake = spy.withArgs.apply(this, arguments);
        if (this.defaultBehavior && this.defaultBehavior.promiseLibrary) {
            fake.defaultBehavior =
                fake.defaultBehavior || behavior.create(fake);
            fake.defaultBehavior.promiseLibrary =
                this.defaultBehavior.promiseLibrary;
        }
        return fake;
    },
};

// Add behavior methods to stub
forEach(Object.keys(behavior), function (method) {
    if (
        hasOwnProperty(behavior, method) &&
        !hasOwnProperty(stub, method) &&
        method !== "create" &&
        method !== "invoke"
    ) {
        stub[method] = behavior.createBehavior(method);
    }
});

forEach(Object.keys(behaviors), function (method) {
    if (hasOwnProperty(behaviors, method) && !hasOwnProperty(stub, method)) {
        behavior.addBehavior(stub, method, behaviors[method]);
    }
});

export default createEsmStub;