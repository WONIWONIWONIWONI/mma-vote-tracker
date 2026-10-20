const fs = require("node:fs"),
  path = require("node:path"),
  { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const run = (command, args) =>
  execFileSync(command, args, { cwd: root, stdio: "inherit" });
run("node", ["scripts/build-config.cjs", "--check"]);
for (const file of fs
  .readdirSync(path.join(root, "qa"))
  .filter(
    (file) =>
      /^test_.*\.cjs$/.test(file) &&
      !["test_ui.cjs", "test_multi_ui.cjs"].includes(file),
  )
  .sort())
  run("node", ["qa/" + file]);
run("python", ["-m", "unittest", "discover", "-s", "collector"]);
