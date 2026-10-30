import { APP_NAME, Logo, SiteFooter } from "./brand";
import { SignedInUser } from "./signed-in-user";

// Placeholder home until the app has real pages. proxy.ts sends signed-out visits to /login.
export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <main className="flex flex-1 items-center justify-center p-4 lg:p-6">
        <div className="flex w-full max-w-md flex-col items-center gap-6 rounded-card border border-subtle bg-surface p-8 text-center sm:p-12">
          <Logo className="size-12" />
          <h1 className="text-heading">{APP_NAME}</h1>
          <SignedInUser />
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
