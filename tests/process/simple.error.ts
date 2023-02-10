import { promisify } from "node:util";
import {
  ERuntimeMode,
  RuntimeContext,
  TraceLog,
} from "../../src/libs/runtimeContext";

const waitMs = promisify(setTimeout);

export async function simpleError(ctx: RuntimeContext) {
  let count = 0;
  const waitMsAction = ctx.wrapAction("waitMs", waitMs);
  const doInc = ctx.wrapAction(
    "doInc",
    async () => {
      count++;
      if (count > 1) throw new Error("😪");
      await waitMsAction(1000);
      return count;
    },
    { canFastForward: false }
  );
  ctx.registerQueryFunc("getCount", () => {
    return count;
  });

  await doInc();
  await doInc();
  await doInc();
}
