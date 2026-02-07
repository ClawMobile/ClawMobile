#!/usr/bin/env python3
import argparse
import json
import os
import sys
import time

def ok(data):
    print(json.dumps({"ok": True, "data": data}, ensure_ascii=False))
    return 0

def fail(msg, extra=None, code=1):
    payload = {"ok": False, "error": msg}
    if extra is not None:
        payload["extra"] = extra
    print(json.dumps(payload, ensure_ascii=False))
    return code

def ensure_droidrun_importable():
    try:
        import droidrun  # noqa: F401
        return True, None
    except Exception as e:
        return False, str(e)

def cmd_health(_args):
    ok_import, err = ensure_droidrun_importable()
    return ok({
        "python": sys.version.split()[0],
        "cwd": os.getcwd(),
        "droidrun_importable": ok_import,
        "droidrun_import_error": err,
        "time": int(time.time())
    })

def cmd_screenshot(args):
    ok_import, err = ensure_droidrun_importable()
    if not ok_import:
        return fail("droidrun not importable", {"import_error": err})

    # TODO: 换成你确认过的 droidrun 截图 API
    return ok({"path": args.output or "/tmp/screenshot-placeholder.png", "note": "placeholder implementation"})

def cmd_tap(args):
    ok_import, err = ensure_droidrun_importable()
    if not ok_import:
        return fail("droidrun not importable", {"import_error": err})

    # TODO: 换成你确认过的 droidrun tap API
    return ok({"x": args.x, "y": args.y, "note": "placeholder implementation"})

def cmd_type(args):
    ok_import, err = ensure_droidrun_importable()
    if not ok_import:
        return fail("droidrun not importable", {"import_error": err})

    # TODO: 换成你确认过的 droidrun type API
    return ok({"text": args.text, "note": "placeholder implementation"})

def cmd_swipe(args):
    ok_import, err = ensure_droidrun_importable()
    if not ok_import:
        return fail("droidrun not importable", {"import_error": err})

    # TODO: 换成你确认过的 droidrun swipe API
    return ok({
        "x1": args.x1, "y1": args.y1, "x2": args.x2, "y2": args.y2,
        "duration_ms": args.duration_ms,
        "note": "placeholder implementation"
    })

def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("health")

    ps = sub.add_parser("screenshot")
    ps.add_argument("--output", default="")

    pt = sub.add_parser("tap")
    pt.add_argument("x", type=int)
    pt.add_argument("y", type=int)

    pty = sub.add_parser("type")
    pty.add_argument("text")

    pw = sub.add_parser("swipe")
    pw.add_argument("x1", type=int)
    pw.add_argument("y1", type=int)
    pw.add_argument("x2", type=int)
    pw.add_argument("y2", type=int)
    pw.add_argument("--duration-ms", dest="duration_ms", type=int, default=300)

    args = p.parse_args()

    try:
        if args.cmd == "health":
            return cmd_health(args)
        if args.cmd == "screenshot":
            return cmd_screenshot(args)
        if args.cmd == "tap":
            return cmd_tap(args)
        if args.cmd == "type":
            return cmd_type(args)
        if args.cmd == "swipe":
            return cmd_swipe(args)
        return fail("unknown cmd")
    except Exception as e:
        return fail("exception", {"repr": repr(e)})

if __name__ == "__main__":
    raise SystemExit(main())