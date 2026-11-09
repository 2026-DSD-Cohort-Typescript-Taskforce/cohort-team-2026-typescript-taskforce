// Content column for /bills and /bills/[id]; the sidebar and header come from (app)/layout.tsx.
export default function BillsLayout({ children }: LayoutProps<'/bills'>) {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4 lg:p-6">
      {children}
    </main>
  );
}
