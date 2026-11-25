// Docs: how to get the most from JobSensei, what each file is for, how Agy uses your data, Agy's commands, and fixes
// for common problems. The text is docs/app/*.md (one owner each), trimmed to this edition at build time.
import { useState } from "react";
import startHere from "../../docs/app/start-here.md?raw";
import yourData from "../../docs/app/your-data.md?raw";
import howAgy from "../../docs/app/how-agy-uses-it.md?raw";
import agyCommands from "../../docs/app/agy-commands.md?raw";
import troubleshooting from "../../docs/app/troubleshooting.md?raw";
import { markdownHtml } from "./markdown";
import { SubTabs, SubTabPanel } from "./SubTabs";
import { PageHead } from "./BentoPrimitives";

const PAGES = [
  { id: "start", label: "Start here", text: startHere },
  { id: "data", label: "Your data", text: yourData },
  { id: "agy", label: "How Agy uses it", text: howAgy },
  { id: "commands", label: "Agy commands", text: agyCommands },
  { id: "help", label: "Troubleshooting", text: troubleshooting },
] as const;
type DocsPage = (typeof PAGES)[number]["id"];

const remembered = (): DocsPage => {
  try { const value = window.localStorage.getItem("sensei-docs-tab"); return PAGES.some((page) => page.id === value) ? value as DocsPage : "start"; } catch { return "start"; }
};

export function DocsView() {
  const [tab, setTab] = useState<DocsPage>(remembered);
  const page = PAGES.find((candidate) => candidate.id === tab)!;
  return <section className="docs-home">
    <PageHead title="Docs" tip="How to get the best from JobSensei, and how Agy uses what you give it." />
    <SubTabs<DocsPage> idPrefix="docs" label="Docs sections" value={tab}
      onChange={(next) => { setTab(next); try { window.localStorage.setItem("sensei-docs-tab", next); } catch { /* storage unavailable */ } }}
      tabs={PAGES.map(({ id, label }) => ({ id, label }))} />
    <SubTabPanel idPrefix="docs" value={tab}>
      <article className="docs-page iv-markdown" dangerouslySetInnerHTML={{ __html: markdownHtml(page.text, [], { readable: true }) }} />
    </SubTabPanel>
  </section>;
}
