import { forward } from '@/lib/forward';

// DC-55: send a user a new invite link. Express checks that the caller is a system admin.
export async function POST(request: Request, ctx: RouteContext<'/api/admin/users/[id]/invite'>) {
  const { id } = await ctx.params;
  return forward(request, `/api/admin/users/${encodeURIComponent(id)}/invite`);
}
