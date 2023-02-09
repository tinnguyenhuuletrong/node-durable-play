- define ctx + log structure
- define behavior
    terminate point
    call func -> check prev 
                    success -> return 
                    error -> ctx.can_retry ? retry : throw error
- engine
    v8
    worker