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

def _norm(s: str) -> str:
    return (s or "").strip().lower()

def _contains(hay: str, needle: str) -> bool:
    hay = _norm(hay)
    needle = _norm(needle)
    return bool(needle) and needle in hay

def _score_match(node_s, query):
    """
    node_s: simplified node dict
    query: dict of filters
    returns (matched: bool, score: int, reasons: list[str])
    """
    reasons = []
    score = 0

    text = node_s.get("text", "")
    desc = node_s.get("content_desc", "")
    rid = node_s.get("resource_id", "")
    cls = node_s.get("class", "")

    # hard filters
    if query.get("clickableOnly") and node_s.get("clickable") is not True:
        return False, 0, ["not_clickable"]
    if query.get("enabledOnly") and node_s.get("enabled") is not True:
        return False, 0, ["not_enabled"]

    # soft matches add score
    tc = query.get("textContains") or ""
    if tc:
        if _contains(text, tc):
            score += 50
            reasons.append("textContains")
        else:
            return False, 0, ["text_miss"]

    dc = query.get("descContains") or ""
    if dc:
        if _contains(desc, dc):
            score += 40
            reasons.append("descContains")
        else:
            return False, 0, ["desc_miss"]

    rc = query.get("resourceIdContains") or ""
    if rc:
        if _contains(rid, rc):
            score += 80
            reasons.append("resourceIdContains")
        else:
            return False, 0, ["resource_id_miss"]

    cc = query.get("classContains") or ""
    if cc:
        if _contains(cls, cc):
            score += 20
            reasons.append("classContains")
        else:
            return False, 0, ["class_miss"]

    # preference boosts
    if query.get("preferClickable") and node_s.get("clickable") is True:
        score += 10
        reasons.append("preferClickable+")
    if node_s.get("focused") is True:
        score += 5
        reasons.append("focused+")

    # tiny bias for having bounds
    if node_s.get("bounds"):
        score += 1

    return True, score, reasons

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

def cmd_ui_find(args):
    ok_import, err = ensure_droidrun_importable()
    if not ok_import:
        return fail("droidrun not importable", {"import_error": err})

    query = {
        "textContains": args.text_contains or "",
        "descContains": args.desc_contains or "",
        "resourceIdContains": args.resource_id_contains or "",
        "classContains": args.class_contains or "",
        "clickableOnly": bool(args.clickable_only),
        "enabledOnly": bool(args.enabled_only),
        "preferClickable": bool(args.prefer_clickable),
        "limit": int(args.limit),
    }

    async def _run():
        tools = await _make_tools()
        _formatted_text, focused_text, a11y_tree, phone_state = await tools.get_state()

        nodes = []
        seen = set()
        for n in _iter_nodes(a11y_tree):
            idx = _to_int(n.get("index"))
            if idx is None or idx in seen:
                continue
            seen.add(idx)

            sn = _simplify_node(n)
            matched, score, reasons = _score_match(sn, query)
            if not matched:
                continue

            sn["score"] = score
            sn["reasons"] = reasons
            nodes.append(sn)

        nodes.sort(key=lambda x: (-int(x.get("score", 0)), x.get("index", 10**9)))
        nodes = nodes[: query["limit"]]

        return {
            "query": query,
            "count": len(nodes),
            "nodes": nodes,
            "focused_text": focused_text,
            "phone_state": phone_state,
        }

    try:
        # get_state 会触发 AdbTools 初始化，仍然做 IME guard
        with ImeGuard():
            data = asyncio.run(_run())
        return ok(data)
    except Exception as e:
        return fail("ui_find_failed", {"repr": repr(e)})

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

def cmd_ui_tap_find(args):
    ok_import, err = ensure_droidrun_importable()
    if not ok_import:
        return fail("droidrun not importable", {"import_error": err})

    query = {
        "textContains": args.text_contains or "",
        "descContains": args.desc_contains or "",
        "resourceIdContains": args.resource_id_contains or "",
        "classContains": args.class_contains or "",
        "clickableOnly": bool(args.clickable_only),
        "enabledOnly": bool(args.enabled_only),
        "preferClickable": True,  # tap 默认偏好 clickable
        "limit": int(args.limit),
    }

    async def _run():
        tools = await _make_tools()
        _formatted_text, focused_text, a11y_tree, phone_state = await tools.get_state()

        nodes = []
        seen = set()
        for n in _iter_nodes(a11y_tree):
            idx = _to_int(n.get("index"))
            if idx is None or idx in seen:
                continue
            seen.add(idx)

            sn = _simplify_node(n)
            matched, score, reasons = _score_match(sn, query)
            if not matched:
                continue
            sn["score"] = score
            sn["reasons"] = reasons
            nodes.append(sn)

        nodes.sort(key=lambda x: (-int(x.get("score", 0)), x.get("index", 10**9)))
        nodes = nodes[: query["limit"]]

        if not nodes:
            return {"success": False, "reason": "no_match", "query": query, "focused_text": focused_text, "phone_state": phone_state}

        top = nodes[0]
        idx = int(top["index"])

        success = await tools.tap_by_index(idx)
        return {
            "success": bool(success),
            "tapped_index": idx,
            "candidate": top,
            "alternates": nodes[1:],
            "query": query,
        }

    try:
        with ImeGuard():
            data = asyncio.run(_run())
        return ok(data)
    except Exception as e:
        return fail("ui_tap_find_failed", {"repr": repr(e)})
    
def cmd_ui_type_find(args):
    ok_import, err = ensure_droidrun_importable()
    if not ok_import:
        return fail("droidrun not importable", {"import_error": err})

    query = {
        "textContains": args.text_contains or "",
        "descContains": args.desc_contains or "",
        "resourceIdContains": args.resource_id_contains or "",
        "classContains": args.class_contains or "",
        "clickableOnly": False,     # 输入框不一定 clickable
        "enabledOnly": bool(args.enabled_only),
        "preferClickable": False,
        "limit": int(args.limit),
    }

    async def _run():
        tools = await _make_tools()
        _formatted_text, focused_text, a11y_tree, phone_state = await tools.get_state()

        nodes = []
        seen = set()
        for n in _iter_nodes(a11y_tree):
            idx = _to_int(n.get("index"))
            if idx is None or idx in seen:
                continue
            seen.add(idx)

            sn = _simplify_node(n)
            matched, score, reasons = _score_match(sn, query)
            if not matched:
                continue
            sn["score"] = score
            sn["reasons"] = reasons
            nodes.append(sn)

        nodes.sort(key=lambda x: (-int(x.get("score", 0)), x.get("index", 10**9)))
        nodes = nodes[: query["limit"]]

        if not nodes:
            return {"success": False, "reason": "no_match", "query": query, "focused_text": focused_text, "phone_state": phone_state}

        top = nodes[0]
        idx = int(top["index"])

        # 可选：先 tap 聚焦，再输入
        await tools.tap_by_index(idx)
        result = await tools.input_text(args.text, index=idx, clear=args.clear)

        return {
            "success": True,
            "typed_index": idx,
            "result": result,
            "candidate": top,
            "alternates": nodes[1:],
            "query": query,
            "text_len": len(args.text or ""),
            "clear": bool(args.clear),
        }

    try:
        with ImeGuard():
            data = asyncio.run(_run())
        return ok(data)
    except Exception as e:
        return fail("ui_type_find_failed", {"repr": repr(e)})

def cmd_agent_task(args):
    ok_import, err = ensure_droidrun_importable()
    if not ok_import:
        return fail("droidrun not importable", {"import_error": err})

    goal = (args.goal or "").strip()
    if not goal:
        return fail("goal is required")

    serial = os.environ.get("DROIDRUN_SERIAL") or None
    use_tcp = os.environ.get("DROIDRUN_USE_TCP", "0").lower() in ("1", "true", "yes")

    if args.device_serial:
        serial = args.device_serial
    if args.tcp:
        use_tcp = True

    max_steps = int(args.steps)
    timeout = int(args.timeout)

    async def _run():
        from droidrun import DroidAgent, DeviceConfig
        from droidrun.config_manager import DroidrunConfig

        device_cfg = DeviceConfig(serial=serial, use_tcp=use_tcp)
        cfg = DroidrunConfig(device=device_cfg)

        # best-effort set max_steps if this version exposes agent config
        if getattr(cfg, "agent", None) is not None and hasattr(cfg.agent, "max_steps"):
            cfg.agent.max_steps = max_steps

        # agent = DroidAgent(goal=goal, config=cfg, timeout=timeout)
        # result = await agent.run()

        provider = os.environ.get("DROIDRUN_PROVIDER", "").strip()
        model = os.environ.get("DROIDRUN_MODEL", "").strip()

        llm = None
        if provider and model:
            # v2 docs show load_llm(provider_name=..., model=...)
            load_errs = []
            try:
                from droidrun.agent.utils.llm_picker import load_llm
                llm = load_llm(provider_name=provider, model=model, temperature=0.2)
            except Exception as e:
                load_errs.append(f"llm_picker: {repr(e)}")

            if llm is None:
                try:
                    from droidrun.agent.utils.llm import load_llm  # alt path in some versions
                    llm = load_llm(provider_name=provider, model=model, temperature=0.2)
                except Exception as e:
                    load_errs.append(f"llm: {repr(e)}")

            if llm is None:
                return fail("llm_load_failed", {"provider": provider, "model": model, "errors": load_errs})

        agent = DroidAgent(goal=goal, config=cfg, llms=llm, timeout=timeout)
        result = await agent.run()


        out = {
            "success": bool(getattr(result, "success", False)),
            "reason": getattr(result, "reason", ""),
            "steps": int(getattr(result, "steps", 0) or 0),
        }
        so = getattr(result, "structured_output", None)
        if so is not None:
            out["structured_output"] = so
        return out

    try:
        with ImeGuard():
            data = asyncio.run(_run())
        return ok(data)
    except Exception as e:
        return fail("agent_task_failed", {"repr": repr(e)})
    
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

    # NEW: ui_find
    puf = sub.add_parser("ui_find")
    puf.add_argument("--text-contains", dest="text_contains", default="")
    puf.add_argument("--desc-contains", dest="desc_contains", default="")
    puf.add_argument("--resource-id-contains", dest="resource_id_contains", default="")
    puf.add_argument("--class-contains", dest="class_contains", default="")
    puf.add_argument("--clickable-only", action="store_true")
    puf.add_argument("--enabled-only", action="store_true")
    puf.add_argument("--prefer-clickable", action="store_true")
    puf.add_argument("--limit", type=int, default=8)

    # NEW: ui_tap_find
    putf = sub.add_parser("ui_tap_find")
    putf.add_argument("--text-contains", dest="text_contains", default="")
    putf.add_argument("--desc-contains", dest="desc_contains", default="")
    putf.add_argument("--resource-id-contains", dest="resource_id_contains", default="")
    putf.add_argument("--class-contains", dest="class_contains", default="")
    putf.add_argument("--clickable-only", action="store_true")
    putf.add_argument("--enabled-only", action="store_true")
    putf.add_argument("--limit", type=int, default=8)

    # NEW: ui_type_find
    puif = sub.add_parser("ui_type_find")
    puif.add_argument("--text-contains", dest="text_contains", default="")
    puif.add_argument("--desc-contains", dest="desc_contains", default="")
    puif.add_argument("--resource-id-contains", dest="resource_id_contains", default="")
    puif.add_argument("--class-contains", dest="class_contains", default="")
    puif.add_argument("--enabled-only", action="store_true")
    puif.add_argument("--limit", type=int, default=8)
    puif.add_argument("--clear", action="store_true")
    puif.add_argument("text")

    pag = sub.add_parser("agent_task")
    pag.add_argument("goal")
    pag.add_argument("--steps", type=int, default=30)
    pag.add_argument("--timeout", type=int, default=1000)
    pag.add_argument("--device-serial", dest="device_serial", default="")
    pag.add_argument("--tcp", action="store_true")

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
        if args.cmd == "ui_find":
            return cmd_ui_find(args)
        if args.cmd == "ui_tap_find":
            return cmd_ui_tap_find(args)
        if args.cmd == "ui_type_find":
            return cmd_ui_type_find(args)
        if args.cmd == "agent_task":
            return cmd_agent_task(args)
        return fail("unknown cmd")
    except Exception as e:
        return fail("exception", {"repr": repr(e)})


if __name__ == "__main__":
    raise SystemExit(main())
