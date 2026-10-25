# JobSensei Story Bank

## Description

Build or refresh the candidate's personal story bank at `data/profile/story_bank.md`: 6–8 true work stories that every interview round picks from. Run once before the first interview prep, or when the user asks to refresh it.

## Steps

1. Read `data/profile/candidate.json`, the selected structured context (including `context/structured/interview-stories.md` when it exists), and `data/profile/interview_voice.md` if present. Do not read job folders or transcripts.
2. Choose 6–8 stories from different experiences that together cover these themes: ownership, a hard customer or stakeholder, ambiguity, fast learning, a mistake and recovery, working across teams, technical or functional depth, and bridging a skill gap. Each story covers 2–3 themes; no theme should rest on a single story.
3. Write each story exactly in this format (the app parses it):

```markdown
## S1 · <short title>
- Themes: <theme>, <theme>
- Evidence: <evidence ID>, <evidence ID>
- Cues: <3–8 words> · <3–8 words> · <3–8 words>
- Framing limit: <how strongly it can be told: what the candidate owned, what they did not, scale>
```

4. Every story needs at least one real evidence ID. Never invent a detail, metric, client, or outcome; keep the candidate's own qualifiers in the framing limit. Write cues in the candidate's own words (`interview_voice.md` phrases), never full sentences.
5. If the user already has a story bank, keep their edits: add or refresh stories only where the user asked, and never renumber existing IDs.
6. Show the user the list of story titles and stop.

## Command Firewall

No scripts or commands. Read files and write `data/profile/story_bank.md` only.
