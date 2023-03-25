process.env.DEBUG = "*";

import { promisify } from "util";
import debug from "debug";
import { RuntimeContext, Trace } from "../src";
import assert from "assert";
import { clone } from "../src/libs/utils";

const loggerFlow = debug("flow");

const waitMs = promisify(setTimeout);

async function loopCheckFlow(ctx: RuntimeContext) {
  let total = 0;
  const doLog = ctx.wrapAction("doLog", async (msg: string) => {
    loggerFlow("log", msg);
    return msg;
  });
  ctx.withSignal("onPayment", (x: number) => {
    loggerFlow("onPayment", x);
    total += x;
  });

  ctx.withQuery("getTotal", () => {
    return total;
  });

  loggerFlow("begin", total);

  let c = 0;
  while (total < 100) {
    c++;
    await ctx.sleep(`loop_${c}`, "1 second");
    if (c > 3) {
      await doLog(`log_loop_${c}`, `loop ${c} >=3. break`);
      break;
    } else {
      await doLog(`log_loop_${c}`, `loop ${c} < 3. continue`);
    }
  }

  loggerFlow("end", total);
}

async function main() {
  const logger = debug("main");

  logger("runAndContinue: true");
  const tracesTrue = await runAndContinue(true);

  logger("replayFinished: true");
  await replayFinished(true, tracesTrue);

  logger("runAndContinue: false");
  const tracesFalse = await runAndContinue(false);

  logger("replayFinished: false");
  await replayFinished(false, tracesFalse);

  logger("runNotFinish");
  const runningTraces = await runNotFinish();

  // TODO: why need to clone ?
  logger("replayAndContinue: false");
  await replayAndContinue(false, clone(runningTraces));

  logger("replayAndContinue: true");
  await replayAndContinue(true, clone(runningTraces));
}
main();

async function runAndContinue(resolve: boolean) {
  const ctx = new RuntimeContext();
  await ctx.runAsNew(loopCheckFlow);

  let callSignal = () => {
    ctx.callSignal("onPayment", 9999);
    shouldCallSignal = false;
  };
  let shouldCallSignal: boolean = false;
  if (resolve) {
    setTimeout(() => {
      shouldCallSignal = true;
    }, 1000);
  }

  while (!ctx.isEnd()) {
    console.log("wait and continue after 2 sec");
    await waitMs(1000);
    await ctx.continue();

    if (shouldCallSignal) {
      callSignal();
    }
  }

  console.dir(ctx.getTraces(), { depth: 10 });
  console.log("blocks: ", ctx.getBlocks());
  console.log("isEnd: ", ctx.isEnd());
  assert(ctx.isEnd(), "ctx.isEnd() should true");
  return ctx.getTraces();
}

async function replayFinished(resolve: boolean, traces: Trace[]) {
  const ctx = new RuntimeContext();
  await ctx.replay(traces, loopCheckFlow);

  assert(ctx.isEnd(), "ctx.isEnd() should true");
  if (resolve) {
    assert(ctx.callQuery("getTotal") === 9999, "total should equal 9999");
  } else {
    assert(ctx.callQuery("getTotal") === 0, "total should equal 0");
  }
}

async function runNotFinish() {
  const ctx = new RuntimeContext();
  await ctx.runAsNew(loopCheckFlow);

  await waitMs(1000);
  await ctx.continue();

  await waitMs(1000);
  await ctx.continue();

  console.dir(ctx.getTraces(), { depth: 10 });
  console.log("blocks: ", ctx.getBlocks());
  console.log("isEnd: ", ctx.isEnd());
  assert(ctx.isEnd() === false, "ctx.isEnd() should false");
  return ctx.getTraces();
}

async function replayAndContinue(resolve: boolean, traces: Trace[]) {
  const ctx = new RuntimeContext();
  await ctx.replay(traces, loopCheckFlow);

  assert(ctx.isEnd() === false, "ctx.isEnd() should false");
  if (resolve) {
    ctx.callSignal("onPayment", 9999);
  }

  while (!ctx.isEnd()) {
    console.log("wait and continue after 2 sec");
    await waitMs(1000);
    await ctx.continue();
  }

  assert(ctx.isEnd(), "ctx.isEnd() should true");
  if (resolve) {
    assert(ctx.callQuery("getTotal") === 9999, "total should equal 9999");
  } else {
    assert(ctx.callQuery("getTotal") === 0, "total should equal 0");
  }
}
