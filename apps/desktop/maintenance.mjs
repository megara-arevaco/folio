import { spawn } from "node:child_process";
import { join } from "node:path";

const commands = new Set(["backup", "verify", "restore", "recover"]);

// Paths come exclusively from the main process/native dialogs, never from web content.
export function runDataTool({ root, data, command, file, executable = process.execPath }) {
  if (!commands.has(command)) throw new Error("Operación de mantenimiento no admitida");
  const args = [join(root, "scripts/folio-data.mjs"), command, "--data-dir", data];
  if (file) args.push("--file", file);
  if (command === "restore") args.push("--confirm", "RESTORE FOLIO DATA");
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    let errors = "";
    child.stdout.on("data", chunk => { output = (output + chunk.toString()).slice(-24000); });
    child.stderr.on("data", chunk => { errors = (errors + chunk.toString()).slice(-24000); });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(errors.trim() || `Mantenimiento interrumpido (${signal ?? code}). Conserva los datos y recupera antes de continuar.`));
    });
  });
}

// Never restart the API in this process: its job maps and ledgers may be stale after restore.
// Once stopped, every outcome requires a fresh app launch, including tool failure.
export function createMaintenanceController({ stop, run, restart }) {
  let busy = false;
  return {
    get busy() { return busy; },
    async execute(command, file) {
      if (!commands.has(command)) throw new Error("Operación de mantenimiento no admitida");
      if (busy) throw new Error("Hay otra operación de mantenimiento en curso");
      busy = true;
      let stopped = false;
      try {
        if (command !== "verify") {
          await stop();
          stopped = true;
        }
        return await run(command, file);
      } finally {
        try { if (stopped) await restart(); }
        finally { busy = false; }
      }
    },
  };
}
