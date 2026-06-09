const sinon = require('./lib/sinon.js');

const stub = sinon.stub();
const thenable = {
    then: function(resolve) {
        resolve('test');
    }
};

stub.returns(thenable);

const res = stub();
res.then(val => {
    console.log("Then resolved:", val);
    console.log("Call count:", stub.callCount);
});