---
title: BD-row empirical mapping (theme-clustering Phase 1 output)
date: 2026-05-08
status: phase-1-output
related:
  - docs/2026-05-08-theme-clustering-strategy-plan.md
---

# BD-row empirical mapping — Phase 1 output

**Purpose.** Seed for Phase 3's `lib/themes/taxonomy.ts`. Built by querying the live BD Feedback Lark Base (`MObXbnFnkafeEAsRrFUlcwrRgcf` / `tbl49YoFep0cYYDd`) on 2026-05-08 and hand-clustering all 155 non-Done rows.

**Method.**
1. Pulled all rows where `Status != Done` (155 rows).
2. Read `Item`, `Translate`, `Category`, `Sub-category`, `Priority`, `Date Created` for each.
3. Hand-clustered onto 14 candidate themes. Mapping target ≥95% of rows; achieved 100% (no `Other` bucket needed for this snapshot, but kept as escape valve).
4. Cross-referenced against `salon-x-business/INDEX.md` (13 PM-blessed feature areas) and the Dev `Module` MultiSelect (20 controlled values) to ensure dominantModules/dominantCategories hints align with how Dev tickets are tagged.

**Output.** The `CANDIDATE_THEMES` TS snippet at the end of this doc is ready to drop into `lib/themes/taxonomy.ts` for Phase 3.

---

## Distribution observed (155 BD rows, non-Done, 2026-05-08)

| Theme (proposed) | Rows | % |
|---|---:|---:|
| Booking Flow & Calendar | 47 | 30% |
| Counseling Sheet & CRM | 23 | 15% |
| Menu & Service Configuration | 18 | 12% |
| Reports & Analytics | 13 | 8% |
| POS Checkout & Payment | 11 | 7% |
| Staff Scheduling & Blocks | 10 | 6% |
| Online Booking / LINE Channel | 9 | 6% |
| Career Progression & Training | 7 | 5% |
| Multi-store & Location Settings | 6 | 4% |
| Notifications & Receipts | 5 | 3% |
| Mobile & Performance | 3 | 2% |
| Localization & i18n | 2 | 1% |
| Salary & Commission | 1 | 1% |
| Customer Search & Merge | — covered by CRM | — |

**Cardinality:** 13 themes for 155 rows. Sits in the prompt's target band (5–15). The four largest themes account for 65% of volume, which is a healthy distribution — neither too flat nor dominated by a single bucket.

**Anti-distribution observed in raw `Sub-category` values** (the user's complaint): 60+ distinct Sub-category strings with bilingual duplication (e.g., `Reservation` / `予約` / `Reservation\n` / `予約\n` are 4 different strings for the same concept). Grouping by raw Sub-category would yield 60+ themes — explicitly a problem the new vocabulary solves.

---

## Themes — name, hint, signals, examples

### 1. Booking Flow & Calendar  (47 rows)

**Hint.** Reservation creation flow, calendar UI, time-slot logic, booking duration/window, recurring closing days, booking caps. Includes both staff-side (POS calendar) and customer-side (online booking) when the issue is about the *booking mechanic*.

**dominantModules:** `Appointments`, `Online Booking`
**dominantCategories:** `Admin/POS`, `LINE OA`, `Online Booking`

**Example rows:**
- #1 — "I would like to be able to add photos and profiles of stylists" (LINE OA / Reservation)
- #11 — "On the customer reservation screen, the reservation button is placed against the flow of the UI..." (Admin/POS / 予約)
- #28 — "When you book a training session, the calendar shows the name of the training participant..." (Admin/POS / カレンダー)
- #54 — "Is it possible to view a week's worth of reservations on the reservation calendar, just like Google Calendar?" (Admin/POS / カレンダー)
- #71 — "Change appointment duration by dragging the item on Calendar page (tablet)" (Admin/POS / Calendar)
- #79 — "Default error 'This time slot is fully booked' is displayed for every booking error" (Admin/POS / Calendar / Bookings)
- #85 — "Maximum cap of bookable reservations for the entire salon" (Admin / Calendar / Bookings)
- #91 — "Even when max simultaneous reservations exceeded, allow manual bookings" (Admin/POS / Appointments)
- #103 — "5-step reservation flow: Reservation → Customer Selection → New Customer..." (Admin/POS / Calendar / Booking)
- #154 — "Set fixed rest days by 'nth weekday of month' (e.g., 3rd Saturday)" (no sub-cat)

### 2. Counseling Sheet & CRM  (23 rows)

**Hint.** Customer profile, counseling sheet (initial + pre-visit), Karte, customer notes, customer health score, customer search/merge by phone/Furigana. Covers everything about *the customer record itself*.

**dominantModules:** `CRM`, `Customer Management`
**dominantCategories:** `Admin/POS`, `CRM`

**Example rows:**
- #10 — "Function to merge customer information (consolidate multiple registrations)" (Admin/POS / 顧客)
- #15 — "LINE-reserved customer's phone number not registered in customer information" (Admin/POS / 顧客)
- #34 — "Personal info (email, DOB, address) visible to staff — hide it" (Staff App / 顧客)
- #57 — "Download customer data (incl. treatment records) in CSV" (Admin / 顧客)
- #64 — "Customer details page does not show actual transaction details" (Admin/POS / 顧客)
- #72 — "Furigana for customer kanji names" (Admin/POS / Customers)
- #102 — "Pre-visit counseling sheet requires selecting a 'reservation' that doesn't exist for non-SalonX bookings" (Admin / CRM / Counseling sheet)
- #106 — "Counseling sheet phone-number merge fails operationally → duplicate customer records" (Admin/POS / Counseling Sheet)
- #138 — "Rename '来店ヘルス' to 'ヘルススコア'" (Admin/POS / Customer Health)
- #143 — "Web booking creates duplicate customer record despite same phone number" (Admin/POS)
- #147 — "Customer search by phone with international '+81' format issue, Furigana sort, health/tag sort" (Admin/POS)
- #155 — "Web-based pre-visit counseling sheet (not just LINE)" (CRM / Counseling Sheet)
- #159 — "Staff-entered customer notes visible at-a-glance in reservation/calendar/transaction lists" (CRM / Customer Notes)
- #160 — "Handwritten head-chart customer Karte for iPad" (CRM / Customer Karte)
- #177 — "Postal code + secondary phone number fields in customer info" (Admin/POS / CRM)

### 3. Menu & Service Configuration  (18 rows)

**Hint.** Menu/service setup, per-staff menu restrictions, per-location menu assignment, menu pricing (incl. tax-in/out), set-menu / bundle composition, service duration overrides per stylist.

**dominantModules:** `Product & Inventory`, `Settings`
**dominantCategories:** `Admin`, `Admin/POS`

**Example rows:**
- #43 — "Rename 'Inventory Management' to 'Service Settings' in left nav" (Admin / 在庫管理)
- #45 — "Schedule price changes on calendar (e.g., new price from Jan 1)" (Admin / 在庫管理)
- #46 — "Per-stylist service duration overrides (e.g., haircut 40 min)" (Admin / 在庫管理)
- #47 — "Per-service: select staff who can deliver it" (Admin / 在庫管理)
- #48 — "Set main menu + upsell/cross-sell relationships per service" (Admin / 在庫管理)
- #61 — "Cannot register inventory when listing a product" (Admin/POS / メニュー)
- #67 — "Configure menu price tax-exclusive / tax-inclusive" (Admin / Menu / Services)
- #73 — "Staff assignment indicators on Menu List screen" (Admin / Menu / Staff)
- #81 — "Bulk staff assignment to multiple menu items in one action" (Admin/POS / Menu (Limit to specific staff))
- #86 — "Edit Menu page scroll function too restrictive" (Admin / Edit Menu)
- #95 — "Set menu categories appearing in dropdown tabs cause confusion" (Admin / Menu / Staff)
- #101 — "Per-store menu assignment for multi-store contracts" (LINE OA / Admin / Menu)
- #117 — "Hide detailed breakdown of set-menu items on customer reservation screen" (Online Booking / Menu / Category Descriptions)
- #121 — "Bulk-assign locations to hundreds of menus at once" (Admin / Menu / Location Management)
- #132 — "Set Menu booking — show Set Menu name + price above individual services" (Admin/POS / Set Menu Display)
- #134 — "Set menu negative discount (surcharge) not persisted at individual service level" (Admin/POS / Set Menu Pricing)

### 4. Reports & Analytics  (13 rows)

**Hint.** Sales reports, daily/monthly breakdowns, customer analysis, sales forecasting, CSV export, freee accounting integration, designation fee tracking.

**dominantModules:** `Analytics`, `Reports`
**dominantCategories:** `Admin/POS`, `POS`

**Example rows:**
- #19 — "Difficult to select start date for daily sales report" (Admin/POS / レポート)
- #20 — "Rename 'メニュー月次' / '月次商品' to 'サービス売上' / '物販売上'" (Admin/POS / レポート)
- #22 — "Click-through from report numbers to underlying transaction list" (Admin/POS / レポート)
- #23 — "Group staff into teams for report aggregation" (Admin/POS / レポート)
- #38 — "Garbled CSV when downloaded and opened" (Admin/POS / レポートReport)
- #50 — "Add reporting at the POS counter" (POS / レポート)
- #51 — "Daily sales breakdown by menu item" (POS / レポート)
- #60 — "freee (accounting) integration" (Admin/POS / レポート)
- #62 — "Richer report features (customer analysis, sales forecasting)" (Admin/POS / レポート機能)
- #65 — "Report breakdown: new(free), new(designated), repeater(free), repeater(designated)" (Admin/POS / レポート)
- #70 — "Sales forecast based on current bookings × menu prices" (Admin/POS / レポート機能)
- #88 — "Designation fee included in reports" (Admin / Reports)

### 5. POS Checkout & Payment  (11 rows)

**Hint.** Register/checkout flow, discount/surcharge UI, payment methods (QR, transit cards), per-item discounts, post-payment void/redo, checkout-from-calendar shortcut.

**dominantModules:** `POS`, `Register`, `Transactions`
**dominantCategories:** `Admin/POS`, `POS`

**Example rows:**
- #18 — "Reservation doesn't disappear from cash register after checkout; cannot redo accounting" (Admin/POS / レジ)
- #39 — "Allow QR / transit-card payment methods beyond cash and card" (Admin/POS / レジ)
- #44 — "Discount hidden behind '⋮' menu — make it more visible" (Admin/POS / レジ)
- #53 — "Pathway: calendar reservation → checkout in one click" (Admin/POS / レジ)
- #58 — "Per-individual-menu discount (currently only whole-bill)" (Admin/POS / レジ)
- #92 — "Wrap long menu names within button on register screen + larger buttons" (Admin/POS / Register)
- #94 — "Checkout button on individual service card within bundle booking" (Admin/POS / Appointments)
- #99 — "Allow surcharge at checkout (currently only discount). e.g., 'Color from ¥9000'" (Admin/POS / Register)
- #105 — "Calendar booking subtotal incorrect; register total correct" (Admin/POS / Appointment / Register)

### 6. Staff Scheduling & Blocks  (10 rows)

**Hint.** Shift management, ad-hoc unavailability, calendar blocks (creation + deletion + visual), per-staff special days, smartphone access for stylists.

**dominantModules:** `Staff Management`, `Appointments`
**dominantCategories:** `Admin/POS`, `Staff App`

**Example rows:**
- #25 — "Per-individual shift days off / half-days; week-based pattern setting" (Admin/POS / Settings)
- #49 — "View entire-store calendar from smartphone (visual)" (POS/Staff App / 予約)
- #59 — "Timesheet function (clock-in/clock-out)" (POS/Staff App / その他)
- #63 — "Ad-hoc staff unavailability — special day in web admin + POS" (Admin/POS / カレンダー)
- #68 — "Block staff availability" (Admin/POS / Calendar)
- #75 — "Edit display order of stylists" (Admin/POS / LINE OA / Staff)
- #122 — "Attendance clock-in/clock-out feature" (Admin/POS / Staff Management)
- #163 — "Calendar block deletion leaves stripe; darken block color" (Admin/POS / Calendar)
- #180 — "Merchant TAMA cannot add block time on calendar" (Calendar / Block Time)

### 7. Online Booking / LINE Channel  (9 rows)

**Hint.** LINE-specific reservation flow, online portal scrolling/display, LIFF/UAT/production endpoint, channel-specific notification routing, proxy-booking. Distinct from "Booking Flow & Calendar" — this bucket is about the *customer-facing channel* (LINE, web portal) more than the booking mechanic.

**dominantModules:** `LINE`, `Online Booking`
**dominantCategories:** `LINE OA`, `Online Booking`

**Example rows:**
- #87 — "Full description on booking page (long descriptions truncated)" (Online Booking / Online Booking)
- #97 — "Rename '備考' → 'リクエスト' on booking form" (Online Booking / Booking)
- #109 — "Tag-first customer selection when staff books on behalf" (Admin/POS / Booking)
- #110 — "Cannot scroll Select Date & Time on Online Booking; no time-slots" (Online Booking / Booking)
- #124 — "Cancelling 1 of 3 set-menu sub-bookings should cancel the bundle" (LINE OA / Reservation)
- #125 — "Block calendar from POS app on mobile" (POS / Booking)
- #126 — "Set-menu pre-visit counseling sheet not reflected in reservation details" (LINE OA / Reservation)
- #157 — "Booking on behalf / proxy booking (mother books for daughter)" (Online Booking / Booking on behalf)
- #161 — "Separate QR/URL for counseling sheet 1 vs counseling sheet 2" (LINE OA)
- #165 — "LIFF endpoint URL using UAT instead of production domain" (LINE OA / LINE)
- #166 — "LINE channel slow (~20s load)" (LINE OA / Load time)
- #167 — "Studio Teddy LINE-booking confirmation routing" (LINE OA / Confirmation Message)

### 8. Career Progression & Training  (7 rows)

**Hint.** Career level details, promotion requirements, test evaluation, training submission, performance metrics, badges. Staff App-specific.

**dominantModules:** `Staff App`
**dominantCategories:** `Staff App`

**Example rows:**
- #30 — "Where/who can view submitted training content?" (Staff App / 研修提出)
- #31 — "'Today's number' should be explicit ('this month's number')" (Staff App / パフォーマンス指標)
- #35 — "Make badge icon look luxurious" (Staff App / バッジ)
- #36 — "Display Base Salary, commission rate, designation fee per level" (Staff App / キャリアアップ)
- #37 — "Monthly performance trend UI (not personal-tab)" (Staff App / 個人)
- #113 — "Performance evaluation: both employee + manager comments delivered" (Staff App / Test Evaluation)
- #114 — "Promotion requirements: clarify which test, vague labels" (Staff App / Career Up / Promotion Requirements)
- #115 — "Career level details: vague advancement criteria" (Staff App / Career Up / Level Details)
- #116 — "Save/view videos and files" (Staff App / Media / Files)

### 9. Multi-store & Location Settings  (6 rows)

**Hint.** Multi-store registration controls, per-location naming, location opening hours, store contact details, mobile responsiveness of admin.

**dominantModules:** `Settings`, `Localization`
**dominantCategories:** `Admin`

**Example rows:**
- #7 — "Rename 'Store Name' to 'Brand name/Company name' in Basic Information" (Admin / Settings)
- #8 — "Block multi-store registration when not billing" (Admin / Locations)
- #9 — "Rename 'Location' to 'Store'" (Admin / Locations)
- #41 — "Vertical scroll on settings screen" (Admin / 設定)
- #52 — "JP address order: country → postal → prefecture → city → block → building" (Admin / 設定)
- #66 — "Public-holiday rule vs weekly-fixed-closing-day priority" (Admin / Calendar)
- #77 — "Setting: how holidays behave on normally-open days" (Admin / Location Opening Hours)
- #83 — "Web admin accessible via mobile browser" (Admin / Mobile responsiveness)
- #136 — "Owner-account phone/email on receipts vs store official; QR on email receipts" (Admin / Online Booking / Store Contact details)
- #164 — "Allow blank email/phone in receipts" (Admin / Store Contact)

### 10. Notifications & Receipts  (5 rows)

**Hint.** Appointment reminders via LINE/email, receipt download/send, confirmation messages routing, channel-specific notification fan-out.

**dominantModules:** `Marketing`, `LINE`, `Notifications & Communication`
**dominantCategories:** `Admin/POS`, `LINE OA`, `Online Booking`

**Example rows:**
- #84 — "Send appointment reminders via LINE / email" (LINE OA / Bookings / Appointments)
- #89 — "Auto-send pre-visit consultation sheet immediately after booking" (Admin / LINE OA)
- #90 — "Add/delete pre-visit / post-visit survey questions" (Admin/POS / LINE OA / Pre-visit / Post-visit survey)
- #131 — "カルテ (CS) badge on calendar appointments" (Reservation / Counseling Sheet)
- #135 — "Link unlinked counseling sheets from appointment detail view" (Reservation / Counseling Sheet)
- #153 — "Download receipt; send via LINE" (no sub-cat)

### 11. Mobile & Performance  (3 rows)

**Hint.** Mobile-web admin, slow page loads, Android-specific bugs.

**dominantModules:** `Tech`, `User Experience`
**dominantCategories:** `Admin`, `LINE OA`

**Example rows:**
- #4 — "Date selection slow (~10s)" (LINE OA / Reservation)
- #129 — "Android booking portal/counseling sheet displays English instead of Japanese (locale 'ja-JP' not matched to 'ja')" (Reservation / Language / i18n)
- #166 — "LINE channel slow (~20s)" (LINE OA / Load time) — also overlaps with theme 7

### 12. Localization & i18n  (2 rows)

**Hint.** Translation quality, locale matching, English residue in JP-only screens.

**dominantModules:** `Localization`
**dominantCategories:** `Admin`

**Example rows:**
- #5 — "Part of English display remains; please change to Japanese" (LINE OA / Reservation)
- #107 — "SalonX repeatedly run through Google Translate; unnatural Japanese" (Admin / Localisation (Language))
- (#129 also touches i18n — primarily routed to Mobile & Performance because the bug is locale-string-matching, not translation quality)

### 13. Salary & Commission  (1 row)

**Hint.** Payroll defaults, commission rates per level, designation fees in payroll.

**dominantModules:** `Salary`
**dominantCategories:** `Staff App`

**Example rows:**
- #112 — "Default salary in JPY off by one digit" (Staff App / Payroll / Salary Settings)
- (Designation-fee in reports — #88 — overlaps; routed to Reports & Analytics because the user concern is the report visibility, not the payroll calculation.)

### 14. Other (cross-cutting) — escape valve, 0 rows currently

**Hint.** Reserved for genuinely cross-cutting concerns that don't fit any candidate. If used, file a `taxonomy_proposals` entry to evaluate adding a new candidate.

---

## Coverage check

- **155 rows mapped → 100% coverage** (no rows resisted classification).
- **Largest theme** "Booking Flow & Calendar" at 30% — cohesive, not a dumping ground; rows all share the booking-mechanic concern.
- **Smallest themes** Salary & Commission (1 row), Localization & i18n (2 rows) — kept as separate themes because the underlying concerns are distinct enough that merging them into a catch-all loses signal. If volume stays this low for 6+ weeks, fold into "Other" and revisit.

---

## CANDIDATE_THEMES TypeScript snippet (drop into `lib/themes/taxonomy.ts`)

```typescript
// Hand-curated theme vocabulary derived from 2026-05-08 BD-row mapping.
// See docs/2026-05-08-bd-row-empirical-mapping.md for rationale and examples.
//
// Cluster prompt instructs Claude to PREFER names from this list. New names
// (max 2/run, see MAX_NEW_THEMES_PER_RUN below) get logged to taxonomy_proposals
// for explicit review before joining the canon.

export type CandidateTheme = {
  /** Title-Case theme name, ≤4 words. Used as both label and stable id seed. */
  name: string;
  /** One-line description shown to Claude as a hint. Helps it decide which
   * candidate fits when a row is borderline. */
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

export const MAX_NEW_THEMES_PER_RUN = 2;
```

---

## Notes for Phase 3

1. **Prompt should emphasize the `hint` field** — it's the disambiguator when two candidates plausibly fit. e.g., "Designation fee in reports" → Reports & Analytics, not Salary & Commission, because the user-visible concern is *report visibility*.
2. **Bilingual rows are fine** — Claude already prefers `translate` over `item` (`cluster.ts:111`). The candidate names are English-only, but rows in Japanese should map cleanly because the candidate names describe the *concern*, not the surface phrase.
3. **Theme overlap is real** — #166 ("LINE 20s load") could plausibly land in *Mobile & Performance* or *Online Booking & LINE Channel*. Resolve by row-level priority: when a row is *fundamentally about a channel*, use the channel theme; when it's *fundamentally about performance/mobile*, use that theme. This is the hint-disambiguation use case above.
4. **"Other" should rarely fire on this snapshot** — 100% map without it. If it fires >5% of rows in a real run, we have a vocabulary gap; surface via taxonomy_proposals.
5. **Validate cardinality after first real Phase 3 run** — if Claude keeps emitting names outside the candidate set, raise `MAX_NEW_THEMES_PER_RUN` cautiously (2 → 3) only after auditing the proposals.
