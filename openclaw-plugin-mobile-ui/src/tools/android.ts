import fs from "fs";
import path from "path";
import { adb_screenshot, adb_tap, adb_type, adb_swipe, adb_ui_dump_xml } from "../backends/adb";
import { android_ocr_dump as backend_ocr_dump } from "../backends/ocr";
import {
  auditEnd,
  auditError,
  auditStart,
} from "../internal/runtime";
import {
  capabilityUnavailable,
  detectMobileCapabilities,
} from "../runtime/mobileCapabilities";
import type { MobileCapabilityName } from "../runtime/mobileCapabilities";
import {
  runBoundedTextQuery,
  runBoundedTokenCoverageQuery,
  summarizeTextMatch,
  type TextMatchPickStrategy,
} from "../internal/text_queries";
import { readPngDimensions } from "../backends/image";
import { ensureUiDumpsDir, truncateString } from "./workspace";
import { signalComplete } from "./attention";
import { buildUiKeywordIndex, queryUiXml, type UiXmlQueryInput } from "./ui_xml";

// Composite mobile runtime wrappers exposed as `android_*`.
// They sit above backend adapters and enforce the Termux runtime capability
// stage before calling ADB, screenshot, UI, or OCR helpers.

const recentUiDumps = new Map<string, { path: string; xml: string; createdAt: number }>();
let latestUiDumpId = "";

function safeDumpId(value: string) {
  return String(value || "").replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 120);
}

function rememberUiDump(xml: string) {
  const dir = ensureUiDumpsDir();
  const id = `uidump_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
  const file = path.join(dir, `${id}.xml`);
  fs.writeFileSync(file, xml);
  recentUiDumps.set(id, { path: file, xml, createdAt: Date.now() });
  latestUiDumpId = id;

  const entries = [...recentUiDumps.entries()].sort((a, b) => b[1].createdAt - a[1].createdAt);
  for (const [oldId] of entries.slice(8)) recentUiDumps.delete(oldId);

  return { id, file };
}

function readRememberedUiDump(dumpId?: string) {
  const requested = safeDumpId(dumpId || latestUiDumpId);
  if (!requested) return null;
  const cached = recentUiDumps.get(requested);
  if (cached) return { id: requested, ...cached };

  const file = path.join(ensureUiDumpsDir(), `${requested}.xml`);
  if (!fs.existsSync(file)) return null;
  const xml = fs.readFileSync(file, "utf8");
  const entry = { path: file, xml, createdAt: Date.now() };
  recentUiDumps.set(requested, entry);
  latestUiDumpId = requested;
  return { id: requested, ...entry };
}

async function requireRuntimeCapability(
  capability: MobileCapabilityName,
  message?: string
) {
  const detected = await detectMobileCapabilities();
  if (detected.capabilities[capability]) return null;
  return capabilityUnavailable(capability, detected, message);
}

export async function android_health() {
  return await detectMobileCapabilities();
}

export async function android_screenshot() {
  const start = Date.now();
  auditStart("android_screenshot", "adb", start);
  try {
    const unavailable = await requireRuntimeCapability(
      "screenshot",
      "Screenshots require an ADB/shell-level backend. Termux-only stage can still run local Termux tools."
    );
    if (unavailable) {
      auditEnd("android_screenshot", start, unavailable, { resolved_backend: "unavailable" });
      return unavailable;
    }

    const res = await adb_screenshot();
    auditEnd("android_screenshot", start, res, { resolved_backend: "adb" });
    return res;
  } catch (error) {
    auditError("android_screenshot", start, error, { backend: "adb" });
    throw error;
  }
}

export async function android_tap(input: { x: number; y: number }) {
  const start = Date.now();
  auditStart("android_tap", "adb", start);
  try {
    const unavailable = await requireRuntimeCapability(
      "ui_input",
      "Screen taps require an ADB/shell-level backend. Configure ADB to unlock UI control."
    );
    if (unavailable) {
      auditEnd("android_tap", start, unavailable, { resolved_backend: "unavailable" });
      return unavailable;
    }

    const res = await adb_tap({ x: input.x, y: input.y });
    auditEnd("android_tap", start, res, { resolved_backend: "adb" });
    return res;
  } catch (error) {
    auditError("android_tap", start, error, { backend: "adb" });
    throw error;
  }
}

type AndroidTypeInput = {
  text: string;
  // Deprecated fields from older callers.
  // We still accept them at runtime so older callers get a structured
  // rejection instead of silently ignoring the request.
  index?: number;
  clear?: boolean;
};

export async function android_type(input: AndroidTypeInput) {
  const start = Date.now();
  auditStart("android_type", "adb", start);
  try {
    if (input.index !== undefined || input.clear !== undefined) {
      const res = {
        ok: false,
        error: "android_type_only_supports_typing_into_the_focused_field",
        extra: {
          unsupported_fields: [
            ...(input.index !== undefined ? ["index"] : []),
            ...(input.clear !== undefined ? ["clear"] : []),
          ],
        },
      };
      auditEnd("android_type", start, res, {
        resolved_backend: "unsupported",
        requested_backend: "adb",
        rejection_reason: "legacy_index_or_clear_not_supported_in_termux_runtime",
      });
      return res;
    }

    const unavailable = await requireRuntimeCapability(
      "ui_input",
      "Typing into the focused Android field requires an ADB/shell-level backend."
    );
    if (unavailable) {
      auditEnd("android_type", start, unavailable, { resolved_backend: "unavailable" });
      return unavailable;
    }

    const res = await adb_type({ text: input.text });
    auditEnd("android_type", start, res, { resolved_backend: "adb" });
    return res;
  } catch (error) {
    auditError("android_type", start, error, { backend: "adb" });
    throw error;
  }
}

export async function android_swipe(input: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  durationMs?: number;
}) {
  const start = Date.now();
  auditStart("android_swipe", "adb", start);
  try {
    const unavailable = await requireRuntimeCapability(
      "ui_input",
      "Screen swipes require an ADB/shell-level backend. Configure ADB to unlock UI control."
    );
    if (unavailable) {
      auditEnd("android_swipe", start, unavailable, { resolved_backend: "unavailable" });
      return unavailable;
    }

    const res = await adb_swipe(input);
    auditEnd("android_swipe", start, res, { resolved_backend: "adb" });
    return res;
  } catch (error) {
    auditError("android_swipe", start, error, { backend: "adb" });
    throw error;
  }
}

// ---- observation + agent wrappers ----
export async function android_ui_dump(input?: { rawXml?: boolean; compressed?: boolean }) {
  const start = Date.now();
  auditStart("android_ui_dump", "adb", start);
  try {
    const unavailable = await requireRuntimeCapability(
      "ui_observe",
      "UI hierarchy dumps require an ADB/shell-level backend. Termux-only stage cannot inspect other app UIs."
    );
    if (unavailable) {
      auditEnd("android_ui_dump", start, unavailable, { resolved_backend: "unavailable" });
      return unavailable;
    }

    const res = await adb_ui_dump_xml({ compressed: input?.compressed, maxOutputBytes: 0 });
    const remembered = res.ok ? rememberUiDump(res.xml || "") : null;
    if (input?.rawXml) {
      const shaped = {
        ok: res.ok,
        code: res.code,
        stderr: res.stderr,
        xml: truncateString(res.xml || ""),
        source: "adb_ui_dump_xml" as const,
        dump_id: remembered?.id || "",
        xml_path: remembered?.file || "",
        ...(!res.ok && res.stdout
          ? { stdout_snip: truncateString(res.stdout) }
          : {}),
      };
      auditEnd("android_ui_dump", start, shaped);
      return shaped;
    }

    const shaped = {
      ok: res.ok,
      code: res.code,
      stderr: res.stderr,
      ...(res.ok
        ? buildUiKeywordIndex(res.xml || "", {
            dumpId: remembered?.id || "",
            xmlPath: remembered?.file || "",
          })
        : {
            source: "adb_ui_dump_xml" as const,
            xml_omitted: true,
          }),
      ...(!res.ok && res.stdout
        ? { stdout_snip: truncateString(res.stdout) }
        : {}),
    };
    auditEnd("android_ui_dump", start, shaped);
    return shaped;
  } catch (error) {
    auditError("android_ui_dump", start, error, { backend: "adb" });
    throw error;
  }
}

export async function android_ui_query(input: UiXmlQueryInput = {}) {
  const start = Date.now();
  auditStart("android_ui_query", "adb", start);
  try {
    const unavailable = await requireRuntimeCapability(
      "ui_observe",
      "UI hierarchy queries require an ADB/shell-level backend. Termux-only stage cannot inspect other app UIs."
    );
    if (unavailable) {
      auditEnd("android_ui_query", start, unavailable, { resolved_backend: "unavailable" });
      return unavailable;
    }

    const cached = readRememberedUiDump(input?.dumpId);
    const dump = cached
      ? { ok: true, code: 0, stdout: "", stderr: "", xml: cached.xml }
      : await adb_ui_dump_xml({ maxOutputBytes: 0 });
    if (!dump.ok) {
      const res = { ok: false, error: dump.stderr || "ui_dump_failed", code: dump.code, stderr: dump.stderr };
      auditEnd("android_ui_query", start, res, { resolved_backend: "adb" });
      return res;
    }

    const remembered = cached
      ? { id: cached.id, file: cached.path, reused: true }
      : { ...rememberUiDump(dump.xml || ""), reused: false };
    const result = {
      ...queryUiXml(dump.xml || "", input),
      dump_id: remembered.id,
      xml_path: remembered.file,
      reused_dump: remembered.reused,
    };
    auditEnd("android_ui_query", start, result, { resolved_backend: "adb" });
    return result;
  } catch (error) {
    auditError("android_ui_query", start, error, { backend: "adb" });
    throw error;
  }
}

function normalizeVisionRegion(
  region?:
    | {
        left?: number;
        top?: number;
        width?: number;
        height?: number;
      }
    | null
) {
  const left = Number(region?.left ?? NaN);
  const top = Number(region?.top ?? NaN);
  const width = Number(region?.width ?? NaN);
  const height = Number(region?.height ?? NaN);
  if (
    !Number.isFinite(left) ||
    !Number.isFinite(top) ||
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(width),
    height: Math.round(height),
  };
}

function normalizeTextMatchPickStrategy(value?: string | null): TextMatchPickStrategy {
  const allowed = new Set<TextMatchPickStrategy>([
    "highest_confidence",
    "bottom_most",
    "top_most",
    "left_most",
    "right_most",
    "largest",
    "widest",
    "tallest",
  ]);
  const normalized = String(value || "").trim().toLowerCase() as TextMatchPickStrategy;
  return allowed.has(normalized) ? normalized : "highest_confidence";
}

async function requireOcrInputCapabilities(input?: { path?: string }) {
  const ocrUnavailable = await requireRuntimeCapability(
    "ocr",
    "OCR requires the optional local tesseract binary. Install it with `CLAWMOBILE_TERMUX_INSTALL_OCR=1 clawmobile install`."
  );
  if (ocrUnavailable) return ocrUnavailable;

  if (!String(input?.path || "").trim()) {
    return requireRuntimeCapability(
      "screenshot",
      "OCR without a provided image path requires screenshot capability from an ADB/shell-level backend."
    );
  }

  return null;
}

async function resolveObservationScreenshot(input?: { path?: string }) {
  const existingPath = String(input?.path || "").trim();
  if (existingPath) {
    try {
      const info = readPngDimensions(existingPath);
      return {
        ok: true as const,
        screenshot: {
          path: existingPath,
          captured: false,
          width: info.width,
          height: info.height,
        },
      };
    } catch (error: any) {
      return {
        ok: false as const,
        error: String(error?.message || "image_dimensions_unavailable"),
      };
    }
  }

  const unavailable = await requireRuntimeCapability(
    "screenshot",
    "OCR text queries without a provided screenshot path require screenshot capability from an ADB/shell-level backend."
  );
  if (unavailable) {
    return { ok: false as const, error: unavailable.message || unavailable.error };
  }

  const shot = await adb_screenshot();
  if (!(shot?.ok && shot.path)) {
    return {
      ok: false as const,
      error: "screenshot_failed",
    };
  }

  return {
    ok: true as const,
    screenshot: {
      path: shot.path,
      captured: true,
      width: shot.width ?? null,
      height: shot.height ?? null,
    },
  };
}

export async function android_ocr_dump(input?: {
  path?: string;
  lang?: string;
  psm?: number;
  timeoutMs?: number;
  minConfidence?: number;
  region?: { left: number; top: number; width: number; height: number };
  scale?: number;
}) {
  const start = Date.now();
  auditStart("android_ocr_dump", "ocr", start);
  try {
    const unavailable = await requireOcrInputCapabilities(input);
    if (unavailable) {
      auditEnd("android_ocr_dump", start, unavailable, { resolved_backend: "unavailable" });
      return unavailable;
    }

    const res = await backend_ocr_dump(input);
    auditEnd("android_ocr_dump", start, res, { resolved_backend: "tesseract" });
    return res;
  } catch (error) {
    auditError("android_ocr_dump", start, error, { backend: "tesseract" });
    throw error;
  }
}

export async function android_match_text_queries(input: {
  text: string;
  path?: string;
  queries: Array<{
    name?: string;
    region?: { left: number; top: number; width: number; height: number };
    scale?: number;
    lang?: string;
    psm?: number;
    minConfidence?: number;
    exact?: boolean;
    ignoreCase?: boolean;
    scope?: "line" | "word" | "all";
  }>;
  matchRegion?: { left: number; top: number; width: number; height: number };
  matchPickStrategy?: TextMatchPickStrategy;
}) {
  const start = Date.now();
  auditStart("android_match_text_queries", "ocr", start);
  try {
    const unavailable = await requireOcrInputCapabilities({ path: input?.path });
    if (unavailable) {
      auditEnd("android_match_text_queries", start, unavailable, { resolved_backend: "unavailable" });
      return unavailable;
    }

    const text = String(input?.text || "");
    if (!text) {
      const res = { ok: false, error: "text_required" };
      auditEnd("android_match_text_queries", start, res, { resolved_backend: "tesseract" });
      return res;
    }

    const screenshotRes = await resolveObservationScreenshot({ path: input?.path });
    if (!screenshotRes.ok) {
      const res = { ok: false, error: screenshotRes.error || "screenshot_unavailable" };
      auditEnd("android_match_text_queries", start, res, { resolved_backend: "tesseract" });
      return res;
    }

    const screenshot = screenshotRes.screenshot;
    const queries = Array.isArray(input?.queries) ? input.queries.filter(Boolean) : [];
    const matchRegion = normalizeVisionRegion(input?.matchRegion || null);
    const matchPickStrategy = normalizeTextMatchPickStrategy(input?.matchPickStrategy);
    const attempts: any[] = [];

    for (const query of queries) {
      const phraseQuery = {
        region: query.region,
        scale: query.scale,
        lang: query.lang,
        psm: query.psm,
        minConfidence: query.minConfidence,
        exact: query?.exact === true,
        ignoreCase: query?.ignoreCase !== false,
        scope: query?.scope || "all",
      };
      const phraseRun = await runBoundedTextQuery({
        path: screenshot.path,
        text,
        query: phraseQuery,
        matchRegion,
        matchPickStrategy,
      });
      const attempt: any = {
        query,
        matchRegion,
        matchPickStrategy,
        phrase: phraseRun.summarized,
      };

      const coverageRun =
        phraseRun.result?.ok === true && phraseRun.selected
          ? null
          : await runBoundedTokenCoverageQuery({
              path: screenshot.path,
              text,
              query: phraseQuery,
              matchRegion,
              matchPickStrategy,
            });
      if (coverageRun?.summarized) {
        attempt.token_coverage = coverageRun.summarized;
      }
      attempts.push(attempt);

      if (phraseRun.result?.ok === true && phraseRun.selected) {
        const res = {
          ok: true,
          method: "android-match-text-queries-v1",
          best: {
            method: `${query?.name || "query"}_phrase_match`,
            selected: summarizeTextMatch(phraseRun.selected),
            result: phraseRun.summarized,
            ocr_query: query,
          },
          attempts,
          screenshot,
          error: "",
        };
        auditEnd("android_match_text_queries", start, res, { resolved_backend: "tesseract" });
        return res;
      }

      if (coverageRun?.result?.ok === true && coverageRun.selected) {
        const res = {
          ok: true,
          method: "android-match-text-queries-v1",
          best: {
            method: `${query?.name || "query"}_token_coverage_match`,
            selected: summarizeTextMatch(coverageRun.selected),
            result: coverageRun.summarized,
            ocr_query: query,
          },
          attempts,
          screenshot,
          error: "",
        };
        auditEnd("android_match_text_queries", start, res, { resolved_backend: "tesseract" });
        return res;
      }
    }

    const res = {
      ok: false,
      method: "android-match-text-queries-v1",
      best: null,
      attempts,
      screenshot,
      error: "text_not_matched_in_queries",
    };
    auditEnd("android_match_text_queries", start, res, { resolved_backend: "tesseract" });
    return res;
  } catch (error) {
    auditError("android_match_text_queries", start, error, { backend: "tesseract" });
    throw error;
  }
}

export async function android_resolve_text_queries(input: {
  path?: string;
  queries: Array<{
    name?: string;
    text: string;
    region?: { left: number; top: number; width: number; height: number };
    scale?: number;
    lang?: string;
    psm?: number;
    minConfidence?: number;
    exact?: boolean;
    ignoreCase?: boolean;
    scope?: "line" | "word" | "all";
  }>;
  matchRegion?: { left: number; top: number; width: number; height: number };
  matchPickStrategy?: TextMatchPickStrategy;
}) {
  const start = Date.now();
  auditStart("android_resolve_text_queries", "ocr", start);
  try {
    const unavailable = await requireOcrInputCapabilities({ path: input?.path });
    if (unavailable) {
      auditEnd("android_resolve_text_queries", start, unavailable, { resolved_backend: "unavailable" });
      return unavailable;
    }

    const queries = Array.isArray(input?.queries) ? input.queries.filter(Boolean) : [];
    if (queries.length === 0) {
      const res = { ok: false, error: "queries_required" };
      auditEnd("android_resolve_text_queries", start, res, { resolved_backend: "tesseract" });
      return res;
    }

    const screenshotRes = await resolveObservationScreenshot({ path: input?.path });
    if (!screenshotRes.ok) {
      const res = { ok: false, error: screenshotRes.error || "screenshot_unavailable" };
      auditEnd("android_resolve_text_queries", start, res, { resolved_backend: "tesseract" });
      return res;
    }

    const screenshot = screenshotRes.screenshot;
    const matchRegion = normalizeVisionRegion(input?.matchRegion || null);
    const matchPickStrategy = normalizeTextMatchPickStrategy(input?.matchPickStrategy);
    const attempts: any[] = [];

    for (const query of queries) {
      const text = String(query?.text || "");
      if (!text) {
        attempts.push({ query, result: { ok: false, error: "text_required" } });
        continue;
      }

      const { result, selected, summarized } = await runBoundedTextQuery({
        path: screenshot.path,
        text,
        query,
        matchRegion,
        matchPickStrategy,
      });

      attempts.push({
        query,
        matchRegion,
        matchPickStrategy,
        result: summarized,
      });

      if (!result?.ok || !selected) continue;
      const res = {
        ok: true,
        method: "android-resolve-text-queries-v1",
        screenshot,
        query,
        best: {
          selected: summarizeTextMatch(selected),
          result: summarized,
        },
        attempts,
        error: "",
      };
      auditEnd("android_resolve_text_queries", start, res, { resolved_backend: "tesseract" });
      return res;
    }

    const res = {
      ok: false,
      method: "android-resolve-text-queries-v1",
      screenshot,
      query: null,
      best: null,
      attempts,
      error: "text_query_not_resolved",
    };
    auditEnd("android_resolve_text_queries", start, res, { resolved_backend: "tesseract" });
    return res;
  } catch (error) {
    auditError("android_resolve_text_queries", start, error, { backend: "tesseract" });
    throw error;
  }
}

export async function android_signal_complete(args?: {
  ms?: number;
  title?: string;
  content?: string;
  vibrate?: boolean;
  toast?: boolean;
  wait?: boolean;
}) {
  return signalComplete(args);
}
