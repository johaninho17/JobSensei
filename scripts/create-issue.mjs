#!/usr/bin/env node
// Logs a task as a GitHub issue in the project's format, for example a bug found while working on something else.
//   npm run issues:new -- --title "Sidebar text overlaps" --priority P2 --feature FEAT-009 \
//     --problem "Long labels overlap at the default width." --correlates 12,13 [--approach "..."] [--accept "a;b"] [--dry-run]
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { PRIORITIES, featureLabels, issueBody, numberList } from "./issue-lib.mjs";

const { values } = parseArgs({
  options: {
    title: { type: "string" }, priority: { type: "string", default: "P2" }, feature: { type: "string" },
    problem: { type: "string" }, approach: { type: "string" }, accept: { type: "string" },
    "depends-on": { type: "string" }, blocks: { type: "string" }, correlates: { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

try {
  if (!values.title || !values.problem || !values.feature) throw new Error("Needs --title, --feature, and --problem.");
  if (!PRIORITIES.includes(values.priority)) throw new Error(`--priority is one of ${PRIORITIES.join(", ")}.`);
  const features = featureLabels(values.feature);
  const dependsOn = numberList(values["depends-on"]);
  const body = issueBody({
    features, dependsOn, blocks: numberList(values.blocks), correlates: numberList(values.correlates),
    problem: values.problem, approach: values.approach,
    acceptance: String(values.accept ?? "").split(";").map((line) => line.trim()).filter(Boolean),
  });
  const labels = [values.priority, ...features, ...(dependsOn.length ? ["status:blocked"] : [])];
  if (values["dry-run"]) {
    console.log(`Title: ${values.title}\nLabels: ${labels.join(", ")}\n\n${body}`);
  } else {
    const url = execFileSync("gh", ["issue", "create", "--title", values.title, "--body", body, ...labels.flatMap((label) => ["--label", label])], { encoding: "utf8" }).trim();
    console.log(url);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
