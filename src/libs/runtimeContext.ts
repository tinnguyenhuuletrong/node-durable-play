import { promisify } from "util";
import { AsyncLocalStorage } from "async_hooks";
import debug from "debug";
import humanInterval from "human-interval";
import Deferred from "./deferred";
import { clone } from "./utils";
import assert from "assert";

const logger = debug("utils");
const waitMs = promisify(setTimeout);

type Ins = Trace & {
  visited?: boolean;
};
type InsCall = Ins & TraceCall;

export type Trace = {
  opt: "call" | "sleep" | "condition";
  callBy: string;
  child: Trace[];
};
export type TraceCall = Trace & {
  opt: "call";
  funcName: string;
  isSuccess: boolean;
  response?: any;
  error?: any;
};
export type TraceSleep = Trace & {
  opt: "sleep";
  wakeUpAt: Date;
};
export type TraceCondition = Trace & {
  opt: "condition";
  timeOutAt: Date;
};
export type wrapActionOpts = {};

const SYM_RECORD_INT = Symbol("SYM_RECORD_INT");

class ErrInterupt extends Error {
  constructor(msg: string, public traceItem: Trace) {
    super(msg);
  }
}

export class RuntimeContext {
  private traces: Trace[] = [];
  private instructions: Ins[] = [];
  private asyncLocalStorage = new AsyncLocalStorage();
  private mode: "replay" | "run";

  constructor() {}

  async runAsNew(f: (ctx: RuntimeContext) => Promise<any>) {
    this.mode = "run";
    this.traces = [];
    await Promise.race([await f(this)]);
  }

  async replay(traces: Trace[], f: (ctx: RuntimeContext) => Promise<any>) {
    this.mode = "replay";
    this.instructions = clone(traces);
    await Promise.race([await f(this)]);
  }

  getTraces() {
    return this.traces;
  }
  getInstructions() {
    return this.instructions;
  }

  async sleep(callId: string, x: number | string) {
    if (this.mode === "run") {
      return this.sleepActionForRun(callId, x);
    } else {
      return this.sleepActionForReplay(callId, x);
    }
  }

  async sleepActionForRun(callId: string, x: number | string) {
    let duration: number;
    if (typeof x === "string") {
      duration = humanInterval(x);
    } else {
      duration = x;
    }
    const wakeUpAt = new Date(Date.now() + duration);
    const traceItem: TraceSleep = {
      opt: "sleep",
      callBy: "",
      child: [],
      wakeUpAt,
    };
    this._appendTrace(traceItem, callId);

    // TODO: marked as finish or Sleep DeferedAction
    // await waitMs();
  }
  async sleepActionForReplay(callId: string, x: number | string) {}

  wrapAction<A extends ReadonlyArray<unknown>, R>(
    name: string,
    f: (...params: A) => Promise<R>,
    opts: wrapActionOpts = {}
  ) {
    if (this.mode === "run") return this.wrapActionForRun(name, f);
    else return this.wrapActionForReplay(name, f);
  }

  private wrapActionForReplay<A extends ReadonlyArray<unknown>, R>(
    name: string,
    f: (...params: A) => Promise<R>
  ) {
    return async (callId: string, ...i: A) => {
      const insItem: InsCall = this._consumeIns(callId, "call");

      if (insItem.isSuccess) {
        if (insItem.child.length > 0) {
          const prevCtx = this.asyncLocalStorage.getStore();
          this.asyncLocalStorage.enterWith(insItem);
          const r = f(...i);
          this.asyncLocalStorage.enterWith(prevCtx);
          return r;
        } else {
          return insItem.response;
        }
      } else {
        //TODO: Spawn Retry DeferedAction
      }
    };
  }

  private wrapActionForRun<A extends ReadonlyArray<unknown>, R>(
    name: string,
    f: (...params: A) => Promise<R>
  ) {
    return async (callId: string, ...i: A) => {
      const traceItem: TraceCall = {
        opt: "call",
        child: [],
        funcName: name,
        callBy: callId,
        isSuccess: true,
      };
      this._appendTrace(traceItem, callId);

      return await this.asyncLocalStorage.run(traceItem, async () => {
        let res: R;
        try {
          res = await f(...i);
          traceItem.isSuccess = true;
          traceItem.response = res;
        } catch (error) {
          traceItem.isSuccess = false;
        }
        return res;
      });
    };
  }

  private _appendTrace(traceItem: Trace, callId: string) {
    const parent = this.asyncLocalStorage.getStore() as Trace;
    if (parent) {
      traceItem.callBy = `${parent.callBy}>${callId}`;
      parent.child.push(traceItem);
    } else {
      this.traces.push(traceItem);
    }
  }

  private _consumeIns(callId: string, expectedOp: "call"): InsCall {
    const parent = this.asyncLocalStorage.getStore() as Ins;
    let ins: Ins;
    if (parent) {
      const nestedCallId = `${parent.callBy}>${callId}`;
      ins = parent.child.find((itm) => itm.callBy === nestedCallId);
    } else {
      ins = this.instructions.find((itm) => itm.callBy === callId);
    }
    if (!ins) throw new Error("Fatal error. Instruction missmatch.");

    ins.visited = true;
    switch (expectedOp) {
      case "call":
        return ins as Ins & TraceCall;

      default:
        throw new Error("Fatal error. unknown type");
    }
  }
}
