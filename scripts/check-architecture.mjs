import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { builtinModules } from "node:module";

const nodeModules = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

const projectRoot = resolve(import.meta.dirname, "..");
const webRoot = resolve(projectRoot, "apps/web/src");
const apiRoot = resolve(projectRoot, "apps/api/src");
const contractsRoot = resolve(projectRoot, "packages/contracts/src");
const servicesRoot = resolve(apiRoot, "services");
const routesRoot = resolve(apiRoot, "routes");
const inside = (file, directory) => file === directory || file.startsWith(directory + sep);

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (/\.tsx?$/.test(entry.name)) files.push(path);
  }
  return files;
}

const configPath = ts.findConfigFile(projectRoot, ts.sys.fileExists, "tsconfig.json");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
const options = ts.parseJsonConfigFileContent(config.config, ts.sys, projectRoot).options;
const violations = [];
for (const root of [webRoot, apiRoot, contractsRoot]) {
  for (const file of await sourceFiles(root)) {
    const source = ts.createSourceFile(file, await readFile(file, "utf8"), ts.ScriptTarget.Latest, true);
    function visit(node) {
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        specifier = node.moduleSpecifier;
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
        specifier = node.argument.literal;
      } else if (ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
        specifier = node.arguments[0];
      }
      if (specifier && ts.isStringLiteralLike(specifier)) {
        const name = specifier.text;
        const resolved = ts.resolveModuleName(name, file, options, ts.sys).resolvedModule?.resolvedFileName;
        const target = resolved ? resolve(resolved) : name.startsWith(".") ? resolve(dirname(file), name) : null;
        const testFile = /\.test\.tsx?$/.test(file);
        const typeOnly = (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) ||
          (ts.isExportDeclaration(node) && node.isTypeOnly) || ts.isImportTypeNode(node);
        const pureModule = /services\/(?:jobs\/(?:state|queue|records)|readingLog\/domain)\.ts$/.test(file);
        const persistenceModule = /services\/(?:jobs\/persistence|readingLog\/repository)\.ts$/.test(file);
        const testBuiltin = /\.test\.tsx?$/.test(file) && nodeModules.has(name);
        let reason;
        if (!testFile && pureModule && !typeOnly && (!target || !inside(target, contractsRoot))) {
          reason = "Las reglas puras solo pueden importar contratos en ejecución";
        } else if (!testFile && persistenceModule && !typeOnly && target &&
          /services\/(?:jobs(?:\.ts|\/(?:runner|queue|state)\.ts)|readingLog(?:\.ts|\/domain\.ts))$/.test(target)) {
          reason = "La persistencia no puede depender de coordinadores ni ejecución";
        } else if (inside(file, contractsRoot) && !testBuiltin && (!target || !inside(target, contractsRoot))) {
          reason = "Los contratos solo pueden depender de otros contratos";
        } else if (inside(file, webRoot) &&
          ((!testBuiltin && (name.startsWith("node:") || nodeModules.has(name))) ||
            target && inside(target, apiRoot))) {
          reason = "La web no puede depender de Node ni de la implementación de la API";
        } else if (inside(file, apiRoot) && target && inside(target, webRoot)) {
          reason = "La API no puede depender de la web";
        } else if (inside(file, servicesRoot) && target &&
          (inside(target, routesRoot) || target.replace(/\.tsx?$/, "") === resolve(apiRoot, "server"))) {
          reason = "Los servicios no pueden depender de rutas ni del arranque HTTP";
        }
        if (reason) {
          const { line } = source.getLineAndCharacterOfPosition(specifier.getStart(source));
          violations.push(`${relative(projectRoot, file)}:${line + 1}: ${reason} (${name})`);
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
}
if (violations.length) {
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Dependencias de API, web y contratos verificadas.");
}
