// Loads server/.env before any other module reads process.env.
// Must be the first import of index.ts (ES modules evaluate imports in order).
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
try {
  process.loadEnvFile(join(here, "..", ".env"));
} catch {
  // no .env – fine for Open Food Facts-only use, or when env vars come from the host
}
