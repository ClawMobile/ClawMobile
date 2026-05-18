export type UiQueryRegion = {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
};

export type UiQuery = {
  name?: string;
  nodeId?: number;
  text?: string;
  contentDesc?: string;
  resourceId?: string;
  className?: string;
  clickable?: boolean;
  enabled?: boolean;
  exact?: boolean;
  ignoreCase?: boolean;
  region?: UiQueryRegion;
  matchPickStrategy?: string;
  detail?: string;
  maxMatches?: number;
};

export type UiXmlQueryInput = UiQuery & {
  dumpId?: string;
  queries?: UiQuery[];
  matchPickStrategy?: string;
  maxMatches?: number;
};

type UiNode = {
  id: number;
  parent_id: number | null;
  depth: number;
  text: string;
  content_desc: string;
  resource_id: string;
  class: string;
  package: string;
  bounds: ReturnType<typeof parseBounds>;
  clickable: boolean;
  enabled: boolean;
  focusable: boolean;
  focused: boolean;
  scrollable: boolean;
  long_clickable: boolean;
  checkable: boolean;
  checked: boolean;
  selected: boolean;
  password: boolean;
};

function decodeXmlAttr(value: string) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function attrValue(node: string, name: string) {
  const match = node.match(new RegExp(`${name}="([^"]*)"`));
  return match ? decodeXmlAttr(match[1]) : "";
}

function parseBounds(value: string) {
  const match = String(value || "").match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!match) return null;
  const left = Number(match[1]);
  const top = Number(match[2]);
  const right = Number(match[3]);
  const bottom = Number(match[4]);
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) return null;
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    centerX: Math.round((left + right) / 2),
    centerY: Math.round((top + bottom) / 2),
  };
}

function attrBool(node: string, name: string) {
  return attrValue(node, name) === "true";
}

function classTail(value: string) {
  const text = String(value || "");
  const parts = text.split(".");
  return parts[parts.length - 1] || text;
}

function resourceTail(value: string) {
  const text = String(value || "");
  const slash = text.lastIndexOf("/");
  return slash >= 0 ? text.slice(slash + 1) : text;
}

function shortText(value: string, limit = 80) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function parseUiNodes(xml: string) {
  const sourceXml = String(xml || "");
  const nodes: UiNode[] = [];
  const stack: number[] = [];
  const tokenPattern = /<\/node>|<node\b[^>]*\/?>/g;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(sourceXml))) {
    const token = match[0];
    if (token.startsWith("</")) {
      stack.pop();
      continue;
    }

    const bounds = parseBounds(attrValue(token, "bounds"));
    const id = nodes.length + 1;
    const parent_id = stack.length > 0 ? stack[stack.length - 1] : null;
    const node: UiNode = {
      id,
      parent_id,
      depth: stack.length,
      text: attrValue(token, "text"),
      content_desc: attrValue(token, "content-desc"),
      resource_id: attrValue(token, "resource-id"),
      class: attrValue(token, "class"),
      package: attrValue(token, "package"),
      bounds,
      clickable: attrBool(token, "clickable"),
      enabled: attrValue(token, "enabled") !== "false",
      focusable: attrBool(token, "focusable"),
      focused: attrBool(token, "focused"),
      scrollable: attrBool(token, "scrollable"),
      long_clickable: attrBool(token, "long-clickable"),
      checkable: attrBool(token, "checkable"),
      checked: attrBool(token, "checked"),
      selected: attrBool(token, "selected"),
      password: attrBool(token, "password"),
    };
    nodes.push(node);

    if (!token.endsWith("/>")) {
      stack.push(id);
    }
  }

  return nodes;
}

function buildChildren(nodes: UiNode[]) {
  const children = new Map<number, UiNode[]>();
  for (const node of nodes) {
    if (node.parent_id == null) continue;
    if (!children.has(node.parent_id)) children.set(node.parent_id, []);
    children.get(node.parent_id)!.push(node);
  }
  return children;
}

function semanticLabel(node: UiNode) {
  return shortText(node.text || node.content_desc);
}

function collectDescendantLabels(node: UiNode, children: Map<number, UiNode[]>, limit = 8) {
  const labels: string[] = [];
  const seen = new Set<string>();
  const queue = [...(children.get(node.id) || [])];
  while (queue.length > 0 && labels.length < limit) {
    const item = queue.shift()!;
    const label = semanticLabel(item);
    if (label && !seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
    queue.push(...(children.get(item.id) || []));
  }
  return labels;
}

function isInputNode(node: UiNode) {
  return /EditText|TextInput/i.test(node.class);
}

function isActionableNode(node: UiNode) {
  if (!node.bounds) return false;
  if (node.clickable || node.long_clickable || node.scrollable || node.checkable || node.focusable) return true;
  return /Button|ImageButton|Switch|CheckBox|RadioButton|Spinner|SeekBar|EditText/i.test(node.class);
}

function roleForNode(node: UiNode) {
  if (isInputNode(node)) return "input";
  if (/Button|ImageButton/i.test(node.class)) return "button";
  if (/Switch/i.test(node.class)) return "switch";
  if (/CheckBox/i.test(node.class)) return "checkbox";
  if (/RadioButton/i.test(node.class)) return "radio";
  if (node.scrollable) return "scrollable";
  if (node.checkable) return "checkable";
  if (node.clickable || node.long_clickable) return "clickable";
  return classTail(node.class) || "node";
}

function nearestActionableAncestor(node: UiNode, byId: Map<number, UiNode>) {
  let current = node.parent_id == null ? null : byId.get(node.parent_id) || null;
  while (current) {
    if (isActionableNode(current)) return current;
    current = current.parent_id == null ? null : byId.get(current.parent_id) || null;
  }
  return null;
}

function compactBounds(bounds: ReturnType<typeof parseBounds>) {
  if (!bounds) return null;
  return [bounds.left, bounds.top, bounds.right, bounds.bottom];
}

function compactPoint(bounds: ReturnType<typeof parseBounds>) {
  if (!bounds) return null;
  return [bounds.centerX, bounds.centerY];
}

function compactNode(node: UiNode, children: Map<number, UiNode[]>, byId: Map<number, UiNode>, includeClickTarget = false) {
  const ownSemanticLabel = semanticLabel(node);
  const ownLabel = ownSemanticLabel || resourceTail(node.resource_id);
  const child_labels = collectDescendantLabels(node, children);
  const combinedLabel = ownLabel || child_labels.join(" ");
  const flags: string[] = [];
  if (node.clickable) flags.push("click");
  if (node.long_clickable) flags.push("long");
  if (node.scrollable) flags.push("scroll");
  if (node.focusable) flags.push("focus");
  if (node.focused) flags.push("focused");
  if (node.checkable) flags.push("checkable");
  if (node.checked) flags.push("checked");
  if (node.selected) flags.push("selected");
  if (node.enabled === false) flags.push("disabled");

  const out: any = {
    id: node.id,
    role: roleForNode(node),
    label: shortText(combinedLabel, 120),
    pt: compactPoint(node.bounds),
    b: compactBounds(node.bounds),
  };
  const cls = classTail(node.class);
  const rid = resourceTail(node.resource_id);
  if (cls) out.cls = cls;
  if (rid) out.rid = rid;
  if (node.text && node.content_desc && node.text !== node.content_desc) out.desc = shortText(node.content_desc);
  if (!ownSemanticLabel && child_labels.length > 0) out.child_text = child_labels.slice(0, 6);
  if (flags.length > 0) out.flags = flags;
  if (includeClickTarget) {
    const target = isActionableNode(node) ? node : nearestActionableAncestor(node, byId);
    if (target && target.id !== node.id) {
      out.click_id = target.id;
      out.click_pt = compactPoint(target.bounds);
    }
  }
  return out;
}

function sortedVisual(nodes: UiNode[]) {
  return nodes.slice().sort((a, b) => {
    const ay = a.bounds?.top ?? 0;
    const by = b.bounds?.top ?? 0;
    const ax = a.bounds?.left ?? 0;
    const bx = b.bounds?.left ?? 0;
    return ay - by || ax - bx || a.id - b.id;
  });
}

function limitRows(rows: any[], limit: number, warnings: string[], label: string) {
  if (rows.length <= limit) return { rows, truncated: false, omitted: 0 };
  warnings.push(`${label} truncated from ${rows.length} to ${limit}; use dump_id with android_ui_query for full local XML search.`);
  return { rows: rows.slice(0, limit), truncated: true, omitted: rows.length - limit };
}

export function buildUiInventory(xml: string, options?: {
  dumpId?: string;
  xmlPath?: string;
  maxActionables?: number;
  maxInputs?: number;
  maxTextNodes?: number;
}) {
  const sourceXml = String(xml || "");
  const nodes = parseUiNodes(sourceXml).filter((node) => node.bounds);
  const children = buildChildren(nodes);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const warnings: string[] = [];
  const packages = [...new Set(nodes.map((node) => node.package).filter(Boolean))].sort();
  const actionablesRaw = sortedVisual(nodes.filter(isActionableNode)).map((node) => compactNode(node, children, byId));
  const inputsRaw = sortedVisual(nodes.filter(isInputNode)).map((node) => compactNode(node, children, byId));
  const textNodesRaw = sortedVisual(
    nodes.filter((node) => Boolean(semanticLabel(node)) && !isInputNode(node) && !isActionableNode(node))
  ).map((node) => compactNode(node, children, byId, true));

  const actionables = limitRows(actionablesRaw, options?.maxActionables ?? 120, warnings, "actionables");
  const inputs = limitRows(inputsRaw, options?.maxInputs ?? 80, warnings, "inputs");
  const textNodes = limitRows(textNodesRaw, options?.maxTextNodes ?? 200, warnings, "text_nodes");

  return {
    ok: true,
    method: "ui_inventory_v1",
    source: "uiautomator_xml",
    legend: {
      pt: "tap center [x,y]",
      b: "bounds [left,top,right,bottom]",
      rid: "resource-id suffix",
      child_text: "semantic descendant labels",
    },
    dump_id: options?.dumpId || "",
    xml_path: options?.xmlPath || "",
    xml_omitted: true,
    xml_len: sourceXml.length,
    node_count: nodes.length,
    packages,
    counts: {
      actionables: actionablesRaw.length,
      inputs: inputsRaw.length,
      text_nodes: textNodesRaw.length,
    },
    included: {
      actionables: actionables.rows.length,
      inputs: inputs.rows.length,
      text_nodes: textNodes.rows.length,
    },
    truncated: {
      actionables: actionables.truncated,
      inputs: inputs.truncated,
      text_nodes: textNodes.truncated,
    },
    actionables: actionables.rows,
    inputs: inputs.rows,
    text_nodes: textNodes.rows,
    warnings,
  };
}

function pushUnique(list: string[], seen: Set<string>, value: string, limit = 80) {
  const text = shortText(value, limit);
  if (!text || seen.has(text)) return;
  seen.add(text);
  list.push(text);
}

function keywordList(nodes: UiNode[], field: "text" | "content_desc" | "resource_id" | "class") {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const node of sortedVisual(nodes)) {
    if (field === "resource_id") {
      pushUnique(out, seen, resourceTail(node.resource_id));
    } else if (field === "class") {
      pushUnique(out, seen, classTail(node.class));
    } else {
      pushUnique(out, seen, node[field]);
    }
  }
  return out;
}

export function buildUiKeywordIndex(xml: string, options?: {
  dumpId?: string;
  xmlPath?: string;
}) {
  const sourceXml = String(xml || "");
  const nodes = parseUiNodes(sourceXml).filter((node) => node.bounds);
  const actionables = nodes.filter(isActionableNode);
  const inputs = nodes.filter(isInputNode);
  const texts = keywordList(nodes, "text");
  const contentDescriptions = keywordList(nodes, "content_desc");
  const resourceIds = keywordList(nodes, "resource_id");
  const classes = keywordList(nodes, "class");
  return {
    ok: true,
    method: "ui_keyword_index_v1",
    source: "uiautomator_xml",
    dump_id: options?.dumpId || "",
    xml_path: options?.xmlPath || "",
    xml_omitted: true,
    xml_len: sourceXml.length,
    node_count: nodes.length,
    counts: {
      actionables: actionables.length,
      inputs: inputs.length,
      text: texts.length,
      content_desc: contentDescriptions.length,
      resource_id: resourceIds.length,
      class: classes.length,
    },
    query_hint: "Use android_ui_query with this dumpId and one of these fields: text, contentDesc, resourceId, className.",
    keywords: {
      text: texts,
      content_desc: contentDescriptions,
      resource_id: resourceIds,
      class: classes,
    },
  };
}

function textMatches(candidate: string, needle: string, exact?: boolean, ignoreCase?: boolean) {
  const lhs = ignoreCase === false ? String(candidate || "") : String(candidate || "").toLowerCase();
  const rhs = ignoreCase === false ? String(needle || "") : String(needle || "").toLowerCase();
  return exact === true ? lhs === rhs : lhs.includes(rhs);
}

function intersectsRegion(match: any, region?: UiQueryRegion) {
  if (!region) return true;
  const left = Number(region.left);
  const top = Number(region.top);
  const width = Number(region.width);
  const height = Number(region.height);
  if (![left, top, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return true;
  const right = left + width;
  const bottom = top + height;
  return match.left < right && match.right > left && match.top < bottom && match.bottom > top;
}

function pickUiMatch(matches: any[], strategy: string | undefined) {
  if (matches.length === 0) return null;
  const scored = matches.slice().sort((a, b) => {
    const score = (match: any) => {
      const area = Number(match.width || 0) * Number(match.height || 0);
      switch (strategy || "highest_confidence") {
        case "bottom_most":
          return Number(match.centerY || 0);
        case "top_most":
          return -Number(match.centerY || 0);
        case "left_most":
          return -Number(match.centerX || 0);
        case "right_most":
          return Number(match.centerX || 0);
        case "largest":
          return area;
        case "widest":
          return Number(match.width || 0);
        case "tallest":
          return Number(match.height || 0);
        case "clickable_first":
          return Number(match.clickable ? 100000 : 0) + area / 1000;
        case "highest_confidence":
        default:
          return Number(match.clickable ? 1000 : 0) + area / 1000;
      }
    };
    return score(b) - score(a);
  });
  return scored[0] || null;
}

function normalizeQueries(input: UiXmlQueryInput) {
  const queries = Array.isArray(input?.queries) ? input.queries : [];
  if (queries.length > 0) {
    return queries.map((query) => ({
      ...query,
      matchPickStrategy: query.matchPickStrategy || input.matchPickStrategy,
      detail: query.detail || input.detail,
      maxMatches: query.maxMatches ?? input.maxMatches,
    }));
  }
  return [
    {
      name: input?.name,
      nodeId: input?.nodeId,
      text: input?.text,
      contentDesc: input?.contentDesc,
      resourceId: input?.resourceId,
      className: input?.className,
      clickable: input?.clickable,
      enabled: input?.enabled,
      exact: input?.exact,
      ignoreCase: input?.ignoreCase,
      region: input?.region,
      matchPickStrategy: input?.matchPickStrategy,
      detail: input?.detail,
      maxMatches: input?.maxMatches,
    },
  ];
}

function compactQuery(query: UiQuery) {
  const out: any = {};
  for (const key of ["name", "nodeId", "text", "contentDesc", "resourceId", "className", "clickable", "enabled", "exact", "ignoreCase", "matchPickStrategy", "detail"] as const) {
    if ((query as any)[key] !== undefined && (query as any)[key] !== "") out[key] = (query as any)[key];
  }
  if (query.region) out.region = query.region;
  return out;
}

function matchNode(node: string, query: UiQuery) {
  const visibleText = attrValue(node, "text");
  const contentDesc = attrValue(node, "content-desc");
  const resourceId = attrValue(node, "resource-id");
  const className = attrValue(node, "class");
  const bounds = parseBounds(attrValue(node, "bounds"));
  if (!bounds) return null;

  const clickable = attrValue(node, "clickable") === "true";
  const enabled = attrValue(node, "enabled") !== "false";
  const matchedFields: string[] = [];

  if (query.text) {
    if (textMatches(visibleText, query.text, query.exact, query.ignoreCase)) matchedFields.push("text");
    else if (textMatches(contentDesc, query.text, query.exact, query.ignoreCase)) matchedFields.push("content-desc");
    else return null;
  }
  if (query.contentDesc) {
    if (textMatches(contentDesc, query.contentDesc, query.exact, query.ignoreCase)) matchedFields.push("content-desc");
    else return null;
  }
  if (query.resourceId) {
    if (textMatches(resourceId, query.resourceId, query.exact, query.ignoreCase)) matchedFields.push("resource-id");
    else return null;
  }
  if (query.className) {
    if (textMatches(className, query.className, query.exact, query.ignoreCase)) matchedFields.push("class");
    else return null;
  }
  if (query.clickable !== undefined && clickable !== query.clickable) return null;
  if (query.enabled !== undefined && enabled !== query.enabled) return null;
  if (Number.isFinite(Number(query.nodeId)) && Number(query.nodeId) > 0) {
    // nodeId is assigned by this parser in visual XML order. It is intended for
    // follow-up inspection from compact results, not as a stable cross-dump id.
    // The caller supplies it through queryUiXml's node index wrapper below.
  }

  if (!query.text && !query.contentDesc && !query.resourceId && !query.className && query.clickable === undefined && query.enabled === undefined) {
    return null;
  }

  const match = {
    ...bounds,
    text: visibleText,
    content_desc: contentDesc,
    resource_id: resourceId,
    class: className,
    clickable,
    enabled,
    matched_fields: matchedFields,
    matched_field: matchedFields[0] || "",
  };

  return intersectsRegion(match, query.region) ? match : null;
}

function matchNodeWithId(node: string, query: UiQuery, nodeId: number) {
  const wantedNodeId = Number(query.nodeId);
  if (Number.isFinite(wantedNodeId) && wantedNodeId > 0 && wantedNodeId !== nodeId) return null;
  if (Number.isFinite(wantedNodeId) && wantedNodeId > 0) {
    const bounds = parseBounds(attrValue(node, "bounds"));
    if (!bounds) return null;
    const visibleText = attrValue(node, "text");
    const contentDesc = attrValue(node, "content-desc");
    const resourceId = attrValue(node, "resource-id");
    const className = attrValue(node, "class");
    const clickable = attrValue(node, "clickable") === "true";
    const enabled = attrValue(node, "enabled") !== "false";
    return {
      ...bounds,
      node_id: nodeId,
      text: visibleText,
      content_desc: contentDesc,
      resource_id: resourceId,
      class: className,
      clickable,
      enabled,
      matched_fields: ["node_id"],
      matched_field: "node_id",
    };
  }
  const match = matchNode(node, query);
  return match ? { ...match, node_id: nodeId } : null;
}

function matchFlags(match: any) {
  const flags: string[] = [];
  if (match.clickable) flags.push("click");
  if (match.enabled === false) flags.push("disabled");
  return flags;
}

function matchLabel(match: any) {
  return shortText(match.text || match.content_desc || resourceTail(match.resource_id) || classTail(match.class), 100);
}

function compactMatch(match: any, index: number) {
  const out: any = {
    i: index,
    node_id: match.node_id,
    label: matchLabel(match),
    pt: [match.centerX, match.centerY],
    cls: classTail(match.class),
    matched: match.matched_field || "",
  };
  const rid = resourceTail(match.resource_id);
  const flags = matchFlags(match);
  if (rid) out.rid = rid;
  if (flags.length > 0) out.flags = flags;
  return out;
}

function richMatch(match: any, index: number) {
  const out = compactMatch(match, index);
  out.b = [match.left, match.top, match.right, match.bottom];
  if (match.text) out.text = shortText(match.text);
  if (match.content_desc && match.content_desc !== match.text) out.content_desc = shortText(match.content_desc);
  if (match.resource_id) out.resource_id = match.resource_id;
  if (match.class) out.class = match.class;
  out.clickable = Boolean(match.clickable);
  out.enabled = match.enabled !== false;
  return out;
}

function legacySelected(match: any | null) {
  if (!match) return null;
  return {
    left: match.left,
    top: match.top,
    right: match.right,
    bottom: match.bottom,
    width: match.width,
    height: match.height,
    centerX: match.centerX,
    centerY: match.centerY,
    node_id: match.node_id,
    text: match.text,
    content_desc: match.content_desc,
    resource_id: match.resource_id,
    class: match.class,
    clickable: match.clickable,
    enabled: match.enabled,
    matched_fields: match.matched_fields,
    matched_field: match.matched_field,
  };
}

function regionGroups(matches: any[]) {
  if (matches.length === 0) return [];
  const maxBottom = Math.max(...matches.map((match) => Number(match.bottom || 0)), 1);
  const groups = [
    { region: "top", count: 0 },
    { region: "middle", count: 0 },
    { region: "bottom", count: 0 },
  ];
  for (const match of matches) {
    const y = Number(match.centerY || 0) / maxBottom;
    if (y < 1 / 3) groups[0].count += 1;
    else if (y < 2 / 3) groups[1].count += 1;
    else groups[2].count += 1;
  }
  return groups.filter((group) => group.count > 0);
}

function relaxedQuery(query: UiQuery) {
  if (query.exact !== true && query.ignoreCase !== false) return null;
  return {
    ...query,
    exact: false,
    ignoreCase: true,
  };
}

export function queryUiXml(xml: string, input: UiXmlQueryInput) {
  const sourceXml = String(xml || "");
  const nodes = sourceXml.match(/<node\b[^>]*>/g) || [];
  const queries = normalizeQueries(input);
  let needsFallbackKeywords = false;
  const results = queries.map((query, index) => {
    const matches = nodes
      .map((node, nodeIndex) => matchNodeWithId(node, query, nodeIndex + 1))
      .filter(Boolean);
    let effectiveMatches = matches;
    let fallbackUsed = "";
    if (effectiveMatches.length === 0) {
      const relaxed = relaxedQuery(query);
      if (relaxed) {
        const relaxedMatches = nodes
          .map((node, nodeIndex) => matchNodeWithId(node, relaxed, nodeIndex + 1))
          .filter(Boolean);
        if (relaxedMatches.length > 0) {
          effectiveMatches = relaxedMatches;
          fallbackUsed = "relaxed_match";
        }
      }
    }
    if (effectiveMatches.length === 0) needsFallbackKeywords = true;

    const selected = pickUiMatch(effectiveMatches, query.matchPickStrategy || input.matchPickStrategy);
    const detail = String(query.detail || input.detail || "auto").toLowerCase();
    const explicitMax = query.maxMatches ?? input.maxMatches;
    const defaultLimit = effectiveMatches.length <= 5 ? 5 : 30;
    const maxMatches = Math.max(1, Math.min(Number(explicitMax ?? defaultLimit) || defaultLimit, 100));
    const outputMode = detail === "full"
      ? "full"
      : detail === "compact"
        ? "compact"
        : effectiveMatches.length <= 5
          ? "rich"
          : "compact";
    const visibleMatches = effectiveMatches.slice(0, maxMatches);
    const outputMatches = outputMode === "full"
      ? visibleMatches.map((match) => legacySelected(match))
      : outputMode === "rich"
        ? visibleMatches.map((match, matchIndex) => richMatch(match, matchIndex))
        : visibleMatches.map((match, matchIndex) => compactMatch(match, matchIndex));
    return {
      name: query.name || `query_${index + 1}`,
      query: compactQuery(query),
      match_count: effectiveMatches.length,
      original_match_count: matches.length,
      fallback_used: fallbackUsed || undefined,
      output_mode: outputMode,
      selected: legacySelected(selected),
      matches: outputMatches,
      matches_returned: outputMatches.length,
      matches_truncated: effectiveMatches.length > maxMatches,
      groups: effectiveMatches.length > maxMatches ? regionGroups(effectiveMatches) : [],
      next_query_hints: effectiveMatches.length > maxMatches
        ? ["Use region to narrow matches", "Use exact=true or a more specific text/resourceId", "Use nodeId with detail=full to inspect one candidate"]
        : effectiveMatches.length === 0
          ? ["Check fallback_keywords for available query terms", "Try exact=false/ignoreCase=true", "Try contentDesc/resourceId/className instead of text"]
          : [],
    };
  });
  const first = results.find((result) => result.selected) || null;
  const fallbackIndex = needsFallbackKeywords ? buildUiKeywordIndex(sourceXml).keywords : undefined;
  return {
    ok: Boolean(first),
    method: "ui_xml_query_v1",
    source: "uiautomator_xml",
    xml_len: sourceXml.length,
    node_count: nodes.length,
    query_count: results.length,
    best: first,
    results,
    ...(fallbackIndex ? { fallback_keywords: fallbackIndex } : {}),
  };
}
