const GLOBAL_KEY = Symbol.for("@sinonjs/shared-state");

function getSharedState() {
    if (!globalThis[GLOBAL_KEY]) {
        globalThis[GLOBAL_KEY] = {
            wrapStateRegistry: new WeakMap(),
            sandboxRegistry: new WeakMap(),
            callId: 0,
            spyUuid: 0,
            stubUuid: 0,
        };
    }
    return globalThis[GLOBAL_KEY];
}

export default getSharedState;
