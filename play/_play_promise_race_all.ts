process.env.DEBUG = "*";

import { promisify } from "util";
import debug from "debug";
import { RuntimeContext } from "../src";

const loggerFlow = debug("flow");

const waitMs = promisify(setTimeout);

async function promiseFlow(ctx: RuntimeContext) {
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

  const res1 = await Promise.all([
    doInc("p1", 10),
    ctx.sleep("s1", "2 seconds"),
  ]);

  loggerFlow("res1", res1);

  const res2 = await Promise.race([
    doInc("p2", 50),
    ctx.sleep("s2", "2 seconds"),
  ]);

  loggerFlow("res2", res2);

  loggerFlow("end", total);
}

async function main() {
  const logger = debug("main");
  // logger("runAndContinue");
  // await runAndContinue();

  logger("runReplayAndContinue");
  await runReplayAndContinue();
}
main();

async function runAndContinue() {
  const ctx = new RuntimeContext();
  await ctx.runAsNew(promiseFlow);
  console.dir(ctx.getTraces(), { depth: 10 });
  console.log("blocks: ", ctx.getBlocks());

  while (!ctx.isEnd()) {
    console.log("wait and continue after 2 sec");
    await waitMs(2000);
    await ctx.continue();
  }

  console.dir(ctx.getTraces(), { depth: 10 });
  console.log("blocks: ", ctx.getBlocks());
  console.log("isEnd: ", ctx.isEnd());
}

async function runReplayAndContinue() {
  let ctx = new RuntimeContext();
  await ctx.runAsNew(promiseFlow);
  console.log("isEnd: ", ctx.isEnd());
  console.log("blocks: ", ctx.getBlocks());
  console.log("replay... ");

  await ctx.replay(ctx.getTraces(), promiseFlow);
  console.log("isEnd: ", ctx.isEnd());
  console.log("blocks: ", ctx.getBlocks());

  while (!ctx.isEnd()) {
    console.log("wait and continue after 2 sec");
    await waitMs(2000);
    await ctx.continue();
  }

  console.dir(ctx.getTraces(), { depth: 10 });
  console.log("blocks: ", ctx.getBlocks());
  console.log("isEnd: ", ctx.isEnd());
}
