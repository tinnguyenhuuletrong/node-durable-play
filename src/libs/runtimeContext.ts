import debug from "debug";
const logger = debug("utils");

type TraceItem = {
  seqId: number;
  action: string;
  params: any[];
  result: any;
  error: any;
};

export class RuntimeContext {
  private traces: TraceItem[] = [];
  constructor() {}

  restore(traces: TraceItem[]) {
    this.traces = traces;
  }

  getTraces() {
    return this.traces;
  }

  wrapAction<A extends ReadonlyArray<unknown>, R>(
    name: string,
    f: (...params: A) => Promise<R>
  ) {
    return async (...i: A) => {
      // TODO: lookup prevActionId

      const seqId = this.traces.length;
      const newItm: TraceItem = {
        seqId,
        action: name,
        params: [...i],
        result: undefined,
        error: undefined,
      };
      this.traces.push(newItm);

      logger("begin", seqId, name);

      let funcReturn: any;
      try {
        funcReturn = await f(...i);
        newItm.result = funcReturn;
      } catch (error) {
        newItm.error = error;
        throw error;
      }

      logger("end", seqId, { result: newItm.result, error: newItm.error });

      return funcReturn;
    };
  }
}
