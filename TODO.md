- define ctx + log structure
- define behavior
    terminate point
    call func -> check prev 
                    success -> return 
                    error -> ctx.can_retry ? retry : throw error
- engine
    v8
    worker


mode restore
    ----
        run -> check logs -> resolve result | throw error

mode restore & continue
        run -> check logs -> resolve result 
                                | throw error (retry ?)
        write log continue run




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
}

