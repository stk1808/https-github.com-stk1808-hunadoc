import { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Role } from "@/lib/types";
// Image asset imports — webpack/vite will fingerprint these. The illustrations
// are bundled with the client.
import imgPrescriberPatients from "@assets/help/01-prescriber-patients.png";
import imgPrescriberPrescribe from "@assets/help/02-prescriber-prescribe.png";
import imgPrescriberLai from "@assets/help/03-prescriber-lai.png";
import imgPrescriberTelehealth from "@assets/help/04-prescriber-telehealth.png";
import imgPharmacistShifts from "@assets/help/05-pharmacist-shifts.png";
import imgPharmacistRx from "@assets/help/06-pharmacist-rx.png";
import imgPharmacistLai from "@assets/help/07-pharmacist-lai.png";
import imgPharmacistCreds from "@assets/help/08-pharmacist-credentials.png";
import imgPharmacyRx from "@assets/help/09-pharmacy-rx-queue.png";
import imgPharmacyClaims from "@assets/help/10-pharmacy-claims.png";
import imgPharmacyShifts from "@assets/help/11-pharmacy-shifts.png";
import imgManagerOverview from "@assets/help/12-manager-overview.png";
import imgManagerVerify from "@assets/help/13-manager-verify.png";
import imgManagerLedger from "@assets/help/14-manager-ledger.png";
import imgPatientOverview from "@assets/help/15-patient-overview.png";

interface Step {
  title: string;
  body: string;
}

interface GuideSection {
  title: string;
  image: string;
  intro: string;
  steps: Step[];
  tips?: string[];
}

const PRESCRIBER: GuideSection[] = [
  {
    title: "Patients",
    image: imgPrescriberPatients,
    intro: "Add and review your patient roster. All records are TEST-only with synthetic identifiers.",
    steps: [
      { title: "Add a patient", body: "Click New patient. Enter MRN, name, DOB, sex, and any allergies. Save." },
      { title: "Browse roster", body: "Each card shows name, MRN, DOB, and allergy notes for quick review before prescribing." },
    ],
    tips: ["Use synthetic data only — this is an alpha environment."],
  },
  {
    title: "Prescribe",
    image: imgPrescriberPrescribe,
    intro: "Create draft prescriptions, route them to a HunaDoc pharmacy, and sign with a real XRPL Testnet anchor.",
    steps: [
      { title: "Pick the patient", body: "Select the patient at the top of the form." },
      { title: "Drug, strength, sig", body: "Enter the medication details. Sig is the patient instruction (e.g. \"Take 1 tablet by mouth daily\")." },
      { title: "Routing channel", body: "Manual is the default. Surescripts and Direct are SIMULATED for the alpha." },
      { title: "Pharmacy", body: "Pick a HunaDoc pharmacy. The signed Rx will appear in their queue immediately." },
      { title: "Save & sign", body: "Save as draft, then click Sign + anchor on the draft card. The Rx is hashed and broadcast to XRPL Testnet." },
    ],
    tips: ["Look for the green ledger badge after signing — it links to the live XRPL Testnet transaction."],
  },
  {
    title: "LAI administration",
    image: imgPrescriberLai,
    intro: "Long-acting injectables (LAI) are routed to a mobile LAI-certified pharmacist who administers and timestamps each dose.",
    steps: [
      { title: "Toggle LAI", body: "The toggle locks on automatically when the drug name matches the LAI list (Aristada, Invega Sustenna, Sublocade, etc.). Otherwise toggle it on manually." },
      { title: "Pick a schedule", body: "ASAP for one-time, or recurring: monthly, q2w, q4w, q3 month, q6 month." },
      { title: "Pick the mobile pharmacist", body: "Only LAI-certified pharmacists appear here. They receive the order in their LAI administrations queue." },
      { title: "Sign", body: "Signing creates the first administration record, anchors it to XRPL Testnet, and notifies the pharmacist." },
    ],
    tips: ["Each completed administration auto-submits a SIMULATED $200 admin-fee claim with T0 settlement."],
  },
  {
    title: "Telehealth",
    image: imgPrescriberTelehealth,
    intro: "Schedule, run, and document telehealth visits. Notes are hashed and anchored — content stays in HunaDoc.",
    steps: [
      { title: "Schedule a visit", body: "Click Schedule visit. Pick the patient, date/time, and reason." },
      { title: "Start the visit", body: "When it's time, click Start. The mock video panel opens." },
      { title: "End + anchor", body: "Write your visit notes. Click End visit + anchor hash. Only the SHA-256 hash goes on-chain." },
    ],
  },
];

const PHARMACIST: GuideSection[] = [
  {
    title: "Open shifts",
    image: imgPharmacistShifts,
    intro: "Browse and accept open per diem shifts posted by pharmacies.",
    steps: [
      { title: "Review the card", body: "Title, date, hours, location, hourly rate, and any notes." },
      { title: "Accept shift", body: "Click Accept shift to commit. It moves to your My shifts list." },
      { title: "Mark complete", body: "After working, click Mark complete + sign. Completion is anchored to XRPL Testnet." },
    ],
  },
  {
    title: "Rx queue",
    image: imgPharmacistRx,
    intro: "Signed prescriptions routed to your pharmacy appear here. Fill them and update status.",
    steps: [
      { title: "Read the order", body: "Each card shows Rx number, drug, strength, quantity, sig, and prescriber signature ledger badge." },
      { title: "Mark filled", body: "Click Mark filled when the order is dispensed." },
    ],
    tips: ["The prescriber signature badge links directly to the XRPL Testnet transaction proving it was signed."],
  },
  {
    title: "LAI administrations",
    image: imgPharmacistLai,
    intro: "Long-acting injectable orders routed to you. Accept, schedule, administer, timestamp.",
    steps: [
      { title: "Pending", body: "New orders show up here. Click Accept (ASAP) or Schedule… to set a future date." },
      { title: "Scheduled", body: "Once accepted, the card moves here. When the visit happens, click Mark administered." },
      { title: "Confirm administration", body: "Add optional notes (site, lot). Click Mark administered + anchor. Timestamp is broadcast to XRPL Testnet." },
      { title: "Auto claim & next cycle", body: "A SIMULATED $200 admin-fee claim is auto-submitted with T0 settlement. For recurring schedules, the next cycle is created automatically." },
    ],
  },
  {
    title: "Credentials",
    image: imgPharmacistCreds,
    intro: "Add your credentials (state pharmacist license, professional liability insurance, signed 1099 form, and other certifications). A manager verifies and anchors them on-chain.",
    steps: [
      { title: "Add credential", body: "Click Add credential. Pick type, enter number, state, and expiration." },
      { title: "Submit for verification", body: "The credential goes pending until a manager verifies it." },
      { title: "Verified badge", body: "Once verified, a green ledger badge appears linking to the on-chain proof." },
    ],
  },
];

const PHARMACY: GuideSection[] = [
  {
    title: "Rx queue",
    image: imgPharmacyRx,
    intro: "All signed prescriptions routed to this pharmacy. Verify, fill, and submit insurance claims.",
    steps: [
      { title: "Active queue", body: "Signed Rx awaiting fill. Each card shows the patient instruction (sig), channel, destination software, and prescriber signature anchor." },
      { title: "Submit a claim", body: "Click Submit claim. A SIMULATED claim is built and anchored on XRPL Testnet." },
    ],
  },
  {
    title: "Claims & settlements",
    image: imgPharmacyClaims,
    intro: "Track every claim from submission through adjudication and on-chain T0 settlement in XRP.",
    steps: [
      { title: "Submitted", body: "Newly submitted claims with their on-chain anchor." },
      { title: "Adjudicate", body: "SIMULATED PBM adjudication — randomly approves part of the billed amount." },
      { title: "Settle", body: "Click Settle on adjudicated claims. Funds move on XRPL Testnet from the payer wallet to the pharmacy wallet." },
    ],
    tips: ["Settlement is real XRPL Testnet XRP movement, not simulated."],
  },
  {
    title: "Staffing shifts",
    image: imgPharmacyShifts,
    intro: "Post per diem shifts that pharmacists can accept.",
    steps: [
      { title: "Post a shift", body: "Click Post shift. Enter title, date, hours, location, hourly rate, and notes." },
      { title: "Track", body: "Watch shifts move from open → accepted → completed. Completion is anchored on-chain." },
    ],
  },
];

const MANAGER: GuideSection[] = [
  {
    title: "Overview",
    image: imgManagerOverview,
    intro: "Network-wide health: user counts, pending verifications, claim volume, and on-chain activity.",
    steps: [
      { title: "Read the KPIs", body: "Quick counts of users, prescriptions, shifts, and claims across the network." },
      { title: "Spot bottlenecks", body: "Pending license verifications and unsettled claims surface here first." },
    ],
  },
  {
    title: "Verify licenses",
    image: imgManagerVerify,
    intro: "Approve pharmacist credentials. Each verification anchors a SHA-256 hash to XRPL Testnet.",
    steps: [
      { title: "Review the submission", body: "License type, number, state, expiration, and the submitting pharmacist." },
      { title: "Verify + anchor", body: "Click Verify. The credential becomes active and a ledger badge attaches." },
    ],
  },
  {
    title: "Ledger feed",
    image: imgManagerLedger,
    intro: "Real-time view of every XRPL Testnet anchor produced by the network.",
    steps: [
      { title: "Watch the stream", body: "New entries arrive as users sign prescriptions, complete shifts, settle claims, or administer LAI doses." },
      { title: "Click to verify", body: "Each badge links to the public XRPL Testnet explorer for cryptographic proof." },
    ],
  },
];

const PATIENT: GuideSection[] = [
  {
    title: "My HunaDoc",
    image: imgPatientOverview,
    intro: "Your prescriptions, telehealth visits, and on-chain verification proofs in one place.",
    steps: [
      { title: "Prescriptions", body: "Active and historical Rx with the prescriber's on-chain signature for tamper-evidence." },
      { title: "Telehealth visits", body: "Past and upcoming visits with the anchored note hash for each completed encounter." },
      { title: "Verification", body: "One-click open of any ledger badge to see the live XRPL Testnet transaction." },
    ],
    tips: ["You never see your own PHI on-chain — only its hash. The original record stays with HunaDoc."],
  },
];

const GUIDES: Record<Role, GuideSection[]> = {
  prescriber: PRESCRIBER,
  pharmacist: PHARMACIST,
  pharmacy: PHARMACY,
  manager: MANAGER,
  patient: PATIENT,
};

export function HelpGuide({ role }: { role: Role }) {
  const sections = GUIDES[role] || [];
  return (
    <div className="space-y-6">
      <Card className="border-primary/30 bg-primary/[0.03]">
        <CardContent className="p-5 space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">User guide</Badge>
            <span className="text-xs text-muted-foreground">Step-by-step walk-through of every tab.</span>
          </div>
          <p className="text-sm">
            HunaDoc is a TEST-ONLY alpha. Every action that you see anchored is a real XRPL Testnet transaction; labels marked SIMULATED reflect external networks (Surescripts, PBM, PioneerRx, etc.) that HunaDoc has not yet certified into.
          </p>
        </CardContent>
      </Card>

      {sections.map((s, i) => (
        <GuideCard key={i} section={s} index={i + 1} />
      ))}

      <Card>
        <CardContent className="p-5 space-y-2">
          <h3 className="text-sm font-semibold">Need a printable version?</h3>
          <p className="text-xs text-muted-foreground">
            Download the role-specific PDF from your account manager, or request one at the bottom of this page.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function GuideCard({ section, index }: { section: GuideSection; index: number }) {
  return (
    <Card data-testid={`help-section-${index}`}>
      <CardContent className="p-0 overflow-hidden">
        <div className="grid md:grid-cols-[1.1fr_1fr]">
          <div className="aspect-video md:aspect-auto bg-muted/40">
            <img
              src={section.image}
              alt={section.title}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          </div>
          <div className="p-5 space-y-4">
            <div>
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-[10px]">Step {index}</Badge>
                <h2 className="text-base font-semibold">{section.title}</h2>
              </div>
              <p className="text-xs text-muted-foreground mt-1">{section.intro}</p>
            </div>
            <ol className="space-y-2">
              {section.steps.map((st, i) => (
                <li key={i} className="flex gap-3">
                  <div className="h-5 w-5 rounded-full bg-primary/10 text-primary text-[11px] font-medium flex items-center justify-center shrink-0 mt-0.5">
                    {i + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{st.title}</div>
                    <p className="text-xs text-muted-foreground">{st.body}</p>
                  </div>
                </li>
              ))}
            </ol>
            {section.tips && section.tips.length > 0 && (
              <div className="space-y-1 border-t border-border pt-3">
                {section.tips.map((t, i) => (
                  <p key={i} className="text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">Tip: </span>{t}
                  </p>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function _buildElement(_n: ReactNode) { return null; }
