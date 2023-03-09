process.env.DEBUG = "*";

import debug from "debug";
import { RuntimeContext } from "../src";
const logger = debug("main");

async function simpleFlow(ctx: RuntimeContext) {
  let total = 0;
  const doLog = ctx.wrapAction("doLog", async (msg: string) => {
    // await ctx.sleep("s1", "1 second");
    return msg;
  });
  const doInc = ctx.wrapAction("doInc", async (x: number) => {
    total += x;
    await doLog("log_after_inc", `before ${total - x} after ${total}`);
    return total;
  });

  logger("begin", total);

  await Promise.all([
    async () => {
      doInc("p1", 10);
    },
    doInc("p2", 20),
  ]);

  logger("end", total);
}

async function main() {
  const ctx = new RuntimeContext();
  await ctx.runAsNew(simpleFlow);
  const traces = ctx.getTraces();
  console.dir(traces, { depth: 10 });

  // Replay
  await ctx.replay(traces, simpleFlow);
  console.dir(ctx.getInstructions(), { depth: 10 });
}
main();
