/**
 * GET /api/slots?date=YYYY-MM-DD
 *
 * Returns which time slots are already booked for a given date.
 * The frontend uses this to disable unavailable options in real time.
 */

const ALL_SLOTS = ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00", "17:00"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Content-Type": "application/json",
};

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "Valid date (YYYY-MM-DD) is required" }, { status: 400, headers: CORS });
  }

  // Reject dates in the past
  const today = new Date().toISOString().split("T")[0];
  if (date < today) {
    return Response.json({ availableSlots: [] }, { headers: CORS });
  }

  try {
    const { results } = await env.DB.prepare(
      "SELECT booking_time FROM bookings WHERE booking_date = ?"
    )
      .bind(date)
      .all();

    const booked = new Set(results.map((r) => r.booking_time));
    const availableSlots = ALL_SLOTS.filter((slot) => !booked.has(slot));

    return Response.json({ availableSlots }, { headers: CORS });
  } catch (err) {
    console.error("DB error fetching slots:", err);
    return Response.json({ error: "Could not fetch availability" }, { status: 500, headers: CORS });
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
