import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const jobsRoot = join(process.cwd(), "data", "jobs");
let created = 0;

const entries = await readdir(jobsRoot, { withFileTypes: true }).catch(() => []);
for (const entry of entries) {
  if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
  const jobRoot = join(jobsRoot, entry.name);
  const sourcePath = join(jobRoot, "original_jd.txt");
  const markdownPath = join(jobRoot, "original_jd.md");
  if (!(await stat(sourcePath).catch(() => null))?.isFile()) continue;
  if ((await stat(markdownPath).catch(() => null))?.isFile()) continue;

  const source = (await readFile(sourcePath, "utf8")).replaceAll("\r\n", "\n").trim();
  const markdown = `# Original Job Description\n\n${source}\n`;
  await writeFile(markdownPath, markdown, "utf8");
  created += 1;
  console.log(`Created ${markdownPath}`);
}

console.log(`JD Markdown migration complete: ${created} file${created === 1 ? "" : "s"} created. Original TXT sources were preserved.`);
