import "dotenv/config";
import express from "express";
import fs from "fs";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { DateTime } from "luxon";
import fetch from "node-fetch"; // <-- new import for Brevo API

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// BUSINESS TIMEZONE (NETHERLANDS)
const BUSINESS_TZ = "Europe/Amsterdam";

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 10000; // use Render's port if provided
const BOOKING_FILE = path.join(__dirname, "bookings.json");

/* ---------- HELPERS ---------- */
function getBookings() {
  if (!fs.existsSync(BOOKING_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(BOOKING_FILE, "utf8") || "[]");
  } catch {
    return [];
  }
}

function saveBooking(b) {
  const data = getBookings();
  data.push(b);
  fs.writeFileSync(BOOKING_FILE, JSON.stringify(data, null, 2));
}

function blocksFromMinutes(min) {
  return Math.ceil(Number(min) / 30);
}

/* ---------- AVAILABLE SLOTS ---------- */
app.get("/available", (req, res) => {
  try {
    const { date, minutes } = req.query;
    if (!date || !minutes) return res.json([]);

    const totalBlocks = blocksFromMinutes(minutes);
    const bookings = getBookings();

    const startHour = 11.5;
    const endHour = 19;

    const now = DateTime.now().setZone(BUSINESS_TZ);
    const todayStr = now.toISODate();

    let allSlots = [];
    for (let h = startHour; h < endHour; h += 0.5) {
      allSlots.push(h);
    }

    if (date === todayStr) {
      const currentTime = now.hour + (now.minute >= 30 ? 0.5 : 0);
      allSlots = allSlots.filter(t => t > currentTime);
    }

    let blocked = [];
    bookings
      .filter(b => b.date === date)
      .forEach(b => {
        for (let i = 0; i < b.blocks; i++) {
          blocked.push(b.start + i * 0.5);
        }
      });

    const available = allSlots.filter(start => {
      for (let i = 0; i < totalBlocks; i++) {
        if (blocked.includes(start + i * 0.5)) return false;
      }
      return true;
    });

    res.json(available);
  } catch (err) {
    console.error("Available error:", err);
    res.json([]);
  }
});

/* ---------- BOOK + EMAIL USING BREVO API ---------- */
app.post("/send-email", async (req, res) => {
  try {
    const {
      senderName,
      customerEmail,
      receiverEmail,
      telephone,
      service,
      date,
      time,
      total,
      totalMinutes
    } = req.body;

    if (!senderName || !customerEmail || !time || !date) {
      return res.json({ success: false });
    }

    // Convert time to decimal
    const start = time.includes(":")
      ? Number(time.split(":")[0]) + (time.includes("30") ? 0.5 : 0)
      : Number(time);

    const blocks = blocksFromMinutes(totalMinutes);
    const bookings = getBookings();

    const conflict = bookings.some(b => {
      if (b.date !== date) return false;
      for (let i = 0; i < b.blocks; i++) {
        for (let j = 0; j < blocks; j++) {
          if (b.start + i * 0.5 === start + j * 0.5) return true;
        }
      }
      return false;
    });

    if (conflict) {
      return res.json({ success: false });
    }

    // SAVE BOOKING FIRST (CRITICAL)
    saveBooking({ date, start, blocks });

    // SEND EMAIL VIA BREVO API (HTTP, no SMTP)
    try {
      const emailData = {
        sender: { email: process.env.BREVO_SENDER_EMAIL, name: "Khobkhun Thai Massage" },
        to: [{ email: receiverEmail }],
        subject: "New Booking",
        htmlContent: `
          <p><b>Name:</b> ${senderName}</p>
          <p><b>Email:</b> ${customerEmail}</p>
          <p><b>Phone:</b> ${telephone}</p>
          <p><b>Service:</b><br>${service}</p>
          <p><b>Date:</b> ${date}</p>
          <p><b>Time:</b> ${time} (NL time)</p>
          <p><b>Total:</b> €${total}</p>
        `
      };

      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": process.env.BREVO_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(emailData)
      });

      if (!response.ok) {
        const text = await response.text();
        console.error("Brevo API error:", text);
      }
    } catch (mailErr) {
      console.error("Email failed (ignored):", mailErr);
    }

    res.json({ success: true });

  } catch (err) {
    console.error("Booking error:", err);
    res.json({ success: false });
  }
});

/* ---------- START ---------- */
app.listen(PORT, () =>
  console.log(`✅ Server running on port ${PORT}`)
);
