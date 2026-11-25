import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const shared = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
};

const builds = [
  { ...shared, entryPoints: ["src/main.ts"], outfile: "dist/main.js" },
  { ...shared, entryPoints: ["src/preload.ts"], outfile: "dist/preload.js" },
];

if (watch) {
  const contexts = await Promise.all(builds.map((b) => esbuild.context(b)));
  await Promise.all(contexts.map((ctx) => ctx.watch()));
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
