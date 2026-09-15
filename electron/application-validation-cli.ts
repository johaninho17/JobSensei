import { basename, resolve } from "node:path";
import { validateJobApplication } from "./application-validation";

function defaultWorkspace(): string {
  const configured = process.env.SENSEI_WORKSPACE;
  if (configured) return resolve(configured);
  return basename(process.cwd()) === "data" ? process.cwd() : resolve(process.cwd(), "data");
}

const jobId = process.argv[2];
const inspectOnly = process.argv.includes("--inspect");
if (!jobId) {
  process.stderr.write(`${JSON.stringify({
    status: "not_ready",
    jobId: "",
    runId: null,
    snapshotId: null,
    manifestHash: null,
    issues: [{
      code: "JOB_ID_MISSING",
      artifact: "command",
      field: "jobId",
      message: "A canonical job ID is required.",
      expected: "npm run application:validate -- <canonical-job-id>",
      actual: null,
      repairHint: "Run the validator with the existing canonical job folder name.",
    }],
  }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  validateJobApplication(defaultWorkspace(), jobId, !inspectOnly)
    .then((report) => {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      if (report.status !== "passed") process.exitCode = 1;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${JSON.stringify({
        status: "not_ready",
        jobId,
        runId: null,
        snapshotId: null,
        manifestHash: null,
        issues: [{
          code: "VALIDATOR_FATAL",
          artifact: "application",
          field: null,
          message: error instanceof Error ? error.message : String(error),
          expected: null,
          actual: null,
          repairHint: "Fix the reported workspace or job-path problem, then rerun the same validation command.",
        }],
      }, null, 2)}\n`);
      process.exitCode = 1;
    });
}
