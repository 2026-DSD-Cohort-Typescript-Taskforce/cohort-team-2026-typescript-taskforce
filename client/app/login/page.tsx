import type { Metadata } from "next";
import type { ReactNode } from "react";
import { APP_NAME, Logo, SiteFooter } from "../brand";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

const highlights: { label: string; icon: ReactNode }[] = [
  {
    label: "Capture every bill",
    icon: <path d="M6 3.5h12v17l-3-2-3 2-3-2-3 2v-17ZM9 8.5h6M9 12h6M9 15.5h3" />,
  },
  {
    label: "Approve with a clear trail",
    icon: <path d="m3.5 7 2 2 3.5-3.5M12.5 7.5h8M3.5 16l2 2 3.5-3.5M12.5 16.5h8" />,
  },
  {
    label: "Pay vendors on time",
    icon: (
      <>
        <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
        <path d="M8 3v4M16 3v4M3.5 10h17M9 15l2 2 4-4" />
      </>
    ),
  },
];

// Layout follows the FigJam "Login Screen" wireframe in the Emerald dark theme. Its "Forgot
// Password?" and "Sign up" links are left out: there is no sign-up or password reset yet.
// Below lg the brand panel shrinks to a header above the form, in one centred column.
export default function LoginPage() {
  return (
    <div className="flex flex-1 flex-col">
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-4 lg:flex-row lg:items-stretch lg:gap-6 lg:p-6">
        <section className="relative isolate flex w-full max-w-lg flex-col gap-6 overflow-hidden rounded-card border border-subtle bg-brand p-6 lg:w-5/12 lg:max-w-none lg:justify-between lg:p-12">
          <BrandPattern />
          <div className="flex items-center gap-4">
            <Logo />
            <p className="text-body-lg font-semibold">{APP_NAME}</p>
          </div>
          <div className="flex flex-col gap-4 lg:gap-6">
            <p className="text-heading lg:text-display">
              Every bill, <span className="text-accent">handled.</span>
            </p>
            <p className="max-w-md text-body text-secondary lg:text-body-lg">
              Capture, approve and pay your property bills in one place, so nothing slips through.
            </p>
            <ul className="mt-6 hidden flex-col gap-4 lg:flex">
              {highlights.map(({ label, icon }) => (
                <li key={label} className="flex items-center gap-4 text-body font-medium">
                  <span className="grid size-10 shrink-0 place-items-center rounded-input border border-subtle bg-surface text-primary">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                      className="size-5"
                    >
                      {icon}
                    </svg>
                  </span>
                  {label}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="flex w-full max-w-lg justify-center lg:max-w-none lg:flex-1 lg:items-center lg:py-8">
          <div className="w-full max-w-lg rounded-card border border-subtle bg-surface p-6 sm:p-12">
            <h1 className="text-heading">Sign in</h1>
            <p className="mt-2 text-body text-secondary">
              Welcome back. Enter your details to sign in.
            </p>
            <LoginForm />
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

// Decoration only: a fading dot grid and rings spreading from the panel's top-right corner.
function BrandPattern() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 -z-10 size-full text-primary"
    >
      <defs>
        <pattern id="brand-dots" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.25" fill="currentColor" />
        </pattern>
        <radialGradient id="brand-fade" cx="100%" cy="0%" r="85%">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.45" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
        <mask id="brand-mask" style={{ maskType: "alpha" }}>
          <rect width="100%" height="100%" fill="url(#brand-fade)" />
        </mask>
      </defs>
      <rect width="100%" height="100%" fill="url(#brand-dots)" mask="url(#brand-mask)" />
      <g fill="none" stroke="currentColor" strokeOpacity="0.16">
        {[120, 220, 320, 420, 520].map((r) => (
          <circle key={r} cx="100%" cy="0" r={r} />
        ))}
      </g>
    </svg>
  );
}
