import { promisify } from "node:util";
import {
  ERuntimeMode,
  RuntimeContext,
  TraceLog,
} from "../src/libs/runtimeContext";
import { simpleError } from "./process/simple.error";
import { simpleSuccess } from "./process/simple.success";

describe("runtime - record", () => {
  it("simpleSuccess", async () => {
    const ctx = new RuntimeContext(ERuntimeMode.EREPLAY_AND_RUN);
    await ctx.run(simpleSuccess);
    const traces = ctx.getTraces();
    expect(traces).toMatchSnapshot();

    expect(ctx.doQuery("getCount", [])).toEqual(3);
  });

  it("simpleError", async () => {
    const ctx = new RuntimeContext(ERuntimeMode.EREPLAY_AND_RUN);
    try {
      await ctx.run(simpleError);
    } catch (error) {}
    const traces = ctx.getTraces();
    expect(traces).toMatchSnapshot();
    expect(ctx.doQuery("getCount", [])).toEqual(2);
  });
});

describe("runtime - replay", () => {
  it("simpleSuccess - replay only", async () => {
    const ctx = new RuntimeContext(ERuntimeMode.EREPLAY_ONLY);
    ctx.restore([
      {
        action: "doInc",
        error: undefined,
        isSuccess: true,
        params: [],
        result: 1,
        seqId: 1,
      },
      {
        action: "waitMs",
        error: undefined,
        isSuccess: true,
        params: [1000],
        result: undefined,
        seqId: 2,
      },
    ]);
    await ctx.replay(simpleSuccess);

    expect(ctx.doQuery("getCount", [])).toEqual(1);
  });

  it("simpleSuccess - replay and continue", async () => {
    const ctx = new RuntimeContext(ERuntimeMode.EREPLAY_AND_RUN);
    ctx.restore([
      {
        action: "doInc",
        error: undefined,
        isSuccess: true,
        params: [],
        result: 1,
        seqId: 1,
      },
      {
        action: "waitMs",
        error: undefined,
        isSuccess: true,
        params: [1000],
        result: undefined,
        seqId: 2,
      },
    ]);
    await ctx.run(simpleSuccess);

    expect(ctx.doQuery("getCount", [])).toEqual(3);
  });
});
