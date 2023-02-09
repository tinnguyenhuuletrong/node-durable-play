import { promisify } from "util";
import debug from "debug";
import { RuntimeContext } from "./libs/runtimeContext";
const logger = debug("main");

const waitMs = promisify(setTimeout);

async function processError(ctx: RuntimeContext) {
  const waitMsAction = ctx.wrapAction("waitMs", waitMs);
  const doInc = ctx.wrapAction("doInc", async () => {
    count++;
    if (count > 2) throw new Error("😪");

    await waitMsAction(1000);
    return count;
  });
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
  const doInc = ctx.wrapAction("doInc", async () => {
    count++;
    if (count > 2) throw new Error("😪");

    await waitMsAction(1000);
    return count;
  });

  logger("1");
  await doInc();
  logger("2");
  await doInc();
  logger("3");
  await doInc();
  logger("3");
}

async function main() {
  const ctx = new RuntimeContext();
  console.log("process start");
  try {
    await processError(ctx);
  } catch (error) {
    console.log("process end with error", error);
  }

  console.log("process traces", ctx.getTraces());
}
main();
