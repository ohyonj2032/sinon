import assert from "node:assert/strict";
import test from "node:test";
import sinon from "../../src/sinon.js";

function deferred() {
    let resolve;
    const promise = new Promise(function (resolvePromise) {
        resolve = resolvePromise;
    });

    return { promise, resolve };
}

test(
    "node:test 并行子测试下不同 sandbox 对同一方法的 stub/restore 互不污染",
    { concurrency: true },
    async function (t) {
        const target = {
            method() {
                return "original";
            },
        };
        const sandboxA = sinon.createSandbox();
        const sandboxB = sinon.createSandbox();
        const aStubbed = deferred();
        const bStubbed = deferred();
        const aRestored = deferred();

        t.after(function () {
            sandboxB.restore();
            sandboxA.restore();
        });

        await Promise.all([
            t.test(
                "worker A",
                { concurrency: true },
                async function () {
                    sandboxA.stub(target, "method").returns("A");
                    assert.equal(target.method(), "A");
                    aStubbed.resolve();

                    await bStubbed.promise;

                    sandboxA.restore();
                    assert.equal(target.method(), "B");
                    aRestored.resolve();
                },
            ),
            t.test(
                "worker B",
                { concurrency: true },
                async function () {
                    await aStubbed.promise;

                    sandboxB.stub(target, "method").returns("B");
                    assert.equal(target.method(), "B");
                    bStubbed.resolve();

                    await aRestored.promise;

                    assert.equal(target.method(), "B");
                    sandboxB.restore();
                    assert.equal(target.method(), "original");
                },
            ),
        ]);
    },
);
