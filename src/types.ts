import { z } from "zod";

export const FindingSchema = z.object({
  file: z.string().min(1),
  line: z.number().int().positive(),
  category: z.string().min(1),
  dedupeKey: z.string().min(1),
  severity: z.literal("bug"),
  title: z.string().min(1),
  body: z.string().min(1),
});

export type Finding = z.infer<typeof FindingSchema>;

export const FindingsArraySchema = z.array(FindingSchema);

export interface Job {
  owner: string;
  repo: string;
  pr: number;
  headSha: string;
  baseSha: string;
  installationId: number;
}
