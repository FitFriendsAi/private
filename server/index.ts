import "dotenv/config";
import express from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import pg from "pg";
import { passport } from "./auth.js";
import { registerRoutes } from "./routes.js";
import { storage } from "./storage.js";
import { SEED_EXERCISES } from "./services/exercises-seed.js";

const app = express();
const PORT = process.env.PORT || 5001;

// ── CORS ─────────────────────────────────────────────────────────────────────
// Allow local dev clients (Expo, Vite) and any deployed web origin.
// Native mobile apps don't enforce CORS, but web browsers do.
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const isLocalDev = typeof origin === "string" &&
    /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.)/.test(origin);
  const isProduction = process.env.NODE_ENV === "production";

  if (isLocalDev || isProduction) {
    res.setHeader("Access-Control-Allow-Origin", origin ?? "*");
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "10mb" })); // larger limit for base64 images

const PgSession = connectPgSimple(session);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

app.use(
  session({
    store: new PgSession({ pool, createTableIfMissing: true }),
    secret: process.env.SESSION_SECRET || "fitcore-dev-secret-change-in-prod",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production", // HTTPS in prod (Replit), HTTP in dev
      maxAge: 30 * 24 * 60 * 60 * 1000,
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

registerRoutes(app);

// Serve frontend in production
if (process.env.NODE_ENV === "production") {
  const { default: path } = await import("path");
  const { fileURLToPath } = await import("url");
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  app.use(express.static(path.join(__dirname, "public")));
  app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
}

app.listen(PORT, async () => {
  console.log(`FitCore server running on port ${PORT}`);

  // Seed exercises if none exist
  try {
    const count = await storage.countExercises();
    if (count === 0) {
      await storage.seedExercises(SEED_EXERCISES);
      console.log(`Seeded ${SEED_EXERCISES.length} exercises`);
    }
  } catch (err) {
    console.error("Seed error:", err);
  }
});
