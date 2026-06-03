import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.resolve(__dirname, "..");
const distDir = path.join(pluginRoot, "dist");
const legacyRuntimeMarker = ["CLAWMOBILE", "LITE.txt"].join("_");

const removeTargets = [
  path.join(distDir, "backends", "droidrun.js"),
  path.join(distDir, "internal", "droidrun"),
  path.join(distDir, "pyexec"),
  path.join(distDir, legacyRuntimeMarker),
];

for (const target of removeTargets) {
  fs.rmSync(target, { recursive: true, force: true });
}

fs.writeFileSync(
  path.join(distDir, "CLAWMOBILE_TERMUX_RUNTIME.txt"),
  [
    "ClawMobile Termux runtime build",
    "Legacy full-backend bridge artifacts are intentionally omitted.",
    "No plugin runtime mode flag is required.",
    "",
  ].join("\n")
);

console.log("[prepare-lite] removed legacy full-backend artifacts from dist/");
