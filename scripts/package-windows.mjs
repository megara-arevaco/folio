import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";

const args = ["--win", "--x64", ...process.argv.slice(2)];
const require = createRequire(import.meta.url);
const image = "docker.io/electronuserland/builder:wine@sha256:41ae540902461b6cbc988987db79547fcc10cda04d2a6c6367504f59d4b37c64";

function completed(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => code === 0 ? resolve() : reject(new Error(`La compilación terminó con código ${code ?? signal}`)));
  });
}
async function run(command, args) {
  await completed(spawn(command, args, { stdio: "inherit" }));
}

if (process.platform === "win32") {
  await run(process.execPath, [require.resolve("electron-builder/cli.js"), ...args]);
} else {
  // Copy only build inputs: works with remote Docker daemons and keeps .env and user books out.
  const container = `folio-windows-${process.pid}`;
  await run("docker", ["create", "--name", container, "--env", "USE_SYSTEM_WINE=true", "--workdir", "/project",
    "--entrypoint", "node", image, "node_modules/electron-builder/cli.js", ...args, "-c.npmRebuild=false"]);
  try {
    const archive = spawn("tar", ["-cf", "-", "package.json", "pnpm-lock.yaml", "electron-builder.yml", "node_modules", "dist", "apps/web/dist"], { stdio: ["ignore", "pipe", "inherit"] });
    const copy = spawn("docker", ["cp", "-", `${container}:/project`], { stdio: ["pipe", "inherit", "inherit"] });
    archive.stdout.pipe(copy.stdin);
    await Promise.all([completed(archive), completed(copy)]);
    await run("docker", ["start", "--attach", container]);
    // `docker start --attach` does not consistently propagate the command's exit status.
    const status = spawn("docker", ["inspect", "--format", "{{.State.ExitCode}}", container], { stdio: ["ignore", "pipe", "inherit"] });
    let code = "";
    status.stdout.on("data", chunk => { code += chunk; });
    await completed(status);
    if (code.trim() !== "0") throw new Error(`El empaquetado de Windows falló (${code.trim()})`);
    await mkdir("release", { recursive: true });
    await run("docker", ["cp", `${container}:/project/release/.`, "release"]);
  } finally {
    await run("docker", ["rm", "--force", container]);
  }
}
