import type { Express } from "express";
import type { Server as HttpServer } from "http";
import session from "express-session";
import createMemoryStore from "memorystore";
import bcrypt from "bcryptjs";
import { storage, seedIfEmpty } from "./storage";
import { broadcastToXRPL, getWalletInfo, getPayerWalletInfo, settleClaimOnXRPL, sha256 } from "./xrpl";
import {
  insertUserSchema, loginSchema, insertLicenseSchema, insertPatientSchema,
  insertPrescriptionSchema, insertShiftSchema, insertVisitSchema,
} from "@shared/schema";

const MemoryStore = createMemoryStore(session);

// Manager dashboards are scoped per-account. The seeded demo manager
// (manager@demo.huna, Sarah Mendel) sees ONLY the original demo signers.
// Any newly-registered manager (e.g. a non-demo operations manager) sees the INVERSE — all
// non-demo, self-registered users, with the demo signers hidden.
const DEMO_EMAILS = [
  "pharmacist@demo.huna",
  "prescriber@demo.huna",
  "pharmacy@demo.huna",
  "manager@demo.huna",
  "patient@demo.huna",
];

async function getDemoUserIds(): Promise<Set<number>> {
  const ids = new Set<number>();
  for (const e of DEMO_EMAILS) {
    const u = await storage.getUserByEmail(e);
    if (u) ids.add(u.id);
  }
  return ids;
}

type ManagerScope =
  | { mode: "demo"; demoIds: Set<number> }
  | { mode: "nondemo"; demoIds: Set<number> };

async function getManagerScope(userId: number | undefined): Promise<ManagerScope> {
  const demoIds = await getDemoUserIds();
  if (userId == null) return { mode: "nondemo", demoIds };
  const demoManager = await storage.getUserByEmail("manager@demo.huna");
  if (demoManager && demoManager.id === userId) return { mode: "demo", demoIds };
  return { mode: "nondemo", demoIds };
}

// True if a given user id is visible to a manager under the given scope.
// Null/undefined ids are treated as "pass-through" so unowned rows still render.
function managerSees(scope: ManagerScope, id: number | null | undefined): boolean {
  if (id == null) return true;
  return scope.mode === "demo" ? scope.demoIds.has(id) : !scope.demoIds.has(id);
}

// Known long-acting injectable medications (alpha auto-detect list).
// Matches case-insensitive substring against the drug name.
const LAI_DRUGS = [
  "aristada", "invega sustenna", "invega trinza", "invega hafyera",
  "abilify maintena", "abilify asimtufii",
  "risperdal consta", "perseris", "uzedy",
  "zyprexa relprevv",
  "sublocade", "brixadi",
  "vivitrol",
  "haldol decanoate", "prolixin decanoate",
];
function isLaiDrug(drug?: string | null): boolean {
  if (!drug) return false;
  const d = drug.toLowerCase();
  return LAI_DRUGS.some((name) => d.includes(name));
}

// Generates an 11-character temporary password using crypto-safe randomness.
function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const crypto = require("node:crypto");
  const bytes = crypto.randomBytes(11);
  let out = "";
  for (let i = 0; i < 11; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

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

  // Public "Join the Team" / partnership inbound. Stores submissions to a
  // simple JSON log on the persistent disk so the founder can review later.
  // No PHI is collected. Submissions are rate-limited by IP via in-memory map.
  const contactRate: Map<string, number[]> = new Map();
  app.post("/api/contact", async (req: any, res) => {
    try {
      const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || "unknown";
      const now = Date.now();
      const hits = (contactRate.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
      if (hits.length >= 5) return res.status(429).json({ error: "Too many submissions. Please try again later." });
      hits.push(now); contactRate.set(ip, hits);

      const { role, name, email, phone, message, kind } = req.body || {};
      if (!email || typeof email !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return res.status(400).json({ error: "Valid email is required" });
      }
      const safe = (v: any, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
      const wordCount = safe(message, 2000).split(/\s+/).filter(Boolean).length;
      if (wordCount > 50) return res.status(400).json({ error: "Message must be 50 words or fewer." });

      const entry = {
        receivedAt: new Date().toISOString(),
        kind: safe(kind, 32) || "join_team",
        role: safe(role, 64),
        name: safe(name, 120),
        email: safe(email, 200),
        phone: safe(phone, 60),
        message: safe(message, 2000),
        ip,
      };

      const fs = await import("node:fs");
      const path = await import("node:path");
      const dataDir = process.env.DATA_DIR || "./data";
      try { fs.mkdirSync(dataDir, { recursive: true }); } catch {}
      const logPath = path.join(dataDir, "contact-submissions.jsonl");
      fs.appendFileSync(logPath, JSON.stringify(entry) + "\n");

      console.log(`[contact] ${entry.kind} from ${entry.email} (${entry.role || "—"})`);

      // Bridge Join-the-Team submissions into the pending-approval queue when a
      // pharmacist/prescriber/pharmacy/manager/patient role is selected. Investors
      // and generic submissions stay in the JSON log only.
      const validRoles = ["pharmacist", "prescriber", "pharmacy", "manager", "patient"];
      if (entry.role && validRoles.includes(entry.role)) {
        try {
          const existing = await storage.getUserByEmail(entry.email);
          if (!existing) {
            // Use a random placeholder password; manager will replace on approval.
            const placeholder = generateTempPassword();
            const u = await storage.createUser({
              email: entry.email,
              password: placeholder,
              role: entry.role,
              fullName: entry.name || entry.email,
              phone: entry.phone || null,
            } as any);
            await storage.setUserApprovalStatus(u.id, "pending");
            if (entry.message) {
              try { await storage.setUserRegistrationNote(u.id, entry.message); } catch {}
            }
            console.log(`[contact] queued pending user ${entry.email} (${entry.role})`);
          }
        } catch (err: any) {
          console.warn("[contact] queue pending user failed:", err?.message);
        }
      }

      res.json({ ok: true });
    } catch (e: any) {
      console.error("[contact]", e);
      res.status(500).json({ error: "Submission failed. Please try again." });
    }
  });

  // ============================================================
  // Auth
  // ============================================================
  app.post("/api/auth/register", async (req, res) => {
    try {
      const data = insertUserSchema.parse(req.body);
      const existing = await storage.getUserByEmail(data.email);
      if (existing) return res.status(400).json({ error: "Email already registered" });
      // Pending: account is created but NOT auto-logged-in. Manager must approve.
      const user = await storage.createUser(data);
      try {
        await storage.setUserApprovalStatus(user.id, "pending");
      } catch {}
      const { password, ...safe } = user;
      res.json({ pending: true, message: "Registration received. An Operations Manager will review and email a temporary password to you.", user: safe });
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
      // Block pending/rejected users from logging in
      const status = (user as any).approvalStatus || "approved";
      if (status === "pending") {
        return res.status(403).json({ error: "Your account is awaiting Operations Manager approval. You'll receive a temporary password by email once approved." });
      }
      if (status === "rejected") {
        return res.status(403).json({ error: "Your registration was not approved. Please contact support." });
      }
      req.session.userId = user.id;
      req.session.role = user.role;
      const { password: _, ...safe } = user;
      res.json({ ...safe, mustChangePassword: !!(user as any).mustChangePassword });
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

  // First-login password change. Requires auth (user just logged in with temp pwd).
  app.post("/api/auth/change-password", async (req: any, res) => {
    try {
      if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
      const { oldPassword, newPassword } = req.body || {};
      if (typeof newPassword !== "string" || newPassword.length < 8) {
        return res.status(400).json({ error: "New password must be at least 8 characters." });
      }
      const user = await storage.getUserById(req.session.userId);
      if (!user) return res.status(401).json({ error: "Not found" });
      const ok = await bcrypt.compare(String(oldPassword || ""), user.password);
      if (!ok) return res.status(400).json({ error: "Current password is incorrect." });
      await storage.updateUserPassword(user.id, newPassword);
      await storage.setUserMustChangePassword(user.id, false);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
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

  // Tamper-resistance: demo accounts and unapproved users cannot mutate state.
  // Applied globally to /api/* for non-GET methods, with an allowlist for endpoints
  // public users must reach (register, login, logout, change-password, public contact).
  const MUTATION_ALLOWLIST = new Set([
    "/api/auth/register",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/change-password",
    "/api/contact",
  ]);
  app.use("/api", async (req: any, res, next) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
    if (MUTATION_ALLOWLIST.has(req.path)) return next();
    if (!req.session.userId) return res.status(401).json({ error: "Not authenticated" });
    try {
      const user = await storage.getUserById(req.session.userId);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const status = (user as any).approvalStatus || "approved";
      if (status !== "approved") {
        return res.status(403).json({ error: "Account not approved. Read-only access." });
      }
      if ((user as any).isDemo) {
        return res.status(403).json({ error: "Demo account is read-only. Register and request approval to perform actions." });
      }
    } catch (e: any) {
      return res.status(500).json({ error: "Auth check failed" });
    }
    next();
  });

  // ============================================================
  // Users
  // ============================================================
  app.get("/api/users", requireAuth, async (req: any, res) => {
    const role = req.query.role as string | undefined;
    const laiCertified = req.query.laiCertified === "1" || req.query.laiCertified === "true";
    let list = role ? await storage.listUsersByRole(role) : [];
    if (laiCertified) list = list.filter((u: any) => u.laiCertified);
    // Manager dashboards: demo manager sees demo signers only;
    // newly-registered managers see only non-demo (self-registered) users.
    if (req.session.role === "manager") {
      const scope = await getManagerScope(req.session.userId);
      list = list.filter((u: any) =>
        scope.mode === "demo" ? scope.demoIds.has(u.id) : !scope.demoIds.has(u.id)
      );
    }
    res.json(list.map(({ password, ...u }) => u));
  });

  // ============================================================
  // Manager: pending registrations queue
  // ============================================================
  app.get("/api/manager/registrations/pending", requireRole("manager"), async (_req: any, res) => {
    const all = await storage.listPendingUsers();
    res.json(all.map(({ password, ...u }) => u));
  });

  app.post("/api/manager/registrations/:id/approve", requireRole("manager"), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const target = await storage.getUserById(id);
      if (!target) return res.status(404).json({ error: "User not found" });
      if ((target as any).approvalStatus === "approved") {
        return res.status(400).json({ error: "User is already approved." });
      }
      // Generate a temp password the manager can email to the new user.
      const tempPassword = generateTempPassword();
      await storage.updateUserPassword(id, tempPassword);
      await storage.setUserMustChangePassword(id, true);
      await storage.setUserApprovalStatus(id, "approved", req.session.userId);
      const subject = encodeURIComponent("Your HunaDoc account is approved");
      const body = encodeURIComponent(
        `Hello ${target.fullName || target.email},\n\n` +
        `Your HunaDoc account (role: ${target.role}) has been approved by the Operations Manager.\n\n` +
        `Sign in at https://hunadoc.com with:\n` +
        `  Email: ${target.email}\n` +
        `  Temporary password: ${tempPassword}\n\n` +
        `You will be required to change this password on first login.\n\n` +
        `— HunaDoc Operations`
      );
      const mailtoUrl = `mailto:${target.email}?subject=${subject}&body=${body}`;
      res.json({ ok: true, tempPassword, mailtoUrl, user: { id: target.id, email: target.email, fullName: target.fullName, role: target.role } });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  app.post("/api/manager/registrations/:id/reject", requireRole("manager"), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const target = await storage.getUserById(id);
      if (!target) return res.status(404).json({ error: "User not found" });
      await storage.setUserApprovalStatus(id, "rejected", req.session.userId);
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
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

  // Manager-only: list all pending licenses with user info (scoped to demo signers).
  app.get("/api/manager/licenses/pending", requireRole("manager"), async (req: any, res) => {
    const scope = await getManagerScope(req.session.userId);
    const all = await storage.listAllLicenses();
    const pending = all.filter((l) =>
      l.status === "pending" &&
      (scope.mode === "demo" ? scope.demoIds.has(l.userId) : !scope.demoIds.has(l.userId))
    );
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

      // Optional routing fields from prescriber UI
      const routingChannel = (req.body?.routingChannel as string) || rx.channel || "manual";
      const destinationSoftware = (req.body?.destinationSoftware as string) || rx.destinationSoftware || "manual";
      const pharmacyId = req.body?.pharmacyId !== undefined ? Number(req.body.pharmacyId) : (rx.pharmacyId ?? undefined);

      // LAI fields from prescriber UI; if not provided, auto-detect from drug name
      const reqIsLai = req.body?.isLai === true || req.body?.isLai === "true";
      const detectedLai = isLaiDrug(rx.drug);
      const isLai = reqIsLai || detectedLai;
      const laiSchedule = isLai ? ((req.body?.laiSchedule as string) || "asap") : null;
      const mobilePharmacistId = isLai && req.body?.mobilePharmacistId !== undefined && req.body.mobilePharmacistId !== null && req.body.mobilePharmacistId !== ""
        ? Number(req.body.mobilePharmacistId)
        : null;

      // Apply routing + LAI fields first so signed Rx already carries them
      await storage.updatePrescriptionRouting(id, routingChannel, destinationSoftware, pharmacyId);
      await storage.setPrescriptionLai(id, isLai, laiSchedule, mobilePharmacistId);
      const refreshed = await storage.getPrescription(id);

      // Build a SIMULATED NCPDP SCRIPT 2017071 NewRx XML payload
      const channelLabel = routingChannel === "surescripts" ? "Surescripts NewRx (SIMULATED)"
        : routingChannel === "direct" ? "Direct Pharmacy Connect (SIMULATED)"
        : "Manual eRx (no third-party network)";
      const softwareLabel = destinationSoftware === "manual" ? "Manual hand-off" : `${destinationSoftware.replace(/_/g, " ").toUpperCase()} (SIMULATED)`;
      const signedAtIso = new Date().toISOString();
      const ncpdpScript = `<?xml version="1.0" encoding="UTF-8"?>
<!-- SIMULATED NCPDP SCRIPT 2017071 NewRx — generated by HunaDoc alpha. -->
<!-- Channel: ${channelLabel}  /  Destination software: ${softwareLabel} -->
<Message xmlns="http://www.ncpdp.org/schema/SCRIPT">
  <Header>
    <To>${softwareLabel}</To>
    <From>HunaDoc Prescriber Workspace</From>
    <MessageID>${rx.rxNumber}-${Date.now()}</MessageID>
    <SentTime>${signedAtIso}</SentTime>
    <Channel>${channelLabel}</Channel>
  </Header>
  <Body>
    <NewRx>
      <Patient>
        <MRN>${patient?.mrn ?? ""}</MRN>
        <Name>${patient?.firstName ?? ""} ${patient?.lastName ?? ""}</Name>
        <DOB>${patient?.dob ?? ""}</DOB>
      </Patient>
      <Prescriber>
        <Name>${prescriber?.fullName ?? ""}</Name>
        <NPI>${prescriber?.npi ?? ""}</NPI>
      </Prescriber>
      <Medication>
        <DrugDescription>${rx.drug} ${rx.strength} ${rx.form}</DrugDescription>
        <Sig>${rx.sig}</Sig>
        <Quantity>${rx.quantity}</Quantity>
        <Refills>${rx.refills ?? 0}</Refills>
        <DAW>${rx.daw ? "1" : "0"}</DAW>
      </Medication>
      <Pharmacy>
        <DestinationSoftware>${softwareLabel}</DestinationSoftware>
        <PharmacyUserId>${pharmacyId ?? ""}</PharmacyUserId>
      </Pharmacy>
    </NewRx>
  </Body>
</Message>`;

      const docPayload = {
        rx_number: rx.rxNumber,
        patient_mrn: patient?.mrn,
        drug: rx.drug,
        strength: rx.strength,
        sig: rx.sig,
        quantity: rx.quantity,
        refills: rx.refills,
        prescriber_npi: prescriber?.npi,
        routing_channel: routingChannel,
        destination_software: destinationSoftware,
        ncpdp_script_hash: sha256(ncpdpScript),
        signed_at: signedAtIso,
      };
      const result = await broadcastToXRPL(docPayload, "prescription", rx.rxNumber, "sign");
      const updated = await storage.signPrescription(id, result.txHash, result.ledgerSequence, result.documentHash, ncpdpScript);
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
      // If this is an LAI Rx routed to a mobile pharmacist, auto-create the first
      // LAI administration record (cycle 1, status pending).
      let laiAdministration = null;
      if (isLai && mobilePharmacistId) {
        laiAdministration = await storage.createLaiAdministration({
          prescriptionId: rx.id,
          pharmacistId: mobilePharmacistId,
          schedule: laiSchedule || "asap",
          scheduledFor: null,
          cycleNumber: 1,
        });
      }

      res.json({
        prescription: updated,
        broadcast: result,
        routing: { channel: routingChannel, destinationSoftware, pharmacyId },
        lai: isLai ? {
          isLai: true,
          schedule: laiSchedule,
          mobilePharmacistId,
          administrationId: laiAdministration?.id ?? null,
          autoDetected: !reqIsLai && detectedLai,
        } : null,
      });
    } catch (e: any) {
      console.error("[sign]", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/prescriptions/:id/fill", requireRole("pharmacist", "pharmacy"), async (req: any, res) => {
    const id = parseInt(req.params.id);
    const updated = await storage.fillPrescription(id);
    res.json(updated);
  });

  // ============================================================
  // Claims & T0 settlement (XRPL Testnet)
  // PBM = SIMULATED, on-chain Payment = REAL Testnet broadcast
  // ============================================================
  app.post("/api/claims", requireRole("pharmacy", "pharmacist"), async (req: any, res) => {
    try {
      const prescriptionId = Number(req.body.prescriptionId);
      const billedAmount = Number(req.body.billedAmount ?? 50);
      const payerName = (req.body.payerName as string) || "DemoPBM (SIMULATED)";
      if (!prescriptionId) return res.status(400).json({ error: "prescriptionId required" });
      const rx = await storage.getPrescription(prescriptionId);
      if (!rx) return res.status(404).json({ error: "Prescription not found" });

      // Anchor claim submission on XRPL via AccountSet memo (real Testnet broadcast)
      const claimDoc = {
        rx_number: rx.rxNumber,
        prescription_id: rx.id,
        billed_amount: billedAmount,
        payer_name: payerName,
        submitted_at: new Date().toISOString(),
      };
      const broadcast = await broadcastToXRPL(claimDoc, "claim", rx.rxNumber, "submit");

      const claim = await storage.createClaim({
        prescriptionId: rx.id,
        pharmacyUserId: req.session.userId,
        payerName,
        billedAmount,
        submitTxHash: broadcast.txHash,
      });

      const signer = await storage.getUserById(req.session.userId);
      await storage.recordLedger({
        entityType: "claim", entityId: claim.id, action: "submit",
        documentHash: broadcast.documentHash, txHash: broadcast.txHash,
        ledgerSequence: broadcast.ledgerSequence,
        signerUserId: req.session.userId, signerName: signer?.fullName ?? null,
        network: "testnet", explorerUrl: broadcast.explorerUrl,
      } as any);
      res.json({ claim, broadcast });
    } catch (e: any) {
      console.error("[claim submit]", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/claims", requireAuth, async (req: any, res) => {
    const role = req.session.role;
    if (role === "pharmacy" || role === "pharmacist") {
      res.json(await storage.listClaimsByPharmacy(req.session.userId));
    } else {
      res.json(await storage.listAllClaims());
    }
  });

  app.post("/api/claims/:id/adjudicate", requireRole("pharmacy", "pharmacist", "manager"), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const claim = await storage.getClaim(id);
      if (!claim) return res.status(404).json({ error: "Not found" });
      if (claim.status !== "submitted") return res.status(400).json({ error: `Claim already ${claim.status}` });

      // SIMULATED PBM logic: 90% approve, adjudicate at 70-90% of billed,
      // patient responsibility ~10% of adjudicated.
      const approve = Math.random() < 0.9;
      if (!approve) {
        const updated = await storage.adjudicateClaim(id, 0, 0, "rejected", "NDC not on formulary (SIMULATED)");
        return res.json({ claim: updated, simulated: true });
      }
      const ratio = 0.7 + Math.random() * 0.2;
      const adjudicated = Math.round(claim.billedAmount * ratio * 100) / 100;
      const patientResp = Math.round(adjudicated * 0.1 * 100) / 100;
      const updated = await storage.adjudicateClaim(id, adjudicated, patientResp, "adjudicated");

      const signer = await storage.getUserById(req.session.userId);
      await storage.recordLedger({
        entityType: "claim", entityId: id, action: "adjudicate",
        documentHash: sha256(JSON.stringify({ id, adjudicated, patientResp })),
        txHash: claim.submitTxHash || "", // adjudication is mocked PBM, no new on-chain tx
        ledgerSequence: null,
        signerUserId: req.session.userId, signerName: signer?.fullName ?? null,
        network: "testnet", explorerUrl: claim.submitTxHash ? `https://testnet.xrpl.org/transactions/${claim.submitTxHash}` : null,
      } as any);
      res.json({ claim: updated, simulated: true });
    } catch (e: any) {
      console.error("[adjudicate]", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/claims/:id/settle", requireRole("pharmacy", "pharmacist", "manager"), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const claim = await storage.getClaim(id);
      if (!claim) return res.status(404).json({ error: "Not found" });
      if (claim.status !== "adjudicated") return res.status(400).json({ error: `Claim must be adjudicated first (current: ${claim.status})` });
      if (!claim.adjudicatedAmount) return res.status(400).json({ error: "No adjudicated amount" });

      // Map USD-adjudicated to a small XRP amount for the demo settlement.
      // 1 USD ~ 0.5 XRP (demo only). Cap at 5 XRP per tx, floor at 0.1 XRP.
      const xrpAmount = Math.max(0.1, Math.min(5, Math.round(claim.adjudicatedAmount * 0.5 * 1000) / 1000));
      const settlementDoc = {
        claim_number: claim.claimNumber,
        prescription_id: claim.prescriptionId,
        billed_usd: claim.billedAmount,
        adjudicated_usd: claim.adjudicatedAmount,
        settlement_xrp: xrpAmount,
        settled_at: new Date().toISOString(),
      };
      const settle = await settleClaimOnXRPL(xrpAmount, settlementDoc, claim.claimNumber);
      const updated = await storage.settleClaim(id, settle.txHash, settle.amountXrp);

      const signer = await storage.getUserById(req.session.userId);
      await storage.recordLedger({
        entityType: "settlement", entityId: id, action: "settle",
        documentHash: settle.documentHash, txHash: settle.txHash,
        ledgerSequence: settle.ledgerSequence,
        signerUserId: req.session.userId, signerName: signer?.fullName ?? null,
        network: "testnet", explorerUrl: settle.explorerUrl,
      } as any);
      res.json({ claim: updated, broadcast: settle });
    } catch (e: any) {
      console.error("[settle]", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/prescriptions", requireAuth, async (req: any, res) => {
    const role = req.session.role;
    let list;
    if (role === "prescriber") list = await storage.listPrescriptions({ prescriberId: req.session.userId });
    else if (role === "pharmacy") list = await storage.listPrescriptions({ pharmacyId: req.session.userId });
    else if (role === "pharmacist") {
      // Pharmacists see Rx routed to them as the mobile LAI pharmacist, plus any
      // signed Rx routed to a pharmacy (alpha: shared queue across pharmacist users).
      const mine = await storage.listPrescriptions({ mobilePharmacistId: req.session.userId });
      const allSigned = (await storage.listPrescriptions()).filter(
        (r) => r.pharmacyId && ["signed", "transmitted", "received"].includes(r.status as string)
      );
      // de-dupe by id
      const merged = new Map<number, any>();
      for (const r of [...mine, ...allSigned]) merged.set(r.id, r);
      list = Array.from(merged.values()).sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    }
    else if (role === "patient") {
      // find patient record(s) linked to this user
      const all = await storage.listPatients();
      const mine = all.filter((p) => p.userId === req.session.userId);
      const lists = await Promise.all(mine.map((p) => storage.listPrescriptions({ patientId: p.id })));
      list = lists.flat();
    } else list = await storage.listPrescriptions();
    if (role === "manager") {
      const scope = await getManagerScope(req.session.userId);
      list = list.filter((p: any) =>
        managerSees(scope, p.prescriberId) &&
        managerSees(scope, p.pharmacyId) &&
        managerSees(scope, p.mobilePharmacistId)
      );
    }
    res.json(list);
  });

  // ============================================================
  // LAI administrations — mobile pharmacist accepts, schedules, administers
  // ============================================================
  app.get("/api/lai/administrations", requireAuth, async (req: any, res) => {
    const role = req.session.role;
    let list;
    if (role === "pharmacist") list = await storage.listLaiAdministrations({ pharmacistId: req.session.userId });
    else list = await storage.listLaiAdministrations();
    res.json(list);
  });

  app.post("/api/lai/administrations/:id/accept", requireRole("pharmacist"), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const admin = await storage.getLaiAdministration(id);
      if (!admin) return res.status(404).json({ error: "Not found" });
      if (admin.pharmacistId !== req.session.userId) return res.status(403).json({ error: "Not assigned to you" });

      const scheduledForIso = (req.body?.scheduledFor as string) || null;
      const scheduledFor = scheduledForIso ? new Date(scheduledForIso).getTime() : null;
      const rx = await storage.getPrescription(admin.prescriptionId);

      const acceptDoc = {
        administration_id: admin.id,
        prescription_id: admin.prescriptionId,
        rx_number: rx?.rxNumber,
        pharmacist_user_id: req.session.userId,
        schedule: admin.schedule,
        cycle: admin.cycleNumber,
        scheduled_for: scheduledForIso,
        accepted_at: new Date().toISOString(),
      };
      const broadcast = await broadcastToXRPL(acceptDoc, "lai_administration", `LAI-${admin.id}`, "accept");
      const updated = await storage.acceptLaiAdministration(id, scheduledFor, broadcast.txHash, broadcast.documentHash);

      const signer = await storage.getUserById(req.session.userId);
      await storage.recordLedger({
        entityType: "lai_administration", entityId: admin.id, action: "accept",
        documentHash: broadcast.documentHash, txHash: broadcast.txHash,
        ledgerSequence: broadcast.ledgerSequence,
        signerUserId: req.session.userId, signerName: signer?.fullName ?? null,
        network: "testnet", explorerUrl: broadcast.explorerUrl,
      } as any);
      res.json({ administration: updated, broadcast });
    } catch (e: any) {
      console.error("[lai accept]", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/lai/administrations/:id/administer", requireRole("pharmacist"), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const admin = await storage.getLaiAdministration(id);
      if (!admin) return res.status(404).json({ error: "Not found" });
      if (admin.pharmacistId !== req.session.userId) return res.status(403).json({ error: "Not assigned to you" });
      if (admin.status === "administered") return res.status(400).json({ error: "Already administered" });

      const rx = await storage.getPrescription(admin.prescriptionId);
      const notes = (req.body?.notes as string) || "";
      const administeredAtIso = new Date().toISOString();

      const adminDoc = {
        administration_id: admin.id,
        prescription_id: admin.prescriptionId,
        rx_number: rx?.rxNumber,
        drug: rx?.drug,
        strength: rx?.strength,
        pharmacist_user_id: req.session.userId,
        cycle: admin.cycleNumber,
        administered_at: administeredAtIso,
        notes,
      };
      const broadcast = await broadcastToXRPL(adminDoc, "lai_administration", `LAI-${admin.id}-cycle${admin.cycleNumber}`, "administer");

      // Auto-submit a $200 admin-fee claim (SIMULATED) and anchor it on XRPL.
      // The pharmacist (= mobile pharmacist) receives the settlement, since they
      // are the entity who delivered the service.
      let claim: any = null;
      try {
        const claimDoc = {
          rx_number: rx?.rxNumber,
          prescription_id: admin.prescriptionId,
          administration_id: admin.id,
          fee_type: "LAI administration fee (SIMULATED)",
          billed_amount: 200,
          payer_name: "DemoPBM (SIMULATED)",
          submitted_at: administeredAtIso,
        };
        const claimBroadcast = await broadcastToXRPL(claimDoc, "claim", `${rx?.rxNumber ?? "LAI"}-admin-fee`, "submit");
        claim = await storage.createClaim({
          prescriptionId: admin.prescriptionId,
          pharmacyUserId: req.session.userId,
          payerName: "DemoPBM (SIMULATED)",
          billedAmount: 200,
          submitTxHash: claimBroadcast.txHash,
        });
        await storage.recordLedger({
          entityType: "claim", entityId: claim.id, action: "submit",
          documentHash: claimBroadcast.documentHash, txHash: claimBroadcast.txHash,
          ledgerSequence: claimBroadcast.ledgerSequence,
          signerUserId: req.session.userId, signerName: null,
          network: "testnet", explorerUrl: claimBroadcast.explorerUrl,
        } as any);
      } catch (claimErr) {
        console.warn("[lai administer] auto-claim failed:", (claimErr as Error).message);
      }

      const updated = await storage.administerLai(id, broadcast.txHash, broadcast.documentHash, notes, claim?.id);

      // For recurring schedules, auto-create the next-cycle pending record.
      let nextAdmin = null;
      if (admin.schedule && admin.schedule !== "asap") {
        const intervalMs: Record<string, number> = {
          monthly: 30 * 24 * 60 * 60 * 1000,
          q2w: 14 * 24 * 60 * 60 * 1000,
          q4w: 28 * 24 * 60 * 60 * 1000,
          q3month: 90 * 24 * 60 * 60 * 1000,
          q6month: 180 * 24 * 60 * 60 * 1000,
        };
        const interval = intervalMs[admin.schedule] || 0;
        if (interval > 0) {
          nextAdmin = await storage.createLaiAdministration({
            prescriptionId: admin.prescriptionId,
            pharmacistId: admin.pharmacistId,
            schedule: admin.schedule,
            scheduledFor: Date.now() + interval,
            cycleNumber: (admin.cycleNumber ?? 1) + 1,
          });
        }
      }

      const signer = await storage.getUserById(req.session.userId);
      await storage.recordLedger({
        entityType: "lai_administration", entityId: admin.id, action: "administer",
        documentHash: broadcast.documentHash, txHash: broadcast.txHash,
        ledgerSequence: broadcast.ledgerSequence,
        signerUserId: req.session.userId, signerName: signer?.fullName ?? null,
        network: "testnet", explorerUrl: broadcast.explorerUrl,
      } as any);
      res.json({ administration: updated, broadcast, claim, nextAdmin });
    } catch (e: any) {
      console.error("[lai administer]", e);
      res.status(500).json({ error: e.message });
    }
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
    if (role === "manager") {
      const scope = await getManagerScope(req.session.userId);
      list = list.filter((s: any) =>
        managerSees(scope, s.pharmacyId) &&
        managerSees(scope, s.pharmacistId)
      );
    }
    res.json(list);
  });

  // Pharmacy or manager assigns a shift to a specific newly-registered pharmacist.
  app.post("/api/shifts/:id/assign", requireRole("pharmacy", "manager"), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const pharmacistId = parseInt(req.body?.pharmacistId);
      if (!pharmacistId) return res.status(400).json({ error: "pharmacistId required" });
      const target = await storage.getUserById(pharmacistId);
      if (!target || target.role !== "pharmacist") {
        return res.status(400).json({ error: "Target user is not a pharmacist" });
      }
      const s = await storage.acceptShift(id, pharmacistId);
      if (!s) return res.status(404).json({ error: "Shift not found" });
      const signer = await storage.getUserById(req.session.userId);
      const docPayload = {
        shift_id: s.id, pharmacy_id: s.pharmacyId, pharmacist_id: pharmacistId,
        date: s.date, assigned_at: new Date().toISOString(), assigned_by: req.session.userId,
      };
      const result = await broadcastToXRPL(docPayload, "shift", `Shift-${s.id}`, "assign");
      await storage.recordLedger({
        entityType: "shift", entityId: s.id, action: "assign",
        documentHash: result.documentHash, txHash: result.txHash,
        ledgerSequence: result.ledgerSequence,
        signerUserId: req.session.userId, signerName: signer?.fullName ?? null,
        network: "testnet", explorerUrl: result.explorerUrl,
      } as any);
      res.json({ shift: s, broadcast: result });
    } catch (e: any) {
      console.error("[shift assign]", e);
      res.status(500).json({ error: e.message });
    }
  });

  // Manager-only: read public Join-the-Team / Investor submissions stored on disk.
  // Surfaces inbound contact submissions inside the Operations control center so
  // the founder can review them from the manager dashboard.
  app.get("/api/manager/contact-submissions", requireRole("manager"), async (_req: any, res) => {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const dataDir = process.env.DATA_DIR || "./data";
      const logPath = path.join(dataDir, "contact-submissions.jsonl");
      if (!fs.existsSync(logPath)) return res.json([]);
      const raw = fs.readFileSync(logPath, "utf8");
      const lines = raw.split("\n").filter(Boolean);
      const entries = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      // Newest first
      entries.sort((a: any, b: any) => (b.receivedAt || "").localeCompare(a.receivedAt || ""));
      res.json(entries);
    } catch (e: any) {
      console.error("[contact submissions]", e);
      res.status(500).json({ error: e.message });
    }
  });

  // Manager-only: list shifts that are actively assigned to an in-scope pharmacist
  // and have NOT yet been verified by a manager. Scope rules match the rest of the
  // manager dashboards (demo manager sees demo signers, non-demo manager sees the
  // inverse — e.g. a non-demo operations manager sees Medipharm employee shifts).
  app.get("/api/manager/shifts/pending", requireRole("manager"), async (req: any, res) => {
    const scope = await getManagerScope(req.session.userId);
    const all = await storage.listShifts();
    const ledger = await storage.listLedger(10000);
    const verifiedShiftIds = new Set(
      ledger
        .filter((e: any) => e.entityType === "shift" && e.action === "verify")
        .map((e: any) => e.entityId)
    );
    const pending = all.filter((s: any) => {
      // Must be actively assigned (pharmacist pre-assigned or accepted from marketplace)
      const isActive = s.pharmacistId != null && (s.status === "accepted" || s.status === "in_progress");
      if (!isActive) return false;
      if (verifiedShiftIds.has(s.id)) return false;
      // Apply manager scope to the assigned pharmacist and posting pharmacy
      return managerSees(scope, s.pharmacistId) && managerSees(scope, s.pharmacyId);
    });
    const result = await Promise.all(pending.map(async (s: any) => {
      const pharmacist = s.pharmacistId ? await storage.getUserById(s.pharmacistId) : null;
      const pharmacy = s.pharmacyId ? await storage.getUserById(s.pharmacyId) : null;
      const safe = (u: any) => u ? (() => { const { password, ...rest } = u; return rest; })() : null;
      return { ...s, pharmacist: safe(pharmacist), pharmacy: safe(pharmacy) };
    }));
    res.json(result);
  });

  // Manager verifies an actively-assigned shift, anchoring a `verify` action on XRPL.
  app.post("/api/shifts/:id/verify", requireRole("manager"), async (req: any, res) => {
    try {
      const id = parseInt(req.params.id);
      const all = await storage.listShifts();
      const s = all.find((x: any) => x.id === id);
      if (!s) return res.status(404).json({ error: "Shift not found" });
      if (s.pharmacistId == null) return res.status(400).json({ error: "Shift has no assigned pharmacist" });
      const pharmacist = await storage.getUserById(s.pharmacistId);
      const pharmacy = await storage.getUserById(s.pharmacyId);
      const signer = await storage.getUserById(req.session.userId);
      const docPayload = {
        shift_id: s.id,
        pharmacy_id: s.pharmacyId,
        pharmacy_name: pharmacy?.organizationName ?? pharmacy?.fullName ?? null,
        pharmacist_id: s.pharmacistId,
        pharmacist_name: pharmacist?.fullName ?? null,
        date: s.date,
        title: s.title,
        verified_by_user_id: req.session.userId,
        verified_at: new Date().toISOString(),
      };
      const result = await broadcastToXRPL(docPayload, "shift", `Shift-${s.id}`, "verify");
      await storage.recordLedger({
        entityType: "shift", entityId: s.id, action: "verify",
        documentHash: result.documentHash, txHash: result.txHash,
        ledgerSequence: result.ledgerSequence,
        signerUserId: req.session.userId, signerName: signer?.fullName ?? null,
        network: "testnet", explorerUrl: result.explorerUrl,
      } as any);
      res.json({ ok: true, ...result });
    } catch (e: any) {
      console.error("[shift verify]", e);
      res.status(500).json({ error: e.message });
    }
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
  app.get("/api/ledger", requireAuth, async (req: any, res) => {
    const limit = parseInt((req.query.limit as string) || "100");
    let list = await storage.listLedger(limit);
    if (req.session.role === "manager") {
      const scope = await getManagerScope(req.session.userId);
      list = list.filter((e: any) => managerSees(scope, e.signerUserId));
    }
    res.json(list);
  });

  app.get("/api/ledger/wallet", requireAuth, async (req, res) => {
    try {
      res.json(await getWalletInfo());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/ledger/payer-wallet", requireAuth, async (req, res) => {
    try {
      res.json(await getPayerWalletInfo());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ============================================================
  // Stats / overview
  // ============================================================
  app.get("/api/stats", requireAuth, async (req: any, res) => {
    const stats = await storage.getStats();
    if (req.session.role === "manager") {
      // Scope manager-facing stats to the manager's view (demo or non-demo).
      const scope = await getManagerScope(req.session.userId);
      const allUsers = (await Promise.all([
        storage.listUsersByRole("pharmacist"),
        storage.listUsersByRole("prescriber"),
        storage.listUsersByRole("pharmacy"),
        storage.listUsersByRole("manager"),
        storage.listUsersByRole("patient"),
      ])).flat();
      const scopedUsers = allUsers.filter((u: any) =>
        scope.mode === "demo" ? scope.demoIds.has(u.id) : !scope.demoIds.has(u.id)
      );
      const allRx = await storage.listPrescriptions();
      const scopedRx = allRx.filter((p: any) =>
        managerSees(scope, p.prescriberId) &&
        managerSees(scope, p.pharmacyId) &&
        managerSees(scope, p.mobilePharmacistId)
      );
      const allShifts = await storage.listShifts();
      const scopedShifts = allShifts.filter((s: any) =>
        managerSees(scope, s.pharmacyId) &&
        managerSees(scope, s.pharmacistId)
      );
      const allLedger = await storage.listLedger(10000);
      const scopedLedger = allLedger.filter((e: any) => managerSees(scope, e.signerUserId));
      return res.json({
        users: scopedUsers.length,
        prescriptions: scopedRx.length,
        shifts: scopedShifts.length,
        ledgerEntries: scopedLedger.length,
      });
    }
    res.json(stats);
  });
}
