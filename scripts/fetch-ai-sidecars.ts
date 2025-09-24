#!/usr/bin/env tsx
/**
 * Fetch and install AI sidecar binaries (opencode, codex) into src-tauri/sidecars.
 * - Reads pinned versions from src-tauri/sidecars/manifest.json
 * - Downloads macOS assets from GitHub Releases
 * - Installs as:
 *     src-tauri/sidecars/opencode/opencode
 *     src-tauri/sidecars/codex/codex
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";

type Manifest = {
  opencode?: { repo: string; tag: string };
  codex?: { repo: string; tag: string };
};

const root = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const sidecarsDir = path.join(root, "src-tauri", "sidecars");
const manifestPath = path.join(sidecarsDir, "manifest.json");

const GITHUB_API = "https://api.github.com";
const GH_HEADERS: Record<string, string> = {
  "User-Agent": "devdb-studio/ai-sidecars",
  ...(process.env.GITHUB_TOKEN
    ? { Authorization: `token ${process.env.GITHUB_TOKEN}` }
    : {}),
  Accept: "application/vnd.github+json",
};

function log(msg: string) {
  console.log(`[ai:fetch] ${msg}`);
}
function warn(msg: string) {
  console.warn(`[ai:fetch] WARN: ${msg}`);
}
function error(msg: string) {
  console.error(`[ai:fetch] ERROR: ${msg}`);
}

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function platformInfo() {
  return { plat: process.platform, arch: process.arch } as const;
}

type Asset = { name: string; browser_download_url: string };
type Release = { tag_name: string; assets: Asset[] };

function isAsset(x: unknown): x is Asset {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as any).name === "string" &&
    typeof (x as any).browser_download_url === "string"
  );
}

function isRelease(x: unknown): x is Release {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as any).tag_name === "string" &&
    Array.isArray((x as any).assets) &&
    (x as any).assets.every(isAsset)
  );
}

function pickAsset(
  assets: Asset[],
  tool: string,
  { plat, arch }: { plat: string; arch: string },
) {
  const isDarwin = plat === "darwin";
  const armHints = ["arm64", "aarch64", "apple"];
  const x64Hints = ["x86_64", "amd64"];
  const list = assets.filter((a) => {
    const n = (a.name || "").toLowerCase();
    if (!isDarwin) return false;
    if (!n.includes("darwin") && !n.includes("apple")) return false;
    if (arch === "arm64") {
      if (!armHints.some((h) => n.includes(h))) return false;
    } else {
      if (!x64Hints.some((h) => n.includes(h))) return false;
    }
    return true;
  });
  list.sort((a, b) => {
    const aw = a.name.endsWith(".tar.gz") ? 2 : a.name.endsWith(".zip") ? 1 : 0;
    const bw = b.name.endsWith(".tar.gz") ? 2 : b.name.endsWith(".zip") ? 1 : 0;
    return bw - aw;
  });
  return list[0];
}

async function download(url: string, dest: string) {
  const res = await fetch(url, { headers: GH_HEADERS });
  if (!res.ok)
    throw new Error(`download failed ${res.status} ${res.statusText}`);
  await ensureDir(path.dirname(dest));
  const buf = Buffer.from(await res.arrayBuffer());
  await fs.writeFile(dest, buf);
}

async function run(
  cmd: string,
  args: string[],
  options: Record<string, unknown> = {},
) {
  await new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", ...options });
    p.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited ${code}`));
    });
    p.on("error", reject);
  });
}

async function extract(archive: string, outDir: string) {
  await ensureDir(outDir);
  const lower = archive.toLowerCase();
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    await run("tar", ["-xzf", archive, "-C", outDir]);
  } else if (lower.endsWith(".zip")) {
    await run("unzip", ["-o", archive, "-d", outDir]);
  } else {
    // assume raw binary
    const target = path.join(outDir, path.basename(archive));
    await fs.copyFile(archive, target);
  }
}

async function findBinary(dir: string, tool: string): Promise<string | null> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      const found = await findBinary(p, tool);
      if (found) return found;
    } else {
      const lower = e.name.toLowerCase();
      if (lower === tool || lower.startsWith(`${tool}-`)) return p;
      // Direct asset named 'codex' exists in latest release — accept exact name
      if (tool === "codex" && lower === "codex") return p;
      // Some archives include no extension; prefer executable bit when possible
      if (!e.name.includes(".")) return p;
    }
  }
  return null;
}

async function installTool(
  repo: string,
  tag: string,
  tool: "opencode" | "codex",
) {
  async function fetchReleaseByTag(t: string): Promise<Release | null> {
    const url = `${GITHUB_API}/repos/${repo}/releases/tags/${t}`;
    const res = await fetch(url, { headers: GH_HEADERS });
    if (!res.ok) return null;
    const data: unknown = await res.json();
    return isRelease(data) ? data : null;
  }

  let meta: Release | null = await fetchReleaseByTag(tag);
  if (!meta && !tag.startsWith("v")) {
    // try with v prefix
    meta = await fetchReleaseByTag(`v${tag}`);
    if (meta) warn(`${tool}: tag ${tag} not found, using v${tag}`);
  }
  if (!meta) {
    const latestRes = await fetch(
      `${GITHUB_API}/repos/${repo}/releases/latest`,
      { headers: GH_HEADERS },
    );
    if (latestRes.ok) {
      const data: unknown = await latestRes.json();
      if (isRelease(data)) {
        meta = data;
        warn(`${tool}: falling back to latest tag ${meta.tag_name}`);
      }
    }
  }
  if (!meta || !meta.assets)
    throw new Error(`No assets in release ${repo} ${tag}`);
  const asset = pickAsset(meta.assets, tool, platformInfo());
  if (!asset)
    throw new Error(
      `No suitable asset for ${tool} on ${process.platform} ${process.arch}`,
    );

  const tmpDir = path.join(os.tmpdir(), `ai-sidecars-${Date.now()}`);
  const archive = path.join(tmpDir, asset.name);
  await ensureDir(tmpDir);
  await download(asset.browser_download_url, archive);

  const extractDir = path.join(tmpDir, "out");
  await extract(archive, extractDir);
  const binPath = await findBinary(extractDir, tool);
  if (!binPath)
    throw new Error(`Extracted but could not find binary for ${tool}`);

  const destDir = path.join(sidecarsDir, tool);
  await ensureDir(destDir);
  // Map tool names to binary names for process naming
  const binaryNameMap: Record<string, string> = {
    opencode: "devdb-opencode",
    codex: "devdb-openai-codex",
  };
  const destName = binaryNameMap[tool] || tool;
  const dest = path.join(destDir, destName);
  await fs.copyFile(binPath, dest);
  await fs.chmod(dest, 0o755);
  log(`Installed ${tool} -> ${path.relative(root, dest)}`);
}

async function main() {
  const raw: unknown = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  function isManifest(x: unknown): x is Manifest {
    if (typeof x !== "object" || x === null) return false;
    const o = x as Record<string, unknown>;
    const ok = (v: unknown) =>
      typeof v === "object" &&
      v !== null &&
      typeof (v as any).repo === "string" &&
      typeof (v as any).tag === "string";
    const op = o.opencode === undefined || ok(o.opencode);
    const cx = o.codex === undefined || ok(o.codex);
    return op && cx;
  }
  if (!isManifest(raw)) throw new Error("Invalid sidecar manifest");
  const manifest: Manifest = raw;
  const tasks: Array<Promise<void>> = [];
  if (manifest.opencode && manifest.opencode.repo && manifest.opencode.tag) {
    tasks.push(
      installTool(manifest.opencode.repo, manifest.opencode.tag, "opencode"),
    );
  } else {
    warn("opencode: repo/tag missing in manifest — skipping");
  }
  if (manifest.codex && manifest.codex.repo && manifest.codex.tag) {
    tasks.push(installTool(manifest.codex.repo, manifest.codex.tag, "codex"));
  } else {
    warn("codex: repo/tag missing in manifest — skipping");
  }
  await Promise.all(tasks);
}

main().catch((e: unknown) => {
  const msg = e instanceof Error ? e.stack ?? e.message : String(e);
  error(msg);
  process.exit(1);
});
