import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and, desc, or } from "drizzle-orm";
import bcrypt from "bcryptjs";
import path from "path";
import fs from "fs";
import {
  users, licenses, patients, prescriptions, shifts, visits, ledgerEntries, claims, laiAdministrations,
  type User, type InsertUser,
  type License, type InsertLicense,
  type Patient, type InsertPatient,
  type Prescription, type InsertPrescription,
  type Shift, type InsertShift,
  type Visit, type InsertVisit,
  type LedgerEntry,
  type Claim,
  type LaiAdministration,
} from "@shared/schema";

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
const sqlite = new Database(path.join(DATA_DIR, "hunadoc.db"));
sqlite.pragma("journal_mode = WAL");
const db = drizzle(sqlite);

// Schema bootstrap (since we're not using migrations for this alpha)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL,
    full_name TEXT NOT NULL,
    phone TEXT,
    npi TEXT,
    pharmacist_license TEXT,
    ncpdp TEXT,
    organization_name TEXT,
    specialty TEXT,
    state TEXT DEFAULT 'HI',
    verified INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS licenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    number TEXT NOT NULL,
    issuing_state TEXT NOT NULL,
    issue_date TEXT,
    expiration_date TEXT,
    file_name TEXT,
    file_data TEXT,
    status TEXT DEFAULT 'pending',
    ledger_tx_hash TEXT,
    document_hash TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    mrn TEXT NOT NULL UNIQUE,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    dob TEXT NOT NULL,
    sex TEXT,
    email TEXT,
    phone TEXT,
    allergies TEXT,
    primary_prescriber_id INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS prescriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rx_number TEXT NOT NULL UNIQUE,
    patient_id INTEGER NOT NULL,
    prescriber_id INTEGER NOT NULL,
    pharmacy_id INTEGER,
    drug TEXT NOT NULL,
    strength TEXT NOT NULL,
    form TEXT NOT NULL,
    sig TEXT NOT NULL,
    quantity TEXT NOT NULL,
    refills INTEGER DEFAULT 0,
    daw INTEGER DEFAULT 0,
    channel TEXT DEFAULT 'manual',
    ncpdp_script TEXT,
    status TEXT DEFAULT 'draft',
    document_hash TEXT,
    ledger_tx_hash TEXT,
    ledger_sequence INTEGER,
    signed_at INTEGER,
    filled_at INTEGER,
    notes TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pharmacy_id INTEGER NOT NULL,
    pharmacist_id INTEGER,
    title TEXT NOT NULL,
    date TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    hourly_rate REAL NOT NULL,
    location TEXT NOT NULL,
    notes TEXT,
    urgency TEXT DEFAULT 'routine',
    status TEXT DEFAULT 'open',
    ledger_tx_hash TEXT,
    accepted_at INTEGER,
    completed_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS visits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER NOT NULL,
    prescriber_id INTEGER NOT NULL,
    scheduled_for TEXT NOT NULL,
    reason TEXT NOT NULL,
    status TEXT DEFAULT 'scheduled',
    notes TEXT,
    note_hash TEXT,
    ledger_tx_hash TEXT,
    started_at INTEGER,
    ended_at INTEGER,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ledger_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL,
    entity_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    document_hash TEXT NOT NULL,
    tx_hash TEXT NOT NULL,
    ledger_sequence INTEGER,
    signer_user_id INTEGER,
    signer_name TEXT,
    network TEXT DEFAULT 'testnet',
    explorer_url TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS claims (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    claim_number TEXT NOT NULL UNIQUE,
    prescription_id INTEGER NOT NULL,
    pharmacy_user_id INTEGER NOT NULL,
    payer_name TEXT NOT NULL,
    billed_amount REAL NOT NULL,
    adjudicated_amount REAL,
    patient_responsibility REAL,
    status TEXT DEFAULT 'submitted',
    reject_reason TEXT,
    submitted_at INTEGER NOT NULL,
    adjudicated_at INTEGER,
    paid_at INTEGER,
    submit_tx_hash TEXT,
    settlement_tx_hash TEXT,
    settlement_amount_xrp REAL,
    payer_address TEXT,
    pharmacy_address TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS lai_administrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prescription_id INTEGER NOT NULL,
    pharmacist_id INTEGER NOT NULL,
    scheduled_for INTEGER,
    schedule TEXT DEFAULT 'asap',
    cycle_number INTEGER DEFAULT 1,
    status TEXT DEFAULT 'pending',
    accepted_at INTEGER,
    administered_at INTEGER,
    administration_notes TEXT,
    document_hash TEXT,
    accept_tx_hash TEXT,
    administer_tx_hash TEXT,
    claim_id INTEGER,
    created_at INTEGER NOT NULL
  );
`);

// Idempotent column adds for existing databases (Render disk has prior data)
function addColumnIfMissing(table: string, column: string, ddl: string) {
  try {
    const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.find((c) => c.name === column)) {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    }
  } catch (e) {
    console.warn(`[migrate] ${table}.${column}:`, (e as Error).message);
  }
}
addColumnIfMissing("prescriptions", "destination_software", "TEXT DEFAULT 'manual'");
addColumnIfMissing("prescriptions", "is_lai", "INTEGER DEFAULT 0");
addColumnIfMissing("prescriptions", "lai_schedule", "TEXT");
addColumnIfMissing("prescriptions", "mobile_pharmacist_id", "INTEGER");
addColumnIfMissing("users", "lai_certified", "INTEGER DEFAULT 0");
addColumnIfMissing("users", "mobile", "INTEGER DEFAULT 0");

// One-shot fixup: ensure demo pharmacist is LAI-certified + mobile so existing prod DBs
// (where seedIfEmpty already ran) still surface a choice in the prescriber picker.
try {
  sqlite.exec(
    "UPDATE users SET lai_certified = 1, mobile = 1 WHERE email = 'pharmacist@demo.huna' AND (lai_certified = 0 OR mobile = 0)"
  );
} catch (e) {
  console.warn("[migrate] demo lai pharmacist fixup:", (e as Error).message);
}

const now = () => Date.now();

export interface IStorage {
  // Users
  createUser(u: InsertUser): Promise<User>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserById(id: number): Promise<User | undefined>;
  listUsersByRole(role: string): Promise<User[]>;
  setUserVerified(id: number, verified: boolean): Promise<void>;

  // Licenses
  createLicense(l: InsertLicense): Promise<License>;
  listLicensesByUser(userId: number): Promise<License[]>;
  listAllLicenses(): Promise<License[]>;
  getLicense(id: number): Promise<License | undefined>;
  updateLicenseStatus(id: number, status: string, txHash?: string, documentHash?: string): Promise<void>;

  // Patients
  createPatient(p: InsertPatient): Promise<Patient>;
  listPatients(prescriberId?: number): Promise<Patient[]>;
  getPatient(id: number): Promise<Patient | undefined>;

  // Prescriptions
  createPrescription(p: InsertPrescription, prescriberId: number): Promise<Prescription>;
  listPrescriptions(filter?: { prescriberId?: number; pharmacyId?: number; patientId?: number; mobilePharmacistId?: number }): Promise<Prescription[]>;
  getPrescription(id: number): Promise<Prescription | undefined>;
  signPrescription(id: number, txHash: string, ledgerSeq: number, docHash: string, ncpdpScript?: string): Promise<Prescription | undefined>;
  updatePrescriptionRouting(id: number, channel: string, destinationSoftware: string, pharmacyId?: number): Promise<void>;
  setPrescriptionLai(id: number, isLai: boolean, schedule?: string | null, mobilePharmacistId?: number | null): Promise<void>;
  fillPrescription(id: number): Promise<Prescription | undefined>;

  // LAI administrations
  createLaiAdministration(a: { prescriptionId: number; pharmacistId: number; schedule: string; scheduledFor?: number | null; cycleNumber?: number; }): Promise<LaiAdministration>;
  getLaiAdministration(id: number): Promise<LaiAdministration | undefined>;
  listLaiAdministrations(filter?: { pharmacistId?: number; prescriptionId?: number }): Promise<LaiAdministration[]>;
  acceptLaiAdministration(id: number, scheduledFor: number | null, txHash: string, docHash: string): Promise<LaiAdministration | undefined>;
  administerLai(id: number, txHash: string, docHash: string, notes?: string, claimId?: number): Promise<LaiAdministration | undefined>;

  // Claims & T0 settlements
  createClaim(c: { prescriptionId: number; pharmacyUserId: number; payerName: string; billedAmount: number; payerAddress?: string; pharmacyAddress?: string; submitTxHash?: string; }): Promise<Claim>;
  getClaim(id: number): Promise<Claim | undefined>;
  listClaimsByPharmacy(pharmacyUserId: number): Promise<Claim[]>;
  listAllClaims(): Promise<Claim[]>;
  adjudicateClaim(id: number, adjudicatedAmount: number, patientResponsibility: number, status: "adjudicated" | "rejected", rejectReason?: string): Promise<Claim | undefined>;
  settleClaim(id: number, settlementTxHash: string, settlementAmountXrp: number): Promise<Claim | undefined>;

  // Shifts
  createShift(s: InsertShift): Promise<Shift>;
  listShifts(filter?: { pharmacyId?: number; pharmacistId?: number; status?: string }): Promise<Shift[]>;
  acceptShift(id: number, pharmacistId: number): Promise<Shift | undefined>;
  completeShift(id: number, txHash?: string): Promise<Shift | undefined>;

  // Visits
  createVisit(v: InsertVisit): Promise<Visit>;
  listVisits(filter?: { prescriberId?: number; patientId?: number }): Promise<Visit[]>;
  startVisit(id: number): Promise<Visit | undefined>;
  endVisit(id: number, notes: string, noteHash: string, txHash: string): Promise<Visit | undefined>;

  // Ledger
  recordLedger(entry: Omit<LedgerEntry, "id" | "createdAt">): Promise<LedgerEntry>;
  listLedger(limit?: number): Promise<LedgerEntry[]>;

  // Stats
  getStats(): Promise<{ users: number; prescriptions: number; shifts: number; ledgerEntries: number }>;
}

class SQLiteStorage implements IStorage {
  async createUser(u: InsertUser): Promise<User> {
    const hash = await bcrypt.hash(u.password, 10);
    const result = db.insert(users).values({ ...u, password: hash, createdAt: now() }).returning().get();
    return result;
  }
  async getUserByEmail(email: string) {
    return db.select().from(users).where(eq(users.email, email)).get();
  }
  async getUserById(id: number) {
    return db.select().from(users).where(eq(users.id, id)).get();
  }
  async listUsersByRole(role: string) {
    return db.select().from(users).where(eq(users.role, role)).all();
  }
  async setUserVerified(id: number, verified: boolean) {
    db.update(users).set({ verified }).where(eq(users.id, id)).run();
  }

  async createLicense(l: InsertLicense): Promise<License> {
    return db.insert(licenses).values({ ...l, createdAt: now() }).returning().get();
  }
  async listLicensesByUser(userId: number) {
    return db.select().from(licenses).where(eq(licenses.userId, userId)).all();
  }
  async listAllLicenses() {
    return db.select().from(licenses).orderBy(desc(licenses.createdAt)).all();
  }
  async getLicense(id: number) {
    return db.select().from(licenses).where(eq(licenses.id, id)).get();
  }
  async updateLicenseStatus(id: number, status: string, txHash?: string, documentHash?: string) {
    const update: any = { status };
    if (txHash) update.ledgerTxHash = txHash;
    if (documentHash) update.documentHash = documentHash;
    db.update(licenses).set(update).where(eq(licenses.id, id)).run();
  }

  async createPatient(p: InsertPatient): Promise<Patient> {
    return db.insert(patients).values({ ...p, createdAt: now() }).returning().get();
  }
  async listPatients(prescriberId?: number) {
    if (prescriberId) {
      return db.select().from(patients).where(eq(patients.primaryPrescriberId, prescriberId)).all();
    }
    return db.select().from(patients).all();
  }
  async getPatient(id: number) {
    return db.select().from(patients).where(eq(patients.id, id)).get();
  }

  async createPrescription(p: InsertPrescription, prescriberId: number): Promise<Prescription> {
    const rxNumber = `Rx-${100000 + Math.floor(Math.random() * 900000)}`;
    return db.insert(prescriptions).values({ ...p, prescriberId, rxNumber, createdAt: now() }).returning().get();
  }
  async listPrescriptions(filter?: { prescriberId?: number; pharmacyId?: number; patientId?: number; mobilePharmacistId?: number }) {
    let q = db.select().from(prescriptions).$dynamic();
    if (filter?.prescriberId) q = q.where(eq(prescriptions.prescriberId, filter.prescriberId));
    else if (filter?.pharmacyId) q = q.where(eq(prescriptions.pharmacyId, filter.pharmacyId));
    else if (filter?.patientId) q = q.where(eq(prescriptions.patientId, filter.patientId));
    else if (filter?.mobilePharmacistId) q = q.where(eq(prescriptions.mobilePharmacistId, filter.mobilePharmacistId));
    return q.orderBy(desc(prescriptions.createdAt)).all();
  }
  async getPrescription(id: number) {
    return db.select().from(prescriptions).where(eq(prescriptions.id, id)).get();
  }
  async signPrescription(id: number, txHash: string, ledgerSeq: number, docHash: string, ncpdpScript?: string) {
    const update: any = {
      status: "signed",
      ledgerTxHash: txHash,
      ledgerSequence: ledgerSeq,
      documentHash: docHash,
      signedAt: now(),
    };
    if (ncpdpScript) update.ncpdpScript = ncpdpScript;
    db.update(prescriptions).set(update).where(eq(prescriptions.id, id)).run();
    return this.getPrescription(id);
  }
  async updatePrescriptionRouting(id: number, channel: string, destinationSoftware: string, pharmacyId?: number) {
    const update: any = { channel, destinationSoftware };
    if (pharmacyId !== undefined) update.pharmacyId = pharmacyId;
    db.update(prescriptions).set(update).where(eq(prescriptions.id, id)).run();
  }
  async setPrescriptionLai(id: number, isLai: boolean, schedule?: string | null, mobilePharmacistId?: number | null) {
    const update: any = { isLai };
    if (schedule !== undefined) update.laiSchedule = schedule;
    if (mobilePharmacistId !== undefined) update.mobilePharmacistId = mobilePharmacistId;
    db.update(prescriptions).set(update).where(eq(prescriptions.id, id)).run();
  }
  async fillPrescription(id: number) {
    db.update(prescriptions).set({ status: "filled", filledAt: now() }).where(eq(prescriptions.id, id)).run();
    return this.getPrescription(id);
  }

  async createShift(s: InsertShift): Promise<Shift> {
    return db.insert(shifts).values({ ...s, createdAt: now() }).returning().get();
  }
  async listShifts(filter?: { pharmacyId?: number; pharmacistId?: number; status?: string }) {
    let q = db.select().from(shifts).$dynamic();
    const conds = [];
    if (filter?.pharmacyId) conds.push(eq(shifts.pharmacyId, filter.pharmacyId));
    if (filter?.pharmacistId) conds.push(eq(shifts.pharmacistId, filter.pharmacistId));
    if (filter?.status) conds.push(eq(shifts.status, filter.status as any));
    if (conds.length) q = q.where(and(...conds));
    return q.orderBy(desc(shifts.createdAt)).all();
  }
  async acceptShift(id: number, pharmacistId: number) {
    db.update(shifts).set({ pharmacistId, status: "accepted", acceptedAt: now() }).where(eq(shifts.id, id)).run();
    return db.select().from(shifts).where(eq(shifts.id, id)).get();
  }
  async completeShift(id: number, txHash?: string) {
    const update: any = { status: "completed", completedAt: now() };
    if (txHash) update.ledgerTxHash = txHash;
    db.update(shifts).set(update).where(eq(shifts.id, id)).run();
    return db.select().from(shifts).where(eq(shifts.id, id)).get();
  }

  async createVisit(v: InsertVisit): Promise<Visit> {
    return db.insert(visits).values({ ...v, createdAt: now() }).returning().get();
  }
  async listVisits(filter?: { prescriberId?: number; patientId?: number }) {
    let q = db.select().from(visits).$dynamic();
    if (filter?.prescriberId) q = q.where(eq(visits.prescriberId, filter.prescriberId));
    else if (filter?.patientId) q = q.where(eq(visits.patientId, filter.patientId));
    return q.orderBy(desc(visits.scheduledFor)).all();
  }
  async startVisit(id: number) {
    db.update(visits).set({ status: "live", startedAt: now() }).where(eq(visits.id, id)).run();
    return db.select().from(visits).where(eq(visits.id, id)).get();
  }
  async endVisit(id: number, notes: string, noteHash: string, txHash: string) {
    db.update(visits).set({
      status: "completed",
      notes,
      noteHash,
      ledgerTxHash: txHash,
      endedAt: now(),
    }).where(eq(visits.id, id)).run();
    return db.select().from(visits).where(eq(visits.id, id)).get();
  }

  // ============================================================
  // Claims
  // ============================================================
  async createClaim(c: { prescriptionId: number; pharmacyUserId: number; payerName: string; billedAmount: number; payerAddress?: string; pharmacyAddress?: string; submitTxHash?: string; }): Promise<Claim> {
    const claimNumber = `CLM-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 1000).toString().padStart(3, "0")}`;
    return db.insert(claims).values({
      claimNumber,
      prescriptionId: c.prescriptionId,
      pharmacyUserId: c.pharmacyUserId,
      payerName: c.payerName,
      billedAmount: c.billedAmount,
      status: "submitted",
      submittedAt: now(),
      submitTxHash: c.submitTxHash,
      payerAddress: c.payerAddress,
      pharmacyAddress: c.pharmacyAddress,
      createdAt: now(),
    }).returning().get();
  }
  async getClaim(id: number) {
    return db.select().from(claims).where(eq(claims.id, id)).get();
  }
  async listClaimsByPharmacy(pharmacyUserId: number) {
    return db.select().from(claims).where(eq(claims.pharmacyUserId, pharmacyUserId)).orderBy(desc(claims.createdAt)).all();
  }
  async listAllClaims() {
    return db.select().from(claims).orderBy(desc(claims.createdAt)).all();
  }
  async adjudicateClaim(id: number, adjudicatedAmount: number, patientResponsibility: number, status: "adjudicated" | "rejected", rejectReason?: string) {
    const update: any = {
      adjudicatedAmount,
      patientResponsibility,
      status,
      adjudicatedAt: now(),
    };
    if (rejectReason) update.rejectReason = rejectReason;
    db.update(claims).set(update).where(eq(claims.id, id)).run();
    return this.getClaim(id);
  }
  async settleClaim(id: number, settlementTxHash: string, settlementAmountXrp: number) {
    db.update(claims).set({
      settlementTxHash,
      settlementAmountXrp,
      status: "paid",
      paidAt: now(),
    }).where(eq(claims.id, id)).run();
    return this.getClaim(id);
  }

  // ============================================================
  // LAI administrations
  // ============================================================
  async createLaiAdministration(a: { prescriptionId: number; pharmacistId: number; schedule: string; scheduledFor?: number | null; cycleNumber?: number; }): Promise<LaiAdministration> {
    return db.insert(laiAdministrations).values({
      prescriptionId: a.prescriptionId,
      pharmacistId: a.pharmacistId,
      schedule: a.schedule as any,
      scheduledFor: a.scheduledFor ?? null,
      cycleNumber: a.cycleNumber ?? 1,
      status: "pending",
      createdAt: now(),
    }).returning().get();
  }
  async getLaiAdministration(id: number) {
    return db.select().from(laiAdministrations).where(eq(laiAdministrations.id, id)).get();
  }
  async listLaiAdministrations(filter?: { pharmacistId?: number; prescriptionId?: number }) {
    let q = db.select().from(laiAdministrations).$dynamic();
    if (filter?.pharmacistId) q = q.where(eq(laiAdministrations.pharmacistId, filter.pharmacistId));
    else if (filter?.prescriptionId) q = q.where(eq(laiAdministrations.prescriptionId, filter.prescriptionId));
    return q.orderBy(desc(laiAdministrations.createdAt)).all();
  }
  async acceptLaiAdministration(id: number, scheduledFor: number | null, txHash: string, docHash: string) {
    db.update(laiAdministrations).set({
      status: scheduledFor ? "scheduled" : "accepted",
      acceptedAt: now(),
      scheduledFor: scheduledFor ?? null,
      acceptTxHash: txHash,
      documentHash: docHash,
    }).where(eq(laiAdministrations.id, id)).run();
    return this.getLaiAdministration(id);
  }
  async administerLai(id: number, txHash: string, docHash: string, notes?: string, claimId?: number) {
    const update: any = {
      status: "administered",
      administeredAt: now(),
      administerTxHash: txHash,
      documentHash: docHash,
    };
    if (notes) update.administrationNotes = notes;
    if (claimId) update.claimId = claimId;
    db.update(laiAdministrations).set(update).where(eq(laiAdministrations.id, id)).run();
    return this.getLaiAdministration(id);
  }

  async recordLedger(entry: Omit<LedgerEntry, "id" | "createdAt">) {
    return db.insert(ledgerEntries).values({ ...entry, createdAt: now() }).returning().get();
  }
  async listLedger(limit = 100) {
    return db.select().from(ledgerEntries).orderBy(desc(ledgerEntries.createdAt)).limit(limit).all();
  }

  async getStats() {
    const u = (sqlite.prepare("SELECT COUNT(*) as c FROM users").get() as any).c;
    const p = (sqlite.prepare("SELECT COUNT(*) as c FROM prescriptions").get() as any).c;
    const s = (sqlite.prepare("SELECT COUNT(*) as c FROM shifts").get() as any).c;
    const l = (sqlite.prepare("SELECT COUNT(*) as c FROM ledger_entries").get() as any).c;
    return { users: u, prescriptions: p, shifts: s, ledgerEntries: l };
  }
}

export const storage = new SQLiteStorage();

// Seed demo accounts on first run
export async function seedIfEmpty() {
  const existing = (sqlite.prepare("SELECT COUNT(*) as c FROM users").get() as any).c;
  if (existing > 0) return;
  console.log("[seed] Creating demo accounts...");

  const demo = [
    { email: "pharmacist@demo.huna", password: "demo1234", role: "pharmacist", fullName: "Marcus Tanaka, PharmD", pharmacistLicense: "HI-PH-44521", state: "HI" },
    { email: "prescriber@demo.huna", password: "demo1234", role: "prescriber", fullName: "Dr. Aiyana Cole, MD", npi: "1942583729", specialty: "Internal Medicine · Telehealth", state: "HI" },
    { email: "pharmacy@demo.huna", password: "demo1234", role: "pharmacy", fullName: "Kakaako Rx Owner", organizationName: "Kakaako Rx", ncpdp: "1234567", state: "HI" },
    { email: "manager@demo.huna", password: "demo1234", role: "manager", fullName: "Sarah Mendel", organizationName: "HunaDoc Operations", state: "HI" },
    { email: "patient@demo.huna", password: "demo1234", role: "patient", fullName: "Kenji Nakamura", state: "HI" },
  ];
  const userIdByEmail: Record<string, number> = {};
  for (const d of demo) {
    const u = await storage.createUser(d as any);
    // Pharmacist starts unverified so the manager has something to verify in alpha
    if (d.role !== "pharmacist") await storage.setUserVerified(u.id, true);
    userIdByEmail[d.email] = u.id;
  }

  // Mark the demo pharmacist as LAI-certified + mobile so the prescriber picker has a choice
  const pharmacistUserId = userIdByEmail["pharmacist@demo.huna"];
  if (pharmacistUserId) {
    db.update(users).set({ laiCertified: true, mobile: true }).where(eq(users.id, pharmacistUserId)).run();
  }

  // Seed a sample pending license for the pharmacist so the manager flow has data on first run
  const pharmacistId = userIdByEmail["pharmacist@demo.huna"];
  if (pharmacistId) {
    await storage.createLicense({
      userId: pharmacistId, type: "pharmacist_license", number: "HI-PH-44521",
      issuingState: "HI", issueDate: "2019-08-14", expirationDate: "2027-08-14",
      fileName: "hi-ph-44521.pdf", fileData: null,
    } as any);
  }

  // Seed a couple of patients linked to the prescriber
  const prescriber = await storage.getUserByEmail("prescriber@demo.huna");
  const patient = await storage.getUserByEmail("patient@demo.huna");
  if (prescriber && patient) {
    const p = await storage.createPatient({
      userId: patient.id, mrn: "MRN-884-2901", firstName: "Kenji", lastName: "Nakamura",
      dob: "1962-04-09", sex: "M", email: patient.email, phone: "+1-808-555-0142",
      allergies: "Sulfa", primaryPrescriberId: prescriber.id,
    } as any);
    await storage.createPatient({
      userId: null as any, mrn: "MRN-771-3304", firstName: "Rajiv", lastName: "Patel",
      dob: "1958-11-22", sex: "M", email: "rajiv@example.com", phone: "+1-808-555-0188",
      allergies: "None known", primaryPrescriberId: prescriber.id,
    } as any);

    // Seed 2 sample shifts so the marketplace isn't empty
    const pharmacy = await storage.getUserByEmail("pharmacy@demo.huna");
    if (pharmacy) {
      await storage.createShift({
        pharmacyId: pharmacy.id, title: "Saturday coverage", date: "2026-05-09",
        startTime: "09:00", endTime: "17:00", hourlyRate: 72, location: "Kakaako Rx · Honolulu",
        notes: "PRN coverage for community pharmacy", urgency: "routine",
      } as any);
      await storage.createShift({
        pharmacyId: pharmacy.id, title: "STAT — call-out today", date: "2026-05-08",
        startTime: "14:00", endTime: "21:00", hourlyRate: 95, location: "Kakaako Rx · Honolulu",
        notes: "Same-day coverage needed; PIC required", urgency: "stat",
      } as any);
    }
  }
  console.log("[seed] Done.");
}
