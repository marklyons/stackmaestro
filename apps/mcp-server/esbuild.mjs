import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: ["src/index.ts"],
  bundle: true,
  outfile: "dist/index.js",
  platform: "node",
  format: "esm",
  target: "node20",
  // Bundle our own workspace packages (they ship raw .ts, which plain `node`
  // can't import) but leave real npm deps as external `node_modules` requires.
  external: ["@modelcontextprotocol/sdk", "@modelcontextprotocol/sdk/*", "zod"],
  banner: { js: "#!/usr/bin/env node" },
  sourcemap: true,
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
} else {
  await esbuild.build(options);
}
