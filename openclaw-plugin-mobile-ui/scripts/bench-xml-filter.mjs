#!/usr/bin/env node
/**
 * Benchmark: filterUiDumpXml token savings.
 *
 * Generates a realistic UIAutomator XML hierarchy (configurable node count),
 * runs the filter, and reports size / estimated-token reduction plus timing.
 *
 * Usage:
 *   node scripts/bench-xml-filter.mjs            # default 200 nodes
 *   node scripts/bench-xml-filter.mjs 500         # 500 nodes
 */

// ---------------------------------------------------------------------------
// Inline implementation of filterUiDumpXml (mirrors workspace.ts logic)
// so the benchmark is self-contained and runnable without a TS build step.
// ---------------------------------------------------------------------------

const INTERESTING_ATTRS = {
  "text":            (v) => v !== "",
  "content-desc":    (v) => v !== "",
  "resource-id":     (v) => v !== "",
  "clickable":       (v) => v === "true",
  "scrollable":      (v) => v === "true",
  "checkable":       (v) => v === "true",
  "long-clickable":  (v) => v === "true",
  "focused":         (v) => v === "true",
  "checked":         (v) => v === "true",
  "selected":        (v) => v === "true",
};

const KEEP_ATTRS = new Set([
  "text", "content-desc", "resource-id", "class", "bounds",
  "clickable", "scrollable", "checkable", "long-clickable",
  "focused", "checked", "selected", "enabled", "package",
]);

const OMIT_IF_DEFAULT = {
  "clickable": "false", "scrollable": "false", "checkable": "false",
  "long-clickable": "false", "focused": "false", "checked": "false",
  "selected": "false", "enabled": "true", "text": "", "content-desc": "",
  "resource-id": "",
};

const NODE_ATTR_RE = /(\w[\w-]*)="([^"]*)"/g;

function parseUiXml(xml) {
  const roots = [];
  const stack = [];
  const TAG_RE = /<(\/?)node\b([^>]*?)(\/?)>/g;
  let m;
  while ((m = TAG_RE.exec(xml)) !== null) {
    if (m[1] === "/") { stack.pop(); continue; }
    const attrs = {};
    let am;
    NODE_ATTR_RE.lastIndex = 0;
    while ((am = NODE_ATTR_RE.exec(m[2])) !== null) attrs[am[1]] = am[2];
    const node = { attrs, children: [] };
    if (stack.length > 0) stack[stack.length - 1].children.push(node);
    else roots.push(node);
    if (m[3] !== "/") stack.push(node);
  }
  return roots;
}

function isNodeInteresting(attrs) {
  for (const [attr, test] of Object.entries(INTERESTING_ATTRS)) {
    if (attrs[attr] !== undefined && test(attrs[attr])) return true;
  }
  return false;
}

function hasInterestingDescendant(node) {
  for (const child of node.children) {
    if (isNodeInteresting(child.attrs) || hasInterestingDescendant(child)) return true;
  }
  return false;
}

function serializeNode(node, depth) {
  const indent = "  ".repeat(depth);
  const parts = [];
  for (const attr of KEEP_ATTRS) {
    const val = node.attrs[attr];
    if (val === undefined) continue;
    if (OMIT_IF_DEFAULT[attr] !== undefined && val === OMIT_IF_DEFAULT[attr]) continue;
    parts.push(`${attr}="${val}"`);
  }
  const attrStr = parts.join(" ");
  const filteredChildren = filterTree(node.children, depth + 1);
  if (!filteredChildren) return `${indent}<node ${attrStr} />`;
  return `${indent}<node ${attrStr}>\n${filteredChildren}\n${indent}</node>`;
}

function filterTree(nodes, depth = 0) {
  const lines = [];
  for (const node of nodes) {
    if (isNodeInteresting(node.attrs)) {
      lines.push(serializeNode(node, depth));
    } else if (hasInterestingDescendant(node)) {
      const childXml = filterTree(node.children, depth);
      if (childXml) lines.push(childXml);
    }
  }
  return lines.join("\n");
}

function filterUiDumpXml(xml) {
  if (!xml || !xml.includes("<node")) return xml;
  try {
    const roots = parseUiXml(xml);
    return filterTree(roots) || xml;
  } catch { return xml; }
}

// ---------------------------------------------------------------------------
// Generate a realistic UIAutomator XML dump
// ---------------------------------------------------------------------------

const CLASSES = [
  "android.widget.FrameLayout", "android.widget.LinearLayout",
  "android.view.View", "android.widget.RelativeLayout",
  "android.widget.TextView", "android.widget.ImageView",
  "android.widget.Button", "android.widget.EditText",
  "android.widget.ScrollView", "android.widget.CheckBox",
  "android.widget.ImageButton", "android.widget.Switch",
  "androidx.recyclerview.widget.RecyclerView",
  "android.widget.ProgressBar",
];

const PACKAGES = ["com.android.launcher3", "com.google.android.apps.messaging", "com.android.systemui"];

function randomBool(pTrue = 0.1) { return Math.random() < pTrue; }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function generateNode(index, depth, maxDepth, counter) {
  const cls = pick(CLASSES);
  const isLeaf = depth >= maxDepth || counter.n <= 0;
  const isInteractive = cls.includes("Button") || cls.includes("EditText") ||
    cls.includes("CheckBox") || cls.includes("Switch") || cls.includes("ImageButton");

  const text = isInteractive && randomBool(0.6) ? `Label ${counter.n}` : "";
  const contentDesc = !text && isInteractive && randomBool(0.4) ? `desc_${counter.n}` : "";
  const resourceId = isInteractive && randomBool(0.7) ? `com.app:id/btn_${counter.n}` : "";
  const clickable = isInteractive ? "true" : "false";
  const scrollable = cls.includes("ScrollView") || cls.includes("RecyclerView") ? "true" : "false";
  const checkable = cls.includes("CheckBox") || cls.includes("Switch") ? "true" : "false";

  const x1 = Math.floor(Math.random() * 500);
  const y1 = Math.floor(Math.random() * 2000);
  const x2 = x1 + 50 + Math.floor(Math.random() * 500);
  const y2 = y1 + 20 + Math.floor(Math.random() * 200);
  const bounds = `[${x1},${y1}][${x2},${y2}]`;

  const indent = "  ".repeat(depth);
  const attrs = [
    `index="${index}"`,
    `text="${text}"`,
    `resource-id="${resourceId}"`,
    `class="${cls}"`,
    `package="${pick(PACKAGES)}"`,
    `content-desc="${contentDesc}"`,
    `checkable="${checkable}"`,
    `checked="false"`,
    `clickable="${clickable}"`,
    `enabled="true"`,
    `focusable="${isInteractive ? "true" : "false"}"`,
    `focused="false"`,
    `scrollable="${scrollable}"`,
    `long-clickable="false"`,
    `password="false"`,
    `selected="false"`,
    `bounds="${bounds}"`,
  ].join(" ");

  counter.n--;

  if (isLeaf || counter.n <= 0) {
    return `${indent}<node ${attrs} />`;
  }

  const childCount = Math.min(1 + Math.floor(Math.random() * 4), counter.n);
  const children = [];
  for (let i = 0; i < childCount && counter.n > 0; i++) {
    children.push(generateNode(i, depth + 1, maxDepth, counter));
  }
  return `${indent}<node ${attrs}>\n${children.join("\n")}\n${indent}</node>`;
}

function generateUiXml(totalNodes) {
  const counter = { n: totalNodes };
  const children = [];
  let i = 0;
  while (counter.n > 0) {
    children.push(generateNode(i++, 1, 6, counter));
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<hierarchy rotation="0">\n${children.join("\n")}\n</hierarchy>`;
}

// ---------------------------------------------------------------------------
// Rough token estimator (GPT-style: ~4 chars per token for English/XML)
// ---------------------------------------------------------------------------
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

// ---------------------------------------------------------------------------
// Benchmark
// ---------------------------------------------------------------------------
const TOTAL_NODES = parseInt(process.argv[2] || "200", 10);
const ITERATIONS = parseInt(process.argv[3] || "1000", 10);

console.log(`\n=== UI Dump XML Filter Benchmark ===`);
console.log(`Nodes: ${TOTAL_NODES}   Iterations: ${ITERATIONS}\n`);

const xml = generateUiXml(TOTAL_NODES);
const xmlBytes = Buffer.byteLength(xml, "utf8");

// Warm up
filterUiDumpXml(xml);

// Benchmark BEFORE (no filter — just pass-through)
const beforeStart = performance.now();
for (let i = 0; i < ITERATIONS; i++) {
  // Simulate the old path: JSON.stringify with pretty-print
  JSON.stringify({ ok: true, code: 0, stderr: "", xml, source: "adb_ui_dump_xml" }, null, 2);
}
const beforeMs = performance.now() - beforeStart;

// Benchmark AFTER (filter + compact JSON)
const afterStart = performance.now();
let filteredXml = "";
for (let i = 0; i < ITERATIONS; i++) {
  filteredXml = filterUiDumpXml(xml);
  JSON.stringify({ ok: true, xml: filteredXml });
}
const afterMs = performance.now() - afterStart;

const filteredBytes = Buffer.byteLength(filteredXml, "utf8");

const beforeJson = JSON.stringify({ ok: true, code: 0, stderr: "", xml, source: "adb_ui_dump_xml" }, null, 2);
const afterJson = JSON.stringify({ ok: true, xml: filteredXml });

const beforeTokens = estimateTokens(beforeJson);
const afterTokens = estimateTokens(afterJson);
const pctReduction = ((1 - afterTokens / beforeTokens) * 100).toFixed(1);

console.log(`BEFORE (raw XML, pretty JSON):`);
console.log(`  XML size:       ${xmlBytes.toLocaleString()} bytes`);
console.log(`  JSON payload:   ${Buffer.byteLength(beforeJson).toLocaleString()} bytes`);
console.log(`  Est. tokens:    ~${beforeTokens.toLocaleString()}`);
console.log(`  Time (${ITERATIONS}x):   ${beforeMs.toFixed(2)} ms   (${(beforeMs / ITERATIONS).toFixed(4)} ms/call)`);

console.log(`\nAFTER (filtered XML, compact JSON):`);
console.log(`  XML size:       ${filteredBytes.toLocaleString()} bytes`);
console.log(`  JSON payload:   ${Buffer.byteLength(afterJson).toLocaleString()} bytes`);
console.log(`  Est. tokens:    ~${afterTokens.toLocaleString()}`);
console.log(`  Time (${ITERATIONS}x):   ${afterMs.toFixed(2)} ms   (${(afterMs / ITERATIONS).toFixed(4)} ms/call)`);

console.log(`\n--- Result ---`);
console.log(`  XML reduction:   ${((1 - filteredBytes / xmlBytes) * 100).toFixed(1)}%`);
console.log(`  Token reduction: ${pctReduction}%  (${beforeTokens.toLocaleString()} -> ${afterTokens.toLocaleString()})`);
console.log(`  Tokens saved per call: ~${(beforeTokens - afterTokens).toLocaleString()}`);
console.log();
