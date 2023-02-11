process.env.DEBUG = "*";

import { promisify } from "util";
import debug from "debug";
import { RuntimeContext, TraceLog } from "../src";
const logger = debug("main");

const waitMs = promisify(setTimeout);

interface IService {
  queryA(): Promise<any>;
  queryB(): Promise<any>;
  queryC(): Promise<any>;
}

function processParallelSuccess(service: IService) {
  return async function (ctx: RuntimeContext) {
    let profile: any = {
      infoA: null,
      infoB: null,
      infoC: null,
    };
    const waitMsAction = ctx.wrapAction("waitMs", waitMs);
    const doJobA = ctx.wrapAction("doJobA", async () => {
      return await service.queryA();
    });
    const doJobB = ctx.wrapAction("doJobB", async () => {
      return await service.queryB();
    });
    const doJobC = ctx.wrapAction("doJobC", async () => {
      return await service.queryC();
    });
    ctx.registerQueryFunc("getData", () => {
      return profile;
    });

    await waitMsAction(30);

    const [a, b, c] = await Promise.allSettled([doJobA(), doJobB(), doJobC()]);
    profile.infoA = a.status === "fulfilled" ? a.value : undefined;
    profile.infoB = b.status === "fulfilled" ? b.value : undefined;
    profile.infoC = c.status === "fulfilled" ? c.value : undefined;
  };
}

async function runAndCapture(service: IService) {
  const ctx = new RuntimeContext();
  console.log("process start");
  try {
    await ctx.run(processParallelSuccess(service));
  } catch (error) {
    console.log("process end with error", error);
  }

  const res = await ctx.doQuery("getData", []);
  console.log("Query getData:", res);

  return ctx.getTraces();
}

async function runReplayOnly(service: IService, prevCtx: TraceLog[]) {
  const ctx = new RuntimeContext();
  ctx.restore(prevCtx);
  console.log("replay start");

  try {
    await ctx.replay(processParallelSuccess(service));
  } catch (error) {
    console.log("process end with error", error);
  }
  console.log("replay finish");

  let funcRes = await ctx.doQuery("getData", []);
  console.log("Query getData:", funcRes);

  await ctx.resume();

  console.log("resume finish");
  funcRes = await ctx.doQuery("getData", []);
  console.log("Query getData:", funcRes);
}

async function main() {
  const fakeService1 = {
    queryA: async () => {
      return { data: "info from a1" };
    },
    queryB: async () => {
      throw new Error("error during query B1");
      return { data: "info from b" };
    },
    queryC: async () => {
      return { data: "info from c1" };
    },
  };
  const fakeService2 = {
    queryA: async () => {
      return { data: "info from a2" };
    },
    queryB: async () => {
      return { data: "info from b2" };
    },
    queryC: async () => {
      return { data: "info from c2" };
    },
  };
  logger("--------------RUN-----------------");
  const traces = await runAndCapture(fakeService1);
  console.dir(traces, { depth: 100 });
  logger("--------------REPLAY-----------------");
  await runReplayOnly(fakeService2, traces);
}
main();
