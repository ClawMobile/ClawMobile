import fs from "fs";
import { spawn } from "child_process";
import { adb_screenshot } from "./adb";
import {
  mapPreparedBoundsToSource,
  preparePngRegionForOcr,
  readPngDimensions,
  type NormalizedVisionRegion,
  type VisionRegionInput,
} from "./image";
import { truncateString } from "../tools/workspace";

const DEFAULT_TESSERACT_TIMEOUT_MS = 60_000;
const DEFAULT_OCR_LANG = process.env.CLAW_MOBILE_OCR_LANG || "eng";
const DEFAULT_OCR_PSM = 11;
const DEFAULT_MIN_CONFIDENCE = 30;
const MAX_OCR_LINES = 200;

type Bounds = {
  left: number;
  top: number;
  width: number;
  height: number;
  right: number;
  bottom: number;
  centerX: number;
  centerY: number;
};

type OcrWord = Bounds & {
  text: string;
  confidence: number;
  page: number;
  block: number;
  paragraph: number;
  line: number;
  word: number;
};

type OcrLine = Bounds & {
  text: string;
  confidence: number;
  page: number;
  block: number;
  paragraph: number;
  line: number;
  wordCount: number;
};

type OcrTsvResult = {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
};

type OcrAnalysis = {
  ok: true;
  engine: "tesseract";
  lang: string;
  psm: number;
  minConfidence: number;
  path: string;
  captured: boolean;
  width: number | null;
  height: number | null;
  region: NormalizedVisionRegion | null;
  scale: number;
  words: OcrWord[];
  lines: OcrLine[];
  stderr_snip: string;
} | {
  ok: false;
  error: string;
  path: string;
  captured: boolean;
  width: number | null;
  height: number | null;
  region: NormalizedVisionRegion | null;
  scale: number;
  engine: "tesseract";
  code?: number;
  stderr?: string;
  stdout_snip?: string;
};

type ResolveImageResult =
  | {
      ok: true;
      path: string;
      captured: boolean;
      width: number | null;
      height: number | null;
    }
  | {
      ok: false;
      error: string;
      path: string;
      captured: boolean;
      width: number | null;
      height: number | null;
    };

type OcrMatch = OcrLine | OcrWord;

type OcrFindTextSuccess = {
  ok: true;
  engine: "tesseract";
  text: string;
  exact: boolean;
  ignoreCase: boolean;
  scope: "line" | "word" | "all";
  path: string;
  captured: boolean;
  width: number | null;
  height: number | null;
  region: NormalizedVisionRegion | null;
  scale: number;
  matchCount: number;
  matches: OcrMatch[];
  selected: OcrMatch | null;
  stderr_snip: string;
};

type OcrFindTextFailure =
  | Extract<OcrAnalysis, { ok: false }>
  | { ok: false; error: "text_required" };

type OcrFindTextResult = OcrFindTextSuccess | OcrFindTextFailure;

function clampInteger(value: unknown, fallback: number, min: number, max: number) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.trunc(num), min), max);
}

function normalizeText(text: string, ignoreCase: boolean) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  return ignoreCase ? normalized.toLowerCase() : normalized;
}

function buildBounds(left: number, top: number, width: number, height: number): Bounds {
  const right = left + width;
  const bottom = top + height;
  return {
    left,
    top,
    width,
    height,
    right,
    bottom,
    centerX: Math.round(left + width / 2),
    centerY: Math.round(top + height / 2),
  };
}

function resolveRequestedScale(value: unknown) {
  return clampInteger(value, 1, 1, 8);
}

function runTesseractTsv(
  imagePath: string,
  input?: { lang?: string; psm?: number; timeoutMs?: number }
): Promise<OcrTsvResult> {
  return new Promise((resolve) => {
    const lang = String(input?.lang || DEFAULT_OCR_LANG).trim() || DEFAULT_OCR_LANG;
    const psm = clampInteger(input?.psm, DEFAULT_OCR_PSM, 0, 13);
    const timeoutMs = clampInteger(
      input?.timeoutMs,
      DEFAULT_TESSERACT_TIMEOUT_MS,
      1_000,
      300_000
    );

    const args = [imagePath, "stdout", "--psm", String(psm), "-l", lang, "tsv"];
    const p = spawn("tesseract", args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let done = false;

    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        p.kill("SIGKILL");
      } catch {}
      resolve({ ok: false, code: -1, stdout, stderr: stderr || "timeout" });
    }, timeoutMs);

    p.on("error", (error: any) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const msg =
        error?.code === "ENOENT"
          ? "tesseract not found in PATH"
          : String(error?.message || error || "spawn failed");
      resolve({ ok: false, code: -1, stdout, stderr: msg });
    });

    p.stdout.on("data", (d) => (stdout += d.toString()));
    p.stderr.on("data", (d) => (stderr += d.toString()));

    p.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        code: typeof code === "number" ? code : -1,
        stdout,
        stderr,
      });
    });
  });
}

function parseOcrWords(tsv: string, minConfidence: number): OcrWord[] {
  const lines = String(tsv || "")
    .split(/\r?\n/)
    .filter(Boolean);
  if (lines.length < 2) return [];

  const header = lines[0].split("\t");
  const indexOf = (name: string) => header.indexOf(name);
  const idx = {
    text: indexOf("text"),
    conf: indexOf("conf"),
    left: indexOf("left"),
    top: indexOf("top"),
    width: indexOf("width"),
    height: indexOf("height"),
    page: indexOf("page_num"),
    block: indexOf("block_num"),
    paragraph: indexOf("par_num"),
    line: indexOf("line_num"),
    word: indexOf("word_num"),
  };

  const words: OcrWord[] = [];
  for (const rawLine of lines.slice(1)) {
    const cols = rawLine.split("\t");
    const text = String(cols[idx.text] || "").trim();
    const conf = Number(cols[idx.conf] || "-1");
    const left = Number(cols[idx.left] || "0");
    const top = Number(cols[idx.top] || "0");
    const width = Number(cols[idx.width] || "0");
    const height = Number(cols[idx.height] || "0");

    if (!text || !Number.isFinite(conf) || conf < minConfidence) continue;
    if (![left, top, width, height].every(Number.isFinite)) continue;
    if (width <= 0 || height <= 0) continue;

    words.push({
      text,
      confidence: conf,
      page: Number(cols[idx.page] || "0"),
      block: Number(cols[idx.block] || "0"),
      paragraph: Number(cols[idx.paragraph] || "0"),
      line: Number(cols[idx.line] || "0"),
      word: Number(cols[idx.word] || "0"),
      ...buildBounds(left, top, width, height),
    });
  }

  return words;
}

function buildOcrLines(words: OcrWord[]): OcrLine[] {
  const groups = new Map<string, OcrWord[]>();
  for (const word of words) {
    const key = [word.page, word.block, word.paragraph, word.line].join(":");
    const existing = groups.get(key);
    if (existing) {
      existing.push(word);
    } else {
      groups.set(key, [word]);
    }
  }

  const lines: OcrLine[] = [];
  for (const group of groups.values()) {
    const sorted = group.slice().sort((a, b) => a.left - b.left || a.word - b.word);
    const left = Math.min(...sorted.map((word) => word.left));
    const top = Math.min(...sorted.map((word) => word.top));
    const right = Math.max(...sorted.map((word) => word.right));
    const bottom = Math.max(...sorted.map((word) => word.bottom));
    const width = right - left;
    const height = bottom - top;
    const confidence =
      sorted.reduce((sum, word) => sum + word.confidence, 0) / Math.max(sorted.length, 1);

    lines.push({
      text: sorted.map((word) => word.text).join(" ").trim(),
      confidence: Math.round(confidence * 100) / 100,
      page: sorted[0].page,
      block: sorted[0].block,
      paragraph: sorted[0].paragraph,
      line: sorted[0].line,
      wordCount: sorted.length,
      ...buildBounds(left, top, width, height),
    });
  }

  return lines.sort((a, b) => a.top - b.top || a.left - b.left);
}

function mapWordsToSource(
  words: OcrWord[],
  transform: { region: NormalizedVisionRegion; scale: number }
) {
  return words.map((word) => {
    const mapped = mapPreparedBoundsToSource(
      {
        left: word.left,
        top: word.top,
        right: word.right,
        bottom: word.bottom,
      },
      transform
    );
    return {
      text: word.text,
      confidence: word.confidence,
      page: word.page,
      block: word.block,
      paragraph: word.paragraph,
      line: word.line,
      word: word.word,
      ...mapped,
    };
  });
}

async function resolveImage(
  input?: { path?: string }
): Promise<ResolveImageResult> {
  const existingPath = String(input?.path || "").trim();
  if (existingPath) {
    if (!fs.existsSync(existingPath)) {
      return {
        ok: false,
        error: "image_path_not_found",
        path: existingPath,
        captured: false,
        width: null,
        height: null,
      };
    }
    try {
      const info = readPngDimensions(existingPath);
      return {
        ok: true,
        path: existingPath,
        captured: false,
        width: info.width,
        height: info.height,
      };
    } catch {
      return { ok: true, path: existingPath, captured: false, width: null, height: null };
    }
  }

  const shot = await adb_screenshot();
  if (!shot.ok || !shot.path) {
    return {
      ok: false,
      error: "screenshot_failed",
      path: shot.path || "",
      captured: true,
      width: shot.width ?? null,
      height: shot.height ?? null,
    };
  }
  return {
    ok: true,
    path: shot.path,
    captured: true,
    width: shot.width ?? null,
    height: shot.height ?? null,
  };
}

function selectMatches(
  input: {
    text: string;
    exact?: boolean;
    ignoreCase?: boolean;
    scope?: "line" | "word" | "all";
  },
  lines: OcrLine[],
  words: OcrWord[]
) {
  const exact = input.exact === true;
  const ignoreCase = input.ignoreCase !== false;
  const query = normalizeText(input.text, ignoreCase);
  const lineCandidates =
    input.scope === "word"
      ? []
      : lines.filter((item) => {
          const candidate = normalizeText(item.text, ignoreCase);
          return exact ? candidate === query : candidate.includes(query);
        });
  const wordCandidates =
    input.scope === "line"
      ? []
      : words.filter((item) => {
          const candidate = normalizeText(item.text, ignoreCase);
          return exact ? candidate === query : candidate.includes(query);
        });

  return lineCandidates.length > 0 ? lineCandidates : wordCandidates;
}

async function analyzeOcr(input?: {
  path?: string;
  lang?: string;
  psm?: number;
  timeoutMs?: number;
  minConfidence?: number;
  region?: VisionRegionInput;
  scale?: number;
}): Promise<OcrAnalysis> {
  const image = await resolveImage(input);
  if (image.ok === false) {
    return {
      ok: false,
      error: image.error,
      path: image.path,
      captured: image.captured,
      width: image.width,
      height: image.height,
      region: null,
      scale: resolveRequestedScale(input?.scale),
      engine: "tesseract",
    };
  }

  const requestedScale = resolveRequestedScale(input?.scale);
  let preparedPath = image.path;
  let cleanup = () => {};
  let outputWidth = image.width;
  let outputHeight = image.height;
  let normalizedRegion: NormalizedVisionRegion | null = null;
  let appliedScale = requestedScale;

  if (input?.region || requestedScale !== 1) {
    const prepared = preparePngRegionForOcr({
      path: image.path,
      region: input?.region,
      scale: requestedScale,
    });

    if (prepared.ok === false) {
      return {
        ok: false,
        error: "ocr_image_preprocess_failed",
        path: image.path,
        captured: image.captured,
        width: image.width,
        height: image.height,
        region: null,
        scale: requestedScale,
        engine: "tesseract",
        stderr: truncateString(prepared.error),
      };
    }

    preparedPath = prepared.path;
    cleanup = prepared.cleanup;
    outputWidth = prepared.sourceWidth;
    outputHeight = prepared.sourceHeight;
    normalizedRegion = prepared.region;
    appliedScale = prepared.scale;
  }

  try {
    const tsv = await runTesseractTsv(preparedPath, input);
    if (!tsv.ok) {
      return {
        ok: false,
        error: tsv.code === -1 && /not found/i.test(tsv.stderr) ? "ocr_engine_not_found" : "ocr_failed",
        path: image.path,
        captured: image.captured,
        width: outputWidth,
        height: outputHeight,
        region: normalizedRegion,
        scale: appliedScale,
        engine: "tesseract",
        code: tsv.code,
        stderr: truncateString(tsv.stderr),
        stdout_snip: tsv.stdout ? truncateString(tsv.stdout) : "",
      };
    }

    const minConfidence = clampInteger(input?.minConfidence, DEFAULT_MIN_CONFIDENCE, 0, 100);
    const lang = String(input?.lang || DEFAULT_OCR_LANG).trim() || DEFAULT_OCR_LANG;
    const psm = clampInteger(input?.psm, DEFAULT_OCR_PSM, 0, 13);
    const parsedWords = parseOcrWords(tsv.stdout, minConfidence);
    const words = normalizedRegion
      ? mapWordsToSource(parsedWords, { region: normalizedRegion, scale: appliedScale })
      : parsedWords;
    const lines = buildOcrLines(words);

    return {
      ok: true,
      engine: "tesseract",
      lang,
      psm,
      minConfidence,
      path: image.path,
      captured: image.captured,
      width: outputWidth,
      height: outputHeight,
      region: normalizedRegion,
      scale: appliedScale,
      words,
      lines,
      stderr_snip: tsv.stderr ? truncateString(tsv.stderr) : "",
    };
  } finally {
    cleanup();
  }
}

export async function android_ocr_dump(input?: {
  path?: string;
  lang?: string;
  psm?: number;
  timeoutMs?: number;
  minConfidence?: number;
  region?: VisionRegionInput;
  scale?: number;
}) {
  const analysis = await analyzeOcr(input);
  if (analysis.ok === false) return analysis;

  return {
    ok: true,
    engine: analysis.engine,
    lang: analysis.lang,
    psm: analysis.psm,
    minConfidence: analysis.minConfidence,
    path: analysis.path,
    captured: analysis.captured,
    width: analysis.width,
    height: analysis.height,
    region: analysis.region,
    scale: analysis.scale,
    lineCount: analysis.lines.length,
    wordCount: analysis.words.length,
    truncated: analysis.lines.length > MAX_OCR_LINES,
    lines: analysis.lines.slice(0, MAX_OCR_LINES),
    stderr_snip: analysis.stderr_snip,
  };
}

export async function android_ocr_find_text(input: {
  text: string;
  path?: string;
  lang?: string;
  psm?: number;
  timeoutMs?: number;
  minConfidence?: number;
  region?: VisionRegionInput;
  scale?: number;
  exact?: boolean;
  ignoreCase?: boolean;
  scope?: "line" | "word" | "all";
}): Promise<OcrFindTextResult> {
  const query = String(input?.text || "").trim();
  if (!query) {
    return { ok: false, error: "text_required" };
  }

  const analysis = await analyzeOcr(input);
  if (analysis.ok === false) return analysis;
  const matches = selectMatches(input, analysis.lines, analysis.words);

  return {
    ok: true,
    engine: analysis.engine,
    text: query,
    exact: input?.exact === true,
    ignoreCase: input?.ignoreCase !== false,
    scope: input?.scope || "all",
    path: analysis.path,
    captured: analysis.captured,
    width: analysis.width,
    height: analysis.height,
    region: analysis.region,
    scale: analysis.scale,
    matchCount: matches.length,
    matches: matches.slice(0, MAX_OCR_LINES),
    selected: matches[0] || null,
    stderr_snip: analysis.stderr_snip,
  };
}
