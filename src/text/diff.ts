import { createTwoFilesPatch } from "diff";

export function diffTexts(oldText: string, newText: string): string {
  if (oldText === newText) return "(no differences)";
  const patch = createTwoFilesPatch(
    "old",
    "new",
    oldText.endsWith("\n") ? oldText : oldText + "\n",
    newText.endsWith("\n") ? newText : newText + "\n",
  );
  const lines = patch.split("\n");
  const start = lines.findIndex((line) => line.startsWith("---"));
  return lines.slice(start).join("\n").trimEnd();
}
