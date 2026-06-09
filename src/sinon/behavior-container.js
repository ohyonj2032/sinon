import extend from "./util/core/extend.js";
import behavior from "./behavior.js";

/**
 * BehaviorContainer - 独立的 stub 行为容器
 *
 * 职责:
 *   - 管理 defaultBehavior / behaviors 数组
 *   - 暴露 onCall / resetBehavior 等行为配置 API
 *   - 提供 getCurrentBehavior 决策入口
 *
 * 与 stub 组合而非继承, 使 stub 仅保留行为相关逻辑,
 * spy 不需要 BehaviorContainer。
 */
export default function BehaviorContainer(stub) {
    const container = Object.create(BehaviorContainer.prototype);

    container.stub = stub;
    container.defaultBehavior = null;
    container.behaviors = [];

    return container;
}

BehaviorContainer.prototype = {
    constructor: BehaviorContainer,

    onCall: function (index) {
        if (!this.behaviors[index]) {
            this.behaviors[index] = behavior.create(this.stub);
        }
        return this.behaviors[index];
    },

    onFirstCall: function () {
        return this.onCall(0);
    },

    onSecondCall: function () {
        return this.onCall(1);
    },

    onThirdCall: function () {
        return this.onCall(2);
    },

    resetBehavior: function () {
        this.defaultBehavior = null;
        this.behaviors = [];

        if (this.stub) {
            delete this.stub.returnValue;
            delete this.stub.returnArgAt;
            delete this.stub.throwArgAt;
            delete this.stub.resolveArgAt;
            delete this.stub.fakeFn;
            this.stub.returnThis = false;
            this.stub.resolveThis = false;
        }
    },

    getCurrentBehavior: function () {
        const currentBehavior = this.behaviors[this.stub.callCount - 1];
        if (currentBehavior && currentBehavior.isPresent()) {
            return currentBehavior;
        }
        return this.getDefaultBehavior();
    },

    getDefaultBehavior: function () {
        if (this.defaultBehavior) {
            return this.defaultBehavior;
        }
        const parent = this.stub.parent;
        if (parent && parent._behaviorContainer) {
            const b = parent._behaviorContainer.getCurrentBehavior();
            if (b) return b;
        }
        return behavior.create(this.stub);
    },
};

export function mountBehaviorContainerOnto(stub, container) {
    extend.nonEnum(stub, {
        _behaviorContainer: container,
        defaultBehavior: null, // 兼容性字段
        behaviors: [], // 兼容性字段
    });
    // 将 onCall/onFirstCall/... 作为快捷方式挂到 stub 上
    stub.onCall = function (i) {
        return container.onCall(i);
    };
    stub.onFirstCall = function () {
        return container.onFirstCall();
    };
    stub.onSecondCall = function () {
        return container.onSecondCall();
    };
    stub.onThirdCall = function () {
        return container.onThirdCall();
    };
    stub.resetBehavior = function () {
        container.resetBehavior();
        // 同步 fakes
        if (this.fakes && this.fakes.length) {
            Array.prototype.forEach.call(this.fakes, function (fake) {
                if (fake.resetBehavior) fake.resetBehavior();
            });
        }
        return this;
    };
    return stub;
}
