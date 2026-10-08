import { build } from "esbuild";

await build({
  entryPoints: ["apps/api/src/start.ts"], outfile: "dist/api/start.js",
  bundle: true, platform: "node", format: "esm", target: "node24", packages: "external",
});
