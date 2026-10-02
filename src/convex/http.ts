import { httpAction } from "./_generated/server";
import { httpRouter } from "convex/server";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

/**
 * Reverse geocode coordinates to a human-readable address using OpenStreetMap
 * Nominatim (free, keyless). Proxied through Convex to satisfy CORS rules.
 */
export const reverseGeocode = httpAction(async (_ctx, request) => {
  const url = new URL(request.url);
  const lat = url.searchParams.get("lat");
  const lng = url.searchParams.get("lng");

  if (!lat || !lng || Number.isNaN(Number(lat)) || Number.isNaN(Number(lng))) {
    return new Response(JSON.stringify({ error: "lat and lng are required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1`,
      {
        headers: {
          "User-Agent": "CivicGuideAI/1.0 (civic complaint prototype)",
          Accept: "application/json",
        },
      },
    );
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const data = (await res.json()) as {
      display_name?: string;
      address?: Record<string, string>;
    };

    const a = data.address ?? {};
    const parts = [
      a.road,
      a.neighbourhood ?? a.suburb,
      a.city ?? a.town ?? a.village ?? a.county,
      a.state,
      a.postcode,
    ].filter(Boolean);

    return new Response(
      JSON.stringify({
        address: parts.length ? parts.join(", ") : data.display_name ?? null,
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch {
    return new Response(JSON.stringify({ address: null }), {
      headers: { "Content-Type": "application/json" },
    });
  }
});

http.route({
  path: "/reverseGeocode",
  method: "GET",
  handler: reverseGeocode,
});

export default http;
