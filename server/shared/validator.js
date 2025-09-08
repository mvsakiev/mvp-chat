import Ajv from "ajv";
import addFormats from "ajv-formats";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

function loadSchema(file) {
  const p = path.join(__dirname, "..", "schemas", file);
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

const TutorInput = loadSchema("TutorInput.schema.json");
const NormalizeResponse = loadSchema("NormalizeResponse.schema.json");
const ChatResponse = loadSchema("ChatResponse.schema.json");

ajv.addSchema(TutorInput, "TutorInput");
ajv.addSchema(NormalizeResponse, "NormalizeResponse");
ajv.addSchema(ChatResponse, "ChatResponse");

export function validateOrThrow(schemaId, data) {
  const validate = ajv.getSchema(schemaId);
  if (!validate) throw new Error(`Schema not found: ${schemaId}`);
  const ok = validate(data);
  if (!ok) {
    const msg = ajv.errorsText(validate.errors, { separator: "\n" });
    const err = new Error(`Schema validation failed for ${schemaId}:\n${msg}`);
    err.details = validate.errors;
    throw err;
  }
  return true;
}
