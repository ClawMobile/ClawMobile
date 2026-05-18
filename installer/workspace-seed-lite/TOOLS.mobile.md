<!-- CLAWMOBILE_BEGIN -->
# ClawMobile Lite Tools

This runtime provides lightweight Android control from Termux. It detects
available permissions at runtime and unlocks ADB shell tools automatically when
ADB is configured.

DroidRun agent mode is not available in Lite mode. If the compatibility
`android_agent_task` tool is visible, it returns a structured unavailable
result and should not be used for Lite tasks.

## Health / Observation

- `android_health` — reports the current Lite capability stage, backend state,
  and capability booleans.
- `android_screenshot` — takes a screenshot when `screenshot=true`.
- `android_ui_dump` — captures the current UI hierarchy when
  `ui_observe=true`, stores the full XML locally, and returns a compact keyword
  index plus `dump_id`. It omits raw XML by default; use `rawXml=true` only for
  debugging.
- `android_ui_query` — queries local UIAutomator XML and returns matching nodes
  with bounds/centers. If `dumpId` is omitted, it fresh-dumps the current UI and
  caches that XML locally; if `dumpId` is provided, it reuses that cached dump.
  Use it to locate text, content descriptions, resource ids, classes, clickable
  controls, or a specific `nodeId`.
- `android_ocr_dump` — runs local Tesseract OCR on a provided PNG path when
  `ocr=true` / `local_ocr=true`, or on a fresh screenshot when
  `screen_ocr=true`.
- `android_match_text_queries` — runs bounded OCR queries for a target string.
  Requires `ocr=true`; use `screen_ocr=true` when no `path` is supplied.
- `android_resolve_text_queries` — tries OCR text queries in order and returns
  the first selected text match. Requires `ocr=true`; use `screen_ocr=true`
  when no `path` is supplied.
- `adb_ui_dump_xml` — raw UIAutomator XML dump; requires ADB shell.
- `adb_screenshot` — raw screenshot helper; requires ADB shell.

## Android Actions

- `adb_keyevent` — HOME, BACK, RECENTS, ENTER, or numeric keycode; requires
  ADB shell.
- `android_tap` / `adb_tap` — coordinate tap when `ui_input=true`.
- `android_swipe` / `adb_swipe` — coordinate swipe when `ui_input=true`.
- `android_type` / `adb_type` — type into the currently focused field when
  `ui_input=true`.
- `android_shell backend="adb" cmd="..."` — Android shell command runner when
  `android_shell=true`.

## UI XML Lookup Pattern

Use direct query when you already know what to look for:

```json
{"text":"Text","exact":true}
```

Use discovery first when you do not know the available UI terms or need several
queries on the same screen:

1. Call `android_ui_dump` once for the current screen.
2. Read its `keywords` to choose a specific `text`, `contentDesc`,
   `resourceId`, or `className`.
3. Call `android_ui_query` with the same `dumpId` for each related lookup.
4. For a few matches, use the returned rich bounds directly. For many matches,
   use the compact candidate list with label, point, class, resource id, region,
   or `nodeId` to narrow the target.
5. If no match is found, inspect `fallback_keywords` and retry with a better
   query before falling back to screenshot or OCR.

Do not request raw XML for normal grounding. The full XML remains available in
the local UI dump cache for follow-up queries.

## Termux Tools

- `tx_notify`
- `tx_tts`
- `tx_toast`
- `tx_clipboard_get`
- `tx_clipboard_set`
- `tx_battery_status`
- `android_shell backend="termux" cmd="..."` — local Termux shell command
  runner for bounded phone-local checks/actions, including wireless ADB setup
  commands such as `adb pair`, `adb connect`, and `adb devices` before ADB shell
  is available.

Lite mode does not expose `android_shell backend="bash"`.

## Completion

- `android_signal_complete` — local completion signal through Termux:API.
  Use after the final successful user-visible task, not after every
  intermediate tap/swipe.

## Batch Execution

- `clawmobile_skill_run_fast_path` — loads an installed generated skill's
  `generalized_skill.json`, validates required parameters, runs its eligible
  fast path through the deterministic batch executor, and optionally performs
  one final checkpoint plus low-friction feedback. Prefer this for generated
  skills instead of manually expanding their fast-path JSON. Provide required
  skill variables as a top-level `parameters` object, for example
  `parameters: {"title_text":"...","body_text":"..."}`. If an agent is unsure
  about the exact parameter names, call `clawmobile_skill_status` first; do not
  assume the runner lacks parameter support.
- `clawmobile_batch_execute` — executes a small deterministic Lite batch plan
  for generated-skill fast paths. It supports recorded-coordinate taps,
  deterministic text taps, parameter typing, swipes, key events, waits,
  screenshots, UI dump, OCR dump, and simple UI-text assertions. It does not
  run arbitrary code and does not call an LLM.
- `clawmobile_skill_reflect_fast_path_failure` — records the agent's diagnosis
  of a generated-skill fast-path failure and applies one safe, bounded repair
  such as softening an entry UI-text gate or adding better `tap_text`
  candidates. Use it once before falling back to normal stepwise execution when
  the failure is repairable.

Use batch execution only when a generated skill's entry state is plausible,
required parameters are available, and anchors are reliable enough for
recorded-first replay. The batch should stop on structured failure and return
artifacts for self-repair or normal stepwise recovery. If self-repair is used,
retry the generated fast path at most once with the same parameters.

## Demonstration Learning

- `clawmobile_record_start` — starts a human demonstration recording. Requires
  ADB/shell-level access to `getevent`, screenshots, and state sampling.
- `clawmobile_record_stop` — stops the active recording and parses
  `trace.json`.
- `clawmobile_record_parse` — parses an existing recording directory into
  `trace.json`.
- `clawmobile_record_status` — reports the active recorder status.
- `clawmobile_trace_prepare_summary` — prepares a compact trace digest and
  candidate schema for the OpenClaw agent.
- `clawmobile_trace_save_skill_candidate` — validates and saves the agent's
  candidate JSON.
- `clawmobile_skill_candidate_promote` — promotes a validated candidate into a
  generated OpenClaw skill directory.
- `clawmobile_skill_generalize` — creates or refreshes the generalized
  `clawmobile.skill.v2` view used as the primary generated `SKILL.md`.
- `clawmobile_skill_update_from_trace` — merges another validated
  `skill_candidate.json` into an existing generated skill, updating
  `source_traces`, anchor observations, stability, and the primary `SKILL.md`.
- `clawmobile_skill_record_feedback` — records execution success/failure for a
  generated skill and updates its `evolution` counts/history. Generated skills
  should use it when feedback is low-friction, especially after failures,
  partial completions, or informative successful runs. Feedback also extracts
  compact verified contexts and failure patterns for future executions.
- `clawmobile_skill_status` — reads compact generated-skill status, fast-path
  guidance, anchor feedback counts, verified contexts, and failure patterns.
  It omits history, feedback logs, paths, validation, and detailed anchors by
  default; request those fields only when diagnosing a failure.
- `clawmobile_skill_run_fast_path` — executes the generated skill's preferred
  fast path when eligible, then returns a compact batch/final-check result for
  normal recovery if needed.
- `clawmobile_skill_reflect_fast_path_failure` — lets the agent convert a
  failed fast-path attempt into one bounded repair and rerendered generated
  skill before a single retry.

Use the `clawmobile-trace-induction` skill for the full record -> induce ->
promote flow.

Use `clawmobile-policy` only as a reference for complex recovery, high-risk
actions, generated-skill diagnosis, or capability-boundary questions. Routine
UI lookup should follow the direct-query and discovery patterns above without
reading the policy skill first.

## Safety

- Prefer checkpoint verification over re-observing after every low-risk
  UI-changing action.
- When OCR can use an existing screenshot path, pass that path instead of a
  fresh screen capture.
- Do not invent success if a tool returns `ok:false` or
  `error:"capability_unavailable"`.
- If ADB is unauthorized, ask the user to accept the debugging prompt on the
  phone.
- Lite intentionally does not expose the older WeChat-specific visual
  heuristics such as input-box or green-button search; generated skills should
  use recorded anchors, OCR, screenshots, UI dump, and explicit verification.

<!-- CLAWMOBILE_END -->
