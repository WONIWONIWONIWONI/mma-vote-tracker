/* Build a fresh repository without copying a campaign's data or issued forecasts. */
const fs = require("node:fs"),
  path = require("node:path");
const M = require("../dist/multi-source.js"),
  { output } = require("./build-config.cjs");
const root = path.resolve(__dirname, "..");
function create(config, destination) {
  M.validateConfig(config);
  if (
    !/^\d{4}-\d\d-\d\d$/.test(config.startsOn) ||
    !Number.isFinite(Date.parse(config.endsAt))
  )
    throw new Error("Set the confirmed voting dates before generation");
  if (config.timezone !== "Asia/Seoul")
    throw new Error("This shell currently uses KST calendar boundaries");
  if (!/^[\w.-]+\/[\w.-]+$/.test(config.repository) || config.branch !== "main")
    throw new Error("Set the new repository and main branch");
  const dest = path.resolve(destination);
  if (fs.existsSync(dest) && fs.readdirSync(dest).length)
    throw new Error(
      "Destination must be empty; existing trackers are never overwritten",
    );
  const put = (file, content) => {
    const target = path.join(dest, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  };
  const copy = (from, to = from) =>
    put(to, fs.readFileSync(path.join(root, from)));
  put("tracker.config.json", JSON.stringify(config, null, 2) + "\n");
  put("dist/config.js", output(config));
  for (const file of [
    "http.js",
    "sources.js",
    "multi-source.js",
    "axis.js",
    "daily.js",
  ])
    copy("dist/" + file);
  for (const file of ["index.html", "multi.css", "multi-app.js"])
    copy("templates/multi-source/" + file, "dist/" + file);
  copy("templates/multi-source/collect.cjs", "collector/collect.cjs");
  copy("scripts/build-config.cjs");
  put(
    "dist/data/multi-history.json",
    JSON.stringify({ schemaVersion: 1, records: [] }),
  );
  put(".gitignore", "node_modules/\nqa-output/\n");
  put(
    ".github/workflows/publish.yml",
    `name: Publish tracker
on:
  workflow_dispatch:
  push:
    branches: [main]
    paths: ['dist/**', 'tracker.config.json', '.github/workflows/publish.yml']
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: false
jobs:
  publish:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deploy.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: node scripts/build-config.cjs
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - uses: actions/deploy-pages@v4
        id: deploy
`,
  );
  put(
    ".github/workflows/collect.yml",
    `name: Collect public votes
on:
  workflow_dispatch:
  schedule:
    - cron: '*/5 * * * *'
permissions:
  contents: write
concurrency:
  group: collector
  cancel-in-progress: false
jobs:
  collect:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
        with:
          ref: main
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      - run: |
          git config user.name 'github-actions[bot]'
          git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
          node collector/collect.cjs --publish
`,
  );
  put(
    "README.md",
    `# ${config.title}\n\nGenerated from VOTE/TRACK. No earlier campaign votes or predictions were copied.\n\n- Edit tracker.config.json; run node scripts/build-config.cjs.\n- Verify every public endpoint, candidate ID mapping and official combination rules before release.\n- Enable GitHub Pages using Actions. Run Collect public votes once, then Publish tracker.\n- The scheduled collector attempts every five minutes; GitHub can delay execution. Browser refresh reads sources directly where CORS allows.\n- Open the site through HTTP(S). If direct reads are blocked, archived observations remain available with their timestamps.\n- Raw-vote totals are unofficial sums, not weighted final scores. Missing/stale/skewed sources suppress totals.\n- The starter has ranking, source contributions, source tabs, zoomable trends and calendar-day totals. Add the detailed gap/forecast panels only after choosing the new contest's pair and validating its model.\n`,
  );
  return dest;
}
if (require.main === module) {
  const args = process.argv.slice(2),
    value = (flag) => args[args.indexOf(flag) + 1];
  if (!args.includes("--config") || !args.includes("--out")) {
    console.error(
      "Usage: node scripts/new-tracker.cjs --config confirmed-config.json --out /empty/new-repo",
    );
    process.exitCode = 1;
  } else
    console.log(
      "Created:",
      create(JSON.parse(fs.readFileSync(value("--config"))), value("--out")),
    );
}
module.exports = { create };
