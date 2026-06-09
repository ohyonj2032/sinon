import extend from "./util/core/extend.js";

/**
 * CallTracker - 独立的调用记录状态容器
 *
 * 设计原则:
 *   - spy 与 stub 都组合一个 CallTracker 实例，不再通过原型链相互继承状态。
 *   - 实例内部保存一份"权威"状态，同时通过 mountCallTrackerOnto()
 *     在 proxy / spy / stub 对象上建立别名引用，保证外部 API 完全兼容。
 *   - 标量字段 (called/callCount 等) 在 reset 时同步写回 proxy 对象;
 *     数组字段 (args/thisValues...) 直接共享同一数组引用。
 */
export default function CallTracker() {
    const tracker = Object.create(CallTracker.prototype);

    tracker.called = false;
    tracker.notCalled = true;
    tracker.calledOnce = false;
    tracker.calledTwice = false;
    tracker.calledThrice = false;
    tracker.callCount = 0;
    tracker.firstCall = null;
    tracker.secondCall = null;
    tracker.thirdCall = null;
    tracker.lastCall = null;
    tracker.firstArg = null;
    tracker.lastArg = null;
    tracker.args = [];
    tracker.returnValues = [];
    tracker.thisValues = [];
    tracker.exceptions = [];
    tracker.callIds = [];
    tracker.errorsWithCallStack = [];
    tracker.attachedTo = null;

    return tracker;
}

CallTracker.prototype = {
    constructor: CallTracker,

    reset: function () {
        const attachedTo = this.attachedTo;

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
        this.firstArg = null;
        this.lastArg = null;
        this.args.length = 0;
        this.returnValues.length = 0;
        this.thisValues.length = 0;
        this.exceptions.length = 0;
        this.callIds.length = 0;
        this.errorsWithCallStack.length = 0;

        if (attachedTo) {
            attachedTo.called = false;
            attachedTo.notCalled = true;
            attachedTo.calledOnce = false;
            attachedTo.calledTwice = false;
            attachedTo.calledThrice = false;
            attachedTo.callCount = 0;
            attachedTo.firstCall = null;
            attachedTo.secondCall = null;
            attachedTo.thirdCall = null;
            attachedTo.lastCall = null;
            attachedTo.firstArg = null;
            attachedTo.lastArg = null;
        }
    },
};

/**
 * 把 tracker 的数组字段共享到 target 上，并建立反向引用，
 * 让 reset() 能同步刷新 target 的标量字段。
 */
export function mountCallTrackerOnto(target, tracker) {
    tracker.attachedTo = target;

    extend.nonEnum(target, {
        _callTracker: tracker,
        isSinonProxy: true,
        called: false,
        notCalled: true,
        calledOnce: false,
        calledTwice: false,
        calledThrice: false,
        callCount: 0,
        firstCall: null,
        firstArg: null,
        secondCall: null,
        thirdCall: null,
        lastCall: null,
        lastArg: null,
        args: tracker.args,
        returnValues: tracker.returnValues,
        thisValues: tracker.thisValues,
        exceptions: tracker.exceptions,
        callIds: tracker.callIds,
        errorsWithCallStack: tracker.errorsWithCallStack,
    });

    return target;
}
