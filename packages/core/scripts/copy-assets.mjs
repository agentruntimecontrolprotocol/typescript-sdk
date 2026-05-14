#!/usr/bin/env node
// Copy non-TS assets (e.g. SQL schemas) from src/ to dist/ after tsc.
// Cross-platform replacement for `cp`.
import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(here, "..", "src");
const dstRoot = path.join(here, "..", "dist");

const ASSET_EXTS = new Set([".sql"]);

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf(".");
      if (dot > 0 && ASSET_EXTS.has(entry.name.slice(dot))) {
        files.push(full);
      }
    }
  }
  return files;
}

const files = await walk(srcRoot);
for (const file of files) {
  const rel = path.relative(srcRoot, file);
  const dst = path.join(dstRoot, rel);
  await mkdir(path.dirname(dst), { recursive: true });
  await copyFile(file, dst);
  process.stdout.write(`copied ${rel}\n`);
}
if (files.length === 0) {
  process.stdout.write("no assets to copy\n");
}
