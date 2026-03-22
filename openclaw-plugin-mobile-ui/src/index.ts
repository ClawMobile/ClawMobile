import {
  android_health,
  android_screenshot,
  android_tap,
  android_type,
  android_swipe,
  android_agent_task,
  android_ui_dump,
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
  // Public plugin surface for OpenClaw.
  // This file is the contract boundary between the OpenClaw runtime and the
  // mobile runtime implementation below.

  // ---- composite mobile runtime tools ----
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
      "Take a screenshot on the Android device (via adb).",
      { type: "object", properties: {}, additionalProperties: false },
      async () => android_screenshot()
    )
  );

  api.registerTool(
    toolDef(
      "android_tap",
      "Tap at (x,y) on the Android device (via adb).",
      {
        type: "object",
        properties: {
          x: { type: "integer" },
          y: { type: "integer" },
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
      "Type text into the currently focused field (via adb).",
      {
        type: "object",
        properties: {
          text: { type: "string" },
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
      "Swipe from (x1,y1) to (x2,y2) (via adb).",
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

  // ---- deterministic observation + DroidRun agent mode ----
  api.registerTool(
    toolDef(
      "android_ui_dump",
      "Dump current UI hierarchy using adb uiautomator XML. This is the default deterministic observation path.",
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

  // ---- device attention / completion ----
  api.registerTool(
    toolDef(
      "android_signal_complete",
      "Device-level completion signal (Termux:API vibrate/toast). Best-effort by default; set wait=true to block until local signals finish.",
      {
        type: "object",
        properties: {
          ms: { type: "integer", minimum: 1, maximum: 5000 },
          title: { type: "string" },
          content: { type: "string" },
          vibrate: { type: "boolean" },
          toast: { type: "boolean" },
          wait: { type: "boolean" }
        },
        additionalProperties: false
      },
      async (args) => android_signal_complete(args)
    )
  );

  // ---- raw adb primitives ----
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
      "Take a screenshot via adb and return the saved PNG path plus image metadata.",
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

  // ---- raw termux primitives ----
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

  // ---- escape hatches / metadata ----
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

}
