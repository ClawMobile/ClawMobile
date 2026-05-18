import {
  android_ocr_dump as backend_ocr_dump,
  android_ocr_find_text as backend_ocr_find_text,
} from "../backends/ocr";

export type TextMatchPickStrategy =
  | "highest_confidence"
  | "bottom_most"
  | "top_most"
  | "left_most"
  | "right_most"
  | "largest"
  | "widest"
  | "tallest";

type QueryRegion = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type OcrQuery = {
  text?: string;
  region?: QueryRegion;
  scale?: number;
  lang?: string;
  psm?: number;
  minConfidence?: number;
  exact?: boolean;
  ignoreCase?: boolean;
  scope?: "line" | "word" | "all";
};

export function summarizeTextMatch(match: any) {
  if (!match) return null;
  return {
    text: match.text,
    confidence: match.confidence,
    left: match.left,
    top: match.top,
    width: match.width,
    height: match.height,
    centerX: match.centerX,
    centerY: match.centerY,
  };
}

export function summarizeFindTextResult(result: any) {
  if (!result) return null;
  return {
    ok: result.ok === true,
    error: result.ok === false ? result.error || "" : "",
    text: result.text || "",
    path: result.path || "",
    captured: result.captured === true,
    width: typeof result.width === "number" ? result.width : null,
    height: typeof result.height === "number" ? result.height : null,
    region: result.region || null,
    scale: typeof result.scale === "number" ? result.scale : 1,
    matchCount: typeof result.matchCount === "number" ? result.matchCount : 0,
    selected: summarizeTextMatch(result.selected),
    stderr_snip: result.stderr_snip || result.stderr || "",
  };
}

export function selectTextMatchByConstraints(
  matches: any[],
  matchRegion?: QueryRegion | null,
  matchPickStrategy?: TextMatchPickStrategy | string | null
) {
  const eligible = Array.isArray(matches)
    ? matches.filter((match) => {
        if (!matchRegion) return true;
        const centerX = Number(match?.centerX || 0);
        const centerY = Number(match?.centerY || 0);
        return (
          centerX >= Number(matchRegion.left || 0) &&
          centerX <= Number(matchRegion.left || 0) + Number(matchRegion.width || 0) &&
          centerY >= Number(matchRegion.top || 0) &&
          centerY <= Number(matchRegion.top || 0) + Number(matchRegion.height || 0)
        );
      })
    : [];
  if (eligible.length === 0) return null;

  const scored = eligible.slice().sort((a, b) => {
    const score = (match: any) => {
      const width = Number(match?.width || 0);
      const height = Number(match?.height || 0);
      const area = Math.max(0, width * height);
      switch (matchPickStrategy || "highest_confidence") {
        case "bottom_most":
          return Number(match?.centerY || 0);
        case "top_most":
          return -Number(match?.centerY || 0);
        case "left_most":
          return -Number(match?.centerX || 0);
        case "right_most":
          return Number(match?.centerX || 0);
        case "largest":
          return area;
        case "widest":
          return width;
        case "tallest":
          return height;
        case "highest_confidence":
        default:
          return Number(match?.confidence || 0);
      }
    };
    return score(b) - score(a);
  });
  return scored[0] || null;
}

export async function runBoundedTextQuery(input: {
  path: string;
  text: string;
  query: OcrQuery;
  matchRegion?: QueryRegion | null;
  matchPickStrategy?: TextMatchPickStrategy | string | null;
}) {
  const result = await backend_ocr_find_text({
    text: input.text,
    path: input.path,
    region: input.query.region,
    scale: input.query.scale,
    lang: input.query.lang,
    psm: input.query.psm,
    minConfidence: input.query.minConfidence,
    exact: input.query.exact === true,
    ignoreCase: input.query.ignoreCase !== false,
    scope: input.query.scope || "all",
  });
  const resultAny: any = result as any;
  const selected = selectTextMatchByConstraints(
    resultAny?.matches || (resultAny?.selected ? [resultAny.selected] : []),
    input.matchRegion,
    input.matchPickStrategy
  );
  const summarized = summarizeFindTextResult({
    ...resultAny,
    selected,
    matchCount: Array.isArray(resultAny?.matches) ? resultAny.matches.length : resultAny?.matchCount,
  });
  return {
    result,
    selected,
    summarized,
  };
}

function normalizeCoverageText(text: string, ignoreCase: boolean) {
  const normalized = String(text || "")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return ignoreCase ? normalized.toLowerCase() : normalized;
}

function extractCoverageTokens(text: string, ignoreCase: boolean) {
  const normalized = normalizeCoverageText(text, ignoreCase);
  const rawTokens = normalized.match(/[\p{L}\p{N}]+/gu) || [];
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const token of rawTokens) {
    const normalizedToken = String(token || "").trim();
    if (!normalizedToken) continue;
    const isAsciiWord = /^[a-z0-9]+$/i.test(normalizedToken);
    if (isAsciiWord && normalizedToken.length < 2) continue;
    if (seen.has(normalizedToken)) continue;
    seen.add(normalizedToken);
    tokens.push(normalizedToken);
  }
  return tokens;
}

function buildCoverageSelected(lines: any[], text: string) {
  if (!Array.isArray(lines) || lines.length === 0) return null;
  const left = Math.min(...lines.map((line) => Number(line?.left || 0)));
  const top = Math.min(...lines.map((line) => Number(line?.top || 0)));
  const right = Math.max(
    ...lines.map((line) => Number(line?.left || 0) + Number(line?.width || 0))
  );
  const bottom = Math.max(
    ...lines.map((line) => Number(line?.top || 0) + Number(line?.height || 0))
  );
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  const averageConfidence =
    lines.reduce((sum, line) => sum + Number(line?.confidence || 0), 0) / lines.length;
  return {
    text,
    confidence: Number.isFinite(averageConfidence) ? averageConfidence : 0,
    left,
    top,
    width,
    height,
    centerX: Math.round(left + width / 2),
    centerY: Math.round(top + height / 2),
  };
}

function lineCenterInRegion(
  line: any,
  region?: QueryRegion | null
) {
  if (!region) return true;
  const centerX = Number(line?.centerX || 0);
  const centerY = Number(line?.centerY || 0);
  return (
    centerX >= Number(region.left || 0) &&
    centerX <= Number(region.left || 0) + Number(region.width || 0) &&
    centerY >= Number(region.top || 0) &&
    centerY <= Number(region.top || 0) + Number(region.height || 0)
  );
}

function buildCoverageGroups(lines: any[], ignoreCase: boolean) {
  const groups = new Map<string, { key: string; lines: any[]; normalized: string }>();
  for (const line of Array.isArray(lines) ? lines : []) {
    const key = `${Number(line?.page || 0)}:${Number(line?.block || 0)}:${Number(line?.paragraph || 0)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.lines.push(line);
      continue;
    }
    groups.set(key, { key, lines: [line], normalized: "" });
  }
  return Array.from(groups.values()).map((group) => {
    const orderedLines = group.lines
      .slice()
      .sort((a, b) => {
        const topDiff = Number(a?.top || 0) - Number(b?.top || 0);
        if (topDiff !== 0) return topDiff;
        return Number(a?.left || 0) - Number(b?.left || 0);
      });
    return {
      key: group.key,
      lines: orderedLines,
      normalized: normalizeCoverageText(
        orderedLines.map((line) => String(line?.text || "")).join(" "),
        ignoreCase
      ),
    };
  });
}

export async function runBoundedTokenCoverageQuery(input: {
  path: string;
  text: string;
  query: OcrQuery;
  matchRegion?: QueryRegion | null;
  matchPickStrategy?: TextMatchPickStrategy | string | null;
}) {
  const ignoreCase = input.query.ignoreCase !== false;
  const tokens = extractCoverageTokens(input.text, ignoreCase);
  if (tokens.length < 2) {
    return {
      result: null,
      selected: null,
      summarized: {
        ok: false,
        error: "token_coverage_skipped",
        text: input.text,
        tokenCount: tokens.length,
        matchedTokenCount: 0,
        matchedTokens: [],
      },
    };
  }

  const result = await backend_ocr_dump({
    path: input.path,
    region: input.query.region,
    scale: input.query.scale,
    lang: input.query.lang,
    psm: input.query.psm,
    minConfidence: input.query.minConfidence,
  });
  const resultAny: any = result as any;
  const lines = Array.isArray(resultAny?.lines) ? resultAny.lines : [];
  const boundedLines = lines.filter((line: any) => lineCenterInRegion(line, input.matchRegion));
  const coverageGroups = buildCoverageGroups(boundedLines, ignoreCase);
  const matchedTokens = tokens.filter((token) =>
    coverageGroups.some((group) => group.normalized.includes(token))
  );
  const successfulGroups = coverageGroups
    .filter((group) => tokens.every((token) => group.normalized.includes(token)))
    .map((group) => ({
      key: group.key,
      lines: group.lines,
      candidate: {
        ...buildCoverageSelected(group.lines, input.text),
        groupKey: group.key,
      },
    }))
    .filter((entry) => entry.candidate);
  const selectedCandidate = selectTextMatchByConstraints(
    successfulGroups.map((entry) => entry.candidate),
    input.matchRegion,
    input.matchPickStrategy
  );
  const selected =
    resultAny?.ok === true && selectedCandidate
      ? buildCoverageSelected(
          successfulGroups.find((entry) => entry.key === selectedCandidate.groupKey)?.lines || [],
          input.text
        )
      : null;
  const coverageSatisfied = resultAny?.ok === true && Boolean(selected);
  const summarized = {
    ok: coverageSatisfied,
    error:
      resultAny?.ok === true
        ? coverageSatisfied
          ? ""
          : "token_coverage_not_satisfied"
        : resultAny?.error || "ocr_dump_failed",
    text: input.text,
    path: resultAny?.path || input.path,
    captured: resultAny?.captured === true,
    width: typeof resultAny?.width === "number" ? resultAny.width : null,
    height: typeof resultAny?.height === "number" ? resultAny.height : null,
    region: resultAny?.region || input.query.region || null,
    scale:
      typeof resultAny?.scale === "number"
        ? resultAny.scale
        : typeof input.query.scale === "number"
          ? input.query.scale
          : 1,
    lineCount: Array.isArray(boundedLines) ? boundedLines.length : 0,
    tokenCount: tokens.length,
    matchedTokenCount: matchedTokens.length,
    matchedTokens,
    selected: summarizeTextMatch(selected),
    stderr_snip: resultAny?.stderr_snip || resultAny?.stderr || "",
  };
  return {
    result,
    selected,
    summarized,
  };
}
