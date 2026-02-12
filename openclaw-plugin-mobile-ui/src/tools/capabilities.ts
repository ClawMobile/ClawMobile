import fs from "fs";
import path from "path";
import { appendToolAudit, truncateString, DEFAULT_MAX_OUTPUT_BYTES } from "./workspace";

const DEFAULT_PATH = path.resolve(__dirname, "..", "..", "..", "installer", "workspace-seed", "CAPABILITIES.mobile.md");
const PACKAGE_PATH = path.resolve(__dirname, "..", "..", "package.json");

export async function mobile_capabilities(input?: { query?: string }) {
  const timestamp = new Date().toISOString();
  const query = (input?.query || "").toLowerCase().trim();
  let text = "";
  let pluginVersion = "unknown";
  let buildId = "unknown";

  try {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, "utf8"));
    pluginVersion = pkg?.version || "unknown";
    const stat = fs.statSync(PACKAGE_PATH);
    buildId = `mobile-ui@${pluginVersion}-${stat.mtimeMs}`;
  } catch {}

  try {
    text = fs.readFileSync(DEFAULT_PATH, "utf8");
  } catch (e: any) {
    appendToolAudit({
      time: timestamp,
      tool: "mobile_capabilities",
      ok: false,
      error: "capabilities_not_found",
      build_id: buildId,
    });
    return { ok: false, error: "capabilities_not_found", path: DEFAULT_PATH, message: String(e?.message || e) };
  }

  if (query) {
    const lines = text.split(/\r?\n/);
    const filtered = lines.filter((l) => l.toLowerCase().includes(query));
    text = filtered.join("\n");
  }

  text = truncateString(text, DEFAULT_MAX_OUTPUT_BYTES);
  appendToolAudit({
    time: timestamp,
    tool: "mobile_capabilities",
    ok: true,
    build_id: buildId,
  });

  return {
    ok: true,
    path: DEFAULT_PATH,
    content: text,
    truncated: text.length >= DEFAULT_MAX_OUTPUT_BYTES,
    build_id: buildId,
    plugin_version: pluginVersion,
    timestamp,
  };
}
