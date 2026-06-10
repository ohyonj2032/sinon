class MyClass {
    constructor(a, b) {
        this.a = a;
        this.b = b;
    }
}
const bind = Function.prototype.bind;
const bound = bind.apply(MyClass, [null, 1, 2]);
const instance = new bound();
console.log(instance.a, instance.b);
