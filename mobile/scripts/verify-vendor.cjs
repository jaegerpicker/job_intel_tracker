const { readFileSync } = require("node:fs");
const { createHash } = require("node:crypto");
const { resolve } = require("node:path");
const root = resolve(__dirname, "../vendor/decode-uri-component");
const provenance = JSON.parse(
  readFileSync(resolve(root, "UPSTREAM.json"), "utf8"),
);
const adapted = readFileSync(resolve(root, "index.js"), "utf8");
const suffix = "\nmodule.exports = decodeUriComponent;\n";
if (!adapted.endsWith(suffix)) throw new Error("Unexpected decoder adaptation");
const restored = adapted
  .slice(0, -suffix.length)
  .replace(
    "function decodeUriComponent",
    "export default function decodeUriComponent",
  );
const hash = createHash("sha256").update(restored).digest("hex");
if (hash !== provenance.index_js_sha256)
  throw new Error("Vendored decoder logic differs from audited upstream 0.5.0");
const decode = require("decode-uri-component");
if (decode("%F0%9F%8C%B2") !== "🌲")
  throw new Error("Decoder is not CommonJS-compatible");
console.log("Patched decoder provenance and CommonJS compatibility verified.");
