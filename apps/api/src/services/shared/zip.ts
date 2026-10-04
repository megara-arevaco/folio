import { readFileSync, statSync } from "node:fs";
import { posix } from "node:path";
import { inflateRawSync } from "node:zlib";
import AdmZip from "adm-zip";
import { maxDocumentBytes } from "./limits";

type ZipLimits = { compressed: number; entries: number; entry: number; expanded: number };
export function openValidatedZip(input: string | Buffer, limits: ZipLimits = {
  compressed: maxDocumentBytes(), entries: 10000, entry: 64 * 1024 * 1024, expanded: 512 * 1024 * 1024,
}): AdmZip {
  if (typeof input === "string" && statSync(input).size > limits.compressed) throw new Error("El EPUB supera el tamaño permitido");
  const buffer = typeof input === "string" ? readFileSync(input) : input;
  if (buffer.length > limits.compressed) throw new Error("El EPUB supera el tamaño permitido");
  const zip = new AdmZip(buffer);
  const entries = zip.getEntries();
  if (entries.length > limits.entries) throw new Error("El EPUB contiene demasiadas entradas ZIP");
  const names = new Set<string>();
  let expanded = 0;
  for (const entry of entries) {
    const name = entry.entryName;
    const normalized = posix.normalize(name).replace(/\/$/, "");
    if (!name || name.includes("\0") || name.includes("\\") || name.startsWith("/") || /^[a-z]:/i.test(name) ||
      name.split("/").includes("..") || names.has(normalized)) throw new Error("El EPUB contiene rutas ZIP inválidas o duplicadas");
    names.add(normalized);
    expanded += entry.header.size;
    if (entry.header.size > limits.entry || expanded > limits.expanded) throw new Error("El EPUB supera el tamaño expandido permitido");
    if (!entry.isDirectory) {
      const original = entry.getData.bind(entry);
      entry.getData = () => {
        // Bound inflation even when a hostile central-directory size is forged.
        if (entry.header.method === 8) {
          const inflated = inflateRawSync(entry.getCompressedData(), { maxOutputLength: limits.entry });
          if (inflated.length !== entry.header.size) throw new Error("Tamaño ZIP inconsistente");
        }
        return original(); // Retain AdmZip CRC validation.
      };
    }
  }
  return zip;
}
