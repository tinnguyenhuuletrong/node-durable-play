process.env.DEBUG = "*";

import { promisify } from "util";
import debug from "debug";
import { RuntimeContext } from "../src";

const loggerFlow = debug("flow");

const waitMs = promisify(setTimeout);

async function simpleFlow(ctx: RuntimeContext) {
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

  loggerFlow("begin", total);

  await doInc("p1", 10);
  await ctx.sleep("s1", "2 seconds");
  await doInc("p2", 50);

  loggerFlow("end", total);
}

async function main() {
  const logger = debug("main");
  logger("runAndContinue");
  await runAndContinue();

  logger("runReplayAndContinue");
  await runReplayAndContinue();

  logger("runWaitAndReplay");
  await runWaitAndReplay();
}
main();

async function runAndContinue() {
  const ctx = new RuntimeContext();
  await ctx.runAsNew(simpleFlow);
  console.dir(ctx.getTraces(), { depth: 10 });
  console.log("blocks: ", ctx.getBlocks());

  console.log("resume after 2 seconds");

  await waitMs(2000);
  await ctx.continue();

  console.dir(ctx.getTraces(), { depth: 10 });
  console.log("blocks: ", ctx.getBlocks());
  console.log("isEnd: ", ctx.isEnd());
}

async function runReplayAndContinue() {
  const ctx = new RuntimeContext();
  await ctx.runAsNew(simpleFlow);

  // // Replay
  await ctx.replay(ctx.getTraces(), simpleFlow);
  console.log("isReplayDone:", ctx.isReplayDone());
  console.log("blocks: ", ctx.getBlocks());
  console.log("isEnd: ", ctx.isEnd());

  console.log("resume after 2 seconds");

  await waitMs(2000);
  await ctx.continue();

  console.dir(ctx.getTraces(), { depth: 10 });
  console.log("blocks: ", ctx.getBlocks());
  console.log("isEnd: ", ctx.isEnd());
}

async function runWaitAndReplay() {
  const ctx = new RuntimeContext();
  await ctx.runAsNew(simpleFlow);
  console.dir(ctx.getTraces(), { depth: 10 });

  console.log("replay after 2 seconds");
  await waitMs(2000);

  // // Replay
  await ctx.replay(ctx.getTraces(), simpleFlow);
  console.log("blocks: ", ctx.getBlocks());
  console.log("isReplayDone:", ctx.isReplayDone());

  await ctx.continue();

  console.dir(ctx.getTraces(), { depth: 10 });
  console.log("blocks: ", ctx.getBlocks());
  console.log("isEnd: ", ctx.isEnd());
}
