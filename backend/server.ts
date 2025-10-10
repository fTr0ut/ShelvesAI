// server.ts / app.ts
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
// import session from "express-session"  // if you use server sessions

const app = express();

const allowOrigin = (origin?: string | undefined) => {
  if (!origin) return false; // block non-browser tools; set to true if you want Postman/curl
  try {
    const url = new URL(origin);
    const host = url.hostname;

    // Allow local dev (any port)
    if (host === "localhost" || host === "127.0.0.1") return true;

    // Allow your ngrok / vercel preview domains
    if (host.endsWith(".ngrok-free.dev")) return true;
    if (host.endsWith(".vercel.app")) return true;

    return false;
  } catch {
    return false;
  }
};

app.use(
  cors({
    origin: (origin, cb) => cb(null, allowOrigin(origin)),
    credentials: true, // allow cookies/Authorization headers to be sent
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    exposedHeaders: ["Content-Length", "Content-Range"],
  })
);

// Good to handle preflight quickly
app.options("*", (req, res) => {
  res.sendStatus(204);
});

app.use(cookieParser());
app.use(express.json());
