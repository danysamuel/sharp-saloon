/**
 * GET /api/slots?date=YYYY-MM-DD
 *
 * Returns a full list of daily time slots along with their real-time availability.
 * The frontend parses this array directly to build out the button matrix grid.
 */

const ALL_SLOTS = ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00", "17:00"];

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Content-Type": "application/json",
};

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date");

  // Validate date format parameter
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json(
      { error: "Valid date format (YYYY-MM-DD) is required" }, 
      { status: 400, headers: CORS }
    );
  }

  // Calculate "Today" explicitly using the local Australian timezone
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Australia/Melbourne' });
  
  // Safety Switch: If date is in the past, return all slots as unavailable
  if (date < today) {
    const pastSlots = ALL_SLOTS.map((slot) => ({
      time: slot,
      available: false
    }));
    return Response.json(pastSlots, { headers: CORS });
  }

  try {
    // Fetch all existing appointments for the selected date from Cloudflare D1
    const { results } = await env.DB.prepare(
      "SELECT booking_time FROM bookings WHERE booking_date = ?"
    )
      .bind(date)
      .all();

    // Map database results to a Set for O(1) high-speed lookups
    const booked = new Set(results.map((r) => r.booking_time));
    
    // Transform flat timetable array into explicit interactive objects
    const slotsWithAvailability = ALL_SLOTS.map((slot) => ({
      time: slot,
      available: !booked.has(slot)
    }));

    // Deliver pre-parsed data payload directly to frontend fetch promise
    return Response.json(slotsWithAvailability, { headers: CORS });

  } catch (err) {
    console.error("DB error fetching slots:", err);
    return Response.json(
      { error: "Could not fetch availability from D1 storage engine" }, 
      { status: 500, headers: CORS }
    );
  }
}

// Handle pre-flight CORS options handshake safely
export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}