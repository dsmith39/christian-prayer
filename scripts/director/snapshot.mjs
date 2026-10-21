// snapshot.mjs - the director agent's view of FaithRequest (faithrequest.com).
//
// Reads git, GitHub (through gh, if it is installed and signed in), the ADR index, the backend
// dependencies, whether tests and CI exist, and the agent state in ops/ (decisions, owner notes,
// staff reports). Prints one markdown snapshot so the agent reasons from the same numbers every run.
//
// Read-only. Never writes anything. It cannot see production, and it never reads any user data.
//
// Usage:
//   node scripts/director/snapshot.mjs            # markdown
//   node scripts/director/snapshot.mjs --json     # raw numbers
//   node scripts/director/snapshot.mjs --today 2026-10-19

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OPS = join(ROOT, "ops");

// Edit these when the project changes.
const CONFIG = {
  defaultBranch: "master",
  roles: ["dev", "qa", "ops", "growth"],
  staleReportDays: 14,
  staleCommitDays: 30,
};

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const todayArg = args[args.indexOf("--today") + 1];
// Local date, not UTC: toISOString() rolls over to tomorrow in the evening in Denver.
const localDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const today = args.includes("--today") && todayArg ? todayArg : localDate(new Date());

const DAY = 86_400_000;
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

function isoWeek(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((d - yearStart) / DAY + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const missing = [];

function run(cmd, cmdArgs) {
  try {
    return execFileSync(cmd, cmdArgs, { cwd: ROOT, encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function readText(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

function readJson(path) {
  const text = readText(path);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ---- git -------------------------------------------------------------------------------------

const git = {
  branch: run("git", ["branch", "--show-current"]),
  uncommitted: (run("git", ["status", "--porcelain"]) || "").split("\n").filter(Boolean).length,
  recent: (run("git", ["log", "-5", "--date=short", "--pretty=%ad %s"]) || "").split("\n").filter(Boolean),
  commits30d: Number(run("git", ["rev-list", "--count", "--since=30.days", "HEAD"]) || 0),
  lastCommitDate: run("git", ["log", "-1", "--date=short", "--pretty=%ad"]),
};
git.daysSinceCommit = git.lastCommitDate ? daysBetween(git.lastCommitDate, today) : null;

// ---- GitHub ----------------------------------------------------------------------------------

function gh(ghArgs) {
  const out = run("gh", ghArgs);
  if (out === null) return null;
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
}

const prs = gh(["pr", "list", "--state", "open", "--limit", "30", "--json", "number,title,updatedAt"]);
const github = {
  available: prs !== null,
  openPrs: prs ? prs.length : null,
  prs: prs ? prs.slice(0, 10).map((p) => ({ number: p.number, title: p.title, updated: p.updatedAt?.slice(0, 10) })) : [],
};
if (!github.available) missing.push("GitHub data (gh not installed or not signed in)");

// ---- project: ADRs, dependencies, tests, CI --------------------------------------------------

function adrInfo() {
  const text = readText(join(ROOT, "docs", "adr", "README.md"));
  if (!text) return null;
  const rows = [...text.matchAll(/^\|\s*\[(\d{4})\][^|]*\|[^|]*\|\s*([^|]+?)\s*\|/gm)];
  return {
    total: rows.length,
    superseded: rows.filter((r) => /superseded/i.test(r[2])).map((r) => r[1]),
    latest: rows.length ? rows.at(-1)[1] : null,
  };
}

const major = (range) => {
  const m = String(range || "").match(/(\d+)/);
  return m ? Number(m[1]) : null;
};

const backendPkg = readJson(join(ROOT, "backend", "package.json"));
const deps = backendPkg?.dependencies || {};
const express = major(deps.express);
const serverless = major(deps["serverless-http"]);
// Express 5 with serverless-http 3 silently breaks request bodies on Lambda (seen in a sibling project).
const pairingRisk = express !== null && serverless !== null && express >= 5 && serverless < 4;

const rootPkg = readJson(join(ROOT, "package.json"));
const testScript = rootPkg?.scripts?.test || "";
const hasRealTests = Boolean(testScript) && !/no test specified/i.test(testScript);

const project = {
  adrs: adrInfo(),
  backendDeps: Object.keys(deps).length,
  express,
  serverlessHttp: serverless,
  pairingRisk,
  hasRealTests,
  hasTestFiles: existsSync(join(ROOT, "tests")) || existsSync(join(ROOT, "backend", "tests")),
  hasCI: existsSync(join(ROOT, ".github", "workflows")) && readdirSync(join(ROOT, ".github", "workflows")).length > 0,
  hasIaC: ["template.yaml", "template.yml", "cdk.json", "main.tf"].some((f) => existsSync(join(ROOT, f))),
};
if (!project.adrs) missing.push("docs/adr/README.md index");
if (!backendPkg) missing.push("backend/package.json");

// ---- agent state in ops/ ---------------------------------------------------------------------

function openDecisions() {
  const text = readText(join(OPS, "decisions.md"));
  if (text === null) return [];
  const out = [];
  for (const block of text.split(/^## /m).slice(1)) {
    const title = block.split("\n")[0].trim();
    if (/\*\*Status:\*\*\s*open/i.test(block)) out.push(title);
  }
  return out;
}

function teamReports() {
  return CONFIG.roles.map((role) => {
    const dir = join(OPS, "staff", role);
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")).sort() : [];
    const latest = files.at(-1) || null;
    const date = latest?.match(/^\d{4}-\d{2}-\d{2}/)?.[0] || null;
    return { role, reports: files.length, latest, ageDays: date ? daysBetween(date, today) : null };
  });
}

if (!existsSync(join(OPS, "ceo-context.md"))) missing.push("ops/ceo-context.md (run /faithrequest setup from the workspace root)");

const thisWeek = isoWeek(today);
const decisions = openDecisions();
const team = teamReports();

const snapshot = { today, thisWeek, git, github, project, openDecisions: decisions, team, missing };

if (asJson) {
  console.log(JSON.stringify(snapshot, null, 2));
  process.exit(0);
}

// ---- markdown --------------------------------------------------------------------------------

const out = [];
out.push(`# FaithRequest snapshot, ${today} (${thisWeek})`, "");

out.push("## Code");
out.push(`- Branch ${git.branch ?? "unknown"}, ${git.uncommitted} uncommitted file(s), default branch ${CONFIG.defaultBranch}`);
out.push(`- Commits in 30 days: ${git.commits30d}${git.daysSinceCommit !== null ? `, last ${git.lastCommitDate} (${git.daysSinceCommit} days ago)` : ""}`);
if (git.daysSinceCommit !== null && git.daysSinceCommit > CONFIG.staleCommitDays) out.push(`- FLAG: no commit in over ${CONFIG.staleCommitDays} days`);
for (const c of git.recent) out.push(`  - ${c}`);
out.push("");

out.push("## GitHub");
if (github.available) {
  out.push(`- ${github.openPrs} open PR(s)`);
  for (const p of github.prs) out.push(`  - #${p.number} ${p.title} (updated ${p.updated})`);
} else {
  out.push("- Unavailable (gh missing or signed out)");
}
out.push("");

out.push("## Safety net");
out.push(`- Automated tests: ${project.hasRealTests || project.hasTestFiles ? "present" : "NONE (npm test is a placeholder)"}`);
out.push(`- CI workflow: ${project.hasCI ? "present" : "NONE"}`);
out.push(`- Infrastructure as code: ${project.hasIaC ? "present" : "NONE (provisioned by hand; CLAUDE.md Changelog is the record)"}`);
out.push(`- Backend: Express ${project.express ?? "?"}, serverless-http ${project.serverlessHttp ?? "?"}, ${project.backendDeps} dependencies${project.pairingRisk ? " · FLAG: Express 5 with serverless-http under 4 breaks request bodies on Lambda" : ""}`);
if (project.adrs) out.push(`- ADRs: ${project.adrs.total}, latest ${project.adrs.latest}, superseded ${project.adrs.superseded.join(", ") || "none"}`);
out.push("- Users, usage, backups, and AWS cost: not visible here. Ask Dillon and /ops. Real prayers are never read.");
out.push("");

out.push("## Decisions");
out.push(decisions.length ? `- Open: ${decisions.join("; ")}` : "- No open decisions logged");
out.push("");

out.push("## Team (latest report in ops/staff/)");
for (const t of team) {
  const stale = t.ageDays !== null && t.ageDays > CONFIG.staleReportDays ? " STALE" : "";
  out.push(t.latest ? `- ${t.role}: ${t.latest} (${t.ageDays} days old, ${t.reports} total)${stale}` : `- ${t.role}: no reports yet`);
}

if (missing.length) {
  out.push("", "## Missing data");
  out.push(`- ${missing.join("; ")}`);
}

console.log(out.join("\n"));
