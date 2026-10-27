import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
};

// Layout follows the FigJam "Login Screen" wireframe. Its "Forgot Password?" and
// "Sign up" links are left out: there is no sign-up or password reset yet.
export default function LoginPage() {
  return (
    <div className="flex flex-1 flex-col">
      <main className="flex flex-1 flex-col gap-6 p-4 md:flex-row md:p-6">
        <section className="flex min-h-64 flex-col justify-between gap-10 rounded-lg border border-zinc-300 bg-zinc-200 p-6 md:w-[37%] md:p-10">
          <div className="flex items-center gap-3">
            <div
              aria-hidden="true"
              className="flex size-12 shrink-0 items-center justify-center rounded-full border border-zinc-500 bg-white text-xs text-zinc-700"
            >
              Logo
            </div>
            <p className="text-sm font-medium">AppName123</p>
          </div>
          <div className="flex flex-col gap-3">
            <p className="max-w-xs text-4xl leading-tight md:text-5xl">Cool tagline goes here.</p>
            <p className="max-w-56 text-sm text-zinc-600">
              Maybe some text here will help draw the user to the cool tagline.
            </p>
          </div>
        </section>

        <section className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-md">
            <h1 className="text-3xl font-bold">Sign in</h1>
            <p className="mt-1 text-zinc-600">Welcome! Enter your details to sign in below.</p>
            <LoginForm />
          </div>
        </section>
      </main>

      <footer className="border-t border-zinc-300 px-6 py-5 text-sm text-zinc-600">AppName123 © 2026</footer>
    </div>
  );
}
