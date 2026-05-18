import path from "path";
import { getWorkspaceDir } from "../tools/workspace";

const SKILL_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function validateSkillNameIdentifier(skillName: string) {
  const name = String(skillName || "").trim();
  if (!name) throw new Error("skill_name must be non-empty");
  if (!SKILL_NAME_RE.test(name) || name === "." || name === ".." || name.includes("..")) {
    throw new Error("skill_name must be an identifier, not a path");
  }
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) {
    throw new Error("skill_name must not contain path separators");
  }
  return name;
}

export function isPathInsideOrEqual(childPath: string, parentPath: string) {
  const child = path.resolve(childPath);
  const parent = path.resolve(parentPath);
  const relative = path.relative(parent, child);
  return relative === "" || (Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative));
}

export function resolveWorkspaceSkillDirByName(skillName: string) {
  const name = validateSkillNameIdentifier(skillName);
  const skillsRoot = path.resolve(getWorkspaceDir(), "skills");
  const skillDir = path.resolve(skillsRoot, name);
  if (!isPathInsideOrEqual(skillDir, skillsRoot)) {
    throw new Error("resolved skill_name escapes workspace skills directory");
  }
  return skillDir;
}
