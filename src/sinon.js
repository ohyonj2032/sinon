import createApi from "./create-sinon-api.js";
import sinonStub from "./sinon/stub.js";

const sinon = createApi();

sinon.stubESM = function stubESM(namespace, prop) {
    return sinonStub.createEsmStub(namespace, prop);
};

export default sinon;
