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
} from "./tools/android";
import { signalComplete as android_signal_complete } from "./tools/attention";
import {
  adb_devices,
  adb_keyevent,
  adb_ui_dump_xml,
  adb_screenshot,
  adb_tap,
  adb_type,
  adb_swipe,
} from "./backends/adb";
import {
  tx_notify,
  tx_tts,
  tx_toast,
  tx_clipboard_get,
  tx_clipboard_set,
  tx_battery_status,
} from "./backends/termux";
import { android_shell } from "./tools/shell";
import { mobile_capabilities } from "./tools/capabilities";

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
      "Take a screenshot on the Android device (via droidrun or adb).",
      {
        type: "object",
        properties: {
          output: { type: "string" },
          backend: { type: "string", enum: ["auto", "adb", "droidrun"] },
        },
        additionalProperties: false,
      },
      async (args) => android_screenshot(args)
    )
  );

  api.registerTool(
    toolDef(
      "android_tap",
      "Tap at (x,y) on the Android device (via droidrun or adb).",
      {
        type: "object",
        properties: {
          x: { type: "integer" },
          y: { type: "integer" },
          backend: { type: "string", enum: ["auto", "adb", "droidrun"] },
        },
        required: ["x", "y"],
        additionalProperties: false,
      },
      async (args) => android_tap(args)
    )
  );

  api.registerTool(
    toolDef(
      "android_type",
      "Type text into the focused field (via droidrun or adb). Optional index targets a11y element index.",
      {
        type: "object",
        properties: {
          text: { type: "string" },
          index: { type: "integer" },
          clear: { type: "boolean" },
          backend: { type: "string", enum: ["auto", "adb", "droidrun"] },
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
      "Swipe from (x1,y1) to (x2,y2) (via droidrun or adb).",
      {
        type: "object",
        properties: {
          x1: { type: "integer" },
          y1: { type: "integer" },
          x2: { type: "integer" },
          y2: { type: "integer" },
          durationMs: { type: "integer" },
          backend: { type: "string", enum: ["auto", "adb", "droidrun"] },
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
        properties: {},
        additionalProperties: false,
      },
      async () => android_ui_dump()
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

  // ---- completion signal (Termux:API) ----
  api.registerTool(
    toolDef(
      "android_signal_complete",
      "Device-level completion signal (Termux:API vibrate/notification/TTS).",
      {
        type: "object",
        properties: {
          ms: { type: "integer", minimum: 1, maximum: 5000 },
          repeat: { type: "integer", minimum: 1, maximum: 5 },
          gapMs: { type: "integer", minimum: 0, maximum: 2000 },
          tts: { type: "string" },
          title: { type: "string" },
          content: { type: "string" }
        },
        additionalProperties: false
      },
      async (args) => android_signal_complete(args)
    )
  );

  // ---- adb tools ----
  api.registerTool(
    toolDef(
      "adb_devices",
      "List adb devices and connection state.",
      { type: "object", properties: {}, additionalProperties: false },
      async () => adb_devices()
    )
  );

  api.registerTool(
    toolDef(
      "adb_keyevent",
      "Send a key event via adb (HOME/BACK/RECENTS/ENTER or numeric keycode).",
      {
        type: "object",
        properties: {
          key: { type: "string", enum: ["HOME", "BACK", "RECENTS", "ENTER"] },
          keycode: { type: "integer" },
        },
        additionalProperties: false,
        anyOf: [{ required: ["key"] }, { required: ["keycode"] }],
      },
      async (args) => adb_keyevent(args)
    )
  );

  api.registerTool(
    toolDef(
      "adb_ui_dump_xml",
      "Dump UIAutomator XML via adb and return the XML text.",
      { type: "object", properties: { compressed: { type: "boolean" } }, additionalProperties: false },
      async (args) => adb_ui_dump_xml(args)
    )
  );

  api.registerTool(
    toolDef(
      "adb_screenshot",
      "Take a screenshot via adb (returns base64 PNG).",
      { type: "object", properties: {}, additionalProperties: false },
      async () => adb_screenshot()
    )
  );

  api.registerTool(
    toolDef(
      "adb_tap",
      "Tap at (x,y) via adb input.",
      {
        type: "object",
        properties: { x: { type: "integer" }, y: { type: "integer" } },
        required: ["x", "y"],
        additionalProperties: false,
      },
      async (args) => adb_tap(args)
    )
  );

  api.registerTool(
    toolDef(
      "adb_type",
      "Type text via adb input.",
      {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      async (args) => adb_type(args)
    )
  );

  api.registerTool(
    toolDef(
      "adb_swipe",
      "Swipe via adb input.",
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
      async (args) => adb_swipe(args)
    )
  );

  // ---- termux-api tools ----
  api.registerTool(
    toolDef(
      "tx_notify",
      "Send a local Termux notification.",
      {
        type: "object",
        properties: { title: { type: "string" }, content: { type: "string" } },
        required: ["title", "content"],
        additionalProperties: false,
      },
      async (args) => tx_notify(args)
    )
  );

  api.registerTool(
    toolDef(
      "tx_tts",
      "Speak text using Termux TTS.",
      {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      async (args) => tx_tts(args)
    )
  );

  api.registerTool(
    toolDef(
      "tx_toast",
      "Show a Termux toast message.",
      {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      async (args) => tx_toast(args)
    )
  );

  api.registerTool(
    toolDef(
      "tx_clipboard_get",
      "Read text from the Termux clipboard.",
      { type: "object", properties: {}, additionalProperties: false },
      async () => tx_clipboard_get()
    )
  );

  api.registerTool(
    toolDef(
      "tx_clipboard_set",
      "Write text to the Termux clipboard.",
      {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      async (args) => tx_clipboard_set(args)
    )
  );

  api.registerTool(
    toolDef(
      "tx_battery_status",
      "Read battery status from Termux.",
      { type: "object", properties: {}, additionalProperties: false },
      async () => tx_battery_status()
    )
  );

  // ---- fallback shell ----
  api.registerTool(
    toolDef(
      "android_shell",
      "Fallback shell execution via backend: adb | termux | bash (denylists dangerous commands).",
      {
        type: "object",
        properties: {
          backend: { type: "string", enum: ["adb", "termux", "bash"] },
          cmd: { type: "string" },
          timeoutMs: { type: "integer" },
        },
        required: ["backend", "cmd"],
        additionalProperties: false,
      },
      async (args) => android_shell(args)
    )
  );

  api.registerTool(
    toolDef(
      "mobile_capabilities",
      "Return the mobile capability catalog or filter by query.",
      {
        type: "object",
        properties: { query: { type: "string" } },
        additionalProperties: false,
      },
      async (args) => mobile_capabilities(args)
    )
  );

}
