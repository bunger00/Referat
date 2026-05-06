/**
 * Lokalt oppsettsskript.
 *
 * Kjøres med `npm run setup`. Det:
 *   1. Spør deg om et app-passord (det brukerne taster på login).
 *   2. Genererer en bcrypt-hash av det.
 *   3. Genererer en tilfeldig SESSION_SECRET.
 *   4. Skriver eller oppdaterer .env-filen i prosjektroten med disse verdiene
 *      uten å overskrive andre eksisterende verdier (f.eks. DATABASE_URL).
 *
 * Skriptet rører ALDRI eksisterende verdier som ikke gjelder hash/secret.
 */
import bcrypt from "bcrypt";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import readline from "readline";

const ENV_PATH = path.resolve(process.cwd(), ".env");
const ENV_EXAMPLE_PATH = path.resolve(process.cwd(), ".env.example");

function prompt(question: string, opts: { hidden?: boolean } = {}): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (opts.hidden) {
      const stdout = process.stdout as NodeJS.WriteStream & { _writeToOutput?: (s: string) => void };
      const original = stdout.write.bind(stdout);
      let firstWrite = true;
      stdout.write = ((chunk: any, ...rest: any[]) => {
        if (firstWrite) {
          firstWrite = false;
          return original(chunk, ...rest);
        }
        return original("", ...rest);
      }) as any;
      rl.question(question, (answer) => {
        stdout.write = original as any;
        rl.close();
        process.stdout.write("\n");
        resolve(answer.trim());
      });
    } else {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

function parseEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function serializeEnv(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([k, v]) => {
      const needsQuotes = /\s|#|"|'/.test(v);
      const safe = needsQuotes ? `"${v.replace(/"/g, '\\"')}"` : v;
      return `${k}=${safe}`;
    })
    .join("\n") + "\n";
}

async function main() {
  console.log("\n🛠   Møtetranskripsjonsapp — setup\n");

  // Load existing .env if any, otherwise start from .env.example.
  let existing: Record<string, string> = {};
  if (fs.existsSync(ENV_PATH)) {
    existing = parseEnv(fs.readFileSync(ENV_PATH, "utf-8"));
    console.log(`📄 Fant eksisterende .env — oppdaterer den.`);
  } else if (fs.existsSync(ENV_EXAMPLE_PATH)) {
    existing = parseEnv(fs.readFileSync(ENV_EXAMPLE_PATH, "utf-8"));
    console.log(`📄 Ingen .env funnet — starter fra .env.example.`);
  } else {
    console.log(`📄 Ingen .env eller .env.example funnet — oppretter ny .env.`);
  }

  // 1) App password → bcrypt hash
  let password = process.env.SETUP_PASSWORD?.trim();
  if (!password) {
    password = await prompt("Velg app-passord (det brukerne taster på login): ", { hidden: true });
    if (!password) {
      console.error("❌ Passord kan ikke være tomt.");
      process.exit(1);
    }
    const confirm = await prompt("Bekreft passord: ", { hidden: true });
    if (password !== confirm) {
      console.error("❌ Passordene stemmer ikke overens.");
      process.exit(1);
    }
  }
  const hash = await bcrypt.hash(password, 12);
  existing.APP_PASSWORD_HASH = hash;
  console.log("✅ APP_PASSWORD_HASH generert.");

  // 2) Session secret — only generate if missing or marked as placeholder.
  if (
    !existing.SESSION_SECRET ||
    existing.SESSION_SECRET.includes("skift-meg") ||
    existing.SESSION_SECRET.length < 32
  ) {
    existing.SESSION_SECRET = crypto.randomBytes(48).toString("hex");
    console.log("✅ SESSION_SECRET generert (96 tegn hex).");
  } else {
    console.log("ℹ️  SESSION_SECRET fantes allerede — beholder den.");
  }

  // 3) Sensible defaults for first-time setup
  if (!existing.PORT) existing.PORT = "5000";
  if (!existing.NODE_ENV) existing.NODE_ENV = "development";
  if (!existing.DATABASE_URL) existing.DATABASE_URL = "postgresql://localhost:5432/referat";

  // Write file
  fs.writeFileSync(ENV_PATH, serializeEnv(existing), "utf-8");
  console.log(`\n📝 Skrev ${ENV_PATH}\n`);

  // Friendly hints about what is still missing
  const missing: string[] = [];
  if (!existing.OPENAI_API_KEY || existing.OPENAI_API_KEY.startsWith("sk-...")) missing.push("OPENAI_API_KEY");
  if (missing.length > 0) {
    console.log("⚠️  Du mangler fortsatt:");
    missing.forEach((k) => console.log(`   - ${k}`));
    console.log(`Åpne .env og fyll inn verdiene før du kjører \`npm run dev\`.\n`);
  } else {
    console.log("🎉 Alt klart! Neste steg:");
    console.log(`   1. createdb referat                   # opprett Postgres-database`);
    console.log(`   2. npm run db:push                    # opprett tabeller`);
    console.log(`   3. npm run dev                        # start dev-server\n`);
  }
}

main().catch((err) => {
  console.error("❌ Setup feilet:", err);
  process.exit(1);
});
