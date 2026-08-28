import { getChatGPTUser } from "@/app/chatgpt-auth";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ user: null });
  return Response.json({ user: { email: user.email, displayName: user.displayName } });
}
