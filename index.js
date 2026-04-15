const fs = require("fs/promises");
const path = require("path");
const $RefParser = require("@apidevtools/json-schema-ref-parser");
const yaml = require("js-yaml");

const MODELS_DIR = path.resolve("definition/schemas/models");
const OUTPUT_BASE_DIR = path.resolve("publication/schemas");

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(targetPath) {
  try {
    const stat = await fs.stat(targetPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function bundleModel(modelName) {
  const modelDir = path.join(MODELS_DIR, modelName);
  const rootSchemaFile = path.join(modelDir, `${modelName}.schema.yaml`);
  const outputDir = path.join(OUTPUT_BASE_DIR, modelName);
  const outputFile = path.join(outputDir, `${modelName}.schema.json`);

  const rootExists = await pathExists(rootSchemaFile);
  if (!rootExists) {
    console.error(
      `[ERROR] Missing root schema for model "${modelName}": ${rootSchemaFile}`
    );
    return;
  }

  try {
    const bundledSchema = await $RefParser.bundle(rootSchemaFile);

    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(outputFile, JSON.stringify(bundledSchema, null, 2), "utf8");

    console.log(`[OK] Bundled "${modelName}" -> ${outputFile}`);
  } catch (error) {
    console.error(`[ERROR] Failed to bundle model "${modelName}"`);
    console.error(error.message);
  }
}

async function main() {
  const modelsDirExists = await pathExists(MODELS_DIR);
  if (!modelsDirExists) {
    throw new Error(`Models directory does not exist: ${MODELS_DIR}`);
  }

  const entries = await fs.readdir(MODELS_DIR, { withFileTypes: true });
  const modelFolders = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  if (modelFolders.length === 0) {
    console.log(`[INFO] No model folders found in ${MODELS_DIR}`);
    return;
  }

  for (const modelName of modelFolders) {
    await bundleModel(modelName);
  }
}

main().catch((error) => {
  console.error("[FATAL]", error.message);
  process.exit(1);
});