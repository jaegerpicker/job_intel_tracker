import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
// Exercise query-string itself: Router 57 calls its CommonJS parse/stringify API.
const query = require("query-string") as {
  parse: (input: string) => Record<string, string>;
  stringify: (input: Record<string, string>) => string;
};
test("Router query parser uses patched decoder for Unicode and malformed escapes", () => {
  expect(query.parse("note=hello+world&role=%F0%9F%8C%B2")).toMatchObject({
    note: "hello world",
    role: "🌲",
  });
  expect(query.parse("bad=%E0%A4%A&good=%C3%A5")).toMatchObject({ good: "å" });
  const text = "Native / writer + 🌲";
  expect(query.parse(query.stringify({ text })).text).toBe(text);
});
test("malformed URI decoding cannot hang the test process", () => {
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      "const q=require('query-string'); const input='%A0'.repeat(20000); const output=q.parse('q='+input); if(typeof output.q!=='string')process.exit(1);",
    ],
    { cwd: resolve(__dirname, ".."), timeout: 5000, encoding: "utf8" },
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
});
test("patched UUID remains compatible with Xcode project generation", () => {
  const result = spawnSync(
    process.execPath,
    [
      "-e",
      "const x=require('xcode'); const p=x.project('/tmp/synthetic.pbxproj');p.hash={project:{objects:{}}};const id=p.generateUuid(); if(!/^[A-F0-9]{24}$/.test(id))process.exit(1);",
    ],
    { cwd: resolve(__dirname, ".."), timeout: 5000, encoding: "utf8" },
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
});
