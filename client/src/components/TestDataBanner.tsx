import { AlertTriangle } from "lucide-react";

export function TestDataBanner() {
  return (
    <div
      data-testid="banner-test-mode"
      className="bg-amber-500/10 border-b border-amber-500/30 text-amber-900 dark:text-amber-200 px-4 py-2 text-xs font-medium flex items-center justify-center gap-2"
    >
      <AlertTriangle className="h-3.5 w-3.5" />
      <span>
        ALPHA · TEST DATA ONLY · No real PHI · XRPL Testnet (no monetary value)
      </span>
    </div>
  );
}
