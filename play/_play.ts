process.env.DEBUG = "*";

import { promisify } from "util";
import debug from "debug";
import { RuntimeContext } from "../src";
import assert from "assert";

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

  logger("runAndDestroy");
  await runAndDestroy();

  logger("runEndAndReplay");
  await runEndAndReplay();
}
main();

async function runAndDestroy() {
  const ctx = new RuntimeContext();
  await ctx.runAsNew(simpleFlow);
  console.dir(ctx.getTraces(), { depth: 10 });
  console.log("blocks: ", ctx.getBlocks());

  ctx.destroy();
  assert(ctx.getBlocks().length === 0, "blocks empty");
}

async function runAndContinue() {
  const ctx = new RuntimeContext();
  await ctx.runAsNew(simpleFlow);
  console.dir(ctx.getTraces(), { depth: 10 });
  console.log("blocks: ", ctx.getBlocks());

  assert(ctx.isEnd() === false, "ctx.isEnd() should false");
  console.log("resume after 2 seconds");

  await waitMs(2000);
  await ctx.continue();

  console.dir(ctx.getTraces(), { depth: 10 });
  console.log("blocks: ", ctx.getBlocks());
  console.log("isEnd: ", ctx.isEnd());
  assert(ctx.isEnd(), "ctx.isEnd() should true");
}

async function runReplayAndContinue() {
  const ctx = new RuntimeContext();
  await ctx.runAsNew(simpleFlow);

  // // Replay
  await ctx.replay(ctx.getTraces(), simpleFlow);
  console.log("isReplayDone:", ctx.isReplayDone());
  console.log("blocks: ", ctx.getBlocks());
  console.log("isEnd: ", ctx.isEnd());
  assert(ctx.isEnd() === false, "ctx.isEnd() should false");

  console.log("resume after 2 seconds");

  await waitMs(2000);
  await ctx.continue();

  console.dir(ctx.getTraces(), { depth: 10 });
  console.log("blocks: ", ctx.getBlocks());
  console.log("isEnd: ", ctx.isEnd());
  assert(ctx.isEnd(), "ctx.isEnd() should true");
}

async function runWaitAndReplay() {
  const ctx = new RuntimeContext();
  await ctx.runAsNew(simpleFlow);
  console.dir(ctx.getTraces(), { depth: 10 });

  console.log("replay after 2 seconds");
  await waitMs(2000);

  // Replay
  await ctx.replay(ctx.getTraces(), simpleFlow);
  console.log("blocks: ", ctx.getBlocks());
  console.log("isReplayDone:", ctx.isReplayDone());
  assert(ctx.isEnd() === false, "ctx.isEnd() should false");

  await ctx.continue();

  console.dir(ctx.getTraces(), { depth: 10 });
  console.log("blocks: ", ctx.getBlocks());
  console.log("isEnd: ", ctx.isEnd());
  assert(ctx.isEnd(), "ctx.isEnd() should true");
}

async function runEndAndReplay() {
  const ctx = new RuntimeContext();
  await ctx.runAsNew(simpleFlow);
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

  await ctx.replay(ctx.getTraces(), simpleFlow);

  console.log("blocks: ", ctx.getBlocks());
  console.log("isEnd: ", ctx.isEnd());
  assert(ctx.isEnd(), "ctx.isEnd() should true");
}
