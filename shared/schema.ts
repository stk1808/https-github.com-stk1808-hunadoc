import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ============================================================
// Users — 5 roles: pharmacist, prescriber, pharmacy, manager, patient
// ============================================================
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  password: text("password").notNull(), // bcrypt hash
  role: text("role", { enum: ["pharmacist", "prescriber", "pharmacy", "manager", "patient"] }).notNull(),
  fullName: text("full_name").notNull(),
  phone: text("phone"),
  // role-specific identifiers
  npi: text("npi"), // prescribers
  pharmacistLicense: text("pharmacist_license"), // pharmacists
  ncpdp: text("ncpdp"), // pharmacies
  organizationName: text("organization_name"), // pharmacies, managers
  specialty: text("specialty"),
  state: text("state").default("HI"),
  verified: integer("verified", { mode: "boolean" }).default(false),
  // pharmacist-only flags
  laiCertified: integer("lai_certified", { mode: "boolean" }).default(false),
  mobile: integer("mobile", { mode: "boolean" }).default(false), // available for mobile administration
  createdAt: integer("created_at").notNull(),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, verified: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ============================================================
// Licenses & credentials — uploaded by pharmacists, prescribers, pharmacies
// ============================================================
export const licenses = sqliteTable("licenses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  type: text("type", { enum: ["pharmacist_license", "dea", "npi", "pharmacy_permit", "controlled_substance", "telehealth_license", "professional_liability_insurance", "form_1099", "other_certifications", "ncpdp", "pharmacy_dea", "pharmacy_npi", "pharmacy_license", "pic_number"] }).notNull(),
  number: text("number").notNull(),
  issuingState: text("issuing_state").notNull(),
  issueDate: text("issue_date"),
  expirationDate: text("expiration_date"),
  fileName: text("file_name"),
  fileData: text("file_data"), // base64 — for alpha. In prod: S3 + BAA.
  status: text("status", { enum: ["pending", "verified", "expired", "rejected"] }).default("pending"),
  ledgerTxHash: text("ledger_tx_hash"), // XRPL tx hash when verified
  documentHash: text("document_hash"), // SHA-256 of file
  createdAt: integer("created_at").notNull(),
});

export const insertLicenseSchema = createInsertSchema(licenses).omit({ id: true, createdAt: true, status: true, ledgerTxHash: true, documentHash: true });
export type InsertLicense = z.infer<typeof insertLicenseSchema>;
export type License = typeof licenses.$inferSelect;

// ============================================================
// Patients — managed by prescribers; patient role can also own their own record
// ============================================================
export const patients = sqliteTable("patients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"), // null until patient creates account; links to users.id when claimed
  mrn: text("mrn").notNull().unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  dob: text("dob").notNull(),
  sex: text("sex"),
  email: text("email"),
  phone: text("phone"),
  allergies: text("allergies"),
  primaryPrescriberId: integer("primary_prescriber_id"),
  createdAt: integer("created_at").notNull(),
});

export const insertPatientSchema = createInsertSchema(patients).omit({ id: true, createdAt: true });
export type InsertPatient = z.infer<typeof insertPatientSchema>;
export type Patient = typeof patients.$inferSelect;

// ============================================================
// Prescriptions — created by prescribers, dispensed by pharmacists
// ============================================================
export const prescriptions = sqliteTable("prescriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  rxNumber: text("rx_number").notNull().unique(),
  patientId: integer("patient_id").notNull(),
  prescriberId: integer("prescriber_id").notNull(),
  pharmacyId: integer("pharmacy_id"), // null until routed
  drug: text("drug").notNull(),
  strength: text("strength").notNull(),
  form: text("form").notNull(),
  sig: text("sig").notNull(),
  quantity: text("quantity").notNull(),
  refills: integer("refills").default(0),
  daw: integer("daw", { mode: "boolean" }).default(false),
  channel: text("channel", { enum: ["surescripts", "direct", "manual"] }).default("manual"),
  destinationSoftware: text("destination_software", { enum: ["pioneer_rx", "qs1", "best_rx", "rx30", "liberty", "manual"] }).default("manual"),
  ncpdpScript: text("ncpdp_script"), // SCRIPT 2017071 NEWRX (SIMULATED)
  // Long-acting injectable (LAI) administration routing
  isLai: integer("is_lai", { mode: "boolean" }).default(false),
  laiSchedule: text("lai_schedule", { enum: ["asap", "monthly", "q2w", "q4w", "q3month", "q6month"] }),
  mobilePharmacistId: integer("mobile_pharmacist_id"), // assigned LAI-certified pharmacist
  status: text("status", { enum: ["draft", "signed", "transmitted", "received", "filled", "cancelled"] }).default("draft"),
  documentHash: text("document_hash"),
  ledgerTxHash: text("ledger_tx_hash"),
  ledgerSequence: integer("ledger_sequence"),
  signedAt: integer("signed_at"),
  filledAt: integer("filled_at"),
  notes: text("notes"),
  createdAt: integer("created_at").notNull(),
});

export const insertPrescriptionSchema = createInsertSchema(prescriptions).omit({
  id: true, createdAt: true, status: true, documentHash: true, ledgerTxHash: true, ledgerSequence: true, signedAt: true, filledAt: true, rxNumber: true,
});
export type InsertPrescription = z.infer<typeof insertPrescriptionSchema>;
export type Prescription = typeof prescriptions.$inferSelect;

// ============================================================
// Shifts — pharmacy posts, pharmacist accepts
// ============================================================
export const shifts = sqliteTable("shifts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  pharmacyId: integer("pharmacy_id").notNull(),
  pharmacistId: integer("pharmacist_id"),
  title: text("title").notNull(),
  date: text("date").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  hourlyRate: real("hourly_rate").notNull(),
  location: text("location").notNull(),
  notes: text("notes"),
  urgency: text("urgency", { enum: ["routine", "urgent", "stat"] }).default("routine"),
  status: text("status", { enum: ["open", "accepted", "in_progress", "completed", "cancelled"] }).default("open"),
  ledgerTxHash: text("ledger_tx_hash"),
  acceptedAt: integer("accepted_at"),
  completedAt: integer("completed_at"),
  createdAt: integer("created_at").notNull(),
});

export const insertShiftSchema = createInsertSchema(shifts).omit({
  id: true, createdAt: true, pharmacistId: true, status: true, ledgerTxHash: true, acceptedAt: true, completedAt: true,
});
export type InsertShift = z.infer<typeof insertShiftSchema>;
export type Shift = typeof shifts.$inferSelect;

// ============================================================
// Telehealth visits
// ============================================================
export const visits = sqliteTable("visits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  patientId: integer("patient_id").notNull(),
  prescriberId: integer("prescriber_id").notNull(),
  scheduledFor: text("scheduled_for").notNull(),
  reason: text("reason").notNull(),
  status: text("status", { enum: ["scheduled", "live", "completed", "cancelled"] }).default("scheduled"),
  notes: text("notes"),
  noteHash: text("note_hash"),
  ledgerTxHash: text("ledger_tx_hash"),
  startedAt: integer("started_at"),
  endedAt: integer("ended_at"),
  createdAt: integer("created_at").notNull(),
});

export const insertVisitSchema = createInsertSchema(visits).omit({
  id: true, createdAt: true, status: true, noteHash: true, ledgerTxHash: true, startedAt: true, endedAt: true, notes: true,
});
export type InsertVisit = z.infer<typeof insertVisitSchema>;
export type Visit = typeof visits.$inferSelect;

// ============================================================
// Pharmacy claims — submitted to a SIMULATED PBM, settled on XRPL Testnet
// ============================================================
export const claims = sqliteTable("claims", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  claimNumber: text("claim_number").notNull().unique(),
  prescriptionId: integer("prescription_id").notNull(),
  pharmacyUserId: integer("pharmacy_user_id").notNull(),
  payerName: text("payer_name").notNull(), // SIMULATED PBM (e.g. "DemoPBM")
  billedAmount: real("billed_amount").notNull(),
  adjudicatedAmount: real("adjudicated_amount"),
  patientResponsibility: real("patient_responsibility"),
  status: text("status", { enum: ["submitted", "adjudicated", "paid", "rejected"] }).default("submitted"),
  rejectReason: text("reject_reason"),
  submittedAt: integer("submitted_at").notNull(),
  adjudicatedAt: integer("adjudicated_at"),
  paidAt: integer("paid_at"),
  submitTxHash: text("submit_tx_hash"),       // XRPL hash anchoring the claim payload
  settlementTxHash: text("settlement_tx_hash"), // XRPL Payment from payer wallet to pharmacy wallet
  settlementAmountXrp: real("settlement_amount_xrp"),
  payerAddress: text("payer_address"),
  pharmacyAddress: text("pharmacy_address"),
  createdAt: integer("created_at").notNull(),
});
export type Claim = typeof claims.$inferSelect;

// ============================================================
// LAI administrations — long-acting injectable visits/timestamps
// ============================================================
export const laiAdministrations = sqliteTable("lai_administrations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  prescriptionId: integer("prescription_id").notNull(),
  pharmacistId: integer("pharmacist_id").notNull(), // mobile pharmacist who accepts/administers
  scheduledFor: integer("scheduled_for"),           // unix ms — null if ASAP
  schedule: text("schedule", { enum: ["asap", "monthly", "q2w", "q4w", "q3month", "q6month"] }).default("asap"),
  cycleNumber: integer("cycle_number").default(1),  // 1, 2, 3 ... follow-up index for recurring schedules
  status: text("status", { enum: ["pending", "accepted", "scheduled", "administered", "missed", "cancelled"] }).default("pending"),
  acceptedAt: integer("accepted_at"),
  administeredAt: integer("administered_at"),       // actual injection timestamp
  administrationNotes: text("administration_notes"),
  documentHash: text("document_hash"),
  acceptTxHash: text("accept_tx_hash"),             // XRPL anchor for accept event
  administerTxHash: text("administer_tx_hash"),     // XRPL anchor for administration event
  claimId: integer("claim_id"),                     // auto-submitted admin-fee claim
  createdAt: integer("created_at").notNull(),
});
export type LaiAdministration = typeof laiAdministrations.$inferSelect;

// ============================================================
// Ledger entries — local mirror of every XRPL broadcast for fast querying
// ============================================================
export const ledgerEntries = sqliteTable("ledger_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type", { enum: ["prescription", "license", "shift", "visit", "claim", "settlement", "lai_administration"] }).notNull(),
  entityId: integer("entity_id").notNull(),
  action: text("action").notNull(), // sign, verify, accept, complete, etc.
  documentHash: text("document_hash").notNull(),
  txHash: text("tx_hash").notNull(),
  ledgerSequence: integer("ledger_sequence"),
  signerUserId: integer("signer_user_id"),
  signerName: text("signer_name"),
  network: text("network").default("testnet"),
  explorerUrl: text("explorer_url"),
  createdAt: integer("created_at").notNull(),
});

export type LedgerEntry = typeof ledgerEntries.$inferSelect;

// ============================================================
// Auth / login
// ============================================================
export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});
export type LoginInput = z.infer<typeof loginSchema>;
