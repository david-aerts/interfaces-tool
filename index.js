const fs = require("fs/promises");
const path = require("path");
const $RefParser = require("@apidevtools/json-schema-ref-parser");
const yaml = require("js-yaml");

const SCHEMAS_DIRECTORY_PATH = path.resolve("definition/schemas");
const MODELS_DIRECTORY_PATH = path.resolve("definition/schemas/models");
const PUBLICATION_DIRECTORY_PATH = path.resolve("publication/schemas");

const PRIMITIVE_SCHEMA_TYPES = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "null",
]);

const logger = {
  /**
   * Logs an informational message.
   *
   * @param {string} message
   * @returns {void}
   */
  info(message) {
    console.info(`[INFO] ${message}`);
  },

  /**
   * Logs a warning message.
   *
   * @param {string} message
   * @returns {void}
   */
  warn(message) {
    console.warn(`[WARN] ${message}`);
  },

  /**
   * Logs an error message.
   *
   * @param {string} message
   * @returns {void}
   */
  error(message) {
    console.error(`[ERROR] ${message}`);
  },
};

/**
 * Returns true when the given path exists.
 *
 * @param {string} targetPath
 * @returns {Promise<boolean>}
 */
async function doesPathExist(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns true when the given path is a directory.
 *
 * @param {string} targetPath
 * @returns {Promise<boolean>}
 */
async function isDirectory(targetPath) {
  try {
    const stats = await fs.stat(targetPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Reads and parses a YAML file.
 *
 * @param {string} filePath
 * @returns {Promise<any>}
 */
async function readYamlFile(filePath) {
  const fileContent = await fs.readFile(filePath, "utf8");
  return yaml.load(fileContent);
}

/**
 * Recursively returns all file paths found under the given directory.
 *
 * @param {string} directoryPath
 * @returns {Promise<string[]>}
 */
async function getAllFilePathsRecursively(directoryPath) {
  const directoryEntries = await fs.readdir(directoryPath, {
    withFileTypes: true,
  });

  const nestedResults = await Promise.all(
    directoryEntries.map(async (directoryEntry) => {
      const entryPath = path.join(directoryPath, directoryEntry.name);

      if (directoryEntry.isDirectory()) {
        return getAllFilePathsRecursively(entryPath);
      }

      if (directoryEntry.isFile()) {
        return [entryPath];
      }

      return [];
    })
  );

  return nestedResults.flat();
}

/**
 * Returns true when the file path points to a YAML schema file.
 *
 * @param {string} filePath
 * @returns {boolean}
 */
function isYamlSchemaFile(filePath) {
  return filePath.endsWith(".schema.yaml") || filePath.endsWith(".schema.yml");
}

/**
 * Returns true when the given schema defines a primitive value type.
 *
 * @param {any} schema
 * @returns {boolean}
 */
function isPrimitiveValueSchema(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return false;
  }

  if (typeof schema.type !== "string") {
    return false;
  }

  return PRIMITIVE_SCHEMA_TYPES.has(schema.type);
}

/**
 * Returns true when the schema has at least one usable example annotation.
 *
 * Accepted forms:
 * - example: <value>
 * - examples: [<value>, ...]
 *
 * @param {any} schema
 * @returns {boolean}
 */
function hasExampleAnnotation(schema) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return false;
  }

  if (Object.prototype.hasOwnProperty.call(schema, "example")) {
    return true;
  }

  if (
    Object.prototype.hasOwnProperty.call(schema, "examples") &&
    Array.isArray(schema.examples) &&
    schema.examples.length > 0
  ) {
    return true;
  }

  return false;
}

/**
 * Validates that primitive value schemas define an example.
 *
 * @param {string} filePath
 * @param {any} schema
 * @returns {void}
 */
function validatePrimitiveSchemasHaveExample(filePath, schema) {
  if (!isPrimitiveValueSchema(schema)) {
    return;
  }

  if (hasExampleAnnotation(schema)) {
    return;
  }

  logger.warn(
    `Primitive value schema "${path.basename(filePath)}" is missing an example.`
  );
}

/**
 * Validates one schema file.
 *
 * @param {string} filePath
 * @returns {Promise<void>}
 */
async function validateSchemaFile(filePath) {
  try {
    const schema = await readYamlFile(filePath);
    validatePrimitiveSchemasHaveExample(filePath, schema);
  } catch (error) {
    logger.error(`Failed to validate schema file "${filePath}": ${error.message}`);
  }
}

/**
 * Validates all YAML schema files under the schemas directory.
 *
 * @param {string} schemasDirectoryPath
 * @returns {Promise<void>}
 */
async function validateSchemaFiles(schemasDirectoryPath) {
  logger.info(`Validating schema files in "${schemasDirectoryPath}"`);

  const allFilePaths = await getAllFilePathsRecursively(schemasDirectoryPath);
  const schemaFilePaths = allFilePaths.filter(isYamlSchemaFile);

  if (schemaFilePaths.length === 0) {
    logger.warn(`No YAML schema files found in "${schemasDirectoryPath}"`);
    return;
  }

  logger.info(`Found ${schemaFilePaths.length} schema file(s) to validate`);

  for (const schemaFilePath of schemaFilePaths) {
    await validateSchemaFile(schemaFilePath);
  }

  logger.info("Schema validation completed");
}

/**
 * Returns the names of all direct model directories.
 *
 * @param {string} modelsDirectoryPath
 * @returns {Promise<string[]>}
 */
async function getModelDirectoryNames(modelsDirectoryPath) {
  const directoryEntries = await fs.readdir(modelsDirectoryPath, {
    withFileTypes: true,
  });

  return directoryEntries
    .filter((directoryEntry) => directoryEntry.isDirectory())
    .map((directoryEntry) => directoryEntry.name);
}

/**
 * Bundles a root schema file into a single-document schema.
 *
 * @param {string} rootSchemaFilePath
 * @returns {Promise<object>}
 */
async function bundleSchema(rootSchemaFilePath) {
  return $RefParser.bundle(rootSchemaFilePath);
}

/**
 * Extracts a missing schema filename from a resolver error message.
 *
 * @param {Error} error
 * @returns {string | null}
 */
function extractMissingSchemaFileName(error) {
  if (!error || typeof error.message !== "string") {
    return null;
  }

  const missingFilePathMatch = error.message.match(
    /Error opening file\s+(.+?):\s+ENOENT/i
  );

  if (!missingFilePathMatch) {
    return null;
  }

  const missingFilePath = missingFilePathMatch[1]
    .trim()
    .replace(/^["']|["']$/g, "");

  return path.basename(missingFilePath);
}

/**
 * Recursively collects all $ref values found in a schema node.
 *
 * @param {any} node
 * @param {string[]} refs
 * @returns {string[]}
 */
function collectRefValues(node, refs = []) {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectRefValues(item, refs);
    }

    return refs;
  }

  if (!node || typeof node !== "object") {
    return refs;
  }

  for (const [key, value] of Object.entries(node)) {
    if (key === "$ref" && typeof value === "string") {
      refs.push(value);
      continue;
    }

    collectRefValues(value, refs);
  }

  return refs;
}

/**
 * Finds schema files containing a $ref mentioning the given missing schema filename.
 *
 * @param {string} schemasDirectoryPath
 * @param {string} missingSchemaFileName
 * @returns {Promise<string[]>}
 */
async function findSchemaFilesReferencingMissingFile(
  schemasDirectoryPath,
  missingSchemaFileName
) {
  const allFilePaths = await getAllFilePathsRecursively(schemasDirectoryPath);
  const schemaFilePaths = allFilePaths.filter(isYamlSchemaFile);
  const matchingSchemaFilePaths = [];

  for (const schemaFilePath of schemaFilePaths) {
    try {
      const schema = await readYamlFile(schemaFilePath);
      const refValues = collectRefValues(schema);

      const hasMatchingRef = refValues.some((refValue) =>
        refValue.includes(missingSchemaFileName)
      );

      if (hasMatchingRef) {
        matchingSchemaFilePaths.push(schemaFilePath);
      }
    } catch (error) {
      logger.warn(
        `Could not inspect schema references in "${schemaFilePath}": ${error.message}`
      );
    }
  }

  return matchingSchemaFilePaths;
}

/**
 * Logs additional diagnostics for missing referenced schema files.
 *
 * @param {Error} error
 * @returns {Promise<void>}
 */
async function logMissingReferenceDiagnostics(error) {
  const missingSchemaFileName = extractMissingSchemaFileName(error);

  if (!missingSchemaFileName) {
    return;
  }

  logger.error(`Referenced schema file not found: "${missingSchemaFileName}"`);

  const referencingSchemaFilePaths = await findSchemaFilesReferencingMissingFile(
    SCHEMAS_DIRECTORY_PATH,
    missingSchemaFileName
  );

  if (referencingSchemaFilePaths.length === 0) {
    logger.warn(
      `No schema file containing a $ref to "${missingSchemaFileName}" was found under "${SCHEMAS_DIRECTORY_PATH}".`
    );
    return;
  }

  logger.warn(
    `The following schema file(s) contain a $ref to "${missingSchemaFileName}":`
  );

  for (const referencingSchemaFilePath of referencingSchemaFilePaths) {
    logger.warn(`- ${referencingSchemaFilePath}`);
  }
}

/**
 * Writes the bundled schema as JSON and YAML.
 *
 * @param {object} bundledSchema
 * @param {string} outputDirectoryPath
 * @param {string} modelName
 * @returns {Promise<void>}
 */
async function writeBundledSchemaFiles(
  bundledSchema,
  outputDirectoryPath,
  modelName
) {
  const jsonOutputFilePath = path.join(
    outputDirectoryPath,
    `${modelName}.schema.json`
  );
  const yamlOutputFilePath = path.join(
    outputDirectoryPath,
    `${modelName}.schema.yaml`
  );

  const jsonFileContent = JSON.stringify(bundledSchema, null, 2);
  const yamlFileContent = yaml.dump(bundledSchema, {
    noRefs: true,
    lineWidth: -1,
  });

  await fs.mkdir(outputDirectoryPath, { recursive: true });
  await fs.writeFile(jsonOutputFilePath, jsonFileContent, "utf8");
  await fs.writeFile(yamlOutputFilePath, yamlFileContent, "utf8");
}

/**
 * Publishes one model:
 * - bundles and writes schema artifacts
 *
 * @param {string} modelName
 * @returns {Promise<void>}
 */
async function processModel(modelName) {
  const modelDirectoryPath = path.join(MODELS_DIRECTORY_PATH, modelName);
  const rootSchemaFilePath = path.join(
    modelDirectoryPath,
    `${modelName}.schema.yaml`
  );
  const outputDirectoryPath = path.join(PUBLICATION_DIRECTORY_PATH, modelName);

  if (!(await doesPathExist(rootSchemaFilePath))) {
    logger.error(
      `Missing root schema file for model "${modelName}": ${rootSchemaFilePath}`
    );
    return;
  }

  try {
    logger.info(`Bundling model "${modelName}"`);

    const bundledSchema = await bundleSchema(rootSchemaFilePath);

    await writeBundledSchemaFiles(
      bundledSchema,
      outputDirectoryPath,
      modelName
    );

    logger.info(`Published schema files for model "${modelName}"`);
  } catch (error) {
    logger.error(
      `Failed to publish schema files for model "${modelName}": ${error.message}`
    );
    await logMissingReferenceDiagnostics(error);
  }
}

/**
 * Publishes all model schemas.
 *
 * @returns {Promise<void>}
 */
async function publishModels() {
  if (!(await doesPathExist(MODELS_DIRECTORY_PATH))) {
    throw new Error(
      `Models directory does not exist: ${MODELS_DIRECTORY_PATH}`
    );
  }

  const modelNames = await getModelDirectoryNames(MODELS_DIRECTORY_PATH);

  if (modelNames.length === 0) {
    logger.warn(`No model directories found in "${MODELS_DIRECTORY_PATH}"`);
    return;
  }

  logger.info(`Found ${modelNames.length} model directorie(s) to publish`);

  for (const modelName of modelNames) {
    await processModel(modelName);
  }

  logger.info("Schema publication completed");
}

/**
 * Runs validation and publication.
 *
 * @returns {Promise<void>}
 */
async function run() {
  if (!(await doesPathExist(SCHEMAS_DIRECTORY_PATH))) {
    throw new Error(
      `Schemas directory does not exist: ${SCHEMAS_DIRECTORY_PATH}`
    );
  }

  if (!(await isDirectory(SCHEMAS_DIRECTORY_PATH))) {
    throw new Error(
      `Schemas path is not a directory: ${SCHEMAS_DIRECTORY_PATH}`
    );
  }

  await validateSchemaFiles(SCHEMAS_DIRECTORY_PATH);
  await publishModels();
}

run().catch((error) => {
  logger.error(`Fatal error: ${error.message}`);
  process.exit(1);
});