import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const root = resolve(import.meta.dir, "..");
const dirs: string[] = [];
const children: Array<{ kill: () => void }> = [];

function keep(path: string) {
  dirs.push(path);
  return path;
}

function run(command: string, args: string[], cwd: string) {
  const result = Bun.spawnSync([command, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
  });
  if (result.exitCode !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed in ${cwd}\n${result.stdout.toString()}\n${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

function freePort() {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const server = createServer();
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    server.close(() => resolve(port));
  });
  server.on("error", reject);
  return promise;
}

function waitFor(url: string) {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const started = Date.now();
  const attempt = () => {
    fetch(url).then((response) => {
      if (response.ok) resolve();
      else if (Date.now() - started > 60_000) reject(new Error(`Timed out waiting for ${url}`));
      else setTimeout(attempt, 250);
    }).catch(() => {
      if (Date.now() - started > 60_000) reject(new Error(`Timed out waiting for ${url}`));
      else setTimeout(attempt, 250);
    });
  };
  attempt();
  return promise;
}

function assertNoReact(source: string, file: string) {
  if (/\bfrom ["']react(?:-dom)?["']/.test(source) || /\brequire\(["']react(?:-dom)?["']\)/.test(source)) {
    throw new Error(`${file} imports React`);
  }
}

try {
  run("bun", ["run", "--filter", "@skalahq/draw", "build"], root);
  const packDir = keep(mkdtempSync(join(tmpdir(), "draw-pack-")));
  run("bun", ["pm", "pack", "--destination", packDir], join(root, "packages/draw"));
  const packedName = readdirSync(packDir).find((name) => name.endsWith(".tgz"));
  if (!packedName) throw new Error(`No tarball in ${packDir}`);
  const tarball = join(packDir, packedName);

  const domDir = keep(mkdtempSync(join(tmpdir(), "draw-dom-")));
  writeFileSync(join(domDir, "package.json"), JSON.stringify({ name: "draw-dom-consumer", private: true, type: "module" }, null, 2));
  run("bun", ["add", tarball], domDir);
  const manifest = JSON.parse(readFileSync(join(domDir, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
  const dependencyNames = Object.keys(manifest.dependencies ?? {});
  if (dependencyNames.some((name) => name === "react" || name === "react-dom" || name.startsWith("@skalahq/draw/"))) {
    throw new Error(`DOM consumer dependencies are not React-free: ${dependencyNames.join(", ")}`);
  }
  if (!dependencyNames.includes("@skalahq/draw")) throw new Error("DOM consumer did not install @skalahq/draw");

  const installed = realpathSync(join(domDir, "node_modules/@skalahq/draw"));
  const workspace = realpathSync(join(root, "packages/draw"));
  if (installed === workspace || installed.startsWith(`${workspace}/`)) {
    throw new Error(`consumer resolved the workspace package at ${installed}`);
  }
  const installedPackage = JSON.parse(readFileSync(join(installed, "package.json"), "utf8")) as { exports?: Record<string, unknown> };
  for (const entry of ["./core", "./react", "./dom", "./styles.css"]) {
    if (!installedPackage.exports?.[entry]) throw new Error(`packed package is missing export ${entry}`);
  }
  assertNoReact(readFileSync(join(installed, "dist/core.js"), "utf8"), "dist/core.js");
  assertNoReact(readFileSync(join(installed, "dist/dom.js"), "utf8"), "dist/dom.js");
  if (!readFileSync(join(installed, "styles.css"), "utf8").includes(".draw-canvas")) {
    throw new Error("packed styles.css is missing .draw-canvas");
  }

  writeFileSync(join(domDir, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      lib: ["ES2022", "DOM"],
    },
    files: ["consumer.ts"],
  }, null, 2));
  writeFileSync(join(domDir, "consumer.ts"), `import { createDrawController, decodeDrawDocument, encodeDrawDocument, exportDrawPng, exportDrawSvg } from "@skalahq/draw/core";
import { mountDraw } from "@skalahq/draw/dom";

if (typeof mountDraw !== "function") throw new Error("mountDraw missing");
const controller = createDrawController({
  version: 1,
  nodes: [{ id: "packed", type: "note", bounds: { x: 8, y: 8, width: 40, height: 24 }, metadata: { label: "Packed", extra: { ok: true } } }],
});
const decoded = decodeDrawDocument(encodeDrawDocument(controller.getSnapshot()));
if ((decoded.nodes[0]?.metadata?.extra as { ok?: boolean } | undefined)?.ok !== true) throw new Error("metadata lost");
if (!exportDrawSvg(controller.getSnapshot()).svg.includes("<svg")) throw new Error("svg export failed");
if (exportDrawPng(controller.getSnapshot()).png[0] !== 137) throw new Error("png export failed");
`);
  run(join(root, "node_modules/.bin/tsc"), ["-p", join(domDir, "tsconfig.json"), "--noEmit"], domDir);
  run("bun", ["consumer.ts"], domDir);

  writeFileSync(join(domDir, "host.ts"), `import { createDrawController } from "@skalahq/draw/core";
import { mountDraw } from "@skalahq/draw/dom";
import "@skalahq/draw/styles.css";

const controller = createDrawController();
const drawing = document.querySelector("#drawing");
if (!(drawing instanceof HTMLElement)) throw new Error("Missing drawing");
mountDraw(drawing, {
  controller,
  ariaLabel: "Packed canvas",
  getNodeLabel: (node) => typeof node.metadata?.label === "string" ? node.metadata.label : node.type,
});
document.querySelector("#add")?.addEventListener("click", () => {
  controller.commands.insertNode({
    id: "packed-note",
    type: "note",
    bounds: { x: 24, y: 24, width: 120, height: 64 },
    metadata: { label: "Packed note" },
  });
});
`);
  writeFileSync(join(domDir, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="./main.css"><style>#drawing{height:320px}</style></head>
<body><button id="add">Add packed note</button><div id="drawing"></div><script type="module" src="./main.js"></script></body></html>`);
  run("bun", ["build", "./host.ts", "--target=browser", "--outdir=public"], domDir);
  const emitted = readdirSync(join(domDir, "public"));
  const scriptName = emitted.find((name) => name.endsWith(".js"));
  const cssName = emitted.find((name) => name.endsWith(".css"));
  if (!scriptName || !cssName) throw new Error(`packed DOM build emitted ${emitted.join(", ") || "nothing"}`);
  const html = Bun.file(join(domDir, "index.html"));
  const script = Bun.file(join(domDir, "public", scriptName));
  const css = Bun.file(join(domDir, "public", cssName));
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    routes: {
      "/": () => new Response(html),
      "/main.js": () => new Response(script),
      "/main.css": () => new Response(css),
    },
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(server.url.toString());
    await page.getByRole("region", { name: "Packed canvas" }).waitFor();
    await page.getByRole("button", { name: "Add packed note" }).click();
    await page.getByRole("group", { name: "Packed note" }).waitFor();
    const position = await page.locator(".draw-canvas").evaluate((element) => getComputedStyle(element).position);
    if (position !== "relative") throw new Error(`packed styles did not apply: ${position}`);
  } finally {
    await browser.close();
    await server.stop(true);
  }

  const nextDir = keep(mkdtempSync(join(tmpdir(), "draw-next-")));
  writeFileSync(join(nextDir, "package.json"), JSON.stringify({ name: "draw-next-consumer", private: true, type: "module" }, null, 2));
  run("bun", ["add", tarball, "next@16.4.6", "react@19.3.1", "react-dom@19.3.1", "@ui-sdk/react@0.1.0-beta.17"], nextDir);
  run("bun", ["add", "-d", "typescript@~5.9.3", "@types/react@^19.3.0", "@types/react-dom@^19.3.0", "@types/node@^24.19.2"], nextDir);
  const nextManifest = JSON.parse(readFileSync(join(nextDir, "package.json"), "utf8")) as { dependencies?: Record<string, string> };
  if (nextManifest.dependencies?.["@skalahq/draw"]?.startsWith("workspace:")) {
    throw new Error("Next consumer resolved a workspace alias");
  }
  writeFileSync(join(nextDir, "next.config.ts"), `import type { NextConfig } from "next";\nexport default {} satisfies NextConfig;\n`);
  writeFileSync(join(nextDir, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2017",
      lib: ["dom", "dom.iterable", "esnext"],
      strict: true,
      noEmit: true,
      esModuleInterop: true,
      module: "esnext",
      moduleResolution: "bundler",
      jsx: "react-jsx",
      incremental: true,
      plugins: [{ name: "next" }],
    },
    include: ["app", "next-env.d.ts"],
  }, null, 2));
  mkdirSync(join(nextDir, "app"));
  writeFileSync(join(nextDir, "app/layout.tsx"), `import type { ReactNode } from "react";\nexport default function Layout({ children }: { children: ReactNode }) {\n  return <html lang="en"><body>{children}</body></html>;\n}\n`);
  writeFileSync(join(nextDir, "app/page.tsx"), `"use client";
import { createDrawController } from "@skalahq/draw/core";
import { DrawCanvas } from "@skalahq/draw/react";
import "@skalahq/draw/styles.css";
import { useState } from "react";

export default function Page() {
  const [controller] = useState(() => createDrawController());
  return (
    <main>
      <style>{\`.packed-canvas { height: 320px }\`}</style>
      <h1>Packed Next</h1>
      <button onClick={() => controller.commands.insertNode({
        id: "packed-note",
        type: "note",
        bounds: { x: 16, y: 16, width: 120, height: 64 },
        metadata: { label: "Packed note" },
      })}>Add packed note</button>
      <DrawCanvas className="packed-canvas" controller={controller} aria-label="Packed canvas" getNodeLabel={(node) => typeof node.metadata?.label === "string" ? node.metadata.label : node.type} renderNode={(node) => <div>{typeof node.metadata?.label === "string" ? node.metadata.label : node.type}</div>} />
    </main>
  );
}
`);
  run("bun", ["run", "--bun", "next", "build"], nextDir);
  const port = await freePort();
  const next = spawn("bun", ["run", "--bun", "next", "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: nextDir,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: "ignore",
  });
  children.push(next);
  await waitFor(`http://127.0.0.1:${port}`);
  const nextBrowser = await chromium.launch();
  try {
    const page = await nextBrowser.newPage();
    await page.goto(`http://127.0.0.1:${port}`);
    await page.getByRole("heading", { name: "Packed Next" }).waitFor();
    await page.getByRole("button", { name: "Add packed note" }).click();
    await page.getByRole("group", { name: "Packed note" }).waitFor();
    const position = await page.locator(".draw-canvas").evaluate((element) => getComputedStyle(element).position);
    if (position !== "relative") throw new Error(`Next consumer styles did not apply: ${position}`);
  } finally {
    await nextBrowser.close();
    next.kill();
  }

  console.log(JSON.stringify({ tarball: packedName, installed, reactFreeDom: true, nextBuild: true }));
} finally {
  for (const child of children) child.kill();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}
