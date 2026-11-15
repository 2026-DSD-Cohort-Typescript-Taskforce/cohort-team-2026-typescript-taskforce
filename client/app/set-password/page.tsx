import type { Metadata } from 'next';
import { APP_NAME, Logo, SiteFooter } from '../../components/layout/brand';
import { SetPasswordForm } from './set-password-form';

export const metadata: Metadata = {
  title: 'Set your password',
};

// Where invite links land (DC-55). Public: the session arrives in the URL fragment, which
// only the browser sees, and proxy.ts doesn't match this path.
export default function SetPasswordPage() {
  return (
    <div className="flex flex-1 flex-col">
      <main className="flex flex-1 flex-col items-center justify-center gap-6 p-4 lg:p-6">
        <div className="flex items-center gap-4">
          <Logo />
          <p className="text-body-lg font-semibold">{APP_NAME}</p>
        </div>
        <div className="w-full max-w-lg rounded-card border border-subtle bg-surface p-6 sm:p-12">
          <h1 className="text-heading">Set your password</h1>
          <p className="mt-2 text-body text-secondary">
            Welcome. Choose a password to finish setting up your account.
          </p>
          <SetPasswordForm />
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
