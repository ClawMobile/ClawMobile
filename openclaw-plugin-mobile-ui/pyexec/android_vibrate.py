#!/usr/bin/env python3
import os
import sys
import json
import time
import subprocess


def run(cmd: list[str]) -> tuple[int, str, str]:
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def adb_base() -> list[str]:
    adb = os.environ.get("CLAW_MOBILE_ADB", "adb")
    serial = os.environ.get("DROIDRUN_SERIAL", "").strip()
    if serial:
        return [adb, "-s", serial]
    return [adb]


def vibrate_once(ms: int) -> tuple[bool, str]:
    ms = max(1, min(ms, 60_000))  # 1ms .. 60s safety clamp
    base = adb_base()

    # 1) Preferred on modern Android: cmd vibrator vibrate <ms>
    code, out, err = run(base + ["shell", "cmd", "vibrator", "vibrate", str(ms)])
    if code == 0:
        return True, "cmd vibrator vibrate"

    # 2) Fallback: service call vibrator (method index varies by Android version)
    # Try a couple common variants.
    # Many devices accept: service call vibrator 1 i32 <ms>
    for method in ("1", "2", "3"):
        code, out, err = run(base + ["shell", "service", "call", "vibrator", method, "i32", str(ms)])
        if code == 0:
            # service call prints something like "Result: Parcel(...)" even on success
            return True, f"service call vibrator {method}"

    return False, f"failed: {err or out or 'unknown error'}"


def main() -> int:
    # Input can be JSON via stdin OR argv[1]
    payload = {}
    try:
        if not sys.stdin.isatty():
            raw = sys.stdin.read().strip()
            if raw:
                payload = json.loads(raw)
        elif len(sys.argv) > 1:
            payload = json.loads(sys.argv[1])
    except Exception:
        payload = {}

    ms = int(payload.get("ms", 200))
    repeat = int(payload.get("repeat", 1))
    gap_ms = int(payload.get("gapMs", 120))

    repeat = max(1, min(repeat, 10))
    gap_ms = max(0, min(gap_ms, 5_000))

    results = []
    ok_any = False
    for i in range(repeat):
        ok, how = vibrate_once(ms)
        ok_any = ok_any or ok
        results.append({"ok": ok, "method": how, "ms": ms})
        if i < repeat - 1 and gap_ms > 0:
            time.sleep(gap_ms / 1000.0)

    print(json.dumps(
        {
            "ok": ok_any,
            "repeat": repeat,
            "gapMs": gap_ms,
            "results": results,
            "serial": os.environ.get("DROIDRUN_SERIAL", ""),
        },
        ensure_ascii=False
    ))
    return 0 if ok_any else 2


if __name__ == "__main__":
    raise SystemExit(main())