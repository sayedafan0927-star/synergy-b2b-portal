Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin") || "";
  const allowedOrigins = [
    "https://b2b.synergy.kz",
    "https://synergy-b2b-portal.vercel.app",
    "http://localhost:5173",
    "http://localhost:3000",
  ];

  const isAllowed = allowedOrigins.includes(origin) || origin.endsWith(".vercel.app");
  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": isAllowed && origin ? origin : "https://b2b.synergy.kz",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Idempotency-Key",
    "Access-Control-Allow-Credentials": "true",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  // P0 Security Guard: Direct unverified order creation through Edge Function is decommissioned
  // to prevent Saga bypass, price tampering, and credit limit evasion.
  // All orders must route through the canonical /api/erp?action=create_order gateway.
  return new Response(
    JSON.stringify({
      success: false,
      error: "Direct order creation via Edge Function is deprecated for security reasons. Please use the canonical API gateway endpoint: POST /api/erp?action=create_order with full Compensating Saga and Anti-Tamper Pricing Guard.",
      canonical_endpoint: "/api/erp?action=create_order",
    }),
    {
      status: 410, // 410 Gone
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
