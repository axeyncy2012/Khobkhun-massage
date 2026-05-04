import dotenv from "dotenv";
dotenv.config();

import express from "express";
import fs from "fs";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import fetch from "node-fetch";
import session from "express-session";
import { DateTime } from "luxon";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.set("trust proxy", 1);

app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json());
app.use(express.static("public"));

/* ---------- SESSION ---------- */
app.use(session({
  name: "admin.sid",
  secret: "khobkhun-admin-secret-7788",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    sameSite: "lax",
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000
  }
}));

const PORT = process.env.PORT || 10000;
const BOOKING_FILE = path.join(__dirname, "bookings.json");
const BLOCKS_FILE = path.join(__dirname, "blocks.json");

/* ---------- DEFAULT HOURS ---------- */
const DEFAULT_HOURS = {
  0: null,
  1: { open: 13, close: 20 },
  2: { open: 11, close: 20 },
  3: { open: 11, close: 20 },
  4: { open: 11, close: 20 },
  5: { open: 11, close: 20 },
  6: null
};

let BUSINESS_HOURS = { ...DEFAULT_HOURS };

/* ---------- HELPERS ---------- */
function getBookings() {
  if (!fs.existsSync(BOOKING_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(BOOKING_FILE, "utf8") || "[]");
  } catch {
    return [];
  }
}

function getManualBlocks() {
  if (!fs.existsSync(BLOCKS_FILE)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(BLOCKS_FILE, "utf8") || "[]");

    return raw.filter(m =>
      m &&
      typeof m.date === "string" &&
      (m.fullDay === true || typeof m.start === "number")
    );
  } catch {
    return [];
  }
}

function blocksFromMinutes(min) {
  const m = Number(min);
  if (isNaN(m) || m <= 0) return 1;
  return Math.ceil(m / 30);
}

const isAdmin = (req, res, next) => {
  if (req.session && req.session.isAdmin) return next();
  res.status(401).json({ success: false });
};

/* ---------- AVAILABLE ---------- */
app.get("/available", (req, res) => {
  try {
    const { date, minutes } = req.query;

    if (!date || !minutes || isNaN(Number(minutes)) || Number(minutes) <= 0) {
      return res.json([]);
    }

    const bookings = getBookings();
    const manualBlocks = getManualBlocks();

    const fullDayClosed = manualBlocks.some(
      m => m.date === date && m.fullDay === true
    );
    if (fullDayClosed) return res.json([]);

    const totalBlocks = blocksFromMinutes(minutes);

    const dayOfWeek = new Date(date).getDay();
    const hours = BUSINESS_HOURS[dayOfWeek];

    if (!hours) return res.json([]);

    /* ---------- GENERATE SLOTS ---------- */
    let allSlots = [];
    for (let h = hours.open; h < hours.close; h += 0.5) {
      allSlots.push(h);
    }

    /* ---------- 🇳🇱 NETHERLANDS TIME FIX ---------- */
    const nowNL = DateTime.now().setZone("Europe/Amsterdam");
    const todayNL = nowNL.toISODate();

    if (date === todayNL) {
      const currentTime =
        nowNL.hour + (nowNL.minute >= 30 ? 0.5 : 0);

      allSlots = allSlots.filter(slot => slot > currentTime);
    }

    /* ---------- BLOCKED SLOTS ---------- */
    let blocked = [];

    manualBlocks.forEach(m => {
      if (m.date === date && typeof m.start === "number") {
        blocked.push(Number(m.start));
      }
    });

    bookings.forEach(b => {
      if (b.date === date) {
        const start = Number(b.start);
        const blocks = Number(b.blocks);

        for (let i = 0; i < blocks; i++) {
          blocked.push(start + i * 0.5);
        }
      }
    });

    const available = allSlots.filter(start => {
      for (let i = 0; i < totalBlocks; i++) {
        const check = start + i * 0.5;

        if (blocked.some(b => Math.abs(b - check) < 0.001)) {
          return false;
        }
      }
      return true;
    });

    res.json(available);

  } catch (err) {
    console.log("ERROR:", err);
    res.json([]);
  }
});

/* ---------- BOOKING ---------- */
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
      totalMinutes
    } = req.body;

    const start = time && time.includes(":")
      ? Number(time.split(":")[0]) + (time.includes("30") ? 0.5 : 0)
      : Number(time || 0);

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

    if (conflict) return res.json({ success: false });

    const newBooking = {
      date,
      start,
      blocks,
      customerName: senderName,
      phone: telephone,
      email: customerEmail,
      service: (service || "").replace(/<br>/g, ", ")
    };

    const currentBookings = getBookings();
    currentBookings.push(newBooking);
    fs.writeFileSync(BOOKING_FILE, JSON.stringify(currentBookings, null, 2));

    const emailData = {
      sender: {
        email: process.env.BREVO_SENDER_EMAIL,
        name: "Khobkhun Thai Massage"
      },
      to: [{ email: receiverEmail }],
      subject: "New Booking Received",
      htmlContent:
        "<p><b>Name:</b> " + senderName +
        "</p><p><b>Date:</b> " + date +
        "</p><p><b>Time:</b> " + time + "</p>"
    };

    fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": process.env.BREVO_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(emailData)
    }).catch(() => {});

    res.json({ success: true });

  } catch (err) {
    console.log("ERROR:", err);
    res.json({ success: false });
  }
});

/* ---------- ADMIN ---------- */
app.post("/admin/login", (req, res) => {
  const { password } = req.body;

  if (password === process.env.ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    req.session.save(() => res.json({ success: true }));
  } else {
    res.status(401).json({ success: false });
  }
});

app.get("/admin/data", isAdmin, (req, res) => {
  res.json({
    bookings: getBookings(),
    businessHours: BUSINESS_HOURS,
    manualBlocks: getManualBlocks()
  });
});

app.post("/admin/cancel", isAdmin, (req, res) => {
  const { date, start } = req.body;

  const filtered = getBookings().filter(
    b => !(b.date === date && b.start === start)
  );

  fs.writeFileSync(BOOKING_FILE, JSON.stringify(filtered, null, 2));
  res.json({ success: true });
});

app.post("/admin/save-slots", isAdmin, (req, res) => {
  const { date, blockedSlots } = req.body;

  let allBlocks = getManualBlocks().filter(m => m.date !== date);

  blockedSlots.forEach(start => {
    allBlocks.push({ date, start });
  });

  fs.writeFileSync(BLOCKS_FILE, JSON.stringify(allBlocks, null, 2));
  res.json({ success: true });
});

app.post("/admin/toggle-closure", isAdmin, (req, res) => {
  const { dayIndex } = req.body;

  BUSINESS_HOURS[dayIndex] = BUSINESS_HOURS[dayIndex]
    ? null
    : DEFAULT_HOURS[dayIndex];

  res.json({ success: true });
});

app.post("/admin/close-date", isAdmin, (req, res) => {
  const { date } = req.body;

  let blocks = getManualBlocks();
  blocks = blocks.filter(b => b.date !== date);
  blocks.push({ date, fullDay: true });

  fs.writeFileSync(BLOCKS_FILE, JSON.stringify(blocks, null, 2));
  res.json({ success: true });
});

/* ---------- START ---------- */
app.listen(PORT, () => {
  console.log("✅ Server running on http://localhost:" + PORT);
});