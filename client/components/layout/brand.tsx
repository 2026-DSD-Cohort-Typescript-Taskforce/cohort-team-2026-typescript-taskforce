// "AppName123" is the wireframe's placeholder, kept until the team picks a name. The page,
// the footer and the metadata all read it from here.
export const APP_NAME = "AppName123";

// Placeholder logo: the app name's first letter on a mint tile.
export function Logo({ className = "size-10" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={`shrink-0 ${className}`}>
      <rect width="40" height="40" rx="12" className="fill-primary" />
      <text
        x="20"
        y="21"
        textAnchor="middle"
        dominantBaseline="central"
        className="fill-on-primary text-[22px] font-bold"
      >
        {APP_NAME[0]}
      </text>
    </svg>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-subtle px-4 py-6 text-body-sm text-secondary lg:px-6">
      © 2026 {APP_NAME}
    </footer>
  );
}
