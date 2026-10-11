import { build } from "esbuild";
import { build as buildWeb } from "vite";

await buildWeb({ root: "apps/web" });
await build({
  entryPoints: ["apps/desktop/api.ts"], outfile: "dist/desktop/api.mjs",
  bundle: true, platform: "node", format: "esm", target: "node24", packages: "external",
});
