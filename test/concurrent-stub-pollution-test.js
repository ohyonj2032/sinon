import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import sinon from "../src/sinon.js";

const sharedObj = {
    method: function () {
        return "original";
    },
    anotherMethod: function () {
        return "another-original";
    },
};

describe("Concurrent stub cross-pollution: fixed with WeakMap registry", () => {
    beforeEach(() => {
        sharedObj.method = function () {
            return "original";
        };
        sharedObj.anotherMethod = function () {
            return "another-original";
        };
    });

    afterEach(() => {
        sinon.restore();
    });

    it("FIXED: two sandboxes CAN now stub the same method concurrently (previously threw 'already wrapped')", () => {
        const sandbox1 = sinon.createSandbox();
        const sandbox2 = sinon.createSandbox();

        const stub1 = sandbox1.stub(sharedObj, "method");
        stub1.returns("stub1");

        assert.doesNotThrow(() => {
            sandbox2.stub(sharedObj, "method");
        }, "Second sandbox should be able to stub the same method");

        sandbox1.restore();
        sandbox2.restore();
    });

    it("FIXED: A's restore no longer wipes B's stub (previously caused cross-pollution)", () => {
        const sandbox1 = sinon.createSandbox();
        const sandbox2 = sinon.createSandbox();

        const stub1 = sandbox1.stub(sharedObj, "method");
        stub1.returns("stub1");

        const stub2 = sandbox2.stub(sharedObj, "method");
        stub2.returns("stub2");

        assert.strictEqual(sharedObj.method(), "stub2");

        sandbox1.restore();

        assert.strictEqual(
            sharedObj.method(),
            "stub2",
            "After sandbox1.restore(), sandbox2's stub should still be active",
        );

        sandbox2.restore();

        assert.strictEqual(
            sharedObj.method(),
            "original",
            "After both restore, original method should be back",
        );
    });
});

describe("Concurrent stub with WeakMap registry (comprehensive tests)", () => {
    beforeEach(() => {
        sharedObj.method = function () {
            return "original";
        };
        sharedObj.anotherMethod = function () {
            return "another-original";
        };
    });

    afterEach(() => {
        sinon.restore();
    });

    it("should allow two sandboxes to stub the same method concurrently", () => {
        const sandbox1 = sinon.createSandbox();
        const sandbox2 = sinon.createSandbox();

        const stub1 = sandbox1.stub(sharedObj, "method");
        stub1.returns("stub1");

        const stub2 = sandbox2.stub(sharedObj, "method");
        stub2.returns("stub2");

        assert.strictEqual(
            sharedObj.method(),
            "stub2",
            "The last stub should be the active one",
        );

        sandbox1.restore();

        assert.strictEqual(
            sharedObj.method(),
            "stub2",
            "After sandbox1 restores, sandbox2's stub should still be active",
        );

        sandbox2.restore();

        assert.strictEqual(
            sharedObj.method(),
            "original",
            "After both sandboxes restore, the original method should be back",
        );
    });

    it("should allow restoring in reverse order", () => {
        const sandbox1 = sinon.createSandbox();
        const sandbox2 = sinon.createSandbox();

        const stub1 = sandbox1.stub(sharedObj, "method");
        stub1.returns("stub1");

        const stub2 = sandbox2.stub(sharedObj, "method");
        stub2.returns("stub2");

        assert.strictEqual(sharedObj.method(), "stub2");

        sandbox2.restore();

        assert.strictEqual(
            sharedObj.method(),
            "stub1",
            "After sandbox2 restores, sandbox1's stub should be active",
        );

        sandbox1.restore();

        assert.strictEqual(
            sharedObj.method(),
            "original",
            "After both restore, original method should be back",
        );
    });

    it("should allow three sandboxes to stub the same method", () => {
        const sandbox1 = sinon.createSandbox();
        const sandbox2 = sinon.createSandbox();
        const sandbox3 = sinon.createSandbox();

        const stub1 = sandbox1.stub(sharedObj, "method");
        stub1.returns("stub1");

        const stub2 = sandbox2.stub(sharedObj, "method");
        stub2.returns("stub2");

        const stub3 = sandbox3.stub(sharedObj, "method");
        stub3.returns("stub3");

        assert.strictEqual(sharedObj.method(), "stub3");

        sandbox2.restore();
        assert.strictEqual(
            sharedObj.method(),
            "stub3",
            "Restoring middle sandbox should not change the active stub",
        );

        sandbox3.restore();
        assert.strictEqual(
            sharedObj.method(),
            "stub1",
            "After top two restore, sandbox1's stub should be active",
        );

        sandbox1.restore();
        assert.strictEqual(sharedObj.method(), "original");
    });

    it("should preserve callsThrough behavior pointing to the true original", () => {
        const sandbox1 = sinon.createSandbox();
        const sandbox2 = sinon.createSandbox();

        const stub1 = sandbox1.stub(sharedObj, "method");
        stub1.returns("stub1");

        const stub2 = sandbox2.stub(sharedObj, "method");
        stub2.callsThrough();

        assert.strictEqual(
            sharedObj.method(),
            "original",
            "callsThrough should call the true original, not stub1",
        );

        sandbox2.restore();
        assert.strictEqual(sharedObj.method(), "stub1");

        sandbox1.restore();
        assert.strictEqual(sharedObj.method(), "original");
    });

    it("should handle stubbing different methods on the same object concurrently", () => {
        const sandbox1 = sinon.createSandbox();
        const sandbox2 = sinon.createSandbox();

        const stub1 = sandbox1.stub(sharedObj, "method");
        stub1.returns("stub1-method");

        const stub2 = sandbox2.stub(sharedObj, "anotherMethod");
        stub2.returns("stub2-another");

        assert.strictEqual(sharedObj.method(), "stub1-method");
        assert.strictEqual(sharedObj.anotherMethod(), "stub2-another");

        sandbox1.restore();
        assert.strictEqual(sharedObj.method(), "original");
        assert.strictEqual(sharedObj.anotherMethod(), "stub2-another");

        sandbox2.restore();
        assert.strictEqual(sharedObj.method(), "original");
        assert.strictEqual(sharedObj.anotherMethod(), "another-original");
    });

    it("should handle double restore gracefully", () => {
        const sandbox1 = sinon.createSandbox();
        const sandbox2 = sinon.createSandbox();

        const stub1 = sandbox1.stub(sharedObj, "method");
        stub1.returns("stub1");

        const stub2 = sandbox2.stub(sharedObj, "method");
        stub2.returns("stub2");

        sandbox1.restore();
        sandbox1.restore();

        assert.strictEqual(sharedObj.method(), "stub2");

        sandbox2.restore();
        assert.strictEqual(sharedObj.method(), "original");
    });

    it("should handle prototype properties correctly with concurrent stubs", () => {
        function MyClass() {}
        MyClass.prototype.method = function () {
            return "prototype-original";
        };

        const instance = new MyClass();

        const sandbox1 = sinon.createSandbox();
        const sandbox2 = sinon.createSandbox();

        const stub1 = sandbox1.stub(instance, "method");
        stub1.returns("stub1");

        const stub2 = sandbox2.stub(instance, "method");
        stub2.returns("stub2");

        assert.strictEqual(instance.method(), "stub2");

        sandbox1.restore();
        assert.strictEqual(instance.method(), "stub2");

        sandbox2.restore();
        assert.strictEqual(
            instance.method(),
            "prototype-original",
            "Prototype method should be restored after all stubs are removed",
        );
        assert.strictEqual(
            instance.hasOwnProperty("method"),
            false,
            "Own property should be removed, falling back to prototype",
        );
    });

    it("should correctly restore when middle entry is removed from stack", () => {
        const sandbox1 = sinon.createSandbox();
        const sandbox2 = sinon.createSandbox();
        const sandbox3 = sinon.createSandbox();

        const stub1 = sandbox1.stub(sharedObj, "method");
        stub1.returns("stub1");

        const stub2 = sandbox2.stub(sharedObj, "method");
        stub2.returns("stub2");

        const stub3 = sandbox3.stub(sharedObj, "method");
        stub3.returns("stub3");

        assert.strictEqual(sharedObj.method(), "stub3");

        sandbox2.restore();
        assert.strictEqual(
            sharedObj.method(),
            "stub3",
            "Removing middle entry should not change the active stub",
        );

        sandbox3.restore();
        assert.strictEqual(
            sharedObj.method(),
            "stub1",
            "After top restores, bottom stub should be active",
        );

        sandbox1.restore();
        assert.strictEqual(sharedObj.method(), "original");
    });

    it("wrappedMethod should always point to the true original", () => {
        const sandbox1 = sinon.createSandbox();
        const sandbox2 = sinon.createSandbox();

        const stub1 = sandbox1.stub(sharedObj, "method");
        stub1.returns("stub1");

        const stub2 = sandbox2.stub(sharedObj, "method");
        stub2.returns("stub2");

        assert.strictEqual(
            typeof stub1.wrappedMethod,
            "function",
            "stub1.wrappedMethod should be a function",
        );
        assert.strictEqual(
            typeof stub2.wrappedMethod,
            "function",
            "stub2.wrappedMethod should be a function",
        );

        assert.strictEqual(
            stub1.wrappedMethod(),
            "original",
            "stub1.wrappedMethod should point to the true original",
        );
        assert.strictEqual(
            stub2.wrappedMethod(),
            "original",
            "stub2.wrappedMethod should also point to the true original",
        );

        sandbox2.restore();
        sandbox1.restore();
    });
});
