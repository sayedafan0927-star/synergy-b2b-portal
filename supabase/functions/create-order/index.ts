Deno.serve(async (req: Request) => {
  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Origin": "https://b2b.synergy.kz, https://synergy-b2b-portal.vercel.app",
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

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const incomingIdempotency = req.headers.get("X-Idempotency-Key") || req.headers.get("Idempotency-Key") || (body as any)?.idempotency_key || crypto.randomUUID();
    const erpUrl = Deno.env.get("ERP_API_URL") || "https://kilem-khan.kz/api/sin/api_portal.php?action=create_order";
    const erpKey = Deno.env.get("ERP_API_KEY") || '';

    // Cleanse any cell/storage stubs
    if (body && typeof body === "object") {
      delete (body as any).cell;
      delete (body as any).cell_code;
      delete (body as any).rack;
      delete (body as any).location;
      if (Array.isArray((body as any).items)) {
        (body as any).items.forEach((it: any) => {
          if (it && typeof it === "object") {
            delete it.cell;
            delete it.cell_code;
            delete it.rack;
            delete it.location;
          }
        });
      }
    }

    const erpResponse = await fetch(
      erpUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Portal-Key": erpKey,
          "Idempotency-Key": incomingIdempotency,
          "X-Idempotency-Key": incomingIdempotency,
        },
        body: JSON.stringify(body),
      },
    );

    const rawText = await erpResponse.text();

    let erpData: unknown;
    try {
      erpData = JSON.parse(rawText);
    } catch {
      return new Response(
        JSON.stringify({ error: "ERP returned invalid response", raw: rawText.slice(0, 500) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify(erpData), {
      status: erpResponse.ok ? 200 : erpResponse.status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
