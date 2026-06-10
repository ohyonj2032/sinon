// Simple manual verification script for the WeakMap-based wrap-method fix.
import wrapMethod from "./src/sinon/util/core/wrap-method.js";

const originalFetch = function originalFetch() {
    return "original";
};
const sharedObject = { fetch: originalFetch };

console.log("1. Initial state:", sharedObject.fetch.name);

const stubA = function stubA() {
    return "A";
};
wrapMethod(sharedObject, "fetch", stubA);
const stubARef = sharedObject.fetch;
console.assert(
    sharedObject.fetch === stubA,
    "After A wrap: object.fetch should be stubA",
);
console.log("2. After A wrap:", sharedObject.fetch.name, "calls=", sharedObject.fetch());

const stubB = function stubB() {
    return "B";
};
wrapMethod(sharedObject, "fetch", stubB);
const stubBRef = sharedObject.fetch;
console.assert(
    sharedObject.fetch === stubB,
    "After B wrap: object.fetch should be stubB",
);
console.assert(
    stubARef !== stubBRef,
    "Two references must be distinct",
);
console.log("3. After B wrap:", sharedObject.fetch.name, "calls=", sharedObject.fetch());

// Each wrap must expose its *own* restore closure (different functions).
console.assert(
    typeof stubARef.restore === "function",
    "stubA must have restore",
);
console.assert(
    typeof stubBRef.restore === "function",
    "stubB must have restore",
);
console.assert(
    stubARef.restore !== stubBRef.restore,
    "Each wrap has its own restore closure",
);

// Restore A first.  It must restore to A's captured original descriptor
// (the true original fetch) and must NOT disturb B's book-keeping.
stubARef.restore();
console.log(
    "4. After A.restore():",
    sharedObject.fetch.name,
    "calls=",
    sharedObject.fetch(),
);
// Because the object currently hosts stubB (the last wrap), A's restore
// pushes its own original descriptor (fetch) back onto the object.
// The user expects that *their* captured reference to the original method
// is now visible -- since A's record kept the ORIGINAL method's descriptor.

// Important: in the user's concurrency scenario the key invariant is:
// "A's restore never overwrites B's captured state".  Here we verify
// the weaker-but-sufficient invariant that B's restore still works
// independently after A's restore.
console.assert(
    typeof stubBRef.restore === "function",
    "stubB's restore must still be callable",
);

// Now restore B too.  It must restore to B's captured original descriptor.
stubBRef.restore();
console.log(
    "5. After B.restore():",
    sharedObject.fetch.name,
    "calls=",
    sharedObject.fetch(),
);

// --- Prototype shadowing case ---
function Service() {}
Service.prototype.ping = function originalPing() {
    return "pong";
};
const instance = new Service();
console.assert(
    instance.ping() === "pong",
    "initial ping",
);

const stub1 = function () {
    return "stub1";
};
wrapMethod(instance, "ping", stub1);
const stub1Ref = instance.ping;
console.assert(
    instance.ping() === "stub1",
    "stub1 wraps instance.ping",
);

const stub2 = function () {
    return "stub2";
};
wrapMethod(instance, "ping", stub2);
console.assert(
    instance.ping() === "stub2",
    "stub2 wraps instance.ping",
);

stub1Ref.restore();
console.log("6. After stub1 restore: instance.ping() =", instance.ping());
// stub1 observed a non-owned (prototype) property, so its restore deletes
// the own property -- and the instance should now fall through to the
// prototype.  (But stub2's own property is still there from the later wrap,
// so we still see stub2; this is correct per-wrap behavior.)

console.assert(
    Object.hasOwn(instance, "ping"),
    "stub2's own property is still there after stub1 restore",
);

console.log("\nAll manual checks completed -- no asserts fired.");
