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

// Demo-only manager view: when the manager logs in, every list endpoint is
// scoped to the original seeded demo signers. New self-registered users are
// hidden from the manager dashboards so the control center always shows the
// stable demo data set.
async function getDemoUserIds(): Promise<Set<number>> {
  const emails = [
    "pharmacist@demo.huna",
    "prescriber@demo.huna",
    "pharmacy@demo.huna",
    "manager@demo.huna",
    "patient@demo.huna",
  ];
  const ids = new Set<number>();
  for (const e of emails) {
    const u = await storage.getUserByEmail(e);
    if (u) ids.add(u.id);
  }
  return ids;
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
  app.get("/api/users", requireAuth, async (req: any, res) => {
    const role = req.query.role as string | undefined;
    const laiCertified = req.query.laiCertified === "1" || req.query.laiCertified === "true";
    let list = role ? await storage.listUsersByRole(role) : [];
    if (laiCertified) list = list.filter((u: any) => u.laiCertified);
    // Manager dashboards only show original demo signers.
    if (req.session.role === "manager") {
      const demoIds = await getDemoUserIds();
      list = list.filter((u: any) => demoIds.has(u.id));
    }
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

  // Manager-only: list all pending licenses with user info (scoped to demo signers).
  app.get("/api/manager/licenses/pending", requireRole("manager"), async (req, res) => {
    const demoIds = await getDemoUserIds();
    const all = await storage.listAllLicenses();
    const pending = all.filter((l) => l.status === "pending" && demoIds.has(l.userId));
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
      const demoIds = await getDemoUserIds();
      list = list.filter((p: any) =>
        (p.prescriberId == null || demoIds.has(p.prescriberId)) &&
        (p.pharmacyId == null || demoIds.has(p.pharmacyId)) &&
        (p.mobilePharmacistId == null || demoIds.has(p.mobilePharmacistId))
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
      const demoIds = await getDemoUserIds();
      list = list.filter((s: any) =>
        (s.pharmacyId == null || demoIds.has(s.pharmacyId)) &&
        (s.pharmacistId == null || demoIds.has(s.pharmacistId))
      );
    }
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
  app.get("/api/ledger", requireAuth, async (req: any, res) => {
    const limit = parseInt((req.query.limit as string) || "100");
    let list = await storage.listLedger(limit);
    if (req.session.role === "manager") {
      const demoIds = await getDemoUserIds();
      list = list.filter((e: any) => e.signerUserId == null || demoIds.has(e.signerUserId));
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
      // Scope manager-facing stats to demo signers only.
      const demoIds = await getDemoUserIds();
      const allRx = await storage.listPrescriptions();
      const demoRx = allRx.filter((p: any) =>
        (p.prescriberId == null || demoIds.has(p.prescriberId)) &&
        (p.pharmacyId == null || demoIds.has(p.pharmacyId)) &&
        (p.mobilePharmacistId == null || demoIds.has(p.mobilePharmacistId))
      );
      const allShifts = await storage.listShifts();
      const demoShifts = allShifts.filter((s: any) =>
        (s.pharmacyId == null || demoIds.has(s.pharmacyId)) &&
        (s.pharmacistId == null || demoIds.has(s.pharmacistId))
      );
      const allLedger = await storage.listLedger(10000);
      const demoLedger = allLedger.filter((e: any) => e.signerUserId == null || demoIds.has(e.signerUserId));
      return res.json({
        users: demoIds.size,
        prescriptions: demoRx.length,
        shifts: demoShifts.length,
        ledgerEntries: demoLedger.length,
      });
    }
    res.json(stats);
  });
}
