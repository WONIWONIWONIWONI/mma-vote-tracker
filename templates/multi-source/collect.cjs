/* One independent public read per source. Schedule this on a server or Actions. */
const fs = require("node:fs"),
  path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const M = require("../dist/multi-source.js"),
  S = require("../dist/sources.js"),
  HTTP = require("../dist/http.js");
async function collect(
  config,
  previous = { schemaVersion: 1, records: [] },
  request = HTTP.json,
  now = Date.now,
) {
  M.validateConfig(config);
  const clock = () => (typeof now === "function" ? now() : now);
  if (clock() >= Date.parse(config.endsAt))
    return {
      ...previous,
      collector: {
        state: "stopped",
        checkedAt: new Date(clock()).toISOString(),
      },
    };
  const results = await Promise.all(
    config.sources.map(async (source) => {
      try {
        if (!source.endpoint) throw new Error("Source endpoint not configured");
        const payload = await request(source.endpoint, { timeout: 15000 });
        return {
          sourceId: source.id,
          record: S.parse(source, payload, new Date(clock()).toISOString()),
          state: "ok",
        };
      } catch (error) {
        return { sourceId: source.id, state: "error", message: error.message };
      }
    }),
  );
  return {
    schemaVersion: 1,
    records: M.mergeRecords(
      previous.records,
      results.flatMap((result) => (result.record ? [result.record] : [])),
    ),
    collector: {
      state: results.every((result) => result.state === "ok")
        ? "ok"
        : "partial",
      checkedAt: new Date(clock()).toISOString(),
      sources: results.map(({ record, ...result }) => result),
    },
  };
}
function write(target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target + ".tmp", JSON.stringify(value));
  fs.renameSync(target + ".tmp", target);
}
function publish(target) {
  const file = "dist/data/multi-history.json",
    git = (...args) =>
      execFileSync("git", args, {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
  git("add", file);
  if (!git("diff", "--cached", "--name-only").trim()) return;
  git("commit", "-m", "data: record source observations");
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      git("push");
      return;
    } catch (error) {
      if (attempt === 2) throw error;
    }
    const pending = JSON.parse(fs.readFileSync(target));
    git("fetch", "origin", "main");
    try {
      git("rebase", "origin/main");
    } catch (error) {
      const conflicts = git("diff", "--name-only", "--diff-filter=U")
        .trim()
        .split("\n");
      if (conflicts.length !== 1 || conflicts[0] !== file) {
        git("rebase", "--abort");
        throw error;
      }
      const remote = JSON.parse(git("show", "origin/main:" + file));
      const collector =
        Date.parse(remote.collector?.checkedAt) >
        Date.parse(pending.collector?.checkedAt)
          ? remote.collector
          : pending.collector;
      write(target, {
        schemaVersion: 1,
        records: M.mergeRecords(pending.records, remote.records),
        collector,
      });
      git("add", file);
      git(
        "-c",
        "core.editor=true",
        "rebase",
        git("diff", "--cached", "--name-only").trim() ? "--continue" : "--skip",
      );
    }
  }
}
if (require.main === module) {
  const config = JSON.parse(
      fs.readFileSync(path.join(root, "tracker.config.json")),
    ),
    target = path.join(root, "dist/data/multi-history.json");
  const previous = fs.existsSync(target)
    ? JSON.parse(fs.readFileSync(target))
    : { schemaVersion: 1, records: [] };
  collect(config, previous)
    .then((value) => {
      write(target, value);
      if (process.argv.includes("--publish")) publish(target);
      console.log("Source states:", value.collector);
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
module.exports = { collect };
