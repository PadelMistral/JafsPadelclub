import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || process.argv[2] || 4173);

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

function resolveRequest(url = "/") {
  const parsed = new URL(url, "http://local.test");
  let pathname = decodeURIComponent(parsed.pathname);
  if (pathname === "/") pathname = "/index.html";
  const target = path.resolve(root, `.${pathname}`);
  if (!target.startsWith(root)) return null;
  if (existsSync(target) && statSync(target).isDirectory()) return path.join(target, "index.html");
  return target;
}

const server = createServer((req, res) => {
  const target = resolveRequest(req.url);
  if (!target || !existsSync(target) || !statSync(target).isFile()) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const type = types[path.extname(target).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, {
    "content-type": type,
    "cache-control": "no-store",
    "cross-origin-resource-policy": "same-origin",
  });
  createReadStream(target).pipe(res);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Padeluminatis local: http://127.0.0.1:${port}/`);
});
