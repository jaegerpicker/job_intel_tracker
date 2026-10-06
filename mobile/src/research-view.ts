import { ResearchPackage, packages } from "./research";
/** Presentation types. Backend transport adapts its confirmed contract into these. */
export const researchDeliverables = [
  "research",
  "resume",
  "cover_letter",
  "interview_prep",
] as const;
export type ResearchDeliverable = (typeof researchDeliverables)[number];
export const deliverableLabels: Record<ResearchDeliverable, string> = {
  research: "Job & company research",
  resume: "Tailored resume",
  cover_letter: "Cover letter",
  interview_prep: "Interview prep",
};
export type ResearchDraft = {
  package: ResearchPackage;
  instructions: string;
};
export type MaterialCoverage = {
  type: ResearchDeliverable;
  available: boolean;
};
export type ResearchResultView = {
  id: string;
  type: ResearchDeliverable;
  title: string;
  text?: string;
  filename?: string;
  source?: string;
  author?: string;
  observedOn?: string;
  version?: number;
};
export type ResearchRequestView = {
  id: string;
  jobId: string;
  version: number;
  status: "queued" | "claimed" | "completed" | "blocked" | "cancelled";
  deliverables: ResearchDeliverable[];
  instructions: string;
  claimedBy?: string;
  detail?: string;
  results: ResearchResultView[];
  missing?: ResearchDeliverable[];
  leaseUntil?: number;
  history?: string[];
};

export function prepareResearchDraft(
  packageChoice: ResearchPackage,
  instructions: string,
): ResearchDraft {
  if (!packages.includes(packageChoice) || instructions.length > 4000)
    throw new Error(
      "Choose a package and keep instructions under 4,000 characters.",
    );
  return { package: packageChoice, instructions: instructions.trim() };
}
