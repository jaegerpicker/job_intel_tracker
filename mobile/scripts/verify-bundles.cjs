const { readFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const maps = [];
function walk(dir) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) walk(path);
    else if (item.name.endsWith(".map")) maps.push(path);
  }
}
walk("dist");
const platforms = new Set();
for (const path of maps) {
  const platform = ["ios", "android", "web"].find((p) =>
    path.includes("/" + p + "/"),
  );
  if (!platform) continue;
  const map = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(map.sources))
    throw new Error("Missing bundle source inventory: " + path);
  const dangerous = map.sources.filter((s) =>
    /(?:^|\/)node_modules\/(?:braces|node-forge|uuid)\//.test(s),
  );
  if (dangerous.length)
    throw new Error(
      "Unpatched/tool-only dependency unexpectedly bundled: " +
        dangerous.join(", "),
    );
  const decoders = map.sources
    .map((s, i) => ({ source: s, content: map.sourcesContent?.[i] }))
    .filter((s) => s.source.includes("/decode-uri-component/"));
  if (
    decoders.length !== 1 ||
    !decoders[0].content?.includes("function parsePercentByte")
  )
    throw new Error("Bundle lacks the single patched decoder: " + path);
  platforms.add(platform);
  console.log(
    platform +
      ": patched decoder present; braces/node-forge/uuid absent from runtime source inventory.",
  );
}
if (platforms.size !== 3)
  throw new Error(
    "Export all three platforms with external source maps before running this check.",
  );
