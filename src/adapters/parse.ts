export function extractFindingsJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no JSON array found in adapter output");
  }
  return JSON.parse(candidate.slice(start, end + 1));
}

// `opencode run --format json` emits JSONL events; the assistant's answer arrives
// in text parts. Reconstruct that text, deduping incremental updates by part id.
export function extractOpencodeText(stdout: string): string {
  const byId = new Map<string, string>();
  let i = 0;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: unknown;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const o = obj as {
      type?: unknown;
      text?: unknown;
      part?: { id?: unknown; type?: unknown; text?: unknown };
    };
    const part = o.part;
    if (part && part.type === "text" && typeof part.text === "string") {
      const key = typeof part.id === "string" ? part.id : `#${i++}`;
      byId.set(key, part.text);
    } else if (o.type === "text" && typeof o.text === "string") {
      byId.set(`#${i++}`, o.text);
    }
  }
  if (byId.size === 0) return stdout;
  return [...byId.values()].join("");
}
