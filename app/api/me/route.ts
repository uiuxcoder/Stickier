import { getSessionUser } from "@/lib/auth";

export async function GET(request: Request) {
  const user = await getSessionUser(request);
  if (!user) return Response.json({ user: null });
  return Response.json({ user: { id: user.id, email: user.email, displayName: user.displayName } });
}
