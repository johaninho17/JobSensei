#!/usr/bin/env node
// Fails when a commit or PR title is not `<type>(<scope>): <summary> (refs #N)`. Used by CI on pull requests.
import { SCOPES, TITLE_PATTERN, TYPES } from "./issue-lib.mjs";

const title = process.argv[2] ?? "";
if (!TITLE_PATTERN.test(title)) {
  console.error(`Title "${title}" should look like: fix(workspace): open role links in the browser (refs #4)\nTypes: ${TYPES.join(", ")}\nScopes: ${SCOPES.join(", ")}`);
  process.exit(1);
}
