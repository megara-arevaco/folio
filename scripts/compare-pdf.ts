import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { getPdfConversionConfig, processPdfWithOpenRouter, type PdfEngine } from "../apps/api/src/services/pdfOpenRouter";

// Runs real, billable OpenRouter requests. A small page limit is deliberate.
const args = process.argv.slice(2);
if (!args.length || args.includes("--help")) {
  console.log("Uso: pnpm pdf:compare libro.pdf [--pages 6] [--engines native,mistral-ocr] [--out tmp/pdf-comparison]");
  console.log("Compara las primeras páginas mediante OpenRouter. Consume saldo; reutiliza extracciones guardadas.");
} else {
  const path = resolve(args[0]!);
  const values = new Map<string, string>();
  for (let index = 1; index < args.length; index += 2) {
    if (!["--pages", "--engines", "--out"].includes(args[index]!) || !args[index + 1]) throw new Error(`Argumento inválido: ${args[index]}`);
    values.set(args[index]!, args[index + 1]!);
  }
  const pageLimit = Number(values.get("--pages") || 6);
  if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 50) throw new Error("--pages debe estar entre 1 y 50");
  const engines = [...new Set((values.get("--engines") || "native,mistral-ocr").split(","))];
  if (engines.some((engine) => !["native", "mistral-ocr", "cloudflare-ai"].includes(engine))) throw new Error("Motores válidos: native,mistral-ocr,cloudflare-ai");
  const config = getPdfConversionConfig();
  const outputDir = resolve(values.get("--out") || "tmp/pdf-comparison");
  await mkdir(outputDir, { recursive: true });
  console.log(`OpenRouter: ${config.model}; hasta ${pageLimit} páginas por motor (${engines.join(", ")}).`);
  const results: { engine: string; output?: string; elapsedMs: number; error?: string }[] = [];
  for (const engine of engines) {
    const started = Date.now();
    try {
      const output = await processPdfWithOpenRouter(path, {
        config: { ...config, engine: engine as PdfEngine },
        inputFileName: basename(path), pageLimit,
        cacheDir: join(outputDir, "cache"),
        onProgress: (progress) => console.log(`[${engine}] ${progress.message}`),
      });
      const outputPath = join(outputDir, `${basename(path, ".pdf")}-${engine}.epub`);
      await writeFile(outputPath, output);
      results.push({ engine, output: outputPath, elapsedMs: Date.now() - started });
    } catch (error) {
      results.push({ engine, elapsedMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
      process.exitCode = 1;
    }
  }
  await writeFile(join(outputDir, "comparison.json"), JSON.stringify({ model: config.model, pageLimit, results }, null, 2));
  console.log(JSON.stringify(results, null, 2));
}
