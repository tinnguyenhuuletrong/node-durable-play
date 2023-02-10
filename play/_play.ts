process.env.DEBUG = "*";

import { promisify } from "util";
import debug from "debug";
import { ERuntimeMode, RuntimeContext, TraceLog } from "../src";
const logger = debug("main");

const waitMs = promisify(setTimeout);

async function processError(ctx: RuntimeContext) {
  const waitMsAction = ctx.wrapAction("waitMs", waitMs);
  const doInc = ctx.wrapAction(
    "doInc",
    async () => {
      count++;
      if (count > 2) throw new Error("😪");

      await waitMsAction(1000);
      return count;
    },
    { canFastForward: false }
  );
  let count = 0;

  logger("1");
  await doInc();
  logger("2");
  await doInc();
  logger("3");
  await doInc();
  logger("3");
}

async function processSuccess(ctx: RuntimeContext) {
  let count = 0;
  const waitMsAction = ctx.wrapAction("waitMs", waitMs);
  const doInc = ctx.wrapAction(
    "doInc",
    async () => {
      count++;
      await waitMsAction(1000);
      return count;
    },
    { canFastForward: false }
  );
  ctx.registerQueryFunc("getCount", () => {
    return count;
  });

  logger("1", count);
  await doInc();
  logger("2", count);
  await doInc();
  logger("3", count);
  await doInc();
  logger("4", count);
}

async function main() {
  await runAndCapture();
  // await runReplayOnly();
  // await runReplayAndContinue();
}
main();
async function runAndCapture() {
  const ctx = new RuntimeContext(ERuntimeMode.EREPLAY_AND_RUN);
  console.log("process start");
  try {
    await ctx.run(processSuccess);
  } catch (error) {
    console.log("process end with error", error);
  }
  console.log("process traces", ctx.getTraces());

  const res = await ctx.doQuery("getCount", []);
  console.log("Query getCount:", res);
}

async function runReplayOnly() {
  const prevCtx: TraceLog[] = [
    {
      seqId: 1,
      action: "doInc",
      params: [],
      result: 1,
      error: undefined,
      isSuccess: true,
    },
    {
      seqId: 2,
      action: "waitMs",
      params: [1000],
      result: undefined,
      error: undefined,
      isSuccess: true,
    },
    {
      seqId: 3,
      action: "doInc",
      params: [],
      result: 2,
      error: undefined,
      isSuccess: true,
    },
    {
      seqId: 4,
      action: "waitMs",
      params: [1000],
      result: undefined,
      error: undefined,
      isSuccess: true,
    },
  ];

  const ctx = new RuntimeContext(ERuntimeMode.EREPLAY_ONLY);
  ctx.restore(prevCtx);
  console.log("process start");
  try {
    await ctx.replay(processSuccess);
  } catch (error) {
    console.log("process end with error", error);
  }

  const res = await ctx.doQuery("getCount", []);
  console.log("Query getCount:", res);
}

async function runReplayAndContinue() {
  const prevCtx: TraceLog[] = [
    {
      seqId: 1,
      action: "doInc",
      params: [],
      result: 1,
      error: undefined,
      isSuccess: true,
    },
    {
      seqId: 2,
      action: "waitMs",
      params: [1000],
      result: undefined,
      error: undefined,
      isSuccess: true,
    },
    {
      seqId: 3,
      action: "doInc",
      params: [],
      result: 2,
      error: undefined,
      isSuccess: true,
    },
    {
      seqId: 4,
      action: "waitMs",
      params: [1000],
      result: undefined,
      error: undefined,
      isSuccess: true,
    },
  ];

  const ctx = new RuntimeContext(ERuntimeMode.EREPLAY_AND_RUN);
  ctx.restore(prevCtx);
  console.log("process start");
  try {
    await ctx.run(processSuccess);
  } catch (error) {
    console.log("process end with error", error);
  }

  const res = await ctx.doQuery("getCount", []);
  console.log("Query getCount:", res);
}
