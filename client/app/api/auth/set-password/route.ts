import { forward } from '@/lib/forward';

// DC-55: the last step of an invite. Express sets the password and the session cookies.
export function POST(request: Request) {
  return forward(request, '/api/auth/set-password');
}
