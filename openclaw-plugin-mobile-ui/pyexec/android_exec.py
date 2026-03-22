#!/usr/bin/env python3
import argparse
import asyncio
import json
import os
import subprocess
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
    except Exception as exc:
        return False, str(exc)


def selected_serial() -> str:
    return os.environ.get("DROIDRUN_SERIAL") or os.environ.get("ANDROID_SERIAL") or ""


def _adb_base():
    serial = selected_serial()
    base = ["adb"]
    if serial:
        base.extend(["-s", serial])
    return base


def adb_shell(cmd: str) -> str:
    try:
        out = subprocess.check_output(
            _adb_base() + ["shell", cmd],
            stderr=subprocess.STDOUT,
            timeout=ADB_SHELL_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"adb_shell_timeout_after_{ADB_SHELL_TIMEOUT_S:.0f}s") from exc
    return out.decode("utf-8", errors="ignore").strip()


def get_default_ime() -> str:
    return adb_shell("settings get secure default_input_method")


def set_ime(ime_id: str) -> None:
    if ime_id:
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


PORTAL_AUTHORITY = "content://com.droidrun.portal"
ADB_SHELL_TIMEOUT_S = 5.0
PORTAL_QUERY_TIMEOUT_S = 3.0


def _extract_json_block(text: str):
    text = (text or "").strip()
    if not text:
        raise RuntimeError("empty portal response")

    try:
        return json.loads(text)
    except Exception:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        return json.loads(text[start : end + 1])

    raise RuntimeError(f"unable to parse portal json: {text[:300]}")


def _unwrap_portal_payload(payload):
    if isinstance(payload, dict) and payload.get("status") == "error":
        raise RuntimeError(payload.get("error") or "portal_error")

    data = payload.get("data") if isinstance(payload, dict) else payload
    if isinstance(data, str):
        stripped = data.strip()
        if (stripped.startswith("{") and stripped.endswith("}")) or (
            stripped.startswith("[") and stripped.endswith("]")
        ):
            try:
                return json.loads(stripped)
            except Exception:
                return data
    return data


def portal_query(path: str):
    try:
        out = subprocess.check_output(
            _adb_base() + ["shell", "content", "query", "--uri", f"{PORTAL_AUTHORITY}/{path}"],
            stderr=subprocess.STDOUT,
            timeout=PORTAL_QUERY_TIMEOUT_S,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(
            f"portal_query_timeout_after_{PORTAL_QUERY_TIMEOUT_S:.0f}s:{path}"
        ) from exc
    payload = _extract_json_block(out.decode("utf-8", errors="ignore"))
    return _unwrap_portal_payload(payload)


def cmd_health(_args):
    ok_import, err = ensure_droidrun_importable()
    tools_ok = False
    tools_err = None
    driver_ok = False
    driver_err = None

    try:
        import droidrun.tools  # noqa: F401
        tools_ok = True
    except Exception as exc:
        tools_err = str(exc)

    try:
        from droidrun.tools import AndroidDriver  # noqa: F401
        driver_ok = True
    except Exception as exc:
        driver_err = str(exc)

    portal_ok = False
    portal_err = None
    try:
        portal_query("ping")
        portal_ok = True
    except Exception as exc:
        portal_err = str(exc)

    diagnostics = {
        "python": sys.version.split()[0],
        "cwd": os.getcwd(),
        "droidrun_importable": ok_import,
        "droidrun_import_error": err,
        "droidrun_tools_importable": tools_ok,
        "droidrun_tools_import_error": tools_err,
        "droidrun_android_driver_importable": driver_ok,
        "droidrun_android_driver_import_error": driver_err,
        "portal_query_ok": portal_ok,
        "portal_query_error": portal_err,
        "env": {
            "DROIDRUN_SERIAL": os.environ.get("DROIDRUN_SERIAL", ""),
            "ANDROID_SERIAL": os.environ.get("ANDROID_SERIAL", ""),
            "selected_serial": selected_serial(),
            "DROIDRUN_USE_TCP": os.environ.get("DROIDRUN_USE_TCP", ""),
            "DROIDRUN_TCP_PORT": os.environ.get("DROIDRUN_TCP_PORT", ""),
        },
        "time": int(time.time()),
    }

    if ok_import and portal_ok:
        return ok(diagnostics)

    reasons = []
    if not ok_import:
        reasons.append("droidrun_not_importable")
    if not portal_ok:
        reasons.append("portal_unreachable")
    return fail("health_check_failed", {**diagnostics, "reasons": reasons})


def cmd_agent_task(args):
    ok_import, err = ensure_droidrun_importable()
    if not ok_import:
        return fail("droidrun not importable", {"import_error": err})

    goal = (args.goal or "").strip()
    if not goal:
        return fail("goal is required")

    serial = selected_serial() or None
    use_tcp = os.environ.get("DROIDRUN_USE_TCP", "0").lower() in ("1", "true", "yes")

    if args.device_serial:
        serial = args.device_serial
    if args.tcp:
        use_tcp = True

    max_steps = int(args.steps)
    timeout = int(args.timeout)

    async def _run():
        from droidrun import DeviceConfig, DroidAgent
        from droidrun.config_manager import DroidrunConfig

        device_cfg = DeviceConfig(serial=serial, use_tcp=use_tcp)
        cfg = DroidrunConfig(device=device_cfg)

        if getattr(cfg, "agent", None) is not None and hasattr(cfg.agent, "max_steps"):
            cfg.agent.max_steps = max_steps

        provider = os.environ.get("DROIDRUN_PROVIDER", "").strip()
        model = os.environ.get("DROIDRUN_MODEL", "").strip()

        llm = None
        if provider and model:
            load_errs = []
            try:
                from droidrun.agent.utils.llm_picker import load_llm

                llm = load_llm(provider_name=provider, model=model, temperature=0.2)
            except Exception as exc:
                load_errs.append(f"llm_picker: {repr(exc)}")

            if llm is None:
                try:
                    from droidrun.agent.utils.llm import load_llm

                    llm = load_llm(provider_name=provider, model=model, temperature=0.2)
                except Exception as exc:
                    load_errs.append(f"llm: {repr(exc)}")

            if llm is None:
                raise RuntimeError(
                    json.dumps(
                        {
                            "error": "llm_load_failed",
                            "provider": provider,
                            "model": model,
                            "errors": load_errs,
                        },
                        ensure_ascii=False,
                    )
                )

        agent = DroidAgent(goal=goal, config=cfg, llms=llm, timeout=timeout)
        result = await agent.run()

        out = {
            "success": bool(getattr(result, "success", False)),
            "reason": getattr(result, "reason", ""),
            "steps": int(getattr(result, "steps", 0) or 0),
        }
        structured_output = getattr(result, "structured_output", None)
        if structured_output is not None:
            out["structured_output"] = structured_output
        return out

    try:
        with ImeGuard():
            data = asyncio.run(_run())
        return ok(data)
    except Exception as exc:
        message = str(exc)
        try:
            parsed = json.loads(message)
        except Exception:
            parsed = None

        if isinstance(parsed, dict) and parsed.get("error"):
            extra = {k: v for k, v in parsed.items() if k != "error"}
            return fail(parsed["error"], extra or None)

        return fail("agent_task_failed", {"repr": repr(exc)})


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("health")

    agent_parser = sub.add_parser("agent_task")
    agent_parser.add_argument("goal")
    agent_parser.add_argument("--steps", type=int, default=30)
    agent_parser.add_argument("--timeout", type=int, default=1000)
    agent_parser.add_argument("--device-serial", dest="device_serial", default="")
    agent_parser.add_argument("--tcp", action="store_true")

    args = parser.parse_args()

    try:
        if args.cmd == "health":
            return cmd_health(args)
        if args.cmd == "agent_task":
            return cmd_agent_task(args)
        return fail("unknown cmd")
    except KeyboardInterrupt:
        return fail("interrupted", code=130)
    except Exception as exc:
        return fail("exception", {"repr": repr(exc)})


if __name__ == "__main__":
    raise SystemExit(main())
