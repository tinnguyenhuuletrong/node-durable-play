process.env.DEBUG = "*";

/*

CheckOutProcess 

await createOrderId
await lockInventory {maxRetry:0}

try {
  await payment {maxRetry:2}
  await waitForPacking {maxTime: 1Day}
  await createShipId {maxRetry:2, uuid: xxx}
  await waitForShip {maxTime: 1Day}
  await markDone
} catch {
  await releaseLockInventory

  if(already payment)
    await refund
}

*/

import { isFunction, promisify } from "util";
import debug from "debug";
import { RuntimeContext, TraceLog } from "../src";
const logger = debug("main");

const waitMs = promisify(setTimeout);

interface IService {
  createUUID(): Promise<string>;
  createOrderId(uuid: string, data: any): Promise<string>;
  lockInventory(uuid: string, data: any): Promise<string>;
  payment(uuid: string, data: any): Promise<string>;
  waitForPacking(uuid: string, data: any): Promise<string>;
  createShipId(uuid: string, data: any): Promise<string>;
  waitForShip(uuid: string, data: any): Promise<string>;
  markDone(uuid: string, data: any): Promise<string>;
  releaseLockInventory(uuid: string, data: any): Promise<string>;
}

function autoWrap(ctx: RuntimeContext, service: IService) {
  const tmp = {};
  for (const k of Object.keys(service)) {
    const f = service[k];
    if (!isFunction(f)) continue;
    logger("autoWrap -", k);
    tmp[k] = ctx.wrapAction(k, f.bind(this));
  }
  return tmp as IService;
}

function paymentProcess(service: IService) {
  return async function (ctx: RuntimeContext) {
    const srv = autoWrap(ctx, service);
    const pid = await srv.createUUID();
    const state: any = {
      pid,
    };
    const checkoutItems = ["1", "2", "3"];

    ctx.registerQueryFunc("getData", () => {
      return state;
    });

    const orderId = await srv.createOrderId(pid, { itm: checkoutItems });
    state.orderDetail = {
      orderId,
    };

    const invLockReceipt = await srv.lockInventory(pid, {
      itm: checkoutItems,
    });
    state.inventoryLock = {
      invLockReceipt,
    };

    const paymentReceipt = await srv.payment(pid, {
      checkoutItems,
    });
    state.paymentDetail = {
      paymentReceipt,
    };

    const status = await srv.waitForPacking(pid, {
      invLockReceipt,
    });
    state.packingStatus = {
      status,
    };

    // TODO: somehow wait and check by scheduler
    //  waiting --> check again after x
    //  complete -> next
    /*

      ctx.waitFor(
        //CheckFunc
        () => srv.getPackingStatus() === 'success'
        //DeadlineAt
        {deadline: startTime + X, checkInterval: 1m}
      )
    */
  };
}

async function runAndCapture(service: IService) {
  const ctx = new RuntimeContext();
  console.log("process start");
  try {
    await ctx.run(paymentProcess(service));
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
    await ctx.replay(paymentProcess(service));
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
  const tmpService: IService = {
    createUUID: async () => `uuid_${Date.now()}`,

    createOrderId: async function (uuid: string, data: any): Promise<string> {
      logger("hit createOrderId", uuid, data);
      return `createOrderId_uuid_${Date.now()}`;
    },
    lockInventory: async function (uuid: string, data: any): Promise<string> {
      logger("hit lockInventory", uuid, data);
      return `lockInventory_uuid_${Date.now()}`;
    },
    payment: async function (uuid: string, data: any): Promise<string> {
      logger("hit payment", uuid, data);
      return `payment_uuid_${Date.now()}`;
    },
    waitForPacking: async function (uuid: string, data: any): Promise<string> {
      logger("hit waitForPacking", uuid, data);
      return "waiting";
    },
    createShipId: async function (uuid: string, data: any): Promise<string> {
      logger("hit createShipId", uuid, data);
      return `createShipId_uuid_${Date.now()}`;
    },
    waitForShip: async function (uuid: string, data: any): Promise<string> {
      logger("hit waitForShip", uuid, data);
      return `waitForShip_uuid_${Date.now()}`;
    },
    markDone: async function (uuid: string, data: any): Promise<string> {
      logger("hit markDone", uuid, data);
      return `markDone_uuid_${Date.now()}`;
    },
    releaseLockInventory: async function (
      uuid: string,
      data: any
    ): Promise<string> {
      logger("hit releaseLockInventory", uuid, data);
      return `releaseLockInventory_uuid_${Date.now()}`;
    },
  };

  logger("--------------RUN-----------------");
  const traces = await runAndCapture(tmpService);
  console.dir(traces, { depth: 100 });

  logger("--------------REPLAY-----------------");
  await runReplayOnly(tmpService, traces);
}
main();
