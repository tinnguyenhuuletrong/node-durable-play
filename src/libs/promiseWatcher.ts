import debug from "debug";
import { AsyncLocalStorage } from "async_hooks";
const logger = debug("utils");

const asyncLocalStorage = new AsyncLocalStorage();

export async function promiseWatcher<T = void>(p: Promise<T>): Promise<T> {
  try {
    const res = await p;
    return res;
  } catch (error) {
    throw error;
  }
}

export function promisifyHoc<A extends ReadonlyArray<unknown>, R>(
  name: string,
  f: (...params: A) => Promise<R>
) {
  return (...i: A) => {
    const ctx = (asyncLocalStorage.getStore() as string[]) || [];
    const seqId = ctx.length;
    const wrappedCtx = [...ctx, { seqId, action: name, params: [...i] }];
    logger("begin: ", wrappedCtx);

    const res = asyncLocalStorage.run(wrappedCtx, () =>
      promiseWatcher(f(...i))
    );

    logger("end: ", seqId);

    return res;
  };
}
