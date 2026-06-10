import * as sinon from './src/sinon.js';
import createProxy from './src/sinon/proxy.js';

class MyClass {}

const stub = createProxy(MyClass, MyClass);
try {
  const instance = new stub();
  console.log("Success! Instance is:", instance);
} catch(e) {
  console.error("Error:", e.message);
}
