import type { Metadata } from 'next';
import { UsersDirectory } from './users-directory';

export const metadata: Metadata = {
  title: 'Users',
};

// User management (DC-55): only system admins see the table and can add users. The data
// loads in the browser, so the page itself is static. proxy.ts sends signed-out visits to
// /login.
export default function UsersPage() {
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 p-4 lg:p-6">
      <UsersDirectory />
    </main>
  );
}
