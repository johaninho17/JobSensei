#!/usr/bin/env node
// Rewrites tasks/issues.md from GitHub Issues (the owner of the task list).
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { indexMarkdown } from "./issue-lib.mjs";

const issues = JSON.parse(execFileSync("gh", ["issue", "list", "--state", "open", "--limit", "500", "--json", "number,title,state,labels"], { encoding: "utf8" }));
writeFileSync(new URL("../tasks/issues.md", import.meta.url), indexMarkdown(issues));
console.log(`tasks/issues.md: ${issues.length} open issues`);
