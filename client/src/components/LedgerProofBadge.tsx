import { ShieldCheck, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";

interface Props {
  txHash?: string | null;
  explorerUrl?: string | null;
  label?: string;
  size?: "sm" | "md";
}

export function LedgerProofBadge({ txHash, explorerUrl, label = "Verified on XRPL", size = "md" }: Props) {
  if (!txHash) return null;
  const url = explorerUrl || `https://testnet.xrpl.org/transactions/${txHash}`;
  const short = `${txHash.slice(0, 6)}…${txHash.slice(-4)}`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      data-testid={`link-ledger-proof-${txHash.slice(0, 8)}`}
      className="inline-flex items-center"
    >
      <Badge
        variant="outline"
        className={`gap-1.5 border-primary/30 bg-primary/5 text-primary hover:bg-primary/10 transition-colors ${
          size === "sm" ? "text-[10px] py-0" : ""
        }`}
      >
        <ShieldCheck className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
        <span className="font-medium">{label}</span>
        <span className="font-mono text-muted-foreground">{short}</span>
        <ExternalLink className="h-3 w-3 opacity-60" />
      </Badge>
    </a>
  );
}
