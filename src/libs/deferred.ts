class Deferred {
  promise: any;
  reject: any;
  resolve: any;
  constructor() {
    this.reset();
  }

  reset() {
    this.promise = new Promise((resolve, reject) => {
      this.reject = reject;
      this.resolve = resolve;
    });
  }
}
export default Deferred;
