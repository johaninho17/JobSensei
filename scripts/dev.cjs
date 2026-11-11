// `npm run dev` for either edition: the dev server runs on the edition's own port (src/shared/edition.ts owns it,
// read from the copy `predev` compiles), so the regular and Recruiter editions can run side by side.
const { spawn } = require("node:child_process");
const { join } = require("node:path");

const { EDITION_INFO, parseEdition } = require(join(__dirname, "..", "dist-electron", "src", "shared", "edition.js"));
const port = EDITION_INFO[parseEdition(process.env.JOBSENSEI_EDITION)].devPort;
const command = `concurrently -k "vite --host 127.0.0.1 --port ${port} --strictPort" "wait-on http-get://127.0.0.1:${port} && electron . --dev"`;
const child = spawn(command, { stdio: "inherit", shell: true, env: process.env });
child.on("exit", (code) => process.exit(code ?? 0));
