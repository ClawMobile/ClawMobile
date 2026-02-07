#!/usr/bin/env python3
import json, os, sys, subprocess, shlex

TERMUX_BIN = os.environ.get("CLAW_MOBILE_TERMUX_BIN", "/data/data/com.termux/files/usr/bin")

def which_termux(cmd: str) -> str:
    p = os.path.join(TERMUX_BIN, cmd)
    return p if os.path.exists(p) and os.access(p, os.X_OK) else ""

def run(cmd: list[str]):
    return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

def main():
    payload = {}
    try:
        if not sys.stdin.isatty():
            raw = sys.stdin.read().strip()
            if raw:
                payload = json.loads(raw)
    except Exception:
        payload = {}

    ms = int(payload.get("ms", 450))
    repeat = int(payload.get("repeat", 1))
    gap_ms = int(payload.get("gapMs", 120))
    tts = str(payload.get("tts", "Done"))
    title = str(payload.get("title", "Clawbot"))
    content = str(payload.get("content", "Task completed."))

    ms = max(1, min(ms, 5000))
    repeat = max(1, min(repeat, 5))
    gap_ms = max(0, min(gap_ms, 2000))

    results = []

    # 1) Vibrate
    tv = which_termux("termux-vibrate")
    if tv:
        # -d duration(ms); -f force
        ok = True
        for i in range(repeat):
            r = run([tv, "-d", str(ms), "-f"])
            if r.returncode != 0:
                ok = False
                results.append({"step": "termux-vibrate", "ok": False, "err": r.stderr.strip() or r.stdout.strip()})
                break
        if ok:
            results.append({"step": "termux-vibrate", "ok": True, "repeat": repeat, "ms": ms})
            print(json.dumps({"ok": True, "method": "termux-vibrate", "details": results}, ensure_ascii=False))
            return 0
    else:
        results.append({"step": "termux-vibrate", "ok": False, "err": "not found (install pkg termux-api + Termux:API app)"})

    # 2) Local notification (may also vibrate/sound depending on system)
    tn = which_termux("termux-notification")
    if tn:
        r = run([tn, "--title", title, "--content", content, "--priority", "high"])
        if r.returncode == 0:
            results.append({"step": "termux-notification", "ok": True})
            print(json.dumps({"ok": True, "method": "termux-notification", "details": results}, ensure_ascii=False))
            return 0
        results.append({"step": "termux-notification", "ok": False, "err": r.stderr.strip() or r.stdout.strip()})
    else:
        results.append({"step": "termux-notification", "ok": False, "err": "not found (install pkg termux-api + Termux:API app)"})

    # 3) TTS speak
    tts_cmd = which_termux("termux-tts-speak")
    if tts_cmd:
        r = run([tts_cmd, tts])
        if r.returncode == 0:
            results.append({"step": "termux-tts-speak", "ok": True})
            print(json.dumps({"ok": True, "method": "termux-tts-speak", "details": results}, ensure_ascii=False))
            return 0
        results.append({"step": "termux-tts-speak", "ok": False, "err": r.stderr.strip() or r.stdout.strip()})
    else:
        results.append({"step": "termux-tts-speak", "ok": False, "err": "not found (install pkg termux-api + Termux:API app)"})

    print(json.dumps({"ok": False, "method": None, "details": results}, ensure_ascii=False))
    return 2

if __name__ == "__main__":
    raise SystemExit(main())