import Link from 'next/link';
import { APP_NAME, Logo, SiteFooter } from '@/components/layout/brand';
import { focusRing } from '@/app/ui';

export default function BillsLayout({ children }: LayoutProps<'/bills'>) {
  return (
    <div className="flex flex-1 flex-col">
      <header className="border-b border-subtle px-4 py-4 lg:px-6">
        <Link href="/" className={`inline-flex items-center gap-3 rounded-input ${focusRing}`}>
          <Logo className="size-8" />
          <span className="text-body-lg font-semibold">{APP_NAME}</span>
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4 lg:p-6">
        {children}
      </main>

      <SiteFooter />
    </div>
  );
}
