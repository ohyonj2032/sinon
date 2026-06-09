import createStub from "./src/sinon/stub.js";

async function testThenable() {
    console.log("Testing thenable support in stub.returns()...\n");

    let testPassed = 0;
    let testFailed = 0;

    try {
        const stub = createStub();
        const thenable = {
            then: function(onFulfilled, onRejected) {
                return onFulfilled("thenable value");
            }
        };

        stub.returns(thenable);

        const result = stub();

        if (result && typeof result.then === "function") {
            const value = await result;
            if (value === "thenable value") {
                console.log("✓ Test 1 PASSED: Thenable object is properly handled and resolves to correct value");
                testPassed++;
            } else {
                console.log("✗ Test 1 FAILED: Thenable resolved to wrong value:", value);
                testFailed++;
            }
        } else {
            console.log("✗ Test 1 FAILED: Result is not a promise");
            testFailed++;
        }

        if (stub.callCount === 1) {
            console.log("✓ Test 2 PASSED: callCount is correctly incremented to 1");
            testPassed++;
        } else {
            console.log("✗ Test 2 FAILED: callCount is", stub.callCount, "expected 1");
            testFailed++;
        }

        const standardPromise = new Promise(function(resolve) {
            resolve("standard promise value");
        });

        const stub2 = createStub();
        stub2.returns(standardPromise);

        const result2 = await stub2();

        if (result2 === "standard promise value") {
            console.log("✓ Test 3 PASSED: Standard Promise still works correctly");
            testPassed++;
        } else {
            console.log("✗ Test 3 FAILED: Standard Promise returned wrong value:", result2);
            testFailed++;
        }

        if (stub2.callCount === 1) {
            console.log("✓ Test 4 PASSED: callCount for standard Promise is correctly incremented");
            testPassed++;
        } else {
            console.log("✗ Test 4 FAILED: callCount for standard Promise is", stub2.callCount, "expected 1");
            testFailed++;
        }

        const originalFn = function() {
            return {
                then: function(onFulfilled, onRejected) {
                    return onFulfilled("original thenable");
                }
            };
        };

        const stub3 = createStub();
        stub3.callsFake(originalFn);

        const result3 = stub3();

        if (result3 && typeof result3.then === "function") {
            const value3 = await result3;
            if (value3 === "original thenable") {
                console.log("✓ Test 5 PASSED: callsFake with thenable works correctly");
                testPassed++;
            } else {
                console.log("✗ Test 5 FAILED: callsFake thenable resolved to wrong value:", value3);
                testFailed++;
            }
        } else {
            console.log("✗ Test 5 FAILED: callsFake result is not a promise");
            testFailed++;
        }

        if (stub3.callCount === 1) {
            console.log("✓ Test 6 PASSED: callCount for callsFake is correctly incremented");
            testPassed++;
        } else {
            console.log("✗ Test 6 FAILED: callCount for callsFake is", stub3.callCount, "expected 1");
            testFailed++;
        }

        const rejectingThenable = {
            then: function(onFulfilled, onRejected) {
                return onRejected(new Error("thenable rejection"));
            }
        };

        const stub4 = createStub();
        stub4.returns(rejectingThenable);

        try {
            const result4 = await stub4();
            console.log("✗ Test 7 FAILED: Rejecting thenable should have thrown");
            testFailed++;
        } catch (error) {
            if (error.message === "thenable rejection") {
                console.log("✓ Test 7 PASSED: Rejecting thenable properly rejects the promise");
                testPassed++;
            } else {
                console.log("✗ Test 7 FAILED: Wrong error message:", error.message);
                testFailed++;
            }
        }

        if (stub4.callCount === 1) {
            console.log("✓ Test 8 PASSED: callCount for rejecting thenable is correctly incremented");
            testPassed++;
        } else {
            console.log("✗ Test 8 FAILED: callCount for rejecting thenable is", stub4.callCount, "expected 1");
            testFailed++;
        }

        console.log(`\n========================================`);
        console.log(`Test Results: ${testPassed} passed, ${testFailed} failed`);
        console.log(`========================================`);

        if (testFailed > 0) {
            process.exit(1);
        }
    } catch (error) {
        console.error("Test execution failed with error:", error);
        process.exit(1);
    }
}

testThenable();
