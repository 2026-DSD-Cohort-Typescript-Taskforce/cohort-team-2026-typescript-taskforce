import { SiteFooter } from '@/components/layout/brand';
import { Sidebar } from '@/components/layout/sidebar';
import { SignedInUser } from '@/components/layout/signed-in-user';

// Shell for every signed-in page. Being a layout, it stays mounted across navigation,
// so the sidebar keeps its collapsed state.
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      <Sidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-end border-b border-subtle px-4 py-3 lg:px-6">
          <SignedInUser />
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
        <SiteFooter />
      </div>
    </div>
  );
}
