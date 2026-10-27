import { SignedInUser } from "./signed-in-user";

// Placeholder home until the app has real pages. proxy.ts sends signed-out visits to /login.
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-6 text-center">
      <h1 className="text-3xl font-bold">AppName123</h1>
      <SignedInUser />
    </main>
  );
}
