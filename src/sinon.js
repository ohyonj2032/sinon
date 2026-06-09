import createApi from "./create-sinon-api.js";
import { stubESM } from "./sinon/stub.js";

const sinon = createApi();

sinon.stubESM = stubESM;

export default sinon;
