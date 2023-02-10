import { AsyncLocalStorage } from "async_hooks";
import debug from "debug";
import Deferred from "./deferred";
const logger = debug("utils");

export type TraceLog = {
  seqId: number;
  action: string;
  params: any[];
  isSuccess: boolean;
  result: any;
  error: any;
  parentSeqId?: number;
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
  private queryFuncs: Map<string, Function>;

  private runtimeReplayDeferred: Deferred;
  private asyncLocalStorage = new AsyncLocalStorage();

  constructor(mode: ERuntimeMode) {
    this.mode = mode;
    this.queryFuncs = new Map();
  }

  restore(traces: TraceLog[]) {
    this.traces = traces;
  }

  destroy() {
    this.queryFuncs.clear();
  }

  getTraces() {
    return this.traces;
  }

  private blockPromise() {
    this?.runtimeReplayDeferred.resolve();
    logger("promise blocked");
    return new Promise(() => {});
  }

  public async run(f: (ctx: RuntimeContext) => Promise<any>) {
    if (this.mode !== ERuntimeMode.EREPLAY_AND_RUN)
      throw new Error(
        "only available with runtime mode ERuntimeMode.EREPLAY_AND_RUN"
      );

    await f(this);
  }

  public async replay(f: (ctx: RuntimeContext) => Promise<any>) {
    if (this.mode !== ERuntimeMode.EREPLAY_ONLY)
      throw new Error(
        "only available with runtime mode ERuntimeMode.EREPLAY_ONLY"
      );

    this.runtimeReplayDeferred = new Deferred();

    const asyncRun = async () => {
      await f(this);
      this.runtimeReplayDeferred.resolve();
    };

    asyncRun();
    return this.runtimeReplayDeferred.promise;
  }

  doQuery(name: string, args: any[]) {
    const f = this.queryFuncs.get(name);
    return f(...args);
  }

  registerQueryFunc(name: string, f: Function) {
    this.queryFuncs.set(name, f);
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
        parentSeqId: this.asyncLocalStorage.getStore() as number,
      };
      this.traces.push(newItm);

      const runCtx = `seqId:${newItm.seqId} parentSeqId:${newItm.parentSeqId}`;
      logger("begin", runCtx, name);

      let funcReturn: any;
      try {
        funcReturn = await this.asyncLocalStorage.run(this.seqId, async () => {
          return f(...i);
        });
        newItm.isSuccess = true;
        newItm.result = funcReturn;
      } catch (error) {
        newItm.error = error;
        newItm.isSuccess = false;
        throw error;
      }

      logger("end", runCtx, { result: newItm.result, error: newItm.error });

      return funcReturn;
    };
  }
}
