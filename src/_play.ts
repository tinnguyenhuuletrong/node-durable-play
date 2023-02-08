import { promisify } from "util";
import debug from "debug";
import { promisifyHoc } from "./libs/promiseWatcher";
const logger = debug("main");

const waitMs = promisify(setTimeout);
const waitMsAction = promisifyHoc("waitMs", waitMs);

async function process() {
  let count = 0;
  const doInc = promisifyHoc("doInc", async () => {
    count++;
    await waitMsAction(1000);
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
  await process();
}
main();
