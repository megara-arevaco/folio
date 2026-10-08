import { startServer } from "./server";

startServer().then(app => {
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}).catch(error => { console.error(error); process.exitCode = 1; });
