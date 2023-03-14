process.env.DEBUG = "*";

import { promisify } from "util";
import debug from "debug";
import { RuntimeContext } from "../src";
import assert from "assert";

const loggerFlow = debug("flow");

const waitMs = promisify(setTimeout);

async function conditionFlow(ctx: RuntimeContext) {
  let total = 0;
  const doLog = ctx.wrapAction("doLog", async (msg: string) => {
    loggerFlow("log", msg);
    return msg;
  });
  const doInc = ctx.wrapAction("doInc", async (x: number) => {
    total += x;
    await doLog("log_after_inc", `before ${total - x} after ${total}`);
    return total;
  });

  ctx.withSignal("onPayment", (x: number) => {
    loggerFlow("onPayment", x);
    total += x;
  });

  loggerFlow("begin", total);

  if (await ctx.condition("cond_check_bonus", () => total > 50, "2 seconds")) {
    loggerFlow("😀. total now > 50. Give X2 bonus", total);
    await doInc("bonus", total);
  } else {
    loggerFlow("😭.");
  }

  loggerFlow("end", total);
}

async function main() {
  const logger = debug("main");
  logger("runAndContinue. condition:true");
  await runAndContinue(true);
  logger("runAndContinue. condition:false");
  await runAndContinue(false);

  // logger("runReplayAndContinue");
  // await runReplayAndContinue();

  // logger("runEndAndReplay");
  // await runEndAndReplay();
}
main();

async function runAndContinue(resolve: boolean) {
  const ctx = new RuntimeContext();
  await ctx.runAsNew(conditionFlow);
  console.dir(ctx.getTraces(), { depth: 10 });
  console.log("blocks: ", ctx.getBlocks());
  assert(ctx.isEnd() === false, "ctx.isEnd() should false");

  if (resolve) {
    ctx.callSignal("onPayment", 101);

    await ctx.continue();
  }

  while (!ctx.isEnd()) {
    console.log("wait and continue after 2 sec");
    await waitMs(2000);
    await ctx.continue();
  }

  console.dir(ctx.getTraces(), { depth: 10 });
  console.log("blocks: ", ctx.getBlocks());
  console.log("isEnd: ", ctx.isEnd());

  assert(ctx.isEnd(), "ctx.isEnd() should true");
}

async function runReplayAndContinue() {
  let ctx = new RuntimeContext();
  await ctx.runAsNew(conditionFlow);
  console.log("isEnd: ", ctx.isEnd());
  console.log("blocks: ", ctx.getBlocks());
  console.log("replay... ");

  await ctx.replay(ctx.getTraces(), conditionFlow);
  console.log("isEnd: ", ctx.isEnd());
  console.log("blocks: ", ctx.getBlocks());
  assert(ctx.isEnd() === false, "ctx.isEnd() should false");

  while (!ctx.isEnd()) {
    console.log("wait and continue after 2 sec");
    await waitMs(2000);
    await ctx.continue();
  }

  console.dir(ctx.getTraces(), { depth: 10 });
  console.log("blocks: ", ctx.getBlocks());
  console.log("isEnd: ", ctx.isEnd());

  assert(ctx.isEnd(), "ctx.isEnd() should true");
}

async function runEndAndReplay() {
  const ctx = new RuntimeContext();
  await ctx.runAsNew(conditionFlow);
  console.log("blocks: ", ctx.getBlocks());

  while (!ctx.isEnd()) {
    console.log("wait and continue after 2 sec");
    await waitMs(2000);
    await ctx.continue();
  }

  console.dir(ctx.getTraces(), { depth: 10 });
  console.log("blocks: ", ctx.getBlocks());
  console.log("isEnd: ", ctx.isEnd());

  assert(ctx.isEnd(), "ctx.isEnd() should true");

  console.log("replay... ");

  await ctx.replay(ctx.getTraces(), conditionFlow);

  console.log("blocks: ", ctx.getBlocks());
  console.log("isEnd: ", ctx.isEnd());

  assert(ctx.isEnd(), "ctx.isEnd() should true");
}
