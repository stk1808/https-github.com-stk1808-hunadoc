import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AppShell } from "@/components/AppShell";
import { LedgerProofBadge } from "@/components/LedgerProofBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Users, FileSignature, Database, ShieldCheck, Wallet, ExternalLink, BookOpen, LayoutDashboard, Briefcase, Mail, Copy } from "lucide-react";
import { HelpGuide } from "@/components/HelpGuide";
import type { NavGroup } from "@/components/AppShell";
import type { LedgerEntry, License, User, Shift } from "@/lib/types";
import { fmtDate, fmtDateTime, statusColor } from "@/lib/format";

type PendingShift = Shift & { pharmacist?: User | null; pharmacy?: User | null };

const NAV: NavGroup[] = [
  {
    label: "Network",
    items: [
      { label: "Overview", path: "/dashboard/manager", testId: "nav-manager-overview", icon: LayoutDashboard },
      { label: "Users", path: "/dashboard/manager/users", testId: "nav-manager-users", icon: Users },
    ],
  },
  {
    label: "Compliance",
    items: [
      { label: "Verify licenses", path: "/dashboard/manager/verify", testId: "nav-manager-verify", icon: ShieldCheck },
      { label: "Verify shifts", path: "/dashboard/manager/verify-shifts", testId: "nav-manager-verify-shifts", icon: Briefcase },
      { label: "Ledger feed", path: "/dashboard/manager/ledger", testId: "nav-manager-ledger", icon: Database },
    ],
  },
  {
    label: "Inbound",
    items: [
      { label: "Messages", path: "/dashboard/manager/inbox", testId: "nav-manager-inbox", icon: Mail },
    ],
  },
  {
    label: "Help",
    items: [
      { label: "User guide", path: "/dashboard/manager/help", testId: "nav-manager-help", icon: BookOpen },
    ],
  },
];

export default function ManagerDashboard() {
  const [, params] = useRoute("/dashboard/manager/:tab?");
  const tab = params?.tab || "overview";
  return (
    <AppShell title="Operations control center" subtitle="HunaDoc network health, credential verification, and the live XRPL feed." nav={NAV}>
      {tab === "overview" && <Overview />}
      {tab === "verify" && <VerifyLicenses />}
      {tab === "verify-shifts" && <VerifyShifts />}
      {tab === "ledger" && <LedgerFeed />}
      {tab === "users" && <UsersList />}
      {tab === "inbox" && <InboundMessages />}
      {tab === "help" && <HelpGuide role="manager" />}
    </AppShell>
  );
}

function Overview() {
  const { data: stats } = useQuery<any>({ queryKey: ["/api/stats"] });
  const { data: wallet } = useQuery<any>({ queryKey: ["/api/ledger/wallet"] });
  const { data: ledger = [] } = useQuery<LedgerEntry[]>({ queryKey: ["/api/ledger"] });
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={Users} label="Network users" value={stats?.users ?? "—"} />
        <Stat icon={FileSignature} label="Prescriptions" value={stats?.prescriptions ?? "—"} />
        <Stat icon={Activity} label="Shifts" value={stats?.shifts ?? "—"} />
        <Stat icon={Database} label="Ledger entries" value={stats?.ledgerEntries ?? "—"} />
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <h3 className="font-semibold text-sm flex items-center gap-2"><Wallet className="h-4 w-4 text-primary" /> HunaDoc anchor wallet</h3>
              <p className="text-xs text-muted-foreground mt-0.5">Every signed action is broadcast as a 1-drop XRPL Testnet payment with the document hash in Memo.</p>
            </div>
            <Badge variant="outline" className="text-[10px]">XRPL TESTNET</Badge>
          </div>
          {wallet && (
            <div className="grid sm:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded-md border border-border bg-card/30">
                <div className="text-muted-foreground uppercase text-[10px] tracking-wider mb-1">Address</div>
                <div className="font-mono break-all">{wallet.address}</div>
              </div>
              <div className="p-3 rounded-md border border-border bg-card/30">
                <div className="text-muted-foreground uppercase text-[10px] tracking-wider mb-1">Balance (XRP)</div>
                <div className="font-mono text-base">{wallet.balanceXRP ?? "—"}</div>
              </div>
              <div className="p-3 rounded-md border border-border bg-card/30">
                <div className="text-muted-foreground uppercase text-[10px] tracking-wider mb-1">Network</div>
                <div className="font-mono">testnet</div>
                {wallet.address && (
                  <a
                    href={`https://testnet.xrpl.org/accounts/${wallet.address}`}
                    target="_blank" rel="noreferrer"
                    className="text-primary text-xs flex items-center gap-1 mt-1 hover:underline"
                    data-testid="link-wallet-explorer"
                  >View on XRPL <ExternalLink className="h-3 w-3" /></a>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div>
        <h3 className="font-semibold text-sm mb-2">Recent ledger activity</h3>
        <LedgerTable entries={ledger.slice(0, 8)} />
      </div>
    </div>
  );
}

function VerifyLicenses() {
  const { toast } = useToast();
  const { data: pharmacists = [] } = useQuery<User[]>({ queryKey: ["/api/users", "pharmacist"], queryFn: async () => (await apiRequest("GET", "/api/users?role=pharmacist")).json() });
  const { data: prescribers = [] } = useQuery<User[]>({ queryKey: ["/api/users", "prescriber"], queryFn: async () => (await apiRequest("GET", "/api/users?role=prescriber")).json() });
  // For each user, fetch their licenses (alpha-light: this would page in prod). Use one fetch for all licenses.
  const { data: allLicenses = [], isLoading } = useQuery<License[]>({
    queryKey: ["/api/licenses/all"],
    queryFn: async () => {
      // grab licenses for each user listed; managers don't have a global listLicenses endpoint, so fetch per user
      const all: License[] = [];
      for (const u of [...pharmacists, ...prescribers]) {
        try {
          const r = await apiRequest("GET", `/api/licenses?userId=${u.id}`);
          // Server returns licenses for current session user only — fallback: skip
          // For alpha, manager should see all. Rebuild via /api/users; we'll patch routes below if needed.
        } catch {}
      }
      return all;
    },
    enabled: false, // disabled for now; use per-user manager-licenses endpoint instead
  });

  // Use new dedicated endpoint
  const { data: pending = [], isLoading: l2 } = useQuery<(License & { user?: User })[]>({
    queryKey: ["/api/manager/licenses/pending"],
    queryFn: async () => (await apiRequest("GET", "/api/manager/licenses/pending")).json(),
    retry: false,
  });

  const verify = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest("POST", `/api/licenses/${id}/verify`);
      return r.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/manager/licenses/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({
        title: "License verified and anchored",
        description: `XRPL tx ${data.txHash?.slice(0, 12)}…`,
      });
    },
  });

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Pending license verifications</h2>
        <p className="text-xs text-muted-foreground">Verifying writes a SHA-256 of the credential to the XRPL Testnet.</p>
      </div>
      {l2 && <Skel />}
      {!l2 && pending.length === 0 && <Empty message="No pending verifications. New license submissions appear here." />}
      <div className="space-y-2">
        {pending.map((l) => (
          <Card key={l.id} data-testid={`card-license-${l.id}`}>
            <CardContent className="p-4 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm capitalize">{l.type.replace(/_/g, " ")}</span>
                  <Badge variant="outline" className={statusColor(l.status)}>{l.status}</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {l.user?.fullName} · {l.user?.email} · {l.user?.role}
                </div>
                <div className="text-xs font-mono text-muted-foreground mt-0.5">
                  License: {l.number} · {l.issuingState} · expires {l.expirationDate || "—"}
                </div>
              </div>
              <Button size="sm" onClick={() => verify.mutate(l.id)} disabled={verify.isPending} data-testid={`button-verify-${l.id}`}>
                <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Verify + anchor
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function VerifyShifts() {
  const { toast } = useToast();
  const { data: pending = [], isLoading } = useQuery<PendingShift[]>({
    queryKey: ["/api/manager/shifts/pending"],
    queryFn: async () => (await apiRequest("GET", "/api/manager/shifts/pending")).json(),
    retry: false,
  });
  const verify = useMutation({
    mutationFn: async (id: number) => {
      const r = await apiRequest("POST", `/api/shifts/${id}/verify`);
      return r.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/manager/shifts/pending"] });
      queryClient.invalidateQueries({ queryKey: ["/api/ledger"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({
        title: "Shift verified and anchored",
        description: data?.txHash ? `XRPL tx ${data.txHash.slice(0, 12)}…` : undefined,
      });
    },
  });
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Verify actively assigned shifts</h2>
        <p className="text-xs text-muted-foreground">
          Shifts pre-assigned to an employed pharmacist (e.g. Medipharm) appear here. Verifying anchors a SHA-256 of the shift record to the XRPL Testnet.
        </p>
      </div>
      {isLoading && <Skel />}
      {!isLoading && pending.length === 0 && (
        <Empty message="No actively assigned shifts awaiting verification. New employed-pharmacist shifts will appear here." />
      )}
      <div className="space-y-2">
        {pending.map((s) => (
          <Card key={s.id} data-testid={`card-shift-${s.id}`}>
            <CardContent className="p-4 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-sm">{s.title}</span>
                  <Badge variant="outline" className={statusColor(s.status)}>{s.status}</Badge>
                  {s.urgency && (
                    <Badge variant="outline" className="text-[10px] capitalize">{s.urgency}</Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Pharmacist: {s.pharmacist?.fullName ?? "—"}
                  {s.pharmacist?.organizationName ? ` · ${s.pharmacist.organizationName}` : ""}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  Pharmacy: {s.pharmacy?.organizationName ?? s.pharmacy?.fullName ?? "—"}
                </div>
                <div className="text-xs font-mono text-muted-foreground mt-0.5">
                  {s.date} · {s.startTime}–{s.endTime} · {s.location}
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => verify.mutate(s.id)}
                disabled={verify.isPending}
                data-testid={`button-verify-shift-${s.id}`}
              >
                <ShieldCheck className="h-3.5 w-3.5 mr-1" /> Verify + anchor
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

type ContactSubmission = {
  receivedAt: string;
  kind: string;
  role: string;
  name: string;
  email: string;
  phone: string;
  message: string;
};

const KIND_LABELS: Record<string, string> = {
  join_team: "Join the Team",
};
const ROLE_LABELS: Record<string, string> = {
  prescriber: "Prescriber",
  pharmacist: "Pharmacist",
  pharmacy: "Pharmacy",
  mental_health: "Mental Health / Outreach",
  investor: "Investor / Partnership",
};

function InboundMessages() {
  const { toast } = useToast();
  const { data: messages = [], isLoading } = useQuery<ContactSubmission[]>({
    queryKey: ["/api/manager/contact-submissions"],
    queryFn: async () => (await apiRequest("GET", "/api/manager/contact-submissions")).json(),
  });
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast({ title: "Copied" }); } catch {}
  };
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Inbound messages</h2>
        <p className="text-xs text-muted-foreground">
          Public submissions from the HunaDoc landing page — Join the Team and Investor / Partnership inquiries. Newest first.
        </p>
      </div>
      {isLoading && <Skel />}
      {!isLoading && messages.length === 0 && (
        <Empty message="No inbound messages yet. Submissions from the public landing page will appear here." />
      )}
      <div className="space-y-2">
        {messages.map((m, i) => {
          const isInvestor = m.role === "investor";
          return (
            <Card key={`${m.receivedAt}-${i}`} data-testid={`card-message-${i}`}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={isInvestor ? "default" : "outline"} className="capitalize">
                      {ROLE_LABELS[m.role] || m.role || "—"}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {KIND_LABELS[m.kind] || m.kind}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{fmtDateTime(m.receivedAt)}</span>
                  </div>
                </div>
                <div className="text-sm font-medium">{m.name || "(no name provided)"}</div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                  <div className="flex items-center gap-1">
                    <a href={`mailto:${m.email}`} className="text-primary hover:underline" data-testid={`link-message-email-${i}`}>{m.email}</a>
                    <button onClick={() => copy(m.email)} className="text-muted-foreground hover:text-foreground" aria-label="Copy email">
                      <Copy className="h-3 w-3" />
                    </button>
                  </div>
                  {m.phone && (
                    <div className="flex items-center gap-1">
                      <a href={`tel:${m.phone}`} className="text-primary hover:underline">{m.phone}</a>
                      <button onClick={() => copy(m.phone)} className="text-muted-foreground hover:text-foreground" aria-label="Copy phone">
                        <Copy className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                </div>
                {m.message && (
                  <div className="text-sm bg-muted/40 rounded-md p-2 whitespace-pre-wrap">{m.message}</div>
                )}
                <div className="flex gap-2 pt-1">
                  <a
                    href={`mailto:${m.email}?subject=${encodeURIComponent("HunaDoc — thanks for reaching out")}&body=${encodeURIComponent(`Aloha ${m.name || ""},\n\nThank you for your message about HunaDoc. We received the following:\n\n\"${m.message}\"\n\nLet's set up a time to talk.\n\nMahalo,\nHunaDoc team`)}`}
                    className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-muted"
                    data-testid={`button-reply-${i}`}
                  >
                    <Mail className="h-3 w-3" /> Reply
                  </a>
                  <a
                    href={`mailto:Lavishluau@gmail.com?subject=${encodeURIComponent("HunaDoc inbound — " + (ROLE_LABELS[m.role] || m.role))}&body=${encodeURIComponent(`From: ${m.name} <${m.email}>\nPhone: ${m.phone || "—"}\nRole: ${ROLE_LABELS[m.role] || m.role}\nReceived: ${m.receivedAt}\n\n${m.message}`)}`}
                    className="text-xs inline-flex items-center gap-1 px-2 py-1 rounded border border-border hover:bg-muted"
                    data-testid={`button-forward-${i}`}
                  >
                    <Mail className="h-3 w-3" /> Forward to Lavishluau@gmail.com
                  </a>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function LedgerFeed() {
  const { data: ledger = [], isLoading } = useQuery<LedgerEntry[]>({ queryKey: ["/api/ledger"] });
  return (
    <div className="space-y-3">
      <div>
        <h2 className="text-base font-semibold">XRPL ledger feed ({ledger.length})</h2>
        <p className="text-xs text-muted-foreground">Every state-changing action across HunaDoc, anchored on-chain. Click any tx to view on the XRPL Testnet explorer.</p>
      </div>
      {isLoading && <Skel />}
      {!isLoading && ledger.length === 0 && <Empty message="No on-chain anchors yet. Sign a prescription, complete a shift, or verify a license to broadcast." />}
      <LedgerTable entries={ledger} />
    </div>
  );
}

function LedgerTable({ entries }: { entries: LedgerEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-muted/40 border-b border-border text-muted-foreground uppercase tracking-wider text-[10px]">
            <th className="text-left px-3 py-2">When</th>
            <th className="text-left px-3 py-2">Entity</th>
            <th className="text-left px-3 py-2">Action</th>
            <th className="text-left px-3 py-2">Signer</th>
            <th className="text-left px-3 py-2">Doc hash</th>
            <th className="text-left px-3 py-2">Tx</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className="border-b border-border last:border-0 hover:bg-accent/30">
              <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(e.createdAt)}</td>
              <td className="px-3 py-2"><Badge variant="outline" className="text-[10px] capitalize">{e.entityType} #{e.entityId}</Badge></td>
              <td className="px-3 py-2 capitalize">{e.action}</td>
              <td className="px-3 py-2">{e.signerName || "—"}</td>
              <td className="px-3 py-2 font-mono text-muted-foreground">{e.documentHash.slice(0, 10)}…</td>
              <td className="px-3 py-2">
                <a href={e.explorerUrl || `https://testnet.xrpl.org/transactions/${e.txHash}`} target="_blank" rel="noreferrer"
                   className="text-primary hover:underline font-mono inline-flex items-center gap-1"
                   data-testid={`link-tx-${e.id}`}>
                  {e.txHash.slice(0, 10)}… <ExternalLink className="h-3 w-3" />
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UsersList() {
  const { data: pharmacists = [] } = useQuery<User[]>({ queryKey: ["/api/users", "pharmacist"], queryFn: async () => (await apiRequest("GET", "/api/users?role=pharmacist")).json() });
  const { data: prescribers = [] } = useQuery<User[]>({ queryKey: ["/api/users", "prescriber"], queryFn: async () => (await apiRequest("GET", "/api/users?role=prescriber")).json() });
  const { data: pharmacies = [] } = useQuery<User[]>({ queryKey: ["/api/users", "pharmacy"], queryFn: async () => (await apiRequest("GET", "/api/users?role=pharmacy")).json() });
  const { data: patients = [] } = useQuery<User[]>({ queryKey: ["/api/users", "patient"], queryFn: async () => (await apiRequest("GET", "/api/users?role=patient")).json() });
  const sections = [
    { title: "Pharmacists", users: pharmacists },
    { title: "Prescribers", users: prescribers },
    { title: "Pharmacies", users: pharmacies },
    { title: "Patients", users: patients },
  ];
  return (
    <div className="space-y-5">
      {sections.map((sec) => (
        <div key={sec.title}>
          <h3 className="text-sm font-semibold mb-2">{sec.title} ({sec.users.length})</h3>
          <div className="space-y-1.5">
            {sec.users.map((u) => (
              <div key={u.id} className="flex items-center justify-between px-3 py-2 rounded-md border border-border bg-card/40 text-xs" data-testid={`row-user-${u.id}`}>
                <div className="flex items-center gap-3">
                  <span className="font-medium">{u.fullName}</span>
                  <span className="text-muted-foreground">{u.email}</span>
                </div>
                <div className="flex items-center gap-2">
                  {u.npi && <span className="font-mono text-muted-foreground">NPI {u.npi}</span>}
                  {u.pharmacistLicense && <span className="font-mono text-muted-foreground">{u.pharmacistLicense}</span>}
                  {u.ncpdp && <span className="font-mono text-muted-foreground">NCPDP {u.ncpdp}</span>}
                  {u.verified ? (
                    <Badge variant="outline" className={statusColor("verified")}>verified</Badge>
                  ) : (
                    <Badge variant="outline" className={statusColor("pending")}>pending</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: any; label: string; value: any }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
          <Icon className="h-3.5 w-3.5" />
          <span>{label}</span>
        </div>
        <div className="text-2xl font-semibold mt-1 font-mono" data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}>{value}</div>
      </CardContent>
    </Card>
  );
}
function Skel() { return <div className="grid gap-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-lg border border-border bg-card animate-pulse" />)}</div>; }
function Empty({ message }: { message: string }) { return <Card className="border-dashed"><CardContent className="p-8 text-center text-sm text-muted-foreground">{message}</CardContent></Card>; }
