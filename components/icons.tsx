import type { Status } from "@/lib/alerts";

// Hand-drawn set, 20px grid, 1.75 stroke. State shapes differ so status never rests on colour:
// a circle for normal, a triangle for watch, an octagon for danger.

type IconProps = { size?: number; className?: string };

export function StateIcon({
  status,
  size = 20,
  className,
  cut = "var(--head-danger)",
}: IconProps & { status: Status; /** Colour of the mark cut into the solid danger octagon. */ cut?: string }) {
  const common = { width: size, height: size, viewBox: "0 0 20 20", "aria-hidden": true, className } as const;
  if (status === "normal") {
    return (
      <svg {...common}>
        <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="2" />
        <circle cx="10" cy="10" r="2.5" fill="currentColor" />
      </svg>
    );
  }
  if (status === "watch") {
    return (
      <svg {...common}>
        <path d="M10 2.5 18 17H2z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <path d="M10 8v4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <circle cx="10" cy="14.6" r="1.1" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M6.9 2.5h6.2l4.4 4.4v6.2l-4.4 4.4H6.9l-4.4-4.4V6.9z" fill="currentColor" />
      <path d="M10 6v5" stroke={cut} strokeWidth="2" strokeLinecap="round" />
      <circle cx="10" cy="13.6" r="1.1" fill={cut} />
    </svg>
  );
}

export function BellIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden className={className}>
      <path
        d="M10 3a4.5 4.5 0 0 0-4.5 4.5v2.8L4 13.5h12l-1.5-3.2V7.5A4.5 4.5 0 0 0 10 3Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
      <path d="M8.2 16a1.9 1.9 0 0 0 3.6 0" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export function PlayIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden className={className}>
      <path d="M6 4v12l10-6z" fill="currentColor" />
    </svg>
  );
}

export function StopIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden className={className}>
      <rect x="5" y="5" width="10" height="10" fill="currentColor" />
    </svg>
  );
}

export function MoonIcon({ size = 18, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden className={className}>
      <path
        d="M15.5 12.6A6.5 6.5 0 0 1 7.4 4.5a6.5 6.5 0 1 0 8.1 8.1Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}
