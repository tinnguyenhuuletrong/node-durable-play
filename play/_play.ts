process.env.DEBUG = "*";

import { promisify } from "util";
import debug from "debug";
import { ERuntimeMode, RuntimeContext, TraceLog } from "../src";
const logger = debug("main");

const waitMs = promisify(setTimeout);

async function processParallelSuccess(ctx: RuntimeContext) {
  let count = 0;
  const waitMsAction = ctx.wrapAction("waitMs", waitMs);
  const doJobA = ctx.wrapAction(
    "doJobA",
    async () => {
      await waitMsAction(2000);
      count += 3;
      logger("doJobA. inc by", 3);
      return count;
    },
    { canFastForward: false }
  );
  const doJobB = ctx.wrapAction(
    "doJobB",
    async () => {
      await waitMsAction(3000);
      count += 5;
      logger("doJobB. inc by", 5);
      return count;
    },
    { canFastForward: false }
  );
  const doJobC = ctx.wrapAction(
    "doJobC",
    async () => {
      await waitMsAction(100);
      count += 1;
      logger("doJobC. inc by", 1);
      return count;
    },
    { canFastForward: false }
  );
  ctx.registerQueryFunc("getCount", () => {
    return count;
  });

  await Promise.all([doJobA(), doJobB(), doJobC()]);
}

async function runAndCapture() {
  const ctx = new RuntimeContext(ERuntimeMode.EREPLAY_AND_RUN);
  console.log("process start");
  try {
    await ctx.run(processParallelSuccess);
  } catch (error) {
    console.log("process end with error", error);
  }
  console.log("process traces", ctx.getTraces());

  const res = await ctx.doQuery("getCount", []);
  console.log("Query getCount:", res);

  return ctx.getTraces();
}

async function runReplayOnly(prevCtx: TraceLog[]) {
  const ctx = new RuntimeContext(ERuntimeMode.EREPLAY_ONLY);
  ctx.restore(prevCtx);
  console.log("replay start");
  try {
    await ctx.replay(processParallelSuccess);
  } catch (error) {
    console.log("process end with error", error);
  }
  console.log("replay finish");

  const res = await ctx.doQuery("getCount", []);
  console.log("Query getCount:", res);
}

async function main() {
  logger("--------------RUN-----------------");
  const traces = await runAndCapture();
  logger("--------------REPLAY-----------------");
  await runReplayOnly(traces);
}
main();
