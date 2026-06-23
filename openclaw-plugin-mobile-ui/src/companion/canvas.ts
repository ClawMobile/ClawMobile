import type { CanvasSchema } from "./types";

export function intentCanvas(text: string, summary = "Ready to submit this task to OpenClaw."): CanvasSchema {
  return {
    title: "Task Review",
    summary,
    fields: [
      {
        id: "intent",
        label: "Intent",
        type: "Text",
        textValue: text,
      },
      {
        id: "confirm",
        label: "Ask before running phone actions",
        type: "Checkbox",
        checked: true,
      },
    ],
    actions: [
      { id: "approve", label: "Approve" },
      { id: "edit", label: "Edit" },
    ],
  };
}
