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
const PORT = process.env.PORT || 5173;

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
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  // Keep connections alive so Neon's serverless DB doesn't drop them after inactivity
  keepAlive: true,
  idleTimeoutMillis: 60_000,   // release idle clients after 60 s
  connectionTimeoutMillis: 5_000,
});

// Re-connect automatically on idle connection errors (Neon drops connections after ~5 min)
pool.on("error", (err) => {
  console.warn("Session pool error (will reconnect):", err.message);
});

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

// Serve frontend (SPA catch-all) — always registered so client-side routes work
{
  const { default: path } = await import("path");
  const { fileURLToPath } = await import("url");
  const { existsSync } = await import("fs");
  const __filename = fileURLToPath(import.meta.url);
  const __dirname  = path.dirname(__filename);

  // Candidate paths in priority order
  const candidates = [
    path.join(__dirname, "public"),            // prod: dist/public  (node dist/index.js)
    path.join(process.cwd(), "dist", "public"), // dev: <root>/dist/public
  ];
  const publicPath = candidates.find(p => existsSync(path.join(p, "index.html"))) ?? candidates[0];

  console.log(`[static] publicPath=${publicPath} exists=${existsSync(publicPath)}`);

  app.use(express.static(publicPath));
  // Always register catch-all so /workouts, /food, etc. don't 404
  app.get("*", (_req, res) => {
    const indexFile = path.join(publicPath, "index.html");
    if (existsSync(indexFile)) {
      res.sendFile(indexFile);
    } else {
      res.status(503).send("App not yet built — run `npm run build` first");
    }
  });
}

// ── Global error handler ─────────────────────────────────────────────────────
// Catches anything that falls through (e.g. session-store DB errors, middleware
// crashes) and returns a clean JSON 500 instead of crashing the process.
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = typeof err?.status === "number" ? err.status : 500;
  const message = err?.message ?? "Internal server error";
  console.error("Unhandled error:", err);
  if (!res.headersSent) res.status(status).json({ message });
});

app.listen(PORT, async () => {
  console.log(`FitCore server running on port ${PORT}`);

  // Log outbound IP so it can be whitelisted in FatSecret's IP Restrictions panel
  fetch("https://api.ipify.org?format=json")
    .then(r => r.json())
    .then((d: any) => console.log(`[server] outbound IP: ${d.ip}  ← add this to FatSecret IP whitelist`))
    .catch(() => {});

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
