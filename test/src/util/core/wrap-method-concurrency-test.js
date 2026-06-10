import test from "node:test";
import assert from "node:assert/strict";
import wrapMethod from "../../../../src/sinon/util/core/wrap-method.js";
import getPropertyDescriptor from "../../../../src/sinon/util/core/get-property-descriptor.js";

const noop = () => {};

test("wrap-method concurrency: two wrappers on same object.method do not cross-contaminate on restore", async (t) => {
    const sharedObject = { method() { return "original"; } };
    const originalMethod = sharedObject.method;

    const results = [];
    const workerADone = new Promise((resolve) => { results[0] = resolve; });
    const workerBDone = new Promise((resolve) => { results[1] = resolve; });

    let stubA, stubB;

    await t.test("Worker A wraps and then restores", async () => {
        stubA = function stubA() { return "stubA"; };
        wrapMethod(sharedObject, "method", stubA);

        assert.strictEqual(
            sharedObject.method,
            stubA,
            "Worker A: object.method should be stubA after wrapping",
        );
        assert.notStrictEqual(
            sharedObject.method,
            originalMethod,
            "Worker A: object.method should not be original",
        );

        results[0]();
    });

    await t.test("Worker B wraps (overwriting A), then A restores, B should survive", async () => {
        stubB = function stubB() { return "stubB"; };
        wrapMethod(sharedObject, "method", stubB);

        assert.strictEqual(
            sharedObject.method,
            stubB,
            "Worker B: object.method should be stubB after wrapping",
        );

        stubA.restore();

        assert.strictEqual(
            sharedObject.method,
            stubB,
            "After A restores, B's stub should still be active because A's stub was overwritten",
        );
        assert.notStrictEqual(
            sharedObject.method,
            originalMethod,
            "After A restores, object.method should NOT be back to original (B is still active)",
        );

        stubB.restore();

        assert.strictEqual(
            sharedObject.method,
            originalMethod,
            "After B restores, object.method should be back to original",
        );

        results[1]();
    });

    await Promise.all([workerADone, workerBDone]);
});

test("wrap-method concurrency: parallel interleaved wrap/restore does not crash", async (t) => {
    const sharedObject = { method() { return "original"; } };
    const originalMethod = sharedObject.method;

    const errors = [];

    const produceWrapper = (name) => {
        const fn = function () { return name; };
        fn._name = name;
        return fn;
    };

    const scheduledActions = [];

    function schedule(name, action) {
        scheduledActions.push({ name, action });
    }

    function runAll() {
        const promises = scheduledActions.map(({ name, action }) => {
            try {
                const result = action();
                return result instanceof Promise ? result : Promise.resolve(result);
            } catch (e) {
                errors.push(`${name}: ${e.message}`);
                return Promise.resolve();
            }
        });
        scheduledActions.length = 0;
        return Promise.all(promises);
    }

    schedule("A-wrap", () => {
        const stubA = produceWrapper("stubA");
        wrapMethod(sharedObject, "method", stubA);
        return { stubA, sharedObject };
    });

    schedule("B-pre-wrap", () => {
        const stubB = produceWrapper("stubB");
        wrapMethod(sharedObject, "method", stubB);
        return { stubB, sharedObject };
    });

    await runAll();

    const currentStub = sharedObject.method;

    assert.strictEqual(
        typeof currentStub.restore,
        "function",
        "active stub should have a restore method",
    );

    currentStub.restore();

    assert.strictEqual(
        sharedObject.method,
        originalMethod,
        "After restoring the active stub, object.method should return to original",
    );

    assert.strictEqual(errors.length, 0, "No errors should have occurred during concurrent operations");
});

test("wrap-method concurrency: descriptor-based accessor wrapping is safe across multiple contexts", async (t) => {
    const sharedObject = {};
    const originalGet = function () { return "original-get"; };
    const originalSet = function () {};

    Object.defineProperty(sharedObject, "prop", {
        get: originalGet,
        set: originalSet,
        configurable: true,
        enumerable: true,
    });

    const workerAStubGet = function () { return "stubA-get"; };
    const workerAStubSet = function () {};

    const workerBStubGet = function () { return "stubB-get"; };
    const workerBStubSet = function () {};

    wrapMethod(sharedObject, "prop", {
        get: workerAStubGet,
        set: workerAStubSet,
    });

    const afterAWrap = getPropertyDescriptor(sharedObject, "prop");

    assert.strictEqual(afterAWrap.get, workerAStubGet);
    assert.strictEqual(afterAWrap.set, workerAStubSet);

    wrapMethod(sharedObject, "prop", {
        get: workerBStubGet,
        set: workerBStubSet,
    });

    const afterBWrap = getPropertyDescriptor(sharedObject, "prop");

    assert.strictEqual(afterBWrap.get, workerBStubGet);
    assert.strictEqual(afterBWrap.set, workerBStubSet);

    afterAWrap.get.restore();

    const afterARestore = getPropertyDescriptor(sharedObject, "prop");

    assert.strictEqual(
        afterARestore.get,
        workerBStubGet,
        "After A restores, B's getter should remain (A is no longer top of stack)",
    );
    assert.strictEqual(
        afterARestore.set,
        workerBStubSet,
        "After A restores, B's setter should remain",
    );

    afterBWrap.get.restore();

    const afterBRestore = getPropertyDescriptor(sharedObject, "prop");

    assert.strictEqual(afterBRestore.get, originalGet);
    assert.strictEqual(afterBRestore.set, originalSet);
});

test("wrap-method concurrency: prototype methods are isolated", async (t) => {
    function MyType() {}
    MyType.prototype.method = function () { return "proto-original"; };

    const instance = new MyType();
    const originalMethod = MyType.prototype.method;

    const stubA = function () { return "stubA"; };
    const stubB = function () { return "stubB"; };

    wrapMethod(instance, "method", stubA);
    assert.strictEqual(instance.method, stubA);

    wrapMethod(instance, "method", stubB);
    assert.strictEqual(instance.method, stubB);

    stubA.restore();

    assert.strictEqual(
        instance.method,
        stubB,
        "After A restores on prototype method, B's stub should remain",
    );
    assert.notStrictEqual(
        instance.method,
        originalMethod,
        "After A restores, should NOT be back to prototype original",
    );

    stubB.restore();

    assert.strictEqual(
        instance.method,
        originalMethod,
        "After B restores, should be back to prototype original",
    );
});