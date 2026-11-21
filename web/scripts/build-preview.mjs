import { build } from "esbuild";
import { mkdir, readFile, writeFile, cp } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const web = fileURLToPath(new URL("../", import.meta.url));
const out = path.resolve(web, "../preview");
const entry = path.resolve(web, "node_modules/.cache/queue-arena/preview-entry.mjs");
await build({
  entryPoints: [path.join(web, "src/home/preview-entry.tsx")],
  outfile: entry,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  jsx: "automatic",
});
const { markup, script } = await import(pathToFileURL(entry).href + `?t=${Date.now()}`);
const styles = await readFile(path.join(web, "src/home/homepage.css"), "utf8");
await mkdir(out, { recursive: true });
await cp(path.join(web, "public/arena"), path.join(out, "assets"), { recursive: true });
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#55B8ED"><title>插队红包 · Queue Arena · 独立预览</title><style>${styles.replaceAll("/arena/", "./assets/")}</style></head><body>${markup.replaceAll("/arena/", "./assets/")}<script>${script}</script></body></html>`;
await writeFile(path.join(out, "queue-arena-homepage.html"), html);
console.log("Standalone preview generated: preview/queue-arena-homepage.html");
