import { hrtime } from "process";
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
  children: TraceLog[];
  _t: string;
};

export type wrapActionOpts = {};

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
  private queryFuncs: Map<string, Function>;

  private runtimeForceReRun: boolean;
  private runtimeReplayFinishDeferred: Deferred;
  private runtimeResumeDeferred: Deferred;
  private runtimeFinishDeferred: Deferred;
  private asyncLocalStorage = new AsyncLocalStorage<TraceLog>();
  private asyncLocalStorageReplay = new AsyncLocalStorage<TraceLog[]>();

  constructor() {
    this.queryFuncs = new Map();
  }

  restore(traces: TraceLog[]) {
    this.traces = traces;
  }

  destroy() {
    this.queryFuncs.clear();
  }

  getTraces(): TraceLog[] {
    // sort by _t traces
    const doSort = (traces: TraceLog[]) => {
      // sort all item level 0
      const newItm = traces.sort((a, b) => a._t.localeCompare(b._t));

      // for each item -> recursive sort children
      for (const it of newItm) {
        it.children = doSort(it.children);
      }

      return newItm;
    };
    return doSort(this.traces);
  }

  private blockPromise() {
    // block hit === replay finish
    this?.runtimeReplayFinishDeferred.resolve();
    logger("promise blocked");
    return this.runtimeResumeDeferred.promise;
  }

  public async run(f: (ctx: RuntimeContext) => Promise<any>) {
    this.runtimeForceReRun = true;
    await this.replay(f);
    await this.resume();
  }

  public async replay(f: (ctx: RuntimeContext) => Promise<any>) {
    this.runtimeReplayFinishDeferred = new Deferred();
    this.runtimeResumeDeferred = new Deferred();
    this.runtimeFinishDeferred = new Deferred();

    const asyncRun = async () => {
      await this.asyncLocalStorageReplay.run(this.traces, async () => {
        logger("replay 1");
        await f(this);
        logger("replay 2");
        this.runtimeFinishDeferred.resolve();
        this.runtimeReplayFinishDeferred.resolve();
      });
    };

    asyncRun();
    await this.runtimeReplayFinishDeferred.promise;
  }

  public async resume() {
    this.runtimeResumeDeferred.resolve();
    await this.runtimeFinishDeferred.promise;
  }

  doQuery(name: string, args: any[]) {
    const f = this.queryFuncs.get(name);
    return f(...args);
  }

  registerQueryFunc(name: string, f: Function) {
    this.queryFuncs.set(name, f);
  }

  private now(): string {
    return hrtime.bigint().toString();
  }

  private replayPickTraceItem(name: string): TraceLog {
    const traceCtx =
      (this.asyncLocalStorageReplay.getStore() as TraceLog[]) ?? [];
    return traceCtx.find((itm) => itm.action === name);
  }

  wrapAction<A extends ReadonlyArray<unknown>, R>(
    name: string,
    f: (...params: A) => Promise<R>,
    opts: wrapActionOpts = { canFastForward: true }
  ) {
    return async (...i: A) => {
      const topItm = this.replayPickTraceItem(name);
      if (topItm) {
        this.seqId++;
        if (topItm.isSuccess) {
          if (topItm.children.length == 0) {
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
          return this.asyncLocalStorageReplay.run(
            topItm.children,
            async () => await f(...i)
          );
        } else {
          //TODO: what should we do ?
          // if replay only
          //  throw error
          // else
          //  nothing

          throw topItm.error;
        }
      }

      // finish replay
      if (!this.runtimeForceReRun) {
        logger(`block promise`);
        await this.blockPromise();
      }

      // continue to run
      this.seqId++;
      const seqId = this.seqId;
      const parentTraceItm = this.asyncLocalStorage.getStore() as TraceLog;
      const newItm: TraceLog = {
        seqId,
        action: name,
        params: [...i],
        result: undefined,
        error: undefined,
        isSuccess: false,
        parentSeqId: parentTraceItm?.seqId,
        children: [],
        _t: this.now(),
      };

      // link to parent ctx or global
      if (!parentTraceItm) this.traces.push(newItm);
      else parentTraceItm.children.push(newItm);

      const runCtx = `seqId:${newItm.seqId} parentSeqId:${newItm.parentSeqId}`;
      logger("begin", runCtx, name);

      let funcReturn: any;
      try {
        funcReturn = await this.asyncLocalStorage.run(newItm, async () => {
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
