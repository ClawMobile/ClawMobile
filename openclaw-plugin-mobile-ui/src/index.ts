import {
  android_health,
  android_screenshot,
  android_tap,
  android_type,
  android_swipe,
  android_task,
  android_ui_dump,
  android_ui_tap,
  android_ui_type,
} from "./tools/android";

type JsonSchema = Record<string, any>;

function asContent(obj: any) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}

function toolDef(
  name: string,
  description: string,
  schema: JsonSchema,
  fn: (args: any) => Promise<any>
) {
  // 兼容不同版本字段读取
  return {
    name,
    description,
    schema,
    inputSchema: schema,
    parameters: schema,
    async execute(_ctx: any, args: any) {
      return asContent(await fn(args ?? {}));
    },
  };
}

export default function register(api: any) {
  api.registerTool(
    toolDef(
      "android_health",
      "Check droidrun/python availability (mobile executor health).",
      { type: "object", properties: {}, additionalProperties: false },
      async () => android_health()
    )
  );

  api.registerTool(
    toolDef(
      "android_screenshot",
      "Take a screenshot on the Android device (via droidrun).",
      {
        type: "object",
        properties: { output: { type: "string" } },
        additionalProperties: false,
      },
      async (args) => android_screenshot(args)
    )
  );

  api.registerTool(
    toolDef(
      "android_tap",
      "Tap at (x,y) on the Android device (via droidrun).",
      {
        type: "object",
        properties: { x: { type: "integer" }, y: { type: "integer" } },
        required: ["x", "y"],
        additionalProperties: false,
      },
      async (args) => android_tap(args)
    )
  );

  api.registerTool(
    toolDef(
      "android_type",
      "Type text into the focused field (via droidrun). Optional index targets a11y element index.",
      {
        type: "object",
        properties: {
          text: { type: "string" },
          index: { type: "integer" },
          clear: { type: "boolean" },
        },
        required: ["text"],
        additionalProperties: false,
      },
      async (args) => android_type(args)
    )
  );

  api.registerTool(
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
      async (args) => android_swipe(args)
    )
  );

  // ---- NEW: a11y-based tools ----
  api.registerTool(
    toolDef(
      "android_ui_dump",
      "Dump current UI accessibility nodes (a11y). Returns a list with indexes you can tap/type.",
      {
        type: "object",
        properties: { onlyClickable: { type: "boolean" } },
        additionalProperties: false,
      },
      async (args) => android_ui_dump(args)
    )
  );

  api.registerTool(
    toolDef(
      "android_ui_tap",
      "Tap an element by accessibility index (stable across screen sizes vs coordinates).",
      {
        type: "object",
        properties: { index: { type: "integer" } },
        required: ["index"],
        additionalProperties: false,
      },
      async (args) => android_ui_tap(args)
    )
  );

  api.registerTool(
    toolDef(
      "android_ui_type",
      "Type text into an element by accessibility index.",
      {
        type: "object",
        properties: {
          index: { type: "integer" },
          text: { type: "string" },
          clear: { type: "boolean" },
        },
        required: ["index", "text"],
        additionalProperties: false,
      },
      async (args) => android_ui_type(args)
    )
  );

  api.registerTool(
    toolDef(
      "android_task",
      "Run a high-level task using droidrun agent mode (placeholder).",
      {
        type: "object",
        properties: { task: { type: "string" } },
        required: ["task"],
        additionalProperties: false,
      },
      async (args) => android_task(args)
    )
  );
}