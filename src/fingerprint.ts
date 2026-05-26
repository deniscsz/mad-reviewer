import { createHash } from "node:crypto";

const MARKER_RE = /<!--\s*mad-reviewer:fp=([a-f0-9]{16})\s*-->/;

export function computeFingerprint(input: {
  file: string;
  category: string;
  dedupeKey: string;
}): string {
  const normalized = [
    input.file.trim(),
    input.category.trim().toLowerCase(),
    input.dedupeKey.trim().toLowerCase(),
  ].join(" ");
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export function embedFingerprint(body: string, fp: string): string {
  return `${body}\n\n<!-- mad-reviewer:fp=${fp} -->`;
}

export function parseFingerprint(body: string): string | null {
  const m = body.match(MARKER_RE);
  return m ? m[1]! : null;
}
