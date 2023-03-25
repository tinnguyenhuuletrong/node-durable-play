want

await a
await b
await c

if (await condition(async(), timeout)...) {

}

activities: a,b,c
timeout
auto retry
uuid

defering check : condition, sleep
-> can interupt

// ---------
// working example
// ---------

sample_1:
a = wrapped('a1', a)
logs: [
{call: 'a', callBy: 'a1', response: x},
]

sample_2:
[c,d] = Promise.all([wrapped('a1', a), wrapped('a2', a)])

logs: [
{call: 'a', callBy: 'a1', response: c},
{call: 'a', callBy: 'a2', response: d},
]

sample*3:
state
a = async () {
wrapped('b1', b)
state = {... /\_some update*/}
}

[c,d] = Promise.all([wrapped('a1', a), wrapped('a2', a)])

// if has child -> ignore response on parent scope
logs: [
{call: 'a', callBy: 'a1', child: [
{call: 'b', callBy: 'a1.b1', response: d}
]},
{call: 'a', callBy: 'a2', child: [
{call: 'b', callBy: 'a2.b1', response: d}
]},
]

sample_4:
await sleep('a1', '5 ms')

logs: [
{opt: 'seep', wakeUpAt: 'timeStamp', callBy: 'a1'},
]
runtime:
check wakeupAt
if wakeupAt > now: -> resolve
else finish({nextResumeAt: wakeUpAt}) -> check later

// No need interval check condition. B/c state only change if
// have action call
// time-on
// => interval check is wasted ???
sample_5:
await condition('a1', () => stateCheck === true, '5 ms')

logs: [
{opt: 'condition', timeOutAt: 'timeStamp', callBy: 'a1'},
]
runtime:
check timeOutAt
if timeOutAt > now: -> resolve(false)
else {
if check()
-> resolve(true)
else
finish({nextResumeAt: Math.min(timeOutAt})
}

query:
read data -> nothing changed

signal:
write data -> has opLogs

      replay -> end
        hasSignal -> auto continue by simulate signal one by one

// ----> Done here
// Next
// Play time

1. flow with for / white loop : https://learn.temporal.io/tutorials/typescript/subscriptions/#end-result
2. flow ecommerce with cancel

  user click Buy -> flow 

  process = condition(() => !cancel, '5 seconds')
  if(!process) return


  await decBalance(x)
  await deliverItm(y)
  
3. flow monthly sub

  usages = []
  isActive = true

  signal('add usage')
  signal('cancel')

  while(isActive) {
    await sleep(nextCycle)
    log(usages)
    charge()
  }

  if(usage.length > 0) { 
    log(usages)
    charge()
  }


// Next +
// Retry + timeout per run

Bug Need to check
// TODO: why need to clone ?  - in _play_loop