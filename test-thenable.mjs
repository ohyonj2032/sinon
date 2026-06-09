import sinon from "./src/sinon.js";

function makeThenable(value, delay = 10) {
    return {
        then(onFulfilled, onRejected) {
            setTimeout(() => {
                onFulfilled(value);
            }, delay);
        },
    };
}

console.log("Test 1: returns() with custom thenable triggers .then callback");
{
    const stub = sinon.stub();
    const t = makeThenable(42);
    stub.returns(t);
    const result = stub();
    console.log("  stub() returned:", result instanceof Promise);
    console.log("  callCount after stub():", stub.callCount);
    result.then((val) => {
        console.log("  .then callback fired with:", val);
        console.log("  callCount after .then:", stub.callCount);
    });
}

setTimeout(() => {
    console.log("\nTest 2: returns() with standard Promise is unchanged");
    {
        const stub = sinon.stub();
        const p = Promise.resolve(99);
        stub.returns(p);
        const result = stub();
        console.log("  Result === original Promise:", result === p);
        result.then((val) => console.log("  Value:", val));
    }

    console.log("\nTest 3: returns() with plain value unchanged");
    {
        const stub = sinon.stub();
        stub.returns("hello");
        const result = stub();
        console.log("  Result:", result);
        console.log("  callCount:", stub.callCount);
    }

    console.log("\nTest 4: callThrough with custom thenable");
    {
        const obj = {
            fn() {
                return makeThenable("async-value");
            },
        };
        const stub = sinon.stub(obj, "fn").callThrough();
        const result = obj.fn();
        console.log("  Result is Promise:", result instanceof Promise);
        console.log("  callCount:", stub.callCount);
        result.then((val) => console.log("  .then callback fired with:", val));
    }

    setTimeout(() => {
        console.log("\nTest 5: resolves() still works normally");
        {
            const stub = sinon.stub().resolves("resolved-value");
            stub().then((val) => console.log("  resolves() value:", val));
        }
    }, 50);
}, 50);
