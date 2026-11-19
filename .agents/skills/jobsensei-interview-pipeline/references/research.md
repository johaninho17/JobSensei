# Company research (`interviews/company_research.json`)

Written once per job, reused by every round. Short and useful during prep, not an encyclopedia. Write `company_research.json`; never write `company_research.md`: `interview:check` writes it from the JSON and rejects homepage-only sources and "reported" claims without a link.

A **fact** is `{ "text": "...", "source": "<specific page URL>", "accessed": "YYYY-MM-DD" }`. The source is a page, not a homepage. A fact you reasoned out has `"inferred": true` and no source. News facts add `"date"`. One line per text field.

```json
{
  "schemaVersion": 1,
  "roleDecoded": [{ "text": "Answers integration questions from mid-size customers", "source": "original_jd.md" }],
  "requirementMatch": [{ "requirement": "<item from job.requiredItems>", "fit": "met", "evidence": "S2", "cue": "3–8 word cue" }],
  "wordsToKnow": [{ "term": "...", "definition": "one plain line", "link": "<public docs URL>" }],
  "pay": "<posted range word for word, or Not posted>",
  "whatTheySell": [{ "text": "...", "source": "...", "accessed": "..." }],
  "recentNews": [{ "date": "YYYY-MM-DD", "text": "...", "source": "<article URL>", "accessed": "..." }],
  "competitors": "one line",
  "interviewProcess": [{ "text": "...", "source": "...", "accessed": "..." }]
}
```

- `roleDecoded`: what this team does day to day and who it serves, 3–5 facts drawn from the JD's responsibilities (source `original_jd.md`).
- `requirementMatch`: one row per item in `job.requiredItems`; `fit` is `met`, `learnable`, or `gap`. Use the evaluation's must-have status when it exists. Never mark `met` without a real story or evidence ID in `evidence`.
- `wordsToKnow`: 5–10 terms from the JD's stack or domain (e.g. a platform's scripting language, a product category, a regulation), each with a plain definition and a public docs link. These are study items, not things the candidate claims to have used.
- `whatTheySell`: 2–3 facts. `recentNews`: up to 3 dated items, each linking the specific article.
- `interviewProcess`: what is public for this company and level. Candidate reports are anecdotal: at most three, each linked.
- Reusing research from another job at the same company (`companyResearch.reuseFrom`): copy `whatTheySell`, `recentNews`, `competitors`, and `interviewProcess` (from that file's JSON, or its matching Markdown sections), and write the role fields fresh for this job.
