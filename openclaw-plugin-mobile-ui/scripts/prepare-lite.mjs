import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.resolve(__dirname, "..");
const distDir = path.join(pluginRoot, "dist");

const removeTargets = [
  path.join(distDir, "backends", "droidrun.js"),
  path.join(distDir, "internal", "droidrun"),
  path.join(distDir, "pyexec"),
];

for (const target of removeTargets) {
  fs.rmSync(target, { recursive: true, force: true });
}

fs.writeFileSync(
  path.join(distDir, "CLAWMOBILE_LITE.txt"),
 [
   "ClawMobile Lite build",
   "DroidRun/Python bridge artifacts are intentionally omitted.",
    "Run with CLAWMOBILE_LITE=1.",
    "CLAW_MOBILE_ADB_ONLY=1 is still accepted as a legacy alias.",
   "",
 ].join("\n")
);

console.log("[prepare-lite] removed DroidRun/Python artifacts from dist/");
