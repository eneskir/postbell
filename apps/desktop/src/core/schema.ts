// Validates the JSON Schema subset that tools/contract.mjs allows; returns the first violation as a path and rule.
export type Schema = {
  readonly type?: "object" | "array" | "string" | "integer" | "number" | "boolean";
  readonly const?: string | number | boolean;
  readonly enum?: readonly (string | number)[];
  readonly properties?: { readonly [key: string]: Schema };
  readonly required?: readonly string[];
  readonly additionalProperties?: false;
  readonly items?: Schema;
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
  readonly minimum?: number;
  readonly maximum?: number;
};

export type SchemaViolation = { readonly path: string; readonly rule: string };

const join = (path: string, key: string | number) =>
  typeof key === "number" ? `${path}[${key}]` : path ? `${path}.${key}` : key;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function validate(schema: Schema, value: unknown, path = ""): SchemaViolation | null {
  const fail = (rule: string): SchemaViolation => ({ path: path || "$", rule });
  if (schema.const !== undefined && value !== schema.const) return fail("const");
  if (schema.enum && !schema.enum.includes(value as string | number)) return fail("enum");
  switch (schema.type) {
    case "object": {
      if (!isObject(value)) return fail("type");
      for (const key of schema.required ?? []) if (!(key in value)) return { path: join(path, key), rule: "required" };
      for (const [key, v] of Object.entries(value)) {
        const sub = schema.properties?.[key];
        if (!sub) {
          if (schema.additionalProperties === false) return { path: join(path, key), rule: "additionalProperties" };
          continue;
        }
        const r = validate(sub, v, join(path, key));
        if (r) return r;
      }
      return null;
    }
    case "array": {
      if (!Array.isArray(value)) return fail("type");
      if (schema.minItems !== undefined && value.length < schema.minItems) return fail("minItems");
      if (schema.maxItems !== undefined && value.length > schema.maxItems) return fail("maxItems");
      if (schema.items) {
        for (let i = 0; i < value.length; i++) {
          const r = validate(schema.items, value[i], join(path, i));
          if (r) return r;
        }
      }
      return null;
    }
    case "string": {
      if (typeof value !== "string") return fail("type");
      const length = [...value].length;
      if (schema.minLength !== undefined && length < schema.minLength) return fail("minLength");
      if (schema.maxLength !== undefined && length > schema.maxLength) return fail("maxLength");
      if (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)) return fail("pattern");
      return null;
    }
    case "integer":
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return fail("type");
      if (schema.type === "integer" && !Number.isInteger(value)) return fail("type");
      if (schema.minimum !== undefined && value < schema.minimum) return fail("minimum");
      if (schema.maximum !== undefined && value > schema.maximum) return fail("maximum");
      return null;
    }
    case "boolean":
      return typeof value === "boolean" ? null : fail("type");
    default:
      return null;
  }
}
