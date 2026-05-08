import { useQuery } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { AppShell } from "@/components/AppShell";
import { LedgerProofBadge } from "@/components/LedgerProofBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Pill, Calendar, FileBadge2, ShieldCheck } from "lucide-react";
import type { Prescription, Visit, LedgerEntry } from "@/lib/types";
import { fmtDateTime, statusColor } from "@/lib/format";

const NAV = [
  { label: "Prescriptions", path: "/dashboard/patient", testId: "nav-patient-rx" },
  { label: "Telehealth", path: "/dashboard/patient/visits", testId: "nav-patient-visits" },
  { label: "Verification", path: "/dashboard/patient/proofs", testId: "nav-patient-proofs" },
];

export default function PatientDashboard() {
  const [, params] = useRoute("/dashboard/patient/:tab?");
  const tab = params?.tab || "rx";
  return (
    <AppShell title="My HunaDoc" subtitle="Your prescriptions, telehealth visits, and on-chain verification proofs." nav={NAV}>
      {tab === "rx" && <RxList />}
      {tab === "visits" && <VisitList />}
      {tab === "proofs" && <Proofs />}
    </AppShell>
  );
}

function RxList() {
  const { data: rxs = [], isLoading } = useQuery<Prescription[]>({ queryKey: ["/api/prescriptions"] });
  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold">My prescriptions ({rxs.length})</h2>
      {isLoading && <Skel />}
      {!isLoading && rxs.length === 0 && <Empty message="No prescriptions on file. Your prescriber's signed orders will appear here." />}
      <div className="space-y-2">
        {rxs.map((r) => (
          <Card key={r.id}>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Pill className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono text-xs text-muted-foreground">{r.rxNumber}</span>
                    <Badge variant="outline" className={statusColor(r.status)}>{r.status}</Badge>
                  </div>
                  <p className="text-sm font-medium mt-1">{r.drug} {r.strength} {r.form}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">qty {r.quantity} · {r.refills} refills</p>
                  <p className="text-xs italic text-muted-foreground mt-1">{r.sig}</p>
                  {r.ledgerTxHash && (
                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                      <LedgerProofBadge txHash={r.ledgerTxHash} label="Authenticity verified" />
                      <span className="text-[10px] text-muted-foreground">
                        Anchored at {fmtDateTime(r.signedAt)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function VisitList() {
  const { data: visits = [], isLoading } = useQuery<Visit[]>({ queryKey: ["/api/visits"] });
  return (
    <div className="space-y-3">
      <h2 className="text-base font-semibold">My telehealth visits ({visits.length})</h2>
      {isLoading && <Skel />}
      {!isLoading && visits.length === 0 && <Empty message="No visits scheduled." />}
      <div className="space-y-2">
        {visits.map((v) => (
          <Card key={v.id}>
            <CardContent className="p-4 flex items-start gap-3">
              <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Calendar className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium">{v.reason}</span>
                  <Badge variant="outline" className={statusColor(v.status)}>{v.status}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">{fmtDateTime(v.scheduledFor)}</div>
                {v.ledgerTxHash && (
                  <div className="mt-2"><LedgerProofBadge txHash={v.ledgerTxHash} label="Visit note hash anchored" size="sm" /></div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Proofs() {
  const { data: ledger = [], isLoading } = useQuery<LedgerEntry[]>({ queryKey: ["/api/ledger"] });
  // Patients see all ledger items in alpha; in prod we'd filter to entities involving them
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">Verification proofs</h2>
        <p className="text-xs text-muted-foreground">Independent, third-party-verifiable proofs that your records are exactly what HunaDoc says they are.</p>
      </div>
      {isLoading && <Skel />}
      {!isLoading && ledger.length === 0 && <Empty message="Once your prescriber signs an order, the verification proof appears here." />}
      <div className="space-y-2">
        {ledger.map((e) => (
          <Card key={e.id}>
            <CardContent className="p-4 flex items-start gap-3">
              <div className="h-10 w-10 rounded-md bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium capitalize">{e.entityType} {e.action}</span>
                  <Badge variant="outline" className="text-[10px]">XRPL TESTNET</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {fmtDateTime(e.createdAt)} · signed by {e.signerName || "—"}
                </div>
                <div className="text-xs font-mono text-muted-foreground mt-1">
                  Hash: {e.documentHash}
                </div>
                <div className="mt-2"><LedgerProofBadge txHash={e.txHash} explorerUrl={e.explorerUrl} label="View independent proof" /></div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Skel() { return <div className="grid gap-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-lg border border-border bg-card animate-pulse" />)}</div>; }
function Empty({ message }: { message: string }) { return <Card className="border-dashed"><CardContent className="p-8 text-center text-sm text-muted-foreground">{message}</CardContent></Card>; }
