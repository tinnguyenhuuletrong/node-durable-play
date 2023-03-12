import { promisify } from "util";
import { AsyncLocalStorage } from "async_hooks";
import debug from "debug";
import humanInterval from "human-interval";
import Deferred from "./deferred";
import { clone } from "./utils";
import { nextTick } from "process";

const logger = debug("utils");
const waitMs = promisify(setTimeout);

type Ins = Trace & {
  visited?: boolean;
};
type InsCall = Ins & TraceCall;
type InsSleep = Ins & TraceSleep;

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
  wakeUpAt: number;
};
export type TraceCondition = Trace & {
  opt: "condition";
  timeOutAt: number;
};
export type wrapActionOpts = {};

enum EBlockType {
  sleep,
}
interface IBlock {
  getType(): EBlockType;
  wait(): Promise<any>;
  cancel();
  resume();
  canContinue(): boolean;
}

const INT_SYM = Symbol("INT_SYM");

class BlockSleep implements IBlock {
  private _def: Deferred = new Deferred();

  constructor(public itm: Trace, public activeAfter: Date) {}

  getType() {
    return EBlockType.sleep;
  }

  canContinue() {
    return Date.now() > this.activeAfter.valueOf();
  }

  async wait() {
    await this._def.promise;
  }

  cancel() {
    this._def.reject(INT_SYM);
  }

  resume() {
    this._def.resolve();
  }
}

export class RuntimeContext {
  private traces: Trace[] = [];
  private instructions: Ins[] = [];
  private program: Promise<any>;
  private asyncLocalStorage = new AsyncLocalStorage();
  private mode: "replay" | "run";
  private isProgramEnd: boolean;

  // For check replay done
  private insIndex = new Map<Ins, boolean>();
  private replayDefered: Deferred;

  // Block
  private blocks: IBlock[] = [];
  private runDefered: Deferred;

  async runAsNew(f: (ctx: RuntimeContext) => Promise<any>) {
    this.mode = "run";
    this.instructions = [];
    this.traces = [];
    this._cleanupBlocks();

    this.runDefered = new Deferred();
    this._loadProgram(f);

    await Promise.race([this.program, this.runDefered.promise]);
  }

  destroy() {
    this._cleanupBlocks();
  }

  async replay(traces: Trace[], f: (ctx: RuntimeContext) => Promise<any>) {
    this.mode = "replay";
    this.traces = traces;
    this._cleanupBlocks();
    this._loadInstructions(traces);

    this.replayDefered = new Deferred();
    this._loadProgram(f);

    await Promise.race([this.program, this.replayDefered.promise]);
  }

  async continue() {
    if (this.blocks.length === 0) return;
    const runable = this.blocks.filter((itm) => itm.canContinue());

    this.mode = "run";
    this.runDefered = new Deferred();
    this.blocks = this.blocks.filter((itm) => !itm.canContinue());

    for (const it of runable) {
      it.resume();
    }

    await Promise.race([this.program, this.runDefered.promise]);
  }

  getTraces() {
    return this.traces;
  }
  getBlocks() {
    return this.blocks;
  }
  isEnd() {
    return this.isProgramEnd;
  }
  isReplayDone() {
    return this.insIndex.size === 0;
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
    const wakeUpAt = Date.now() + duration;
    const traceItem: TraceSleep = {
      opt: "sleep",
      callBy: callId,
      child: [],
      wakeUpAt,
    };
    this._appendTrace(traceItem, callId);

    // TODO: marked as finish or Sleep DeferedAction
    const block = new BlockSleep(traceItem, new Date(wakeUpAt));
    this._addBlock(block);
    await block.wait();
  }

  async sleepActionForReplay(callId: string, x: number | string) {
    const insItem = this._consumeIns(callId, "sleep") as InsSleep;
    const block = new BlockSleep(insItem, new Date(insItem.wakeUpAt));

    // auto resolve
    this._addBlock(block);

    await block.wait();
  }

  wrapAction<A extends ReadonlyArray<unknown>, R>(
    name: string,
    f: (...params: A) => Promise<R>,
    opts: wrapActionOpts = {}
  ) {
    return async (callId: string, ...i: A) => {
      if (this.mode === "run")
        return this.wrapActionForRun(name, f, callId, ...i);
      else return this.wrapActionForReplay(name, f, callId, ...i);
    };
  }

  private async wrapActionForReplay<A extends ReadonlyArray<unknown>, R>(
    name: string,
    f: (...params: A) => Promise<R>,
    callId: string,
    ...i: A
  ) {
    const insItem = this._consumeIns(callId, "call") as InsCall;

    if (insItem.isSuccess) {
      if (insItem.child.length > 0) {
        const prevCtx = this.asyncLocalStorage.getStore();
        this.asyncLocalStorage.enterWith(insItem);
        const r = f(...i);
        this.asyncLocalStorage.enterWith(prevCtx);
        return r;
      } else {
        return insItem.response as R;
      }
    } else {
      //TODO: Spawn Retry DeferedAction
    }
  }

  private async wrapActionForRun<A extends ReadonlyArray<unknown>, R>(
    name: string,
    f: (...params: A) => Promise<R>,
    callId: string,
    ...i: A
  ) {
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

  private _consumeIns(
    callId: string,
    expectedOp: "call" | "sleep"
  ): InsCall | InsSleep {
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
    this.insIndex.delete(ins);
    this._checkReplayDone();

    switch (expectedOp) {
      case "call":
        return ins as InsCall;
      case "sleep":
        return ins as InsSleep;

      default:
        throw new Error("Fatal error. unknown type");
    }
  }

  private _loadProgram(f: (ctx: RuntimeContext) => Promise<any>) {
    this.isProgramEnd = false;

    const doExec = async () => {
      try {
        await f(this);
      } catch (error) {
        if (error === INT_SYM) return;
        logger(error);
        throw error;
      } finally {
        this.isProgramEnd = true;
      }
    };

    this.program = doExec();
  }

  private _loadInstructions(traces: Trace[]) {
    this.insIndex.clear();
    const doIndex = (ins: Ins) => {
      this.insIndex.set(ins, true);
      for (const it of ins.child) {
        doIndex(it);
      }
    };

    this.instructions = clone(traces);

    for (const it of this.instructions) {
      doIndex(it);
    }
  }

  private _checkReplayDone() {
    if (this.isReplayDone()) {
      nextTick(() => {
        this.replayDefered.resolve();
      });
    }
  }

  private _addBlock(block: IBlock) {
    this.blocks.push(block);

    nextTick(() => {
      this.runDefered.resolve();
    });
  }

  private _cleanupBlocks() {
    for (const it of this.blocks) {
      it.cancel();
    }
    this.blocks = [];
  }
}
