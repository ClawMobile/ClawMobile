#!/usr/bin/env python3
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
CONTRACT_PATH = ROOT / "contract.json"
OUTPUT_PATH = ROOT / "SKILL.md"


def render_table(group: dict) -> str:
    if group["kind"] == "backend":
        rows = [
            f"| {entry['task']} | {entry['preferred']} | {entry['label']} | {entry['example']} |"
            for entry in group["entries"]
        ]
        return "\n".join(
            [
                "| Task | Preferred Backend | Label | Example |",
                "|------|-------------------|-------|---------|",
                *rows,
            ]
        )

    rows = []
    for entry in group["entries"]:
        notes = entry.get("notes", "")
        if notes:
            rows.append(f"| {entry['task']} | {entry['preferred']} | {entry['label']} | {notes} |")
        else:
            rows.append(f"| {entry['task']} | {entry['preferred']} | {entry['label']} | |")
    return "\n".join(
        [
            "| Task | Preferred Tool | Label | Notes |",
            "|------|----------------|-------|-------|",
            *rows,
        ]
    )


def render(contract: dict) -> str:
    parts: list[str] = []

    parts.extend(
        [
            "---",
            f"name: {contract['metadata']['name']}",
            f"description: {contract['metadata']['description']}",
            "---",
            "",
            "<!-- Generated from contract.json by generate_skill.py. Edit the contract, then run `python3 installer/workspace-seed/skills/clawmobile-capabilities/generate_skill.py`. -->",
            "",
            f"# {contract['title']}",
            "",
            *contract["intro"],
            "",
            f"## {contract['ownership']['heading']}",
            "",
            contract["ownership"]["summary"],
            "",
            *[f"- {point}" for point in contract["ownership"]["points"]],
            "",
            "---",
            "",
            "## Labels",
            "",
            *[f"- {line}" for line in contract["labels"]],
        ]
    )

    for group in contract["groups"]:
        parts.extend(["", "---", "", f"## {group['title']}", ""])
        if "intro" in group:
            parts.extend([group["intro"], ""])
        parts.append(render_table(group))

    parts.extend(["", "---", "", "## Minimal Contract Rules", ""])
    for line in contract["minimalRules"]:
        if line.startswith("  - "):
            parts.append(line)
        else:
            parts.append(f"- {line}")

    parts.extend(["", "---", "", "## Extension Notes (for contributors)", ""])
    parts.extend(contract["extensionNotes"])
    parts.append("")

    return "\n".join(parts)


def main() -> None:
    contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    OUTPUT_PATH.write_text(render(contract), encoding="utf-8")
    try:
        output_display_path = OUTPUT_PATH.relative_to(Path.cwd())
    except ValueError:
        output_display_path = OUTPUT_PATH
    print(f"[generate-skill] wrote {output_display_path}")


if __name__ == "__main__":
    main()
