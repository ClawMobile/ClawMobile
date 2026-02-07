#!/usr/bin/env python3
import argparse
import json
import os
import sys
import time
import subprocess
import asyncio


# -------------------------
# JSON helpers
# -------------------------
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


# -------------------------
# ADB IME save/restore
# -------------------------
def adb_shell(cmd: str) -> str:
    out = subprocess.check_output(["adb", "shell", cmd], stderr=subprocess.STDOUT)
    return out.decode("utf-8", errors="ignore").strip()


def get_default_ime() -> str:
    return adb_shell("settings get secure default_input_method")


def set_ime(ime_id: str) -> None:
    if not ime_id:
        return
    adb_shell(f"ime set {ime_id}")


class ImeGuard:
    """Save default IME and restore it on exit."""
    def __init__(self):
        self.prev_ime = ""

    def __enter__(self):
        try:
            self.prev_ime = get_default_ime()
        except Exception:
            self.prev_ime = ""
        return self

    def __exit__(self, exc_type, exc, tb):
        try:
            if self.prev_ime:
                set_ime(self.prev_ime)
        except Exception:
            pass
        return False


# -------------------------
# DroidRun tools factory
# -------------------------
def _tools_kwargs():
    serial = os.environ.get("DROIDRUN_SERIAL") or None
    use_tcp = os.environ.get("DROIDRUN_USE_TCP", "0").lower() in ("1", "true", "yes")
    remote_tcp_port = int(os.environ.get("DROIDRUN_TCP_PORT", "8080"))
    return dict(serial=serial, use_tcp=use_tcp, remote_tcp_port=remote_tcp_port)


async def _make_tools():
    from droidrun.tools import AdbTools
    return AdbTools(**_tools_kwargs())


# -------------------------
# Commands
# -------------------------
def cmd_health(_args):
    ok_import, err = ensure_droidrun_importable()
    return ok({
        "python": sys.version.split()[0],
        "cwd": os.getcwd(),
        "droidrun_importable": ok_import,
        "droidrun_import_error": err,
        "env": {
            "DROIDRUN_SERIAL": os.environ.get("DROIDRUN_SERIAL", ""),
            "DROIDRUN_USE_TCP": os.environ.get("DROIDRUN_USE_TCP", ""),
            "DROIDRUN_TCP_PORT": os.environ.get("DROIDRUN_TCP_PORT", ""),
        },
        "time": int(time.time())
    })


def cmd_screenshot(args):
    ok_import, err = ensure_droidrun_importable()
    if not ok_import:
        return fail("droidrun not importable", {"import_error": err})

    async def _run():
        tools = await _make_tools()
        fmt, image_bytes = await tools.take_screenshot(hide_overlay=True)  #  [oai_citation:1‡docs.droidrun.ai](https://docs.droidrun.ai/sdk/adb-tools)
        out_path = (args.output or "").strip()
        if not out_path:
            out_path = f"/tmp/screenshot_{int(time.time())}.png"
        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
        with open(out_path, "wb") as f:
            f.write(image_bytes)
        return {"format": fmt, "path": out_path, "bytes": len(image_bytes)}

    try:
        # screenshot 也会触发 portal keyboard setup，所以同样做 IME 恢复
        with ImeGuard():
            data = asyncio.run(_run())
        return ok(data)
    except Exception as e:
        return fail("screenshot_failed", {"repr": repr(e)})


def cmd_tap(args):
    ok_import, err = ensure_droidrun_importable()
    if not ok_import:
        return fail("droidrun not importable", {"import_error": err})

    async def _run():
        tools = await _make_tools()
        # 坐标点击：tap_by_coordinates(x, y) -> bool  [oai_citation:2‡docs.droidrun.ai](https://docs.droidrun.ai/sdk/adb-tools)
        success = await tools.tap_by_coordinates(args.x, args.y)
        return {"success": bool(success), "x": args.x, "y": args.y}

    try:
        with ImeGuard():
            data = asyncio.run(_run())
        return ok(data)
    except Exception as e:
        return fail("tap_failed", {"repr": repr(e)})


def cmd_swipe(args):
    ok_import, err = ensure_droidrun_importable()
    if not ok_import:
        return fail("droidrun not importable", {"import_error": err})

    async def _run():
        tools = await _make_tools()
        # swipe(start_x, start_y, end_x, end_y, duration_ms) -> bool  [oai_citation:3‡docs.droidrun.ai](https://docs.droidrun.ai/sdk/adb-tools)
        success = await tools.swipe(args.x1, args.y1, args.x2, args.y2, duration_ms=args.duration_ms)
        return {
            "success": bool(success),
            "x1": args.x1, "y1": args.y1, "x2": args.x2, "y2": args.y2,
            "duration_ms": args.duration_ms,
        }

    try:
        with ImeGuard():
            data = asyncio.run(_run())
        return ok(data)
    except Exception as e:
        return fail("swipe_failed", {"repr": repr(e)})


def cmd_type(args):
    ok_import, err = ensure_droidrun_importable()
    if not ok_import:
        return fail("droidrun not importable", {"import_error": err})

    async def _run():
        tools = await _make_tools()
        # input_text(text, index=-1, clear=False) -> str  [oai_citation:4‡docs.droidrun.ai](https://docs.droidrun.ai/sdk/adb-tools)
        result = await tools.input_text(args.text, index=args.index, clear=args.clear)
        return {"result": result, "index": args.index, "clear": bool(args.clear)}

    try:
        # 输入一定会切 portal keyboard，所以务必恢复
        with ImeGuard():
            data = asyncio.run(_run())
        return ok(data)
    except Exception as e:
        return fail("type_failed", {"repr": repr(e)})


def cmd_back(_args):
    ok_import, err = ensure_droidrun_importable()
    if not ok_import:
        return fail("droidrun not importable", {"import_error": err})

    async def _run():
        tools = await _make_tools()
        result = await tools.back()  #  [oai_citation:5‡docs.droidrun.ai](https://docs.droidrun.ai/sdk/adb-tools)
        return {"result": result}

    try:
        with ImeGuard():
            data = asyncio.run(_run())
        return ok(data)
    except Exception as e:
        return fail("back_failed", {"repr": repr(e)})


def cmd_press_key(args):
    ok_import, err = ensure_droidrun_importable()
    if not ok_import:
        return fail("droidrun not importable", {"import_error": err})

    async def _run():
        tools = await _make_tools()
        result = await tools.press_key(args.keycode)  #  [oai_citation:6‡docs.droidrun.ai](https://docs.droidrun.ai/sdk/adb-tools)
        return {"result": result, "keycode": args.keycode}

    try:
        with ImeGuard():
            data = asyncio.run(_run())
        return ok(data)
    except Exception as e:
        return fail("press_key_failed", {"repr": repr(e)})


def cmd_start_app(args):
    ok_import, err = ensure_droidrun_importable()
    if not ok_import:
        return fail("droidrun not importable", {"import_error": err})

    async def _run():
        tools = await _make_tools()
        result = await tools.start_app(args.package, args.activity)  #  [oai_citation:7‡docs.droidrun.ai](https://docs.droidrun.ai/sdk/adb-tools)
        return {"result": result, "package": args.package, "activity": args.activity or ""}

    try:
        # 启动 app 本身不一定切键盘，但 AdbTools 初始化会 setup keyboard，所以也保护一下
        with ImeGuard():
            data = asyncio.run(_run())
        return ok(data)
    except Exception as e:
        return fail("start_app_failed", {"repr": repr(e)})


def cmd_list_packages(args):
    ok_import, err = ensure_droidrun_importable()
    if not ok_import:
        return fail("droidrun not importable", {"import_error": err})

    async def _run():
        tools = await _make_tools()
        pkgs = await tools.list_packages(include_system_apps=args.include_system)  #  [oai_citation:8‡docs.droidrun.ai](https://docs.droidrun.ai/sdk/adb-tools)
        return {"count": len(pkgs), "packages": pkgs}

    try:
        data = asyncio.run(_run())
        return ok(data)
    except Exception as e:
        return fail("list_packages_failed", {"repr": repr(e)})


def cmd_get_apps(args):
    ok_import, err = ensure_droidrun_importable()
    if not ok_import:
        return fail("droidrun not importable", {"import_error": err})

    async def _run():
        tools = await _make_tools()
        apps = await tools.get_apps(include_system=args.include_system)  #  [oai_citation:9‡docs.droidrun.ai](https://docs.droidrun.ai/sdk/adb-tools)
        return {"count": len(apps), "apps": apps}

    try:
        data = asyncio.run(_run())
        return ok(data)
    except Exception as e:
        return fail("get_apps_failed", {"repr": repr(e)})


def cmd_get_state(_args):
    ok_import, err = ensure_droidrun_importable()
    if not ok_import:
        return fail("droidrun not importable", {"import_error": err})

    async def _run():
        tools = await _make_tools()
        # get_state() 返回 (formatted_text, focused_text, a11y_tree, phone_state)  [oai_citation:10‡docs.droidrun.ai](https://docs.droidrun.ai/sdk/adb-tools)
        formatted_text, focused_text, a11y_tree, phone_state = await tools.get_state()
        return {
            "formatted_text": formatted_text,
            "focused_text": focused_text,
            "a11y_tree": a11y_tree,
            "phone_state": phone_state,
        }

    try:
        data = asyncio.run(_run())
        return ok(data)
    except Exception as e:
        return fail("get_state_failed", {"repr": repr(e)})


# -------------------------
# CLI
# -------------------------
def main():
    p = argparse.ArgumentParser()
    sub = p.add_subparsers(dest="cmd", required=True)

    sub.add_parser("health")

    ps = sub.add_parser("screenshot")
    ps.add_argument("--output", default="")

    pt = sub.add_parser("tap")
    pt.add_argument("x", type=int)
    pt.add_argument("y", type=int)

    pw = sub.add_parser("swipe")
    pw.add_argument("x1", type=int)
    pw.add_argument("y1", type=int)
    pw.add_argument("x2", type=int)
    pw.add_argument("y2", type=int)
    pw.add_argument("--duration-ms", dest="duration_ms", type=int, default=300)

    pty = sub.add_parser("type")
    pty.add_argument("text")
    pty.add_argument("--index", type=int, default=-1)   # -1 表示用当前 focus
    pty.add_argument("--clear", action="store_true")    # 是否清空原文本

    pb = sub.add_parser("back")

    pk = sub.add_parser("press_key")
    pk.add_argument("keycode", type=int)

    pa = sub.add_parser("start_app")
    pa.add_argument("package")
    pa.add_argument("--activity", default=None)

    pl = sub.add_parser("list_packages")
    pl.add_argument("--include-system", action="store_true")

    pg = sub.add_parser("get_apps")
    pg.add_argument("--include-system", action="store_true")

    sub.add_parser("get_state")

    args = p.parse_args()

    try:
        if args.cmd == "health":
            return cmd_health(args)
        if args.cmd == "screenshot":
            return cmd_screenshot(args)
        if args.cmd == "tap":
            return cmd_tap(args)
        if args.cmd == "swipe":
            return cmd_swipe(args)
        if args.cmd == "type":
            return cmd_type(args)
        if args.cmd == "back":
            return cmd_back(args)
        if args.cmd == "press_key":
            return cmd_press_key(args)
        if args.cmd == "start_app":
            return cmd_start_app(args)
        if args.cmd == "list_packages":
            return cmd_list_packages(args)
        if args.cmd == "get_apps":
            return cmd_get_apps(args)
        if args.cmd == "get_state":
            return cmd_get_state(args)
        return fail("unknown cmd")
    except Exception as e:
        return fail("exception", {"repr": repr(e)})


if __name__ == "__main__":
    raise SystemExit(main())