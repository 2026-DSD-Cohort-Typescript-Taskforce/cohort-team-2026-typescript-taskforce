import type { Metadata } from 'next';
import DemoCheckout from './checkout';

export const metadata: Metadata = { title: 'Demo payment portal' };

export default function DemoPaymentPage() {
  return <DemoCheckout />;
}
