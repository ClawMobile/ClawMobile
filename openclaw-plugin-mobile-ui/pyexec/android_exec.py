#!/usr/bin/env python3
import argparse
import asyncio
import json
import os
import subprocess
import sys
import time


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
# a11y_tree parsing helpers
# -------------------------
def _iter_nodes(tree):
    """
    Best-effort traversal:
    - If tree is list: iterate elements; recurse into children-like fields
    - If tree is dict: recurse into values that look like children
    """
    if tree is None:
        return
    if isinstance(tree, list):
        for item in tree:
            yield from _iter_nodes(item)
    elif isinstance(tree, dict):
        # Yield this node if it looks like a node
        yield tree
        # common children keys
        for k in ("children", "child", "nodes", "elements"):
            v = tree.get(k)
            if isinstance(v, (list, dict)):
                yield from _iter_nodes(v)


def _to_int(x, default=None):
    try:
        return int(x)
    except Exception:
        return default


def _extract_bounds(node):
    # different portal versions may use different keys
    for k in ("bounds", "rect", "bbox"):
        v = node.get(k)
        if isinstance(v, (list, tuple)) and len(v) == 4:
            return [int(v[0]), int(v[1]), int(v[2]), int(v[3])]
        if isinstance(v, dict):
            # {left, top, right, bottom}
            if all(t in v for t in ("left", "top", "right", "bottom")):
                return [int(v["left"]), int(v["top"]), int(v["right"]), int(v["bottom"])]
    return None


def _simplify_node(node):
    # per community examples, nodes usually carry index/text/etc.  [oai_citation:3‡GitHub](https://github.com/droidrun/droidrun/issues/223?utm_source=chatgpt.com)
    return {
        "index": _to_int(node.get("index")),
        "text": node.get("text") or node.get("label") or "",
        "content_desc": node.get("contentDescription") or node.get("content_desc") or "",
        "resource_id": node.get("resourceId") or node.get("resource_id") or node.get("viewIdResourceName") or "",
        "class": node.get("className") or node.get("class") or node.get("type") or "",
        "clickable": bool(node.get("clickable")) if "clickable" in node else None,
        "enabled": bool(node.get("enabled")) if "enabled" in node else None,
        "focused": bool(node.get("focused")) if "focused" in node else None,
        "bounds": _extract_bounds(node),
    }


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
        fmt, image_bytes = await tools.take_screenshot(hide_overlay=True)
        out_path = (args.output or "").strip()
        if not out_path:
            out_path = f"/tmp/screenshot_{int(time.time())}.png"
        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
        with open(out_path, "wb") as f:
            f.write(image_bytes)
        return {"format": fmt, "path": out_path, "bytes": len(image_bytes)}

    try:
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
        result = await tools.input_text(args.text, index=args.index, clear=args.clear)
        return {"result": result, "index": args.index, "clear": bool(args.clear)}

    try:
        with ImeGuard():
            data = asyncio.run(_run())
        return ok(data)
    except Exception as e:
        return fail("type_failed", {"repr": repr(e)})


def cmd_get_state(_args):
    ok_import, err = ensure_droidrun_importable()
    if not ok_import:
        return fail("droidrun not importable", {"import_error": err})

    async def _run():
        tools = await _make_tools()
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


# ---- NEW: UI a11y dump ----
def cmd_ui_dump(args):
    ok_import, err = ensure_droidrun_importable()
    if not ok_import:
        return fail("droidrun not importable", {"import_error": err})

    async def _run():
        tools = await _make_tools()
        formatted_text, focused_text, a11y_tree, phone_state = await tools.get_state()
        nodes = []
        seen = set()
        for n in _iter_nodes(a11y_tree):
            idx = _to_int(n.get("index"))
            if idx is None:
                continue
            if args.only_clickable and not n.get("clickable"):
                continue
            if idx in seen:
                continue
            seen.add(idx)
            nodes.append(_simplify_node(n))
        nodes.sort(key=lambda x: (x["index"] if x["index"] is not None else 10**9))
        return {
            "count": len(nodes),
            "only_clickable": bool(args.only_clickable),
            "nodes": nodes,
            # keep a bit of context (helpful for the model)
            "focused_text": focused_text,
            "phone_state": phone_state,
        }

    try:
        with ImeGuard():
            data = asyncio.run(_run())
        return ok(data)
    except Exception as e:
        return fail("ui_dump_failed", {"repr": repr(e)})


# ---- NEW: UI tap by index ----
def cmd_ui_tap(args):
    ok_import, err = ensure_droidrun_importable()
    if not ok_import:
        return fail("droidrun not importable", {"import_error": err})

    async def _run():
        tools = await _make_tools()
        # tap_by_index(index) ([docs.droidrun.ai](https://docs.droidrun.ai/sdk/adb-tools))
        success = await tools.tap_by_index(args.index)
        return {"success": bool(success), "index": args.index}

    try:
        with ImeGuard():
            data = asyncio.run(_run())
        return ok(data)
    except Exception as e:
        return fail("ui_tap_failed", {"repr": repr(e)})


# ---- NEW: UI type by index ----
def cmd_ui_type(args):
    ok_import, err = ensure_droidrun_importable()
    if not ok_import:
        return fail("droidrun not importable", {"import_error": err})

    async def _run():
        tools = await _make_tools()
        result = await tools.input_text(args.text, index=args.index, clear=args.clear)
        return {"result": result, "index": args.index, "clear": bool(args.clear)}

    try:
        with ImeGuard():
            data = asyncio.run(_run())
        return ok(data)
    except Exception as e:
        return fail("ui_type_failed", {"repr": repr(e)})


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
    pty.add_argument("--index", type=int, default=-1)
    pty.add_argument("--clear", action="store_true")

    sub.add_parser("get_state")

    # NEW: ui_dump
    pud = sub.add_parser("ui_dump")
    pud.add_argument("--only-clickable", action="store_true")

    # NEW: ui_tap
    put = sub.add_parser("ui_tap")
    put.add_argument("index", type=int)

    # NEW: ui_type
    pui = sub.add_parser("ui_type")
    pui.add_argument("index", type=int)
    pui.add_argument("text")
    pui.add_argument("--clear", action="store_true")

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
        if args.cmd == "get_state":
            return cmd_get_state(args)
        if args.cmd == "ui_dump":
            return cmd_ui_dump(args)
        if args.cmd == "ui_tap":
            return cmd_ui_tap(args)
        if args.cmd == "ui_type":
            return cmd_ui_type(args)
        return fail("unknown cmd")
    except Exception as e:
        return fail("exception", {"repr": repr(e)})


if __name__ == "__main__":
    raise SystemExit(main())