import debug from "debug";
const logger = debug("utils");

export type TraceLog = {
  seqId: number;
  action: string;
  params: any[];
  isSuccess: boolean;
  result: any;
  error: any;
};
export enum ERuntimeMode {
  EREPLAY_ONLY = 1,
  EREPLAY_AND_RUN = 2,
}

export type wrapActionOpts = {
  canFastForward: boolean;
};

/**
 * Run & Record traces
 *  if top traces match
 *    if success
 *      resolve result
 *    else
 *      retry ?
 */
export class RuntimeContext {
  private traces: TraceLog[] = [];
  private seqId: number = 0;
  private mode: ERuntimeMode;
  constructor(mode: ERuntimeMode) {
    this.mode = mode;
  }

  restore(traces: TraceLog[]) {
    this.traces = traces;
  }

  getTraces() {
    return this.traces;
  }

  private blockPromise() {
    return new Promise(() => {});
  }

  wrapAction<A extends ReadonlyArray<unknown>, R>(
    name: string,
    f: (...params: A) => Promise<R>,
    opts: wrapActionOpts = { canFastForward: true }
  ) {
    return async (...i: A) => {
      const topItm = this.traces[this.seqId];
      if (topItm) {
        if (topItm.action !== name) {
          throw new Error(
            `trace miss-match at ${this.seqId}: ${topItm.action} !== ${name}`
          );
        }

        this.seqId++;
        if (topItm.isSuccess) {
          if (opts.canFastForward) {
            logger(`fast-forward: ${topItm.seqId}`, {
              action: topItm.action,
              result: topItm.result,
              error: topItm.error,
            });
            return topItm.result;
          }

          logger(`replay: ${topItm.seqId}`, {
            action: topItm.action,
            result: topItm.result,
            error: topItm.error,
          });
          return await f(...i);
        } else {
          //TODO: check & retry ?
          //  for now - re-throw error
          throw topItm.error;
        }
      }

      // finish replay
      if (this.mode === ERuntimeMode.EREPLAY_ONLY) {
        logger(`block promise`);
        return this.blockPromise();
      }

      // continue to run
      this.seqId++;
      const seqId = this.seqId;
      const newItm: TraceLog = {
        seqId,
        action: name,
        params: [...i],
        result: undefined,
        error: undefined,
        isSuccess: false,
      };
      this.traces.push(newItm);

      logger("begin", seqId, name);

      let funcReturn: any;
      try {
        funcReturn = await f(...i);
        newItm.isSuccess = true;
        newItm.result = funcReturn;
      } catch (error) {
        newItm.error = error;
        newItm.isSuccess = false;
        throw error;
      }

      logger("end", seqId, { result: newItm.result, error: newItm.error });

      return funcReturn;
    };
  }
}
