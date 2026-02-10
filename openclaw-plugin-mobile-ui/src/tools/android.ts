import { DroidrunExecutor } from "../droidrun/executor";
import { DroidrunAgent } from "../droidrun/agent";
import { adb_devices, adb_screenshot, adb_tap, adb_type, adb_swipe } from "./adb";
import { tx_notify, tx_tts, tx_vibrate } from "./termux";

export type Mode = "executor" | "agent";

function getMode(): Mode {
  const m = (process.env.CLAW_MOBILE_MODE || "executor").toLowerCase();
  return m === "agent" ? "agent" : "executor";
}

const exec = new DroidrunExecutor();
const agent = new DroidrunAgent();

export async function android_health() {
  return exec.health();
}

export async function android_screenshot(input: { output?: string; backend?: "auto" | "adb" | "droidrun" }) {
  const backend = input?.backend ?? "auto";
  if (backend === "adb") return adb_screenshot();
  if (backend === "droidrun") return exec.screenshot(input?.output);

  const hasAdb = await hasAdbDevice();
  if (hasAdb) {
    const res = await adb_screenshot();
    if ((res as any)?.ok) return res;
  }
  return exec.screenshot(input?.output);
}

export async function android_tap(input: { x: number; y: number; backend?: "auto" | "adb" | "droidrun" }) {
  const backend = input?.backend ?? "auto";
  if (backend === "adb") return adb_tap({ x: input.x, y: input.y });
  if (backend === "droidrun") return exec.tap(input.x, input.y);

  const hasAdb = await hasAdbDevice();
  if (hasAdb) {
    const res = await adb_tap({ x: input.x, y: input.y });
    if ((res as any)?.ok) return res;
  }
  return exec.tap(input.x, input.y);
}

export async function android_type(input: {
  text: string;
  index?: number;
  clear?: boolean;
  backend?: "auto" | "adb" | "droidrun";
}) {
  const backend = input?.backend ?? "auto";
  if (backend === "adb") return adb_type({ text: input.text });
  if (backend === "droidrun") return exec.typeText(input.text, input.index ?? -1, input.clear ?? false);

  const hasAdb = await hasAdbDevice();
  if (hasAdb) {
    const res = await adb_type({ text: input.text });
    if ((res as any)?.ok) return res;
  }
  return exec.typeText(input.text, input.index ?? -1, input.clear ?? false);
}

export async function android_swipe(input: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  durationMs?: number;
  backend?: "auto" | "adb" | "droidrun";
}) {
  const backend = input?.backend ?? "auto";
  if (backend === "adb") return adb_swipe(input);
  if (backend === "droidrun") return exec.swipe(input.x1, input.y1, input.x2, input.y2, input.durationMs ?? 300);

  const hasAdb = await hasAdbDevice();
  if (hasAdb) {
    const res = await adb_swipe(input);
    if ((res as any)?.ok) return res;
  }
  return exec.swipe(input.x1, input.y1, input.x2, input.y2, input.durationMs ?? 300);
}

// ---- NEW: a11y-based ----
export async function android_ui_dump(input: { onlyClickable?: boolean }) {
  return exec.uiDump(input?.onlyClickable ?? true);
}

export async function android_ui_tap(input: { index: number }) {
  return exec.uiTap(input.index);
}

export async function android_ui_type(input: { index: number; text: string; clear?: boolean }) {
  return exec.uiType(input.index, input.text, input.clear ?? false);
}

export async function android_agent_task(input: {
  goal: string;
  steps?: number;
  timeout?: number;
  deviceSerial?: string;
  tcp?: boolean;
}) {
  return agent.runTask(input);
}

export async function android_ui_find(input: {
  textContains?: string;
  descContains?: string;
  resourceIdContains?: string;
  classContains?: string;
  clickableOnly?: boolean;
  enabledOnly?: boolean;
  preferClickable?: boolean;
  limit?: number;
}) {
  return exec.uiFind(input || {});
}

export async function android_ui_tap_find(input: {
  textContains?: string;
  descContains?: string;
  resourceIdContains?: string;
  classContains?: string;
  clickableOnly?: boolean;
  enabledOnly?: boolean;
  limit?: number;
}) {
  return exec.uiTapFind(input || {});
}

export async function android_ui_type_find(input: {
  textContains?: string;
  descContains?: string;
  resourceIdContains?: string;
  classContains?: string;
  enabledOnly?: boolean;
  limit?: number;
  clear?: boolean;
  text: string;
}) {
  return exec.uiTypeFind(input || ({} as any));
}

export async function android_signal_complete(args?: {
  ms?: number;
  repeat?: number;
  gapMs?: number;
  tts?: string;
  title?: string;
  content?: string;
}) {
  const ms = Math.max(1, Math.min(args?.ms ?? 250, 5000));
  const repeat = Math.max(1, Math.min(args?.repeat ?? 2, 5));
  const gapMs = Math.max(0, Math.min(args?.gapMs ?? 120, 2000));
  const tts = args?.tts ?? "Done";
  const title = args?.title ?? "Clawbot";
  const content = args?.content ?? "Task completed.";

  const details: any[] = [];

  const sleep = (n: number) => new Promise((r) => setTimeout(r, n));

  // 1) Vibrate
  let ok = true;
  for (let i = 0; i < repeat; i++) {
    const r = await tx_vibrate({ ms, force: true });
    if (!r.ok) {
      ok = false;
      details.push({ step: "termux-vibrate", ok: false, err: r.stderr || r.stdout });
      break;
    }
    if (i < repeat - 1 && gapMs > 0) await sleep(gapMs);
  }
  if (ok) {
    details.push({ step: "termux-vibrate", ok: true, repeat, ms });
    return { ok: true, method: "termux-vibrate", details };
  }
  if (!details.length) {
    details.push({
      step: "termux-vibrate",
      ok: false,
      err: "not found (install pkg termux-api + Termux:API app)",
    });
  }

  // 2) Notification
  const n = await tx_notify({ title, content });
  if (n.ok) {
    details.push({ step: "termux-notification", ok: true });
    return { ok: true, method: "termux-notification", details };
  }
  details.push({ step: "termux-notification", ok: false, err: n.stderr || n.stdout });

  // 3) TTS
  const t = await tx_tts({ text: tts });
  if (t.ok) {
    details.push({ step: "termux-tts-speak", ok: true });
    return { ok: true, method: "termux-tts-speak", details };
  }
  details.push({ step: "termux-tts-speak", ok: false, err: t.stderr || t.stdout });

  return { ok: false, method: null, details };
}

async function hasAdbDevice() {
  try {
    const res = await adb_devices();
    return Array.isArray((res as any)?.devices) && (res as any).devices.some((d: any) => d?.state === "device");
  } catch {
    return false;
  }
}
