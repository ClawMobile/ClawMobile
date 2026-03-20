import { runTermuxCommand, tx_toast } from "../backends/termux";

export async function signalComplete(args?: {
  ms?: number;
  title?: string;
  content?: string;
  vibrate?: boolean;
  toast?: boolean;
  wait?: boolean;
}) {
  const parsedEnvMs = Number(process.env.CLAW_MOBILE_NOTIFY_VIBRATE_MS || 500);
  const envMs = Number.isFinite(parsedEnvMs) ? parsedEnvMs : 500;
  const parsedArgMs = Number(args?.ms);
  const requestedMs = Number.isFinite(parsedArgMs) ? parsedArgMs : envMs;
  const ms = Math.max(1, Math.min(requestedMs, 5000));
  const title = args?.title ?? "ClawMobile";
  const content = args?.content ?? "Task completed.";
  const vibrateEnabled =
    typeof args?.vibrate === "boolean"
      ? args.vibrate
      : String(process.env.CLAW_MOBILE_NOTIFY_VIBRATE || "1").toLowerCase() !== "0";
  const toastEnabled =
    typeof args?.toast === "boolean"
      ? args.toast
      : String(process.env.CLAW_MOBILE_NOTIFY_TOAST || "1").toLowerCase() !== "0";
  const waitForSignal = typeof args?.wait === "boolean" ? args.wait : false;
  const anySignalEnabled = vibrateEnabled || toastEnabled;

  async function runSignals() {
    const details: any[] = [];
    const primarySignals: Promise<{ step: string; ok: boolean; err?: string; ms?: number }>[] = [];

    // Keep the default completion path minimal and concurrent: the user only
    // needs one successful local signal, so vibrate and toast can race together.
    if (vibrateEnabled) {
      primarySignals.push(
        runTermuxCommand("termux-vibrate", ["-d", String(ms), "-f"]).then((v) =>
          v.ok ? { step: "termux-vibrate", ok: true, ms } : { step: "termux-vibrate", ok: false, err: v.stderr || v.stdout }
        )
      );
    }

    if (toastEnabled) {
      const text = title ? `${title}: ${content}` : content;
      primarySignals.push(
        tx_toast({ text }).then((t) =>
          t.ok ? { step: "termux-toast", ok: true } : { step: "termux-toast", ok: false, err: t.stderr || t.stdout }
        )
      );
    }

    details.push(...(await Promise.all(primarySignals)));

    return details;
  }

  if (!anySignalEnabled) {
    return {
      ok: true,
      status: "disabled",
      method: null,
      queued: false,
      details: [{ step: "no-signals-enabled", ok: true }],
    };
  }

  if (!waitForSignal) {
    void runSignals();
    return {
      ok: true,
      status: "queued",
      method: "termux-local",
      queued: true,
      details: [{ step: "background-dispatch", ok: true }],
    };
  }

  const details = await runSignals();
  const ok = details.some((d) => d.ok);
  return {
    ok,
    status: ok ? "delivered" : "failed",
    method: ok ? "termux-local" : null,
    queued: false,
    details,
  };
}
