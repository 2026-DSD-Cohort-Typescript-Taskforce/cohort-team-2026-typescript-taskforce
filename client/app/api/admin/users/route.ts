import { forward } from '@/lib/forward';

// DC-55: invite a user. Express checks that the caller is a system admin.
export function POST(request: Request) {
  return forward(request, '/api/admin/users');
}
