process.env.DEBUG = "*";

import { promisify } from "util";
import debug from "debug";
import { RuntimeContext, Trace } from "../src";
import REPL from "repl";
import assert from "assert";
import { clone } from "../src/libs/utils";

const loggerFlow = debug("flow");

const waitMs = promisify(setTimeout);

/*
  active = true | false

  while active {
    each cycle 
      depend on usages 
        -> call charge
  }
*/
async function cycleChargeFlow(ctx: RuntimeContext) {
  let usages: any = [];
  let isActive = true;
  let cycle = "10 seconds";
  const doLog = ctx.wrapAction("doLog", async (msg: string) => {
    loggerFlow("log", msg);
    return msg;
  });
  ctx.withSignal("addUsage", (imtId: string, amount: number) => {
    loggerFlow("addUsage", { imtId, amount });
    usages.push({ imtId, amount });
  });

  ctx.withQuery("getActive", () => {
    return isActive;
  });
  ctx.withQuery("getCycle", () => {
    return count;
  });
  ctx.withSignal("setActive", (v: boolean) => {
    loggerFlow("setActive", v);
    isActive = v;
  });

  loggerFlow("begin");
  loggerFlow(`cycle: ${cycle}`);

  let count = 0;
  while (isActive) {
    count++;
    await ctx.sleep(`sleep_cycle_${count}`, cycle);
    if (usages.length <= 0) continue;
    await doLog(
      `log_cycle_${count}`,
      `charge at cycle ${count} ${JSON.stringify(usages)}`
    );
    usages = [];
  }

  loggerFlow("end");
}

async function main() {
  // startFlow();

  const _previousTraces = `[{"opt":"start","callBy":"","child":[]},{"opt":"sleep","callBy":"sleep_cycle_1","child":[],"wakeUpAt":1679747182418},{"opt":"sleep","callBy":"sleep_cycle_2","child":[],"wakeUpAt":1679747192429},{"opt":"signal","child":[],"callBy":"addUsage","arguments":["itm1",1],"isSuccess":true},{"opt":"call","child":[],"funcName":"doLog","callBy":"log_cycle_2","isSuccess":true,"response":"charge at cycle 2 [{\\"imtId\\":\\"itm1\\",\\"amount\\":1}]"},{"opt":"sleep","callBy":"sleep_cycle_3","child":[],"wakeUpAt":1679747202433},{"opt":"sleep","callBy":"sleep_cycle_4","child":[],"wakeUpAt":1679747212436},{"opt":"signal","child":[],"callBy":"addUsage","arguments":["itm222",55],"isSuccess":true},{"opt":"call","child":[],"funcName":"doLog","callBy":"log_cycle_4","isSuccess":true,"response":"charge at cycle 4 [{\\"imtId\\":\\"itm222\\",\\"amount\\":55}]"},{"opt":"sleep","callBy":"sleep_cycle_5","child":[],"wakeUpAt":1679747222438},{"opt":"signal","child":[],"callBy":"addUsage","arguments":["itm222",55],"isSuccess":true},{"opt":"signal","child":[],"callBy":"addUsage","arguments":["itm222",55],"isSuccess":true},{"opt":"signal","child":[],"callBy":"addUsage","arguments":["itm222",55],"isSuccess":true},{"opt":"call","child":[],"funcName":"doLog","callBy":"log_cycle_5","isSuccess":true,"response":"charge at cycle 5 [{\\"imtId\\":\\"itm222\\",\\"amount\\":55},{\\"imtId\\":\\"itm222\\",\\"amount\\":55},{\\"imtId\\":\\"itm222\\",\\"amount\\":55}]"},{"opt":"sleep","callBy":"sleep_cycle_6","child":[],"wakeUpAt":1679747232441},{"opt":"sleep","callBy":"sleep_cycle_7","child":[],"wakeUpAt":1679747242443},{"opt":"sleep","callBy":"sleep_cycle_8","child":[],"wakeUpAt":1679747252444}]`;
  restoreFlow(JSON.parse(_previousTraces) as Trace[]);
  startRepl();
}
main();

let _ctx: RuntimeContext;

async function startFlow() {
  const ctx = new RuntimeContext();
  await ctx.runAsNew(cycleChargeFlow);

  _ctx = ctx;
  global.ctx = ctx;

  while (!ctx.isEnd()) {
    await waitMs(10000);
    await ctx.continue();
  }
}

async function restoreFlow(traces: Trace[]) {
  const ctx = new RuntimeContext();
  await ctx.replay(traces, cycleChargeFlow);

  _ctx = ctx;
  global.ctx = ctx;

  while (!ctx.isEnd()) {
    await waitMs(10000);
    await ctx.continue();
  }
}

async function startRepl() {
  global.m = {
    getActive: () => _ctx.callQuery("getActive"),
    getCycle: () => _ctx.callQuery("getCycle"),
    setActive: (v: boolean) => _ctx.callSignal("setActive", v),
    addUsage: (itm: string, v: number) => _ctx.callSignal("addUsage", itm, v),
  };

  REPL.start({
    useColors: true,
    useGlobal: true,
  });
}
