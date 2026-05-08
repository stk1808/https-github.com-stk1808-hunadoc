// Frontend type aliases mirroring shared/schema.ts (avoids importing zod types into bundles)
export type Role = "pharmacist" | "prescriber" | "pharmacy" | "manager" | "patient";

export interface User {
  id: number;
  email: string;
  role: Role;
  fullName: string;
  phone: string | null;
  npi: string | null;
  pharmacistLicense: string | null;
  ncpdp: string | null;
  organizationName: string | null;
  specialty: string | null;
  state: string | null;
  verified: boolean;
  createdAt: number;
}

export interface License {
  id: number;
  userId: number;
  type: string;
  number: string;
  issuingState: string;
  issueDate: string | null;
  expirationDate: string | null;
  fileName: string | null;
  status: "pending" | "verified" | "expired" | "rejected";
  ledgerTxHash: string | null;
  documentHash: string | null;
  createdAt: number;
}

export interface Patient {
  id: number;
  userId: number | null;
  mrn: string;
  firstName: string;
  lastName: string;
  dob: string;
  sex: string | null;
  email: string | null;
  phone: string | null;
  allergies: string | null;
  primaryPrescriberId: number | null;
  createdAt: number;
}

export interface Prescription {
  id: number;
  rxNumber: string;
  patientId: number;
  prescriberId: number;
  pharmacyId: number | null;
  drug: string;
  strength: string;
  form: string;
  sig: string;
  quantity: string;
  refills: number;
  daw: boolean;
  channel: "surescripts" | "direct" | "manual";
  destinationSoftware: "pioneer_rx" | "qs1" | "best_rx" | "rx30" | "liberty" | "manual" | null;
  ncpdpScript: string | null;
  status: "draft" | "signed" | "transmitted" | "received" | "filled" | "cancelled";
  documentHash: string | null;
  ledgerTxHash: string | null;
  ledgerSequence: number | null;
  signedAt: number | null;
  filledAt: number | null;
  notes: string | null;
  createdAt: number;
}

export interface Claim {
  id: number;
  claimNumber: string;
  prescriptionId: number;
  pharmacyUserId: number;
  payerName: string;
  billedAmount: number;
  adjudicatedAmount: number | null;
  patientResponsibility: number | null;
  status: "submitted" | "adjudicated" | "paid" | "rejected";
  rejectReason: string | null;
  submittedAt: number;
  adjudicatedAt: number | null;
  paidAt: number | null;
  submitTxHash: string | null;
  settlementTxHash: string | null;
  settlementAmountXrp: number | null;
  payerAddress: string | null;
  pharmacyAddress: string | null;
  createdAt: number;
}

export interface Shift {
  id: number;
  pharmacyId: number;
  pharmacistId: number | null;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  hourlyRate: number;
  location: string;
  notes: string | null;
  urgency: "routine" | "urgent" | "stat";
  status: "open" | "accepted" | "in_progress" | "completed" | "cancelled";
  ledgerTxHash: string | null;
  acceptedAt: number | null;
  completedAt: number | null;
  createdAt: number;
}

export interface Visit {
  id: number;
  patientId: number;
  prescriberId: number;
  scheduledFor: string;
  reason: string;
  status: "scheduled" | "live" | "completed" | "cancelled";
  notes: string | null;
  noteHash: string | null;
  ledgerTxHash: string | null;
  startedAt: number | null;
  endedAt: number | null;
  createdAt: number;
}

export interface LedgerEntry {
  id: number;
  entityType: "prescription" | "license" | "shift" | "visit" | "claim" | "settlement";
  entityId: number;
  action: string;
  documentHash: string;
  txHash: string;
  ledgerSequence: number | null;
  signerUserId: number | null;
  signerName: string | null;
  network: string;
  explorerUrl: string | null;
  createdAt: number;
}
