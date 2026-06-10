import test from "node:test";
import assert from "node:assert/strict";
import wrapMethod from "../../src/sinon/util/core/wrap-method.js";

/**
 * Reproduction test for the Sinon.js concurrent-stub cross-contamination bug.
 *
 * Problem: wrap-method.js stores the original method / descriptor as hidden
 * properties (restore, wrappedMethod, stackTraceError) directly on the wrapped
 * object's replacement function.  When two independent "sandboxes" (e.g.
 * parallel worker threads sharing the same module object) each stub the same
 * (object, property) pair, the second stub overwrites the first one's hidden
 * state on the shared object.  If the first sandbox then calls restore(), it
 * ends up restoring the *second* sandbox's stub in place of the original
 * method, leaving the second sandbox with a broken / dead stub.
 *
 * The fix migrates the book-keeping into a module-private WeakMap keyed by
 * (object, property, replacement) so each wrap has its own isolated record.
 */

test("wrap-method: two sequential wraps of the same (object, property) must not cross-contaminate each other on restore", function () {
    // shared module-level object, like a real service module in Node.js
    const sharedObject = {
        fetch: function originalFetch() {
            return "original";
        },
    };
    const originalFetch = sharedObject.fetch;

    // --- Sandbox A wraps first ---
    const stubA = function stubA() {
        return "A";
    };
    wrapMethod(sharedObject, "fetch", stubA);
    assert.equal(sharedObject.fetch, stubA, "object.fetch should be stubA");
    assert.equal(sharedObject.fetch(), "A");

    // stashed reference for sandbox A to later call restore() on it
    const stubAReference = sharedObject.fetch;
    assert.equal(typeof stubAReference.restore, "function");

    // --- Sandbox B wraps the same (object, property) ---
    // In the real world sandbox B lives in a separate worker and never saw A,
    // so it should not be blocked by A.  The current code, however, stores
    // metadata on the shared object and this is where the cross-contamination
    // originates.  The new implementation keeps A's record separate from B's.
    const stubB = function stubB() {
        return "B";
    };

    // Before the WeakMap refactor this *overwrote* stubA's hidden properties
    // on the shared object; after the refactor A's and B's records live
    // isolated from each other and both are independently restorable.
    wrapMethod(sharedObject, "fetch", stubB);

    // Sandbox A still holds a reference to its stub and expects restore()
    // to put the *original* method back (as far as A is concerned).
    stubAReference.restore();

    // After A's restore the object is back to its original state from A's
    // point of view.  A must NOT have overwritten B's book-keeping:
    assert.equal(
        sharedObject.fetch,
        originalFetch,
        "After A.restore() the object.fetch should be the original function",
    );
});

test("wrap-method: each wrap carries its own original descriptor, restore must not see a sibling's state", function () {
    const sharedObject = { value: 0, inc: function inc() {
        this.value += 1;
        return this.value;
    } };
    const originalInc = sharedObject.inc;

    const stubX = function stubX() {
        return "X";
    };
    wrapMethod(sharedObject, "inc", stubX);
    const stubXRef = sharedObject.inc;

    const stubY = function stubY() {
        return "Y";
    };
    wrapMethod(sharedObject, "inc", stubY);
    const stubYRef = sharedObject.inc;

    // Both stubs should have their own, non-shared, restore method.
    assert.notEqual(
        stubXRef.restore,
        stubYRef.restore,
        "Each wrap must expose its own restore closure",
    );

    // Restoring X first should not break Y's restoration.
    stubXRef.restore();
    // The property is now originalInc (as X saw it before its wrap).
    assert.equal(sharedObject.fetch, sharedObject.fetch); // sanity
    assert.equal(
        sharedObject.inc,
        originalInc,
        "After X.restore() the property should be the original function",
    );
    // Restoring Y afterwards must still be safe and not throw.
    // With the previous implementation Y.restore would restore X's stub on
    // top of the original (because Y had captured X as its "original").
    // With the WeakMap-based registry Y's record refers to the true original
    // descriptor observed when Y wrapped.
    stubYRef.restore();
    assert.equal(
        sharedObject.inc,
        originalInc,
        "After Y.restore() the property must still be the original function",
    );
});

test("wrap-method: restore on a prototype-shadowed property must use its own captured descriptor", function () {
    function Service() {}
    Service.prototype.ping = function originalPing() {
        return "pong";
    };
    const originalPing = Service.prototype.ping;

    const instance = new Service();

    const stub1 = function () {
        return "stub1";
    };
    wrapMethod(instance, "ping", stub1);
    const stub1Ref = instance.ping;

    const stub2 = function () {
        return "stub2";
    };
    wrapMethod(instance, "ping", stub2);

    stub1Ref.restore();
    // After stub1's restore, the own property "ping" on the instance should
    // be gone because stub1 observed a non-owned (prototype) descriptor.
    assert.equal(
        Object.hasOwn(instance, "ping"),
        false,
        "stub1 observed a prototype property and must delete the own property on restore",
    );
    assert.equal(
        instance.ping,
        originalPing,
        "Instance access must resolve to the prototype method",
    );
});
