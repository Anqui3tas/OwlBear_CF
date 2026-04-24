const fs = require("fs");
const path = require("path");

const buildDir = path.join(__dirname, "..", "build");
const indexPath = path.join(buildDir, "index.html");
const notFoundPath = path.join(buildDir, "404.html");

fs.copyFileSync(indexPath, notFoundPath);
console.log("Created build/404.html for Cloudflare Pages SPA fallback.");
