import { promisify } from "util";
import { AsyncLocalStorage } from "async_hooks";
import debug from "debug";
import humanInterval from "human-interval";
import Deferred from "./deferred";
import { clone } from "./utils";

const loggerError = debug("node-durable:error");
const loggerVerbose = debug("node-durable:verbose");
const waitMs = promisify(setTimeout);

type Ins = Trace & {
  nextIns?: Ins;
};
type InsCall = Ins & TraceCall;
type InsSleep = Ins & TraceSleep;
type InsCondition = Ins & TraceCondition;
type InsSignal = Ins & TraceSignalCall;

type AllOps = "call" | "sleep" | "condition" | "end" | "start" | "signal";

export type Trace = {
  opt: AllOps;
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
  deadlineAt: number;
  isFinish: boolean;
  response?: boolean;
};
export type TraceSignalCall = Trace & {
  opt: "signal";
  arguments: any;
  isSuccess: boolean;
  response?: any;
  error?: any;
};
export type TraceEnd = Trace & {
  opt: "end";
};
export type TraceStart = Trace & {
  opt: "start";
};
export type wrapActionOpts = {};

enum EBlockType {
  sleep,
  cond,
}
interface IBlock {
  getType(): EBlockType;
  wait(): Promise<any>;
  cancel();
  resume();
  canContinue(): boolean;
  canFastForwardInReplay(): boolean;
}

const INT_SYM = Symbol("INT_SYM");

class BlockSleep implements IBlock {
  private _def: Deferred = new Deferred();

  constructor(public itm: TraceSleep, public activeAfter: Date) {}

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

  canFastForwardInReplay() {
    const sleepIns = this.itm as InsSleep;

    // i am the last one -> can't fast forward
    if (!sleepIns?.nextIns) return false;

    // If next ins === signal -> should stop fastForward
    //  Replay function will simulate a signal call -> continue replay
    const hasSignalNext = sleepIns?.nextIns?.opt === "signal";
    if (hasSignalNext) return false;

    return this.canContinue();
  }
}

class BlockCondition implements IBlock {
  private _def: Deferred = new Deferred();
  isDeadlinePased: boolean;
  isConditionPassed: boolean;

  constructor(
    public itm: InsCondition,
    public deadlineAt: Date,
    private checkFunc: () => boolean
  ) {}

  getType() {
    return EBlockType.cond;
  }

  canContinue() {
    this.isDeadlinePased = Date.now() > this.deadlineAt.valueOf();
    this.isConditionPassed = this.checkFunc();

    return this.isDeadlinePased || this.isConditionPassed;
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

  canFastForwardInReplay() {
    return false;
  }
}

type RuntimeContextMode = "replay" | "run";

export class RuntimeContext {
  private traces: Trace[] = [];
  private instructions: Ins[] = [];
  private program: Promise<any>;
  private asyncLocalStorage = new AsyncLocalStorage();
  private isProgramEnd: boolean;

  // For check replay done
  private insIndex = new Map<Ins, boolean>();
  private replaySignals: InsSignal[] = [];

  // Block
  private blocks: IBlock[] = [];
  private runDefered: Deferred;

  // Signal
  private signals: Map<string, Function> = new Map();
  private queries: Map<string, Function> = new Map();

  private _mode: RuntimeContextMode;
  private get mode(): RuntimeContextMode {
    return this._mode;
  }
  private set mode(v: RuntimeContextMode) {
    loggerVerbose(`mode: ${v}`);
    this._mode = v;
  }

  async runAsNew(f: (ctx: RuntimeContext) => Promise<any>) {
    this.mode = "run";
    this.instructions = [];
    this.replaySignals = [];
    this.traces = [];
    this.signals.clear();
    this.queries.clear();
    this._cleanupBlocks();

    this.runDefered = new Deferred();
    this._loadProgram(f);

    await Promise.race([this.program, this.runDefered.promise]);
  }

  destroy() {
    this.signals.clear();
    this.queries.clear();
    this._cleanupBlocks();
  }

  async replay(traces: Trace[], f: (ctx: RuntimeContext) => Promise<any>) {
    // Replay need
    // 1. replay
    // 2. simulate signal
    // 3. continue replay

    try {
      this.mode = "replay";
      this.traces = traces;
      this.replaySignals = [];
      this.signals.clear();
      this.queries.clear();
      this._cleanupBlocks();
      this._loadInstructions(traces);

      this.runDefered = new Deferred();
      this._loadProgram(f);

      loggerVerbose("replay start");

      await Promise.race([this.program, this.runDefered.promise]);

      loggerVerbose("replay end");

      if (this.isEnd()) return;

      loggerVerbose("replay simulate signal start");

      await this._replaySimulateSignal();

      loggerVerbose(`replay simulate signal end. ${this.replaySignals.length}`);
    } finally {
      this.mode = "run";
    }
  }

  private async _replaySimulateSignal() {
    if (this.replaySignals.length === 0) return;
    // check signal and continue
    let signalItm = this.replaySignals.shift();

    // TODO
    // Need define dependecy and order between call + replay action
    //  Code below only try to pop and simulate one by one. Which is not 100% correct

    while (signalItm) {
      loggerVerbose(
        `replay: simulate signal ${signalItm.callBy}. replaySignals length ${this.replaySignals.length}`
      );
      this.replaySignalCall(signalItm);
      await this.continue("replay");
      signalItm = this.replaySignals.shift();
    }
  }

  async continue(mode: RuntimeContextMode = "run"): Promise<boolean> {
    if (this.blocks.length === 0) return false;
    const runable = [];
    const nextBlock = [];
    for (const it of this.blocks) {
      if (it.canContinue()) runable.push(it);
      else nextBlock.push(it);
    }

    this.mode = mode;
    this.runDefered = new Deferred();
    this.blocks = nextBlock;

    if (runable.length === 0) return false;

    for (const it of runable) {
      it.resume();
    }

    await Promise.race([this.program, this.runDefered.promise]);
    return true;
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

  //-------------------------------------------------------------------
  //  System action
  //-------------------------------------------------------------------

  async condition(
    callId: string,
    checkFn: () => boolean,
    waitFor: number | string
  ): Promise<boolean> {
    if (this.mode === "run") {
      return this.conditionForRun(callId, checkFn, waitFor);
    } else {
      return this.conditionForReplay(callId, checkFn, waitFor);
    }
  }

  private async conditionForRun(
    callId: string,
    checkFn: () => boolean,
    maxWait: number | string
  ): Promise<boolean> {
    let duration: number;
    if (typeof maxWait === "string") {
      duration = humanInterval(maxWait);
    } else {
      duration = maxWait;
    }
    const deadlineAt = Date.now() + duration;

    const traceItem: TraceCondition = {
      opt: "condition",
      callBy: callId,
      child: [],
      isFinish: false,
      deadlineAt,
    };
    this._appendTrace(traceItem, callId);

    const block = new BlockCondition(traceItem, new Date(deadlineAt), checkFn);
    this._addBlock(block);

    await block.wait();

    traceItem.isFinish = true;
    traceItem.response = block.isConditionPassed;

    return block.isConditionPassed;
  }

  private async conditionForReplay(
    callId: string,
    checkFn: () => boolean,
    maxWait: number | string
  ): Promise<boolean> {
    const insItem = this._consumeIns(callId, "condition") as InsCondition;
    const block = new BlockCondition(
      insItem,
      new Date(insItem.deadlineAt),
      checkFn
    );

    this._addBlock(block);

    await block.wait();

    // replay for finished condition
    if (insItem.isFinish) {
      return !!insItem.response;
    }

    // resume -> finished condition
    insItem.isFinish = true;
    insItem.response = block.isConditionPassed;
    return block.isConditionPassed;
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

    const block = new BlockSleep(traceItem, new Date(wakeUpAt));
    this._addBlock(block);
    await block.wait();
  }

  async sleepActionForReplay(callId: string, x: number | string) {
    const insItem = this._consumeIns(callId, "sleep") as InsSleep;
    const block = new BlockSleep(insItem, new Date(insItem.wakeUpAt));

    this._addBlock(block);

    await block.wait();
  }

  //-------------------------------------------------------------------
  //  User base signal
  //    signal state change
  //    query read data. no state change
  //-------------------------------------------------------------------

  withQuery<A extends ReadonlyArray<unknown>, R>(
    name: string,
    f: (...params: A) => R
  ) {
    this.queries.set(name, f);
  }

  callQuery(name: string, ...i: any): any {
    return this.queries.get(name)(...i);
  }

  withSignal<A extends ReadonlyArray<unknown>, R>(
    name: string,
    f: (...params: A) => R
  ) {
    this.signals.set(name, f);
  }

  callSignal(name: string, ...i: any) {
    if (this.mode !== "run") throw new Error("callSignal. Run mode restricted");

    const traceItem: TraceSignalCall = {
      opt: "signal",
      child: [],
      callBy: name,
      arguments: [...i],
      isSuccess: true,
    };
    this._appendTrace(traceItem, name);
    try {
      let res = this.signals.get(name)(...i);
      traceItem.response = res;
      return res;
    } catch (error) {
      traceItem.error = error?.message;
      traceItem.isSuccess = false;
      throw error;
    }
  }

  private replaySignalCall(traceItm: TraceSignalCall) {
    if (this.mode !== "replay")
      throw new Error("callSignal. replay mode restricted");
    const f = this.signals.get(traceItm.callBy);
    f(...traceItm.arguments);
  }

  //-------------------------------------------------------------------
  //  User base action
  //-------------------------------------------------------------------

  wrapAction<A extends ReadonlyArray<unknown>, R>(
    name: string,
    f: (...params: A) => Promise<R>,
    opts: wrapActionOpts = {}
  ) {
    return async (callId: string, ...i: A): Promise<R> => {
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
        const res = this.asyncLocalStorage.run(insItem, () => f(...i));
        return insItem.response as R;
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
    expectedOp: AllOps
  ): InsCall | InsSleep | InsCondition {
    const parent = this.asyncLocalStorage.getStore() as Ins;
    let ins: Ins;
    if (parent) {
      const nestedCallId = `${parent.callBy}>${callId}`;
      ins = parent.child.find((itm) => itm.callBy === nestedCallId);
    } else {
      ins = this.instructions.find((itm) => itm.callBy === callId);
    }
    if (!ins)
      throw new Error(
        `Fatal error. Instruction missmatch. ${callId} and expected ${expectedOp}`
      );

    this.insIndex.delete(ins);

    switch (expectedOp) {
      case "call":
        return ins as InsCall;
      case "sleep":
        return ins as InsSleep;
      case "condition":
        return ins as InsCondition;

      default:
        throw new Error("Fatal error. unknown type");
    }
  }

  private _loadProgram(f: (ctx: RuntimeContext) => Promise<any>) {
    this.isProgramEnd = false;

    const doExec = async () => {
      try {
        if (this.mode === "run") {
          const startTrace: TraceStart = {
            opt: "start",
            callBy: "",
            child: [],
          };
          this._appendTrace(startTrace, "");
        }

        await f(this);

        if (this.mode === "run") {
          const endTrace: TraceEnd = {
            opt: "end",
            callBy: "",
            child: [],
          };
          this._appendTrace(endTrace, "");
        }

        this.isProgramEnd = true;
        this._cleanupBlocks();
      } catch (error) {
        if (error === INT_SYM) return;
        loggerError(error);
        throw error;
      }
    };

    this.program = doExec();
  }

  private _loadInstructions(traces: Trace[]) {
    this.insIndex.clear();

    const doIndex = (ins: Ins, index: number, parents: Ins[]) => {
      if (ins.opt === "signal") this.replaySignals.push(ins as InsSignal);
      this.insIndex.set(ins, true);
      ins.nextIns = parents[index + 1];
      for (let i = 0; i < ins.child.length; i++) {
        const it = ins.child[i];
        doIndex(it, i, it.child);
      }
    };

    this.instructions = traces;

    for (let i = 0; i < this.instructions.length; i++) {
      const it = this.instructions[i];
      doIndex(it, i, this.instructions);
    }
  }

  private _addBlock(block: IBlock) {
    this.blocks.push(block);

    // replay finished program -> no need to block
    if (this.mode === "replay" && block.canFastForwardInReplay()) {
      block.resume();
      return;
    }
    this.runDefered.resolve();
  }

  private _cleanupBlocks() {
    for (const it of this.blocks) {
      it.cancel();
    }
    this.blocks = [];
  }
}
