import { NextResponse } from "next/server";

export async function GET() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey || !process.env.VAPID_SUBJECT) {
    return NextResponse.json({ error: "Nearby push alerts are not configured on this server." }, { status: 503 });
  }
  return NextResponse.json({ publicKey });
}
