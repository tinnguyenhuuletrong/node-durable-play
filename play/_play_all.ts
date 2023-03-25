async function main() {
  console.log("-----------------------------------------------");
  console.log("_play");
  console.log("-----------------------------------------------");
  await import("./_play");

  console.log("-----------------------------------------------");
  console.log("_play_promise_race_all");
  console.log("-----------------------------------------------");
  await import("./_play_promise_race_all");

  console.log("-----------------------------------------------");
  console.log("_play_condition");
  console.log("-----------------------------------------------");
  await import("./_play_condition");

  console.log("-----------------------------------------------");
  console.log("_play_loop");
  console.log("-----------------------------------------------");
  await import("./_play_loop");
}
main();
