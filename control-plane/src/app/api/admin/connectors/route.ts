import { NextRequest, NextResponse } from "next/server";

const PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL || "http://localhost:3100";
const CP_SERVICE_TOKEN = process.env.CP_SERVICE_TOKEN || "";

export async function GET() {
  const cpRes = await fetch(`${PAPERCLIP_API_URL}/api/connectors`, {
    headers: { "X-Service-Token": CP_SERVICE_TOKEN },
  });
  const data = await cpRes.json();
  return NextResponse.json(data, { status: cpRes.status });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const cpRes = await fetch(`${PAPERCLIP_API_URL}/api/connectors`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Service-Token": CP_SERVICE_TOKEN,
    },
    body: JSON.stringify(body),
  });
  const data = await cpRes.json();
  return NextResponse.json(data, { status: cpRes.status });
}
