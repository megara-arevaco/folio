import { spawn } from "node:child_process";

const children = ["dev:api", "dev:web"].map(script =>
  spawn("corepack", ["pnpm", script], { stdio: "inherit" }));
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill("SIGTERM");
}
process.once("SIGINT", () => stop());
process.once("SIGTERM", () => stop());
for (const child of children) {
  child.once("error", error => { console.error(error); stop(1); });
  child.once("exit", code => stop(code ?? 0));
}
