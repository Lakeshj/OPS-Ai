export type McpDynamicProvider = {
  id: string;
  displayName: string;
  authType: string;
  toolCount: number;
};

export type McpInputSchema = {
  type?: string;
  properties?: Record<string, McpSchemaProperty>;
  required?: string[];
};

export type McpSchemaProperty = {
  type?: string;
  title?: string;
  description?: string;
  enum?: string[];
  items?: { type?: string };
  minimum?: number;
  maximum?: number;
};

export type McpDynamicTool = {
  provider: string;
  id: string;
  displayName: string;
  description: string;
  category: string;
  inputSchema: McpInputSchema;
  outputSchema?: McpInputSchema;
  authType: string;
  access: "read" | "write" | "admin";
  risk: "low" | "medium" | "high";
  implemented: boolean;
};

export type McpParamField = {
  name: string;
  title: string;
  type: "string" | "number" | "integer" | "boolean" | "date" | "dateRange" | "array" | "enum";
  description: string;
  required: boolean;
  enumValues?: string[];
  itemType?: string;
  minimum?: number;
  maximum?: number;
};

/** Generic parameter fields from a tool input schema. Not per-tool UI. */
export function fieldsFromInputSchema(schema: McpInputSchema | undefined): McpParamField[] {
  const properties = schema?.properties && typeof schema.properties === "object" ? schema.properties : {};
  const required = new Set(schema?.required || []);
  return Object.entries(properties).map(([name, spec]) => {
    const rawType = spec?.type || "string";
    const type = Array.isArray(spec?.enum) ? "enum" : rawType;
    return {
      name,
      title: spec?.title || name,
      type: type as McpParamField["type"],
      description: spec?.description || "",
      required: required.has(name),
      enumValues: Array.isArray(spec?.enum) ? spec.enum : undefined,
      itemType: spec?.items?.type,
      minimum: spec?.minimum,
      maximum: spec?.maximum,
    };
  });
}
