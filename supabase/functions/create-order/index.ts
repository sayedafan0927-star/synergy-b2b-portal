Deno.serve(async (req: Request) => {
  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Client-Info, Apikey",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body = await req.json();

    const erpResponse = await fetch(
      "https://kilem-khan.kz/api/sin/api_portal.php?action=create_order",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Portal-Key":
            "138d1bdaf9402600c8f5d5763e2e1573c1e45d32401e62e4981cd7e898bf0544",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify(body),
      },
    );

    const erpData = await erpResponse.json();

    return new Response(JSON.stringify(erpData), {
      status: erpResponse.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
