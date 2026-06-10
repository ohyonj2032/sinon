import * as sinon from './src/sinon.js';

class MyClass {
    constructor() {
        this.value = 42;
    }
}

const mod = { MyClass };

sinon.stub(mod, 'MyClass');

try {
    const instance = new mod.MyClass();
    console.log("Success! Instance:", instance instanceof MyClass);
} catch (e) {
    console.error("Error:", e);
}
