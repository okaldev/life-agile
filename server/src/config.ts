// Runtime configuration from environment variables. See openwiki/deploy.md.

export interface AllowedUser {
  email: string;
  name: string;
}

export interface Config {
  production: boolean;
  port: number;
  publicUrl: string;
  /** True when PUBLIC_URL was not set: write calls then accept an Origin that matches the Host header. */
  publicUrlDefault: boolean;
  /** IANA time zone for all day logic (APP_TIMEZONE). */
  timeZone: string;
  /** Link to the source code (AGPL-3.0 §13), shown in the app. */
  sourceUrl: string;
  /** Public holidays country (HOLIDAYS): "TR" (default) or null for none. */
  holidays: string | null;
  dbPath: string;
  webDist: string;
  googleClientId: string;
  googleClientSecret: string;
  allowed: AllowedUser[];
  devLogin: boolean;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidSubject: string;
}

function parseAllowed(raw: string): AllowedUser[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [email, name] = entry.split(":");
      const e = email.trim().toLowerCase();
      return { email: e, name: (name ?? e.split("@")[0]).trim() };
    });
}

export const DEFAULT_TIME_ZONE = "Europe/Istanbul";

function validTimeZone(tz: string | undefined): string {
  if (!tz) return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    throw new Error(`APP_TIMEZONE is not a valid IANA time zone: ${tz}`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === "production";
  const devLogin = env.DEV_LOGIN === "1" && !production;
  let allowed = parseAllowed(env.ALLOWED_EMAILS ?? "");
  if (allowed.length === 0 && devLogin) {
    allowed = [
      { email: "alice@dev.local", name: "Alice" },
      { email: "bob@dev.local", name: "Bob" },
    ];
  }
  return {
    production,
    port: Number(env.PORT ?? 8080),
    publicUrl: (env.PUBLIC_URL || `http://localhost:${env.PORT ?? 8080}`).replace(/\/$/, ""),
    publicUrlDefault: !env.PUBLIC_URL,
    timeZone: validTimeZone(env.APP_TIMEZONE),
    sourceUrl: env.SOURCE_URL || "https://github.com/okaldev/life-agile",
    holidays: (env.HOLIDAYS ?? "TR").toUpperCase() === "TR" ? "TR" : null,
    dbPath: env.DB_PATH ?? "data/agile.db",
    webDist: env.WEB_DIST ?? "web/dist",
    googleClientId: env.GOOGLE_CLIENT_ID ?? "",
    googleClientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
    allowed,
    devLogin,
    vapidPublicKey: env.VAPID_PUBLIC_KEY ?? "",
    vapidPrivateKey: env.VAPID_PRIVATE_KEY ?? "",
    vapidSubject: env.VAPID_SUBJECT || "mailto:admin@localhost",
  };
}
