import type { RunSummary } from "../runner.js";

export interface CheckMeta {
  adapter: string;
  model?: string;
}

/** success when no bot comments remain open (created + kept === 0), else neutral. */
export function conclusionFor(summary: RunSummary): "success" | "neutral" {
  return summary.created + summary.kept === 0 ? "success" : "neutral";
}

export function formatOutput(summary: RunSummary, meta: CheckMeta): { title: string; summary: string } {
  const open = summary.created + summary.kept;
  const model = meta.model ? ` (${meta.model})` : "";
  const body = [
    `Revisão concluída com **${meta.adapter}**${model}.`,
    "",
    `🆕 ${summary.created} novo(s) · ♻️ ${summary.kept} mantido(s) · ✅ ${summary.resolved} resolvido(s)`,
    "",
    open === 0
      ? "Nenhum problema em aberto. 🎉"
      : `**${open} problema(s) em aberto** (${summary.kept} de revisões anteriores). Veja os comentários na aba *Files changed*.`,
  ].join("\n");
  return {
    title: open === 0 ? "Nenhum problema em aberto" : `${open} problema(s) em aberto`,
    summary: body,
  };
}

export function errorOutput(error: unknown): { title: string; summary: string } {
  const msg = error instanceof Error ? error.message : String(error);
  return {
    title: "Revisão falhou",
    summary: `A revisão não pôde ser concluída e nada foi postado.\n\n\`\`\`\n${msg}\n\`\`\``,
  };
}
