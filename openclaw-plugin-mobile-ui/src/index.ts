import {
  android_health,
  android_screenshot,
  android_tap,
  android_type,
  android_swipe,
  android_task,
} from "./tools/android";

type JsonSchema = Record<string, any>;

function toolDef(
  name: string,
  description: string,
  schema: JsonSchema,
  handler: (input: any) => Promise<any>
) {
  // 兼容不同 OpenClaw 版本/不同工具桥接层：
  // - 有的读 inputSchema
  // - 有的读 schema
  // - 有的转成 OpenAI function.parameters 用 parameters
  return {
    name,
    description,
    inputSchema: schema,
    schema,       // <= 关键：避免 “schema undefined”
    parameters: schema, // <= 关键：有些桥接层用 parameters
    handler,
  };
}

export default function register(api: any) {
  // ---- basic health ----
  api.registerTool?.(
    toolDef(
      "android_health",
      "Check droidrun/python availability (mobile executor health).",
      { type: "object", properties: {}, additionalProperties: false },
      async (_input: any) => android_health()
    )
  );

  // ---- screenshot ----
  api.registerTool?.(
    toolDef(
      "android_screenshot",
      "Take a screenshot on the Android device (via droidrun).",
      {
        type: "object",
        properties: { output: { type: "string" } },
        additionalProperties: false,
      },
      async (input: any) => android_screenshot(input || {})
    )
  );

  // ---- tap ----
  api.registerTool?.(
    toolDef(
      "android_tap",
      "Tap at (x,y) on the Android device (via droidrun).",
      {
        type: "object",
        properties: { x: { type: "integer" }, y: { type: "integer" } },
        required: ["x", "y"],
        additionalProperties: false,
      },
      async (input: any) => android_tap(input)
    )
  );

  // ---- type ----
  api.registerTool?.(
    toolDef(
      "android_type",
      "Type text into the focused field (via droidrun).",
      {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      async (input: any) => android_type(input)
    )
  );

  // ---- swipe ----
  api.registerTool?.(
    toolDef(
      "android_swipe",
      "Swipe from (x1,y1) to (x2,y2) (via droidrun).",
      {
        type: "object",
        properties: {
          x1: { type: "integer" },
          y1: { type: "integer" },
          x2: { type: "integer" },
          y2: { type: "integer" },
          durationMs: { type: "integer" },
        },
        required: ["x1", "y1", "x2", "y2"],
        additionalProperties: false,
      },
      async (input: any) => android_swipe(input)
    )
  );

  // ---- agent task (optional) ----
  api.registerTool?.(
    toolDef(
      "android_task",
      "Run a high-level task using droidrun agent mode (placeholder in v1).",
      {
        type: "object",
        properties: { task: { type: "string" } },
        required: ["task"],
        additionalProperties: false,
      },
      async (input: any) => android_task(input)
    )
  );
}