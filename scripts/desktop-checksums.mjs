import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const directory = resolve(process.argv[2] ?? "dist-desktop");
const files = (await readdir(directory, { withFileTypes: true }))
  .filter(entry => entry.isFile() && /\.(?:AppImage|deb|exe|blockmap)$/.test(entry.name))
  .map(entry => entry.name).sort();
if (!files.length) throw new Error(`No hay artefactos de escritorio en ${directory}`);
const lines = [];
for (const name of files) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(join(directory, name))) hash.update(chunk);
  lines.push(`${hash.digest("hex")}  ${name}`);
}
await writeFile(join(directory, "SHA256SUMS.txt"), `${lines.join("\n")}\n`);
console.log(`SHA256SUMS.txt: ${files.length} archivos`);
