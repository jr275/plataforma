#!/usr/bin/env node
// Gera o snapshot agregado do export do Search Console (ADR-038). Lê direto dos zips; não grava nada além do arquivo de saída.
// Uso:
//   gerar:      node scripts/gsc-export-build.mjs --search <zip> [--ai <zip>] [--dates <csv|zip> --dates-property <prop>] --property <url> --tenant <uuid> [--out apps/web/.data/gsc-export.json]
//   acrescentar a um snapshot que já existe (qualquer combinação):
//               node scripts/gsc-export-build.mjs [--dates <csv|zip> --dates-property <prop>] [--long <zip de 16 meses>] [--property <prop>] [--out apps/web/.data/gsc-export.json]
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildGscExportLong, buildGscExportSnapshot, parseDailySeries, parseGscExportSnapshot } from "../packages/api/src/intel/gsc-export.ts";

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
const need = (k) => { const v = args.get(k); if (!v) { console.error(`falta ${k}`); process.exit(2); } return v; };
const read = (zip, name) => execFileSync("unzip", ["-p", zip, name], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

const out = resolve(args.get("--out") ?? "apps/web/.data/gsc-export.json");
const datesPath = args.get("--dates") ? resolve(args.get("--dates")) : null;
// O zip do Search Console traz a série diária como "Chart.csv" (export completo) ou "Dates.csv" (export só da aba).
const datesCsv = () => {
  if (!datesPath.toLowerCase().endsWith(".zip")) return readFileSync(datesPath, "utf8");
  const names = execFileSync("unzip", ["-Z1", datesPath], { encoding: "utf8" }).split("\n");
  const name = ["Dates.csv", "Chart.csv"].find((n) => names.includes(n));
  if (!name) { console.error("o zip não tem Dates.csv nem Chart.csv"); process.exit(2); }
  return read(datesPath, name);
};
const longZip = args.get("--long") ? resolve(args.get("--long")) : null;
const longFiles = () => ({ devices: read(longZip, "Devices.csv"), queries: read(longZip, "Queries.csv"), pages: read(longZip, "Pages.csv"), filters: read(longZip, "Filters.csv") });
const write = (snapshot) => {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(snapshot, null, 2) + "\n", { mode: 0o600 });
  console.log(`snapshot gravado em ${out}`);
  console.log(`cliques=${snapshot.current.clicks} impressões=${snapshot.current.impressions} ctr=${snapshot.current.ctr.toFixed(2)}% posição=${snapshot.current.position.toFixed(2)}`);
  if (snapshot.long) console.log(`período longo: ${snapshot.long.period}, ${snapshot.long.total.clicks} cliques, ${snapshot.long.coverage.queries.rows} consultas e ${snapshot.long.coverage.pages.rows} páginas`);
  if (snapshot.daily) console.log(`série diária: ${snapshot.daily.points.length} dias (${snapshot.daily.points[0].date} a ${snapshot.daily.points.at(-1).date}) de ${snapshot.daily.property}`);
};

// Modo "acrescentar": série diária e/ou período longo, sobre um snapshot existente.
if (!args.get("--search") && (datesPath || longZip)) {
  if (!existsSync(out)) { console.error(`não há snapshot em ${out}; gere primeiro com --search`); process.exit(2); }
  const current = parseGscExportSnapshot(JSON.parse(readFileSync(out, "utf8")));
  if (!current) { console.error("o snapshot existente é inválido"); process.exit(2); }
  write({
    ...current,
    ...(args.get("--property") ? { property: args.get("--property") } : {}),
    ...(longZip ? { long: buildGscExportLong(longFiles()) } : {}),
    ...(datesPath ? { daily: { property: need("--dates-property"), points: parseDailySeries(datesCsv()) } } : {}),
  });
  process.exit(0);
}

const search = resolve(need("--search"));
const ai = args.get("--ai") ? resolve(args.get("--ai")) : null;
const tenant = need("--tenant");
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenant)) { console.error("--tenant precisa ser um UUID"); process.exit(2); }

write(buildGscExportSnapshot({
  devices: read(search, "Devices.csv"), countries: read(search, "Countries.csv"), appearances: read(search, "Search appearance.csv"),
  queries: read(search, "Queries.csv"), pages: read(search, "Pages.csv"), filters: read(search, "Filters.csv"),
  ...(ai ? { ai: { pages: read(ai, "Pages.csv"), countries: read(ai, "Countries.csv"), devices: read(ai, "Devices.csv") } } : {}),
  ...(datesPath ? { dates: { csv: datesCsv(), property: need("--dates-property") } } : {}),
}, { property: need("--property"), exportedAt: args.get("--date") ?? new Date().toISOString().slice(0, 10), tenantId: tenant }));
