import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import openapiTS, { astToString } from "openapi-typescript";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendDir = resolve(scriptDir, "..");
const repoRoot = resolve(frontendDir, "..");
const pythonExe = resolve(repoRoot, ".venv", "Scripts", "python.exe");
const cacheDir = resolve(frontendDir, ".cache");
const openapiJsonPath = resolve(cacheDir, "openapi.json");
const outputPath = resolve(frontendDir, "src", "types.generated.ts");

mkdirSync(cacheDir, { recursive: true });

const pythonCode = [
  "import json",
  "from app.main import app",
  `with open(r'''${openapiJsonPath}''', 'w', encoding='utf-8') as fh:`,
  "    json.dump(app.openapi(), fh, ensure_ascii=False, indent=2)",
].join("\n");

execFileSync(pythonExe, ["-c", pythonCode], {
  cwd: repoRoot,
  stdio: "inherit",
});

const schema = JSON.parse(readFileSync(openapiJsonPath, "utf-8"));
const ast = await openapiTS(schema);
writeFileSync(outputPath, astToString(ast), "utf-8");
