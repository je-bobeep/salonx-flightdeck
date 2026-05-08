// Hand-curated theme vocabulary for the BD-feedback clusterer.
//
// Derived from the 2026-05-08 BD-row empirical mapping (155 non-Done rows
// hand-clustered). Full rationale + per-row examples in:
//   docs/2026-05-08-bd-row-empirical-mapping.md
//
// The cluster prompt instructs Claude to PREFER names from this list. New
// names are capped at MAX_NEW_THEMES_PER_RUN per call — they get logged to
// the taxonomy_proposals SQLite table for explicit review before joining the
// canon. This eliminates the ossification path that motivated the v2 plan
// (clustering drifting toward Sub-category-shaped names over time).
//
// To add a new candidate:
//   1. Approve a row in /themes/proposals (writes to taxonomy_proposals.status='accepted')
//   2. Add a CandidateTheme entry below
//   3. Run "Cluster from scratch" so the next run uses the new vocabulary
//
// To rename a candidate:
//   1. Update the `name` here
//   2. The slug-based stable id (slugify(name)) will change → manual overrides
//      pointing at the old slug will fall back to name-based recovery in
//      applyRowOverrides. Brief override loss is possible across rename.

export type CandidateTheme = {
  /** Title-Case theme name, ≤4 words. Used as both label and stable id seed
   * (slugified). Must be unique across the list. */
  name: string;
  /** One-line description shown to Claude as a hint. Helps it decide which
   * candidate fits when a row is borderline. Keep ≤25 words. */
  hint: string;
  /** Dev `Module` MultiSelect values that typically map to this theme. Helps
   * the prompt anchor without forcing the grouping axis to be Module. */
  dominantModules?: string[];
  /** BD `Category` MultiSelect values that typically map to this theme. */
  dominantCategories?: string[];
};

export const CANDIDATE_THEMES: CandidateTheme[] = [
  {
    name: "Booking Flow & Calendar",
    hint: "Reservation creation, calendar UI, time-slot logic, booking duration/window, recurring closing days, booking caps. Both staff-side and customer-side when the issue is about the booking mechanic.",
    dominantModules: ["Appointments", "Online Booking"],
    dominantCategories: ["Admin/POS", "LINE OA", "Online Booking"],
  },
  {
    name: "Counseling Sheet & CRM",
    hint: "Customer profile, counseling sheet (initial + pre-visit), Karte, customer notes, customer health score, customer search/merge by phone/Furigana.",
    dominantModules: ["CRM"],
    dominantCategories: ["Admin/POS", "CRM"],
  },
  {
    name: "Menu & Service Configuration",
    hint: "Menu/service setup, per-staff menu restrictions, per-location menu assignment, menu pricing (tax-in/out), set-menu / bundle composition, service duration per stylist.",
    dominantModules: ["Product & Inventory", "Settings"],
    dominantCategories: ["Admin", "Admin/POS"],
  },
  {
    name: "Reports & Analytics",
    hint: "Sales reports, daily/monthly breakdowns, customer analysis, sales forecasting, CSV export, freee integration, designation-fee tracking.",
    dominantModules: ["Analytics", "Reports"],
    dominantCategories: ["Admin/POS", "POS"],
  },
  {
    name: "POS Checkout & Payment",
    hint: "Register/checkout flow, discount/surcharge UI, payment methods (QR, transit), per-item discounts, post-payment void/redo, checkout-from-calendar shortcut.",
    dominantModules: ["POS", "Register", "Transactions"],
    dominantCategories: ["Admin/POS", "POS"],
  },
  {
    name: "Staff Scheduling & Blocks",
    hint: "Shift management, ad-hoc unavailability, calendar blocks, per-staff special days, smartphone calendar access, attendance/timesheet.",
    dominantModules: ["Staff Management", "Appointments"],
    dominantCategories: ["Admin/POS", "Staff App"],
  },
  {
    name: "Online Booking & LINE Channel",
    hint: "LINE-specific reservation flow, online portal display, LIFF/endpoint config, channel-specific notification routing, proxy booking. Distinct from Booking Flow — this is about the customer-facing channel.",
    dominantModules: ["LINE", "Online Booking"],
    dominantCategories: ["LINE OA", "Online Booking"],
  },
  {
    name: "Career Progression & Training",
    hint: "Career level details, promotion requirements, test evaluation, training submission, performance metrics, badges. Staff App-specific.",
    dominantModules: ["Staff App"],
    dominantCategories: ["Staff App"],
  },
  {
    name: "Multi-store & Locations",
    hint: "Multi-store registration controls, per-location naming, location opening hours, store contact, public-holiday vs fixed-closing rules.",
    dominantModules: ["Settings"],
    dominantCategories: ["Admin"],
  },
  {
    name: "Notifications & Receipts",
    hint: "Appointment reminders via LINE/email, receipt download/send, confirmation message routing, pre/post-visit surveys.",
    dominantModules: ["Marketing", "LINE"],
    dominantCategories: ["Admin/POS", "LINE OA", "Online Booking"],
  },
  {
    name: "Mobile & Performance",
    hint: "Mobile-web admin, slow page loads, Android-specific bugs, locale-matching bugs that surface on mobile.",
    dominantModules: ["Tech", "User Experience"],
    dominantCategories: ["Admin", "LINE OA"],
  },
  {
    name: "Localization & i18n",
    hint: "Translation quality, English residue in JP-only screens, machine-translated copy.",
    dominantModules: ["Localization"],
    dominantCategories: ["Admin"],
  },
  {
    name: "Salary & Commission",
    hint: "Payroll defaults, commission rates per level, designation fees in payroll calculation. Distinct from Reports & Analytics, which is about visibility.",
    dominantModules: ["Salary"],
    dominantCategories: ["Staff App"],
  },
  {
    name: "Other (cross-cutting)",
    hint: "Escape valve. Use only when no candidate fits AND the row's concern is genuinely cross-cutting. If used repeatedly, propose a new candidate via taxonomy_proposals.",
    dominantModules: [],
    dominantCategories: [],
  },
];

/** Maximum number of brand-new (non-candidate) theme names Claude may emit
 * per cluster run. Drift defense: keeps the vocabulary close to the canon
 * unless there's strong empirical pressure to expand it. */
export const MAX_NEW_THEMES_PER_RUN = 2;

/** Set of canonical names (lowercased) for fast lookup in cluster.ts post-
 * processing. */
export const CANDIDATE_THEME_NAMES_LC: Set<string> = new Set(
  CANDIDATE_THEMES.map((t) => t.name.toLowerCase())
);

/** Returns true if the given name (case-insensitively) is a canonical
 * candidate. Used by both the cluster post-processor and the override
 * recovery path. */
export function isCandidateName(name: string): boolean {
  return CANDIDATE_THEME_NAMES_LC.has(name.trim().toLowerCase());
}

/** Lookup a candidate by case-insensitive name. Returns the canonical entry
 * (so callers see the exact `name` casing used in CANDIDATE_THEMES). */
export function findCandidate(name: string): CandidateTheme | null {
  const lc = name.trim().toLowerCase();
  return (
    CANDIDATE_THEMES.find((t) => t.name.toLowerCase() === lc) ?? null
  );
}
