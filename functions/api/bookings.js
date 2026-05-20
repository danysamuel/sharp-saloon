/**
 * POST /api/bookings
 *
 * Creates a new booking. The UNIQUE constraint on (booking_date, booking_time)
 * in D1 acts as an atomic lock — concurrent requests for the same slot will
 * result in a UNIQUE violation for the loser, which we surface as a 409.
 *
 * On success, sends a notification email to the owner via Resend.
 */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

// Valid time slots (must match slots.js)
const VALID_SLOTS = new Set(["09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00", "17:00"]);

const VALID_SERVICES = new Set([
  "Classic Cut",
  "Skin Fade",
  "Hot Towel Shave",
  "Full Grooming Package",
]);

export async function onRequestPost({ request, env }) {
  // ── Parse & validate input ──────────────────────────────────────────────────
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400, headers: CORS });
  }

  const { name, email, phone, service, date, time } = body;

  if (!name?.trim() || !email?.trim() || !phone?.trim() || !service || !date || !time) {
    return Response.json({ error: "All fields are required" }, { status: 400, headers: CORS });
  }

  if (!VALID_SERVICES.has(service)) {
    return Response.json({ error: "Invalid service selected" }, { status: 400, headers: CORS });
  }

  if (!VALID_SLOTS.has(time)) {
    return Response.json({ error: "Invalid time slot" }, { status: 400, headers: CORS });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: "Invalid date format" }, { status: 400, headers: CORS });
  }

  const today = new Date().toISOString().split("T")[0];
  if (date < today) {
    return Response.json({ error: "Cannot book a date in the past" }, { status: 400, headers: CORS });
  }

  const cleanName  = name.trim().slice(0, 100);
  const cleanEmail = email.trim().toLowerCase().slice(0, 200);
  const cleanPhone = phone.trim().replace(/[^\d\s+\-()]/g, "").slice(0, 30);

  // ── Insert booking (atomic — UNIQUE constraint prevents double-booking) ─────
  try {
    await env.DB.prepare(
      `INSERT INTO bookings (name, email, phone, service, booking_date, booking_time)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
      .bind(cleanName, cleanEmail, cleanPhone, service, date, time)
      .run();
  } catch (err) {
    if (err.message?.includes("UNIQUE constraint failed")) {
      // Race condition: another request claimed this slot a millisecond earlier
      return Response.json(
        { error: "This slot was just booked. Please choose another time." },
        { status: 409, headers: CORS }
      );
    }
    console.error("DB insert error:", err);
    return Response.json({ error: "Booking failed. Please try again." }, { status: 500, headers: CORS });
  }

  // ── Send owner notification email via Resend ────────────────────────────────
  // Non-blocking: a failed email must not undo a successful booking
  env.RESEND_API_KEY && sendOwnerEmail(env, { name: cleanName, email: cleanEmail, phone: cleanPhone, service, date, time }).catch(
    (e) => console.error("Email send failed:", e)
  );

  return Response.json(
    { success: true, message: "Booking confirmed! We'll see you soon." },
    { status: 201, headers: CORS }
  );
}

// ── Email helper ──────────────────────────────────────────────────────────────

const SERVICE_PRICES = {
  "Classic Cut": "$45",
  "Skin Fade": "$55",
  "Hot Towel Shave": "$40",
  "Full Grooming Package": "$80",
};

function formatDisplayDate(isoDate) {
  const [y, m, d] = isoDate.split("-");
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
}

function formatTime(t) {
  const [h, min] = t.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  return `${h % 12 || 12}:${String(min).padStart(2, "0")} ${ampm}`;
}

async function sendOwnerEmail(env, { name, email, phone, service, date, time }) {
  const displayDate = formatDisplayDate(date);
  const displayTime = formatTime(time);
  const price       = SERVICE_PRICES[service] ?? "";

  const html = `
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8"/>
    <style>
      body { font-family: Georgia, serif; background: #f4f4f0; margin: 0; padding: 30px; }
      .card { background: #fff; max-width: 540px; margin: 0 auto; border: 1px solid #ddd; padding: 40px; }
      .header { border-bottom: 3px solid #d4af37; padding-bottom: 20px; margin-bottom: 30px; }
      .logo { font-size: 24px; font-weight: bold; letter-spacing: 2px; color: #111; }
      .logo span { color: #d4af37; }
      h2 { color: #333; margin: 0 0 6px; font-size: 20px; }
      .subtitle { color: #888; font-size: 13px; font-family: sans-serif; }
      table { width: 100%; border-collapse: collapse; margin-top: 10px; }
      td { padding: 12px 8px; border-bottom: 1px solid #f0f0f0; font-family: sans-serif; font-size: 14px; }
      td:first-child { color: #888; width: 40%; }
      td:last-child { color: #111; font-weight: 600; }
      .highlight { background: #fffbf0; border-left: 3px solid #d4af37; padding: 12px 16px; margin-top: 24px; font-family: sans-serif; font-size: 13px; color: #555; }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="header">
        <div class="logo">SHARP<span>&amp;</span>CO.</div>
      </div>
      <h2>New Booking Received</h2>
      <p class="subtitle">A customer has reserved an appointment through your website.</p>
      <table>
        <tr><td>Customer</td><td>${name}</td></tr>
        <tr><td>Email</td><td>${email}</td></tr>
        <tr><td>Phone</td><td>${phone}</td></tr>
        <tr><td>Service</td><td>${service} ${price}</td></tr>
        <tr><td>Date</td><td>${displayDate}</td></tr>
        <tr><td>Time</td><td>${displayTime}</td></tr>
      </table>
      <div class="highlight">
        This slot is now locked. No one else can book ${displayTime} on ${displayDate}.
      </div>
    </div>
  </body>
  </html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "onboarding@resend.dev",   // ← must match your Resend verified domain
      to:   env.OWNER_EMAIL,
      subject: `📅 New Booking — ${name} · ${service} · ${displayDate}`,
      html,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend API ${res.status}: ${errText}`);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
