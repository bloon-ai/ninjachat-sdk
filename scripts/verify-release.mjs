import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const npmPackage = JSON.parse(await readFile(resolve(root, "packages/typescript/package.json"), "utf8"));
const pyproject = await readFile(resolve(root, "packages/python/pyproject.toml"), "utf8");
const pythonInit = await readFile(resolve(root, "packages/python/ninjachat/__init__.py"), "utf8");
const openapi = JSON.parse(await readFile(resolve(root, "openapi/openapi.json"), "utf8"));
const generatedTypes = await readFile(resolve(root, "packages/typescript/src/openapi.generated.ts"), "utf8");
const pythonContract = await readFile(resolve(root, "packages/python/ninjachat/contract.py"), "utf8");

const pyprojectVersion = pyproject.match(/^version = "([^"]+)"$/m)?.[1];
const pythonVersion = pythonInit.match(/^__version__ = "([^"]+)"$/m)?.[1];
const contractDigest = openapi["x-ninjachat-contract-sha256"];
const failures = [];

if (npmPackage.name !== "@ninjachat/sdk") failures.push("npm package must be @ninjachat/sdk");
if (npmPackage.private === true) failures.push("npm package cannot be private");
if (npmPackage.publishConfig?.access !== "public") failures.push("npm package must publish publicly");
if (npmPackage.version !== pyprojectVersion || npmPackage.version !== pythonVersion) {
  failures.push(`versions differ: npm=${npmPackage.version}, pyproject=${pyprojectVersion}, runtime=${pythonVersion}`);
}
if (!contractDigest || !generatedTypes.includes(contractDigest) || !pythonContract.includes(contractDigest)) {
  failures.push("OpenAPI and generated SDK contract identities differ");
}
if (openapi.servers?.[0]?.url !== "https://www.ninjachat.ai/api/v1") {
  failures.push("OpenAPI must use the canonical www.ninjachat.ai API base URL");
}

if (failures.length > 0) {
  console.error(failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log(`Verified @ninjachat/sdk and ninjachat ${npmPackage.version} (${contractDigest.slice(0, 12)})`);
