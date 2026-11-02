// Generates schema/workflow.schema.json from DEFAULTS and ENUMS, so the schema
// can never drift from what the resolver accepts.

import { DEFAULTS, ENUMS, type Table, type Value } from "./defaults";

type Schema = Record<string, unknown>;

function node(value: Value, key: string): Schema {
  if (Array.isArray(value)) return { type: "array", default: value };
  if (typeof value === "object") return table(value, key);
  const s: Schema = { type: typeof value === "number" ? "number" : typeof value, default: value };
  if (ENUMS[key]) s.enum = ENUMS[key];
  return s;
}

function table(t: Table, prefix: string): Schema {
  const properties = Object.fromEntries(
    Object.entries(t).map(([k, v]) => [k, node(v, prefix ? `${prefix}.${k}` : k)]),
  );
  return { type: "object", additionalProperties: false, properties };
}

export function workflowSchema(): Schema {
  const root = table(DEFAULTS, "");
  (root.properties as Schema).verify = {
    type: "object",
    additionalProperties: {
      type: "object",
      additionalProperties: false,
      properties: { run: { type: "array", items: { type: "string" } }, extends: { type: "string" } },
    },
    properties: { require_review_evidence: { enum: ENUMS["verify.require_review_evidence"] } },
  };
  (root.properties as Schema).checks = { type: "object", additionalProperties: { type: "string" } };
  ((root.properties as Record<string, Schema>).models!.properties as Record<string, Schema>).roles!.additionalProperties = { type: "string" };
  return { $schema: "https://json-schema.org/draft/2020-12/schema", title: "sams-agentic-workflow settings", ...root };
}
