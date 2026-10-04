import { build } from "esbuild";
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
await mkdir("dist/desktop", { recursive: true });
await sharp("apps/web/public/icon.svg").resize(512, 512).png().toFile("dist/desktop/icon.png");
await build({
  entryPoints: ["apps/api/src/server.ts"], outfile: "dist/desktop/api.cjs",
  bundle: true, platform: "node", format: "cjs", target: "node24", packages: "external",
  banner: { js: 'const __folioModuleUrl = require("node:url").pathToFileURL(__filename).href;' },
  define: { "import.meta.url": "__folioModuleUrl" },
});
await build({
  external: ["./api.cjs"],
  entryPoints: ["apps/desktop/main.ts"], outfile: "dist/desktop/main.cjs",
  bundle: true, platform: "node", format: "cjs", target: "node24", packages: "external",
});
await build({
  entryPoints: ["apps/desktop/preload.ts"], outfile: "dist/desktop/preload.cjs",
  bundle: true, platform: "node", format: "cjs", target: "node24", external: ["electron"],
});
