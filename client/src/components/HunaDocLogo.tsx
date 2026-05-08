interface Props {
  size?: number;
  className?: string;
}

export function HunaDocLogo({ size = 28, className = "" }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className={className}
      aria-label="HunaDoc"
    >
      {/* Capsule body — rotated 45deg */}
      <g transform="rotate(45 16 16)">
        <rect x="3" y="12" width="26" height="8" rx="4" fill="hsl(var(--primary))" />
        <rect x="3" y="12" width="13" height="8" rx="4" fill="hsl(var(--primary))" opacity="0.7" />
        <line x1="16" y1="12" x2="16" y2="20" stroke="hsl(var(--background))" strokeWidth="0.6" />
      </g>
      {/* Verification check mark overlay */}
      <circle cx="23" cy="23" r="6" fill="hsl(var(--background))" />
      <circle cx="23" cy="23" r="5" fill="hsl(var(--primary))" />
      <path
        d="M20.5 23 L22.3 24.7 L25.5 21.5"
        stroke="hsl(var(--primary-foreground))"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

export function HunaDocWordmark({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <HunaDocLogo size={24} />
      <span className="font-semibold tracking-tight text-base">
        Huna<span className="text-primary">Doc</span>
      </span>
    </div>
  );
}
