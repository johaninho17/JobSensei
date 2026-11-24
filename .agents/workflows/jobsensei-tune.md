# JobSensei Tune

## Description

The app found files that are new or changed since the last Tune and listed them in `.sensei/tune/<area>-brief.md`. Read them, compare them with the content the brief lists, and write **suggestions** the user will review. You never edit a content file: the app applies only the suggestions the user picks, with a backup and Undo.

## Steps

1. Read the brief, then only the files it lists: the changed files and the content they may improve.
2. Find what the changed files add: a story, a fact, a sharper claim, the candidate's own qualifier, a phrase they use, a fix to how they come across. Keep to what the files say (`AGENTS.md` owns the truth rule: never invent numbers, experiences, or results).
3. Write `.sensei/tune/<area>.json` (the path the brief names), then stop:

```json
{
  "schemaVersion": 1,
  "area": "<the brief's area>",
  "suggestions": [
    { "operation": "add", "file": "<content file from the brief>", "section": "<heading it goes under>", "text": "<the new line, row, or section>", "reason": "<one line: what's new and where it came from>", "source": "<the changed file it comes from>", "urgency": 3, "impact": 4 }
  ]
}
```

## Suggestions

- `operation`:
  - `add`: something new.
  - `enrich`: the same item with more (a source, a number the candidate gave, their qualifier).
  - `replace`: a better version of an item.
  - `archive`: an item that is now wrong or that the candidate rejected. There is no delete: the old text of a `replace` or `archive` is kept in history. Replace or archive only when the changed files show the new version is better.
- `target` (not for `add`): the item to change. Use a story ID (`S3`), a table row's first cell (an evidence ID), or the first words of a bullet.
- `text`: the full new text in the file's own format: a table row for a table, a bullet for a list, a whole `## S7 · Title` section for a new story. Leave `text` out of `archive`.
- `source`: exactly one of the changed files the brief lists.
- `urgency` 1–5: how soon it matters (an interview coming, a wrong claim). `impact` 1–5: how much it improves applications or prep.
- At most 40 suggestions; the user sees the strongest five at a time. One suggestion per change; never bundle two changes in one.
- Paths as the brief writes them. Never write any other file.

## Command Firewall

No scripts or commands. Read only the files the brief lists; write only the suggestions file.
