import fs from "fs";
import os from "os";
import path from "path";

export const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024;
const AUDIT_MAX_BYTES = 2000;

export function getWorkspaceDir() {
  if (process.env.OPENCLAW_WORKSPACE) return process.env.OPENCLAW_WORKSPACE;

  const stateDir = process.env.OPENCLAW_STATE_DIR || path.join(os.homedir(), ".openclaw");
  const configPath = path.join(stateDir, "config.json");

  try {
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, "utf8");
      const parsed = JSON.parse(raw);
      const ws = parsed?.agents?.defaults?.workspace;
      if (typeof ws === "string" && ws.trim()) return ws.trim();
    }
  } catch {
    // ignore and fall back
  }

  if (process.env.OPENCLAW_STATE_DIR) return path.join(stateDir, "workspace");
  return "/root/.openclaw/workspace";
}

export function ensureScreenshotsDir() {
  const ws = getWorkspaceDir();
  const dir = path.join(ws, "screenshots");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function ensureLogsDir() {
  const ws = getWorkspaceDir();
  const dir = path.join(ws, "logs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeLog(dir: string, prefix: string, content: string) {
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 1e6);
  const file = path.join(dir, `${prefix}_${ts}_${rand}.log`);
  fs.writeFileSync(file, truncateString(content, DEFAULT_MAX_OUTPUT_BYTES));
  return file;
}

function safeJsonLine(obj: any, maxBytes = AUDIT_MAX_BYTES) {
  let line = "";
  try {
    line = JSON.stringify(obj);
  } catch {
    line = JSON.stringify({ tool: obj?.tool, time: obj?.time, error: "stringify_failed" });
  }
  if (line.length <= maxBytes) return line;
  return JSON.stringify({
    truncated: true,
    original_len: line.length,
    head: line.slice(0, maxBytes - 100),
  });
}

export function appendToolAudit(entry: any) {
  const dir = ensureLogsDir();
  const file = path.join(dir, "tool-audit.jsonl");
  const line = safeJsonLine(entry, AUDIT_MAX_BYTES);
  fs.appendFileSync(file, line + "\n");
  return file;
}

export function makeScreenshotPath() {
  const dir = ensureScreenshotsDir();
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 1e6);
  return path.join(dir, `shot_${ts}_${rand}.png`);
}

export function pngDimensions(buf: Buffer): { width: number; height: number } {
  if (!buf || buf.length < 24) return { width: 0, height: 0 };
  const signature = "89504e470d0a1a0a";
  if (buf.slice(0, 8).toString("hex") !== signature) return { width: 0, height: 0 };
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function truncateString(text: string, maxBytes = DEFAULT_MAX_OUTPUT_BYTES) {
  if (text.length <= maxBytes) return text;
  return text.slice(0, maxBytes) + `\n...truncated ${text.length - maxBytes} bytes`;
}

export function truncateLargeStrings<T>(value: T, maxBytes = DEFAULT_MAX_OUTPUT_BYTES): T {
  if (typeof value === "string") {
    return truncateString(value, maxBytes) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((v) => truncateLargeStrings(v, maxBytes)) as unknown as T;
  }
  if (value && typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      out[k] = truncateLargeStrings(v, maxBytes);
    }
    return out as T;
  }
  return value;
}

//#region UIAutomator XML filtering

// Attributes that signal a node is actionable / informative for the LLM.
const INTERESTING_ATTRS: Record<string, (v: string) => boolean> = {
  "text": (v) => v !== "",
  "content-desc": (v) => v !== "",
  "resource-id": (v) => v !== "",
  "clickable": (v) => v === "true",
  "scrollable": (v) => v === "true",
  "checkable": (v) => v === "true",
  "long-clickable": (v) => v === "true",
  "focused": (v) => v === "true",
  "checked": (v) => v === "true",
  "selected": (v) => v === "true",
};

// Attributes to always include on kept nodes.
const KEEP_ATTRS = new Set([
  "text",
  "content-desc",
  "resource-id",
  "class",
  "bounds",
  "clickable",
  "scrollable",
  "checkable",
  "long-clickable",
  "focused",
  "checked",
  "selected",
  "enabled",
  "package",
]);

// Attributes whose default/false/empty values should be omitted
const OMIT_IF_DEFAULT: Record<string, string> = {
  "clickable": "false",
  "scrollable": "false",
  "checkable": "false",
  "long-clickable": "false",
  "focused": "false",
  "checked": "false",
  "selected": "false",
  "enabled": "true",
  "text": "",
  "content-desc": "",
  "resource-id": "",
};

interface ParsedNode {
  attrs: Record<string, string>;
  children: ParsedNode[];
}

// Regex to match a single <node ...> or <node .../> tag and extract its attributes.
const NODE_ATTR_RE = /(\w[\w-]*)="([^"]*)"/g;

/**
 * Parse UIAutomator XML into a lightweight tree.
 * UIAutomator dump XML is simple: only <hierarchy> and <node> elements,
 * attributes are always double-quoted, no CDATA or namespaces.
 */
function parseUIXml(xml: string): ParsedNode[] {
  const roots: ParsedNode[] = [];
  const stack: ParsedNode[] = [];

  // Match opening <node ...>, self-closing <node .../>, and closing </node>
  const TAG_RE = /<(\/?)node\b([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;

  while ((m = TAG_RE.exec(xml)) !== null) {
    const isClose = m[1] === "/";
    const attrStr = m[2];
    const isSelfClose = m[3] === "/";

    if (isClose) {
      stack.pop();
      continue;
    }

    // Opening or self-closing tag — parse attributes
    const attrs: Record<string, string> = {};
    let am: RegExpExecArray | null;
    NODE_ATTR_RE.lastIndex = 0;
    while ((am = NODE_ATTR_RE.exec(attrStr)) !== null) {
      attrs[am[1]] = am[2];
    }

    const node: ParsedNode = { attrs, children: [] };
    if (stack.length > 0) {
      stack[stack.length - 1].children.push(node);
    } else {
      roots.push(node);
    }

    if (!isSelfClose) {
      stack.push(node);
    }
  }

  return roots;
}

function isNodeInteresting(attrs: Record<string, string>): boolean {
  for (const [attr, test] of Object.entries(INTERESTING_ATTRS)) {
    if (attrs[attr] !== undefined && test(attrs[attr])) return true;
  }
  return false;
}

function hasInterestingDescendant(node: ParsedNode): boolean {
  for (const child of node.children) {
    if (isNodeInteresting(child.attrs) || hasInterestingDescendant(child)) return true;
  }
  return false;
}

function serializeNode(node: ParsedNode, depth: number): string {
  const indent = "  ".repeat(depth);
  const parts: string[] = [];

  for (const attr of KEEP_ATTRS) {
    const val = node.attrs[attr];
    if (val === undefined) continue;
    // Omit attributes that are at their default value
    if (OMIT_IF_DEFAULT[attr] !== undefined && val === OMIT_IF_DEFAULT[attr]) continue;
    parts.push(`${attr}="${val}"`);
  }

  const attrStr = parts.join(" ");
  const filteredChildren = filterTree(node.children, depth + 1);

  if (!filteredChildren) {
    return `${indent}<node ${attrStr} />`;
  }
  return `${indent}<node ${attrStr}>\n${filteredChildren}\n${indent}</node>`;
}

function filterTree(nodes: ParsedNode[], depth = 0): string {
  const lines: string[] = [];
  for (const node of nodes) {
    if (isNodeInteresting(node.attrs)) {
      lines.push(serializeNode(node, depth));
    } else if (hasInterestingDescendant(node)) {
      // Skip this container but include its interesting descendants
      const childXml = filterTree(node.children, depth);
      if (childXml) lines.push(childXml);
    }
    // else: node and all descendants are inert — drop entirely
  }
  return lines.join("\n");
}

/* Filter UIAutomator XML to retain only informative nodes.
 * Removes inert layout containers and omits default-valued attributes
 * to reduce token consumption when the XML is sent to the LLM.
 *
 * Returns compact XML. If parsing fails (malformed input), returns the
 * original XML unchanged so the tool never silently loses data.
 */
export function filterUIDumpXml(xml: string): string {
  if (!xml || !xml.includes("<node")) return xml;

  try {
    const roots = parseUIXml(xml);
    const filtered = filterTree(roots);
    return filtered || xml;
  } catch {
    // Parsing failed — return original XML
    return xml;
  }
}

//#endregion
