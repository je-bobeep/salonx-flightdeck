// Type-only re-exports so the package doesn't depend on apps/dashboard/lib/.
// Source of truth for the wire shape stays apps/dashboard/lib/data-shapes.ts;
// any drift will be caught by the dashboard import in Task 0.5.

import type { AgingSignal } from "@flightdeck/lark/aging";

export type BdRow = {
  recordId: string;
  number: string;
  item: string;
  translate: string;
  category: string[];
  subCategory: string;
  fromPocMerchant: boolean;
  status: string;
  priority: string;
  dateCreatedMs: number | null;
  dateRecordedMs: number | null;
  ageDays: number | null;
  createdByName: string;
  hasLinkedDev: boolean;
  linkedDevIds: string[];
  hasDayOfDeploying: boolean;
  aging: AgingSignal[];
};

export type DevRow = {
  recordId: string;
  description: string;
  storyDescription: string;
  status: string;
  priority: string;
  milestone: string;
  sprint: string;
  module: string[];
  product: string[];
  requestType: string;
  customerFeedback: boolean;
  assignees: { id: string; name?: string }[];
  bdLinkIds: string[];
  eta: string;
  releaseDate: string;
  internalTargetDate: string;
  lastModifiedMs: number | null;
  aging: AgingSignal[];
};
