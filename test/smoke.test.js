const test = require("node:test");
const assert = require("node:assert/strict");

test("project exposes required files", async () => {
  const fs = require("node:fs/promises");
  const files = [
    "server.js",
    "public/index.html",
    "public/app.js",
    "public/styles.css",
    ".env.example",
    "README.md"
  ];

  for (const file of files) {
    const stat = await fs.stat(file);
    assert.equal(stat.isFile(), true, `${file} should exist`);
  }
});

test("source does not contain the live Hunar key prefix", async () => {
  const fs = require("node:fs/promises");
  const path = require("node:path");
  const files = [
    "server.js",
    "public/index.html",
    "public/app.js",
    ".env.example",
    "README.md"
  ];

  for (const file of files) {
    const contents = await fs.readFile(path.join(process.cwd(), file), "utf8");
    assert.equal(contents.includes("hunar_va_live_sk_"), false, `${file} must not contain live key material`);
  }
});
