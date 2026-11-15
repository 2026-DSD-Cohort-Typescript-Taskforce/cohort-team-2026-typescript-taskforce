import type { Metadata } from 'next';
import { PropertiesGrid } from './properties-grid';

export const metadata: Metadata = {
  title: 'Properties',
};

// The properties grid (DC-83). The data loads in the browser, so the page itself is static.
// proxy.ts sends signed-out visits to /login.
export default function PropertiesPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 lg:p-6">
      <PropertiesGrid />
    </main>
  );
}
