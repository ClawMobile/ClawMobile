import {
  android_health,
  android_screenshot,
  android_tap,
  android_type,
  android_swipe,
  android_agent_task,
  android_ui_dump,
  android_ui_tap,
  android_ui_type,
  android_ui_find,
  android_ui_tap_find,
  android_ui_type_find,
  android_vibrate,
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
      "android_agent_task",
      "Run a high-level Android task using DroidRun DroidAgent (agent mode).",
      {
        type: "object",
        properties: {
          goal: { type: "string" },
          steps: { type: "integer" },
          timeout: { type: "integer" },
          deviceSerial: { type: "string" },
          tcp: { type: "boolean" }
        },
        required: ["goal"],
        additionalProperties: false
      },
      async (args) => android_agent_task(args)
    )
  );

  api.registerTool(
    toolDef(
      "android_ui_find",
      "Find UI accessibility nodes by text/resource-id/desc/class. Returns ranked candidates with indexes.",
      {
        type: "object",
        properties: {
          textContains: { type: "string" },
          descContains: { type: "string" },
          resourceIdContains: { type: "string" },
          classContains: { type: "string" },
          clickableOnly: { type: "boolean" },
          enabledOnly: { type: "boolean" },
          preferClickable: { type: "boolean" },
          limit: { type: "integer" },
        },
        additionalProperties: false,
      },
      async (args) => android_ui_find(args)
    )
  );

  api.registerTool(
    toolDef(
      "android_ui_tap_find",
      "Find a UI element by text/resource-id/desc/class and tap the best match.",
      {
        type: "object",
        properties: {
          textContains: { type: "string" },
          descContains: { type: "string" },
          resourceIdContains: { type: "string" },
          classContains: { type: "string" },
          clickableOnly: { type: "boolean" },
          enabledOnly: { type: "boolean" },
          limit: { type: "integer" }
        },
        additionalProperties: false
      },
      async (args) => android_ui_tap_find(args)
    )
  );

  api.registerTool(
    toolDef(
      "android_ui_type_find",
      "Find a UI input field and type text into it.",
      {
        type: "object",
        properties: {
          textContains: { type: "string" },
          descContains: { type: "string" },
          resourceIdContains: { type: "string" },
          classContains: { type: "string" },
          enabledOnly: { type: "boolean" },
          limit: { type: "integer" },
          clear: { type: "boolean" },
          text: { type: "string" }
        },
        required: ["text"],
        additionalProperties: false
      },
      async (args) => android_ui_type_find(args)
    )
  );

  api.registerTool?.({
  name: "android_vibrate",
  description: "Trigger a short device vibration as a completion signal (does not depend on notifications).",
  inputSchema: {
    type: "object",
    properties: {
      ms: { type: "integer", minimum: 1, maximum: 60000, description: "Vibration duration in milliseconds." },
      repeat: { type: "integer", minimum: 1, maximum: 10, description: "Number of vibrations." },
      gapMs: { type: "integer", minimum: 0, maximum: 5000, description: "Gap between vibrations in milliseconds." },
    },
    additionalProperties: false,
  },
  handler: async (args: any) => android_vibrate(args),
});

}