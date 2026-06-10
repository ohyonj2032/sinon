import test from 'node:test';
import assert from 'node:assert';
import sinon from './src/sinon.js';

const target = {
    method() { return 'original'; }
};

test('worker A', async () => {
    const sandbox = sinon.createSandbox();
    sandbox.stub(target, 'method').returns('A');
    await new Promise(r => setTimeout(r, 100));
    sandbox.restore();
    assert.strictEqual(target.method(), 'original', 'A should restore correctly or leave B intact if B is active. Here B is still active when A restores, so it shouldn\'t restore to A\'s stub');
});

test('worker B', async () => {
    const sandbox = sinon.createSandbox();
    sandbox.stub(target, 'method').returns('B');
    await new Promise(r => setTimeout(r, 50));
    // When B runs restore, it should restore to original because A already restored
    sandbox.restore();
    assert.strictEqual(target.method(), 'original', 'B should restore correctly');
});
