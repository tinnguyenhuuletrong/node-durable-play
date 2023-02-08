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
    logger("begin: ", [...ctx, name]);

    const res = asyncLocalStorage.run([...ctx, name], () =>
      promiseWatcher(f(...i))
    );

    logger("end: ", [...ctx, name]);

    return res;
  };
}
