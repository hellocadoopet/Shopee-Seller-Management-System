import { NextRequest, NextResponse } from "next/server";
import { computeAuthToken } from "@/lib/appAuth";

export async function POST(req: NextRequest) {
  const { password } = (await req.json()) as { password?: string };
  const expected = process.env.APP_PASSWORD ?? "";

  if (!expected || password !== expected) {
    return NextResponse.json({ error: "Wrong password" }, { status: 401 });
  }

  const token = await computeAuthToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set("app_auth", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production", // https on Vercel, http on localhost
    maxAge: 60 * 60 * 24 * 30, // 30 days
    path: "/",
  });
  return res;
}
