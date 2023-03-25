# node-durable-play

Playing with the idea of durable execution in Node.js. Inspired by [https://temporal.io/](https://temporal.io/) - great open source + production-ready services.

## Note

•  Develop and test with Node.js v18.

•  This is just a playground repository. It is not currently stable.

•  See `./play`.

## Done

•  [x] Promise wrap + add traces log.

•  [x] Replay function based on traces log.

•  [x] Deferred (need to wait for something).

•  [x] Sleep(duration): sleep for await.

•  [x] Condition(checkFn, timeoutDuration): If the condition passes, the function returns true. Otherwise, it returns false after the timeout duration.


•  [x] Run, Deferred, continue, end.

•  [x] Run, Deferred, ---- new instance, replay, continue, end.

•  [x] Run, end, replay.

•  [x] Support external calls for:

•  [x] Mutation: trace log + replayable.

•  [x] Query: read data only.

•  [x] Continue playing with more complex examples like loops.

•  [ ] Monthly subscription flow.

•  [ ] Better interface for TraceLog storage (abstract storage backend).


## Bugs

- [ ] _play_loop.ts:63 // TODO: why need to clone ?
