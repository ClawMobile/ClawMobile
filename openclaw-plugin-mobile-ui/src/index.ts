import {
  android_health,
  android_screenshot,
  android_tap,
  android_type,
  android_swipe,
  android_task,
} from "./tools/android";

export default function register(api: any) {
  // ---- basic health ----
  api.registerTool?.({
    name: "android.health",
    description: "Check droidrun/python availability (mobile executor health).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: async () => android_health(),
  });

  // ---- screenshot ----
  api.registerTool?.({
    name: "android.screenshot",
    description: "Take a screenshot on the Android device (via droidrun).",
    inputSchema: {
      type: "object",
      properties: { output: { type: "string", description: "Optional output path" } },
      additionalProperties: false,
    },
    handler: async (input: any) => android_screenshot(input || {}),
  });

  // ---- tap ----
  api.registerTool?.({
    name: "android.tap",
    description: "Tap at (x,y) on the Android device (via droidrun).",
    inputSchema: {
      type: "object",
      properties: { x: { type: "integer" }, y: { type: "integer" } },
      required: ["x", "y"],
      additionalProperties: false,
    },
    handler: async (input: any) => android_tap(input),
  });

  // ---- type ----
  api.registerTool?.({
    name: "android.type",
    description: "Type text into the focused field (via droidrun).",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string" } },
      required: ["text"],
      additionalProperties: false,
    },
    handler: async (input: any) => android_type(input),
  });

  // ---- swipe ----
  api.registerTool?.({
    name: "android.swipe",
    description: "Swipe from (x1,y1) to (x2,y2) (via droidrun).",
    inputSchema: {
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
    handler: async (input: any) => android_swipe(input),
  });

  // ---- agent task (optional) ----
  api.registerTool?.({
    name: "android.task",
    description: "Run a high-level task using droidrun agent mode (placeholder in v1).",
    inputSchema: {
      type: "object",
      properties: { task: { type: "string" } },
      required: ["task"],
      additionalProperties: false,
    },
    handler: async (input: any) => android_task(input),
  });
}