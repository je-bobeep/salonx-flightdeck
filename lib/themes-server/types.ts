// BdRow / DevRow type duplicates so this package doesn't import from
// apps/dashboard/lib/. Source of truth stays apps/dashboard/lib/data-shapes.ts.
// There is no automated assertion that these stay in sync — TypeScript's
// structural typing surfaces drift as errors at the dashboard callsites that
// consume @flightdeck/themes-server/fetch's return values. If the dashboard
// adds a field these cluster paths need, mirror it here.

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
