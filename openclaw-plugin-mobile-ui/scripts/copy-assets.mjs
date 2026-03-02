import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, "..");
const srcDir = path.join(repoRoot, "pyexec");
const dstDir = path.join(repoRoot, "dist", "pyexec");

function copyDir(src, dst) {
  if (!fs.existsSync(src)) {
    console.error(`[copy-assets] source missing: ${src}`);
    process.exit(1);
  }
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, dstPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

copyDir(srcDir, dstDir);
console.log(`[copy-assets] copied ${srcDir} -> ${dstDir}`);
