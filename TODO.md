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