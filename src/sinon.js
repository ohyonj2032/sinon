import createApi from "./create-sinon-api.js";

const sinon = createApi();
const stubESM = sinon.stubESM;

sinon.stubESM = function stubESM(namespace, prop) {
    return stubESM.call(sinon, namespace, prop);
};

export default sinon;
