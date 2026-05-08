import type { Express } from "express";
import type { Server as HttpServer } from "http";
import session from "express-session";
import createMemoryStore from "memorystore";
import bcrypt from "bcryptjs";
import { storage, seedIfEmpty } from "./storage";
import { broadcastToXRPL, getWalletInfo, sha256 } from "./xrpl";
import {
  insertUserSchema, loginSchema, insertLicenseSchema, insertPatientSchema,
  insertPrescriptionSchema, insertShiftSchema, insertVisitSchema,
} from "@shared/schema";

const MemoryStore = createMemoryStore(session);

declare module "express-session" {
  interface SessionData {
    userId?: number;
    role?: string;
  }
}

export async function registerRoutes(httpServer: HttpServer, app: Express) {
  await seedIfEmpty();

  app.use(
    session({
      secret: process.env.SESSION_SECRET || "hunadoc-alpha-dev-secret",
      resave: false,
      saveUninitialized: false,
      store: new MemoryStore({ checkPeriod: 86400000 }),
      cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: "lax" },
    })
  );

  // ============================================================
  // Health
  // ============================================================
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "hunadoc", time: new Date().toISOString() });
  });

  // ============================================================
  // Auth
  // ============================================================
  app.post("/api/auth/register", async (req, res) => {
    try {
      const data = insertUserSchema.parse(req.body);
      const existing = await storage.getUserByEmail(data.email);
      if (existing) return res.status(400).json({ error: "Email already registered" });
      const user = await storage.createUser(data);
      req.session.userId = user.id;
      req.session.role = user.role;
      const { password, ...safe } = user;
      res.json(safe);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { email, password } = loginSchema.parse(req.body);
      const user = await storage.getUserByEmail(email);
      if (!user) return res.status(401).json({ error: "Invalid credentials" });
      const ok = await bcrypt.compare(password, user.password);
      if (!ok) return res.status(401).json({ error: "Invalid credentials" });
      req.session.userId = user.id;
      req.session.role = user.role;
      const { password: _, ...safe } = user;
      res.json(safe);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
    const user = await storage.getUserById(req.session.userId);
    if (!user) return res.status(401).json({ error: "Not found" });
    const { password, ...safe } = user;
    res.json(safe);
  });

  // Auth middleware
  const requireAuth = (req: any, res: any, next: any) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
    next();
  };
  const requireRole = (...roles: string[]) => (req: any, res: any, next: any) => {
    if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
    if (!roles.includes(req.session.role!)) return res.status(403).json({ error: "Forbidden" });
    next();
  };

  // ============================================================
  // Users
  // ============================================================
  app.get("/api/users", requireAuth, async (req, res) => {
    const role = req.query.role as string | undefined;
    const list = role ? await storage.listUsersByRole(role) : [];
    res.json(list.map(({ password, ...u }) => u));
  });

  // ============================================================
  // Licenses
  // ============================================================
  app.post("/api/licenses", requireAuth, async (req: any, res) => {
    try {
      const data = insertLicenseSchema.parse({ ...req.body, userId: req.session.userId });
      const lic = await storage.createLicense(data);
      res.json(lic);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/licenses", requireAuth, async (req: any, res) => {
    const list = await storage.listLicensesByUser(req.session.userId);
    // strip fileData blob from list response
    res.json(list.map(({ fileData, ...l }) => l));
  });

  // Manager-only: list all pending licenses with user info
  app.get("/api/manager/licenses/pending", requireRole("manager"), async (req, res) => {
    const all = await storage.listAllLicenses();
    const pending = all.filter((l) => l.status === "pending");
    const result = await Promise.all(pending.map(async (l) => {
      const user = await storage.getUserById(l.userId);
      const { fileData, ...rest } = l;
      const safeUser = user ? (() => { const { password, ...u } = user; return u; })() : null;
      return { ...rest, user: safeUser };
    }));
    res.json(result);
  });

  app.post("/api/licenses/:id/verify", requireRole("manager"), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const lic = await storage.getLicense(id);
      if (!lic) return res.status(404).json({ error: "Not found" });

      const docPayload = {
        license_id: lic.id,
        type: lic.type,
        number: lic.number,
        state: lic.issuingState,
        expiration: lic.expirationDate,
        verified_by_user_id: (req.session as any).userId,
      };
      const result = await broadcastToXRPL(docPayload, "license", `License-${lic.id}`, "verify");
      await storage.updateLicenseStatus(id, "verified", result.txHash, result.documentHash);
      await storage.setUserVerified(lic.userId, true);
      const signer = await storage.getUserById((req.session as any).userId);
      await storage.recordLedger({
        entityType: "license",
        entityId: lic.id,
        action: "verify",
        documentHash: result.documentHash,
        txHash: result.txHash,
        ledgerSequence: result.ledgerSequence,
        signerUserId: (req.session as any).userId,
        signerName: signer?.fullName ?? null,
        network: "testnet",
        explorerUrl: result.explorerUrl,
      } as any);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      console.error("[verify]", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // Patients
  // ============================================================
  app.post("/api/patients", requireRole("prescriber", "manager"), async (req: any, res) => {
    try {
      const data = insertPatientSchema.parse({
        ...req.body,
        primaryPrescriberId: req.body.primaryPrescriberId ?? req.session.userId,
      });
      const p = await storage.createPatient(data);
      res.json(p);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/patients", requireAuth, async (req: any, res) => {
    const role = req.session.role;
    if (role === "prescriber") {
      const list = await storage.listPatients(req.session.userId);
      res.json(list);
    } else if (role === "patient") {
      const me = await storage.getUserById(req.session.userId);
      const all = await storage.listPatients();
      res.json(all.filter((p) => p.userId === req.session.userId));
    } else {
      res.json(await storage.listPatients());
    }
  });

  // ============================================================
  // Prescriptions
  // ============================================================
  app.post("/api/prescriptions", requireRole("prescriber"), async (req: any, res) => {
    try {
      // prescriberId comes from session, not the client
      const data = insertPrescriptionSchema.parse({ ...req.body, prescriberId: req.session.userId });
      const rx = await storage.createPrescription(data, req.session.userId);
      res.json(rx);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/prescriptions/:id/sign", requireRole("prescriber"), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const rx = await storage.getPrescription(id);
      if (!rx) return res.status(404).json({ error: "Not found" });
      const patient = await storage.getPatient(rx.patientId);
      const prescriber = await storage.getUserById(rx.prescriberId);

      const docPayload = {
        rx_number: rx.rxNumber,
        patient_mrn: patient?.mrn,
        drug: rx.drug,
        strength: rx.strength,
        sig: rx.sig,
        quantity: rx.quantity,
        refills: rx.refills,
        prescriber_npi: prescriber?.npi,
        signed_at: new Date().toISOString(),
      };
      const result = await broadcastToXRPL(docPayload, "prescription", rx.rxNumber, "sign");
      const updated = await storage.signPrescription(id, result.txHash, result.ledgerSequence, result.documentHash);
      await storage.recordLedger({
        entityType: "prescription",
        entityId: rx.id,
        action: "sign",
        documentHash: result.documentHash,
        txHash: result.txHash,
        ledgerSequence: result.ledgerSequence,
        signerUserId: req.session.userId,
        signerName: prescriber?.fullName ?? null,
        network: "testnet",
        explorerUrl: result.explorerUrl,
      } as any);
      res.json({ prescription: updated, broadcast: result });
    } catch (e: any) {
      console.error("[sign]", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/prescriptions/:id/fill", requireRole("pharmacist", "pharmacy"), async (req, res) => {
    const id = parseInt(req.params.id);
    const updated = await storage.fillPrescription(id);
    res.json(updated);
  });

  app.get("/api/prescriptions", requireAuth, async (req: any, res) => {
    const role = req.session.role;
    let list;
    if (role === "prescriber") list = await storage.listPrescriptions({ prescriberId: req.session.userId });
    else if (role === "pharmacy") list = await storage.listPrescriptions({ pharmacyId: req.session.userId });
    else if (role === "patient") {
      // find patient record(s) linked to this user
      const all = await storage.listPatients();
      const mine = all.filter((p) => p.userId === req.session.userId);
      const lists = await Promise.all(mine.map((p) => storage.listPrescriptions({ patientId: p.id })));
      list = lists.flat();
    } else list = await storage.listPrescriptions();
    res.json(list);
  });

  app.get("/api/prescriptions/:id", requireAuth, async (req, res) => {
    const rx = await storage.getPrescription(parseInt(req.params.id));
    if (!rx) return res.status(404).json({ error: "Not found" });
    res.json(rx);
  });

  // ============================================================
  // Shifts
  // ============================================================
  app.post("/api/shifts", requireRole("pharmacy", "manager"), async (req: any, res) => {
    try {
      const data = insertShiftSchema.parse({ ...req.body, pharmacyId: req.body.pharmacyId ?? req.session.userId });
      const s = await storage.createShift(data);
      res.json(s);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/shifts", requireAuth, async (req: any, res) => {
    const role = req.session.role;
    let list;
    if (role === "pharmacy") list = await storage.listShifts({ pharmacyId: req.session.userId });
    else if (role === "pharmacist") list = await storage.listShifts(); // pharmacists see all open shifts
    else list = await storage.listShifts();
    res.json(list);
  });

  app.post("/api/shifts/:id/accept", requireRole("pharmacist"), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const s = await storage.acceptShift(id, req.session.userId);
      const signer = await storage.getUserById(req.session.userId);
      const docPayload = {
        shift_id: s.id, pharmacy_id: s.pharmacyId, pharmacist_id: req.session.userId,
        date: s.date, accepted_at: new Date().toISOString(),
      };
      const result = await broadcastToXRPL(docPayload, "shift", `Shift-${s.id}`, "accept");
      await storage.recordLedger({
        entityType: "shift", entityId: s.id, action: "accept",
        documentHash: result.documentHash, txHash: result.txHash,
        ledgerSequence: result.ledgerSequence,
        signerUserId: req.session.userId, signerName: signer?.fullName ?? null,
        network: "testnet", explorerUrl: result.explorerUrl,
      } as any);
      res.json({ shift: s, broadcast: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/shifts/:id/complete", requireAuth, async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const s = await storage.listShifts().then((all) => all.find((x) => x.id === id));
      if (!s) return res.status(404).json({ error: "Not found" });
      const docPayload = {
        shift_id: s.id, pharmacy_id: s.pharmacyId, pharmacist_id: s.pharmacistId,
        date: s.date, hours: 8, completed_at: new Date().toISOString(),
      };
      const result = await broadcastToXRPL(docPayload, "shift", `Shift-${s.id}`, "complete");
      const updated = await storage.completeShift(id, result.txHash);
      const signer = await storage.getUserById(req.session.userId);
      await storage.recordLedger({
        entityType: "shift",
        entityId: s.id,
        action: "complete",
        documentHash: result.documentHash,
        txHash: result.txHash,
        ledgerSequence: result.ledgerSequence,
        signerUserId: req.session.userId,
        signerName: signer?.fullName ?? null,
        network: "testnet",
        explorerUrl: result.explorerUrl,
      } as any);
      res.json({ shift: updated, broadcast: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // Visits
  // ============================================================
  app.post("/api/visits", requireRole("prescriber"), async (req: any, res) => {
    try {
      const data = insertVisitSchema.parse({ ...req.body, prescriberId: req.session.userId });
      const v = await storage.createVisit(data);
      res.json(v);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.get("/api/visits", requireAuth, async (req: any, res) => {
    const role = req.session.role;
    if (role === "prescriber") res.json(await storage.listVisits({ prescriberId: req.session.userId }));
    else if (role === "patient") {
      const all = await storage.listPatients();
      const mine = all.filter((p) => p.userId === req.session.userId);
      const lists = await Promise.all(mine.map((p) => storage.listVisits({ patientId: p.id })));
      res.json(lists.flat());
    } else res.json(await storage.listVisits());
  });

  app.post("/api/visits/:id/start", requireRole("prescriber"), async (req, res) => {
    const v = await storage.startVisit(parseInt(req.params.id));
    res.json(v);
  });

  app.post("/api/visits/:id/end", requireRole("prescriber"), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const notes = (req.body.notes as string) || "";
      const noteHash = sha256(notes);
      const docPayload = {
        visit_id: id,
        prescriber_id: req.session.userId,
        note_hash: noteHash,
        ended_at: new Date().toISOString(),
      };
      const result = await broadcastToXRPL(docPayload, "visit", `Visit-${id}`, "complete");
      const updated = await storage.endVisit(id, notes, noteHash, result.txHash);
      const signer = await storage.getUserById(req.session.userId);
      await storage.recordLedger({
        entityType: "visit",
        entityId: id,
        action: "complete",
        documentHash: result.documentHash,
        txHash: result.txHash,
        ledgerSequence: result.ledgerSequence,
        signerUserId: req.session.userId,
        signerName: signer?.fullName ?? null,
        network: "testnet",
        explorerUrl: result.explorerUrl,
      } as any);
      res.json({ visit: updated, broadcast: result });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // Ledger (read-only)
  // ============================================================
  app.get("/api/ledger", requireAuth, async (req, res) => {
    const limit = parseInt((req.query.limit as string) || "100");
    res.json(await storage.listLedger(limit));
  });

  app.get("/api/ledger/wallet", requireAuth, async (req, res) => {
    try {
      res.json(await getWalletInfo());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // Stats / overview
  // ============================================================
  app.get("/api/stats", requireAuth, async (req, res) => {
    res.json(await storage.getStats());
  });
}
