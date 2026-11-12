# JobSensei Story Bank

## Description

Build or refresh the candidate's personal story bank at `profile/story_bank.md` (workspace-relative; your terminal starts in the workspace): 6–8 true work stories that every interview round picks from. Run once before the first interview prep, or when the user asks to refresh it.

## Steps

1. Read `profile/candidate.json`, the selected structured context (including `context/structured/interview-stories.md` when it exists), and `profile/interview_voice.md` if present. Do not read job folders or transcripts.
2. Choose 6–8 stories from different experiences that together cover these themes: ownership, a hard customer or stakeholder, ambiguity, fast learning, a mistake and recovery, working across teams, technical or functional depth, and bridging a skill gap. Each story covers 2–3 themes; no theme should rest on a single story.
3. Write each story exactly in this format (the app parses it):

```markdown
## S1 · <short title>
- Themes: <theme>, <theme>
- Evidence: <evidence ID>, <evidence ID>
- Cues: <what happened, with who and roughly when> · <what the candidate did> · <what the candidate did> · <how it ended>   (the first cue under 15 words, the others under 10: interview cards reuse them as Say points)
- Framing limit: <how strongly it can be told: what the candidate owned, what they did not, scale>
```

4. Cues tell the story in order: the first cue says what the experience was, with who (described, not named) and roughly when ("spring 2026, a research client wanted…"); the middle cues say what the candidate did; the last cue says how it ended. Use the times of the evidence rows (timing rule in the career-evidence skill). A reader must know which experience it is from the first cue alone.
5. Every story needs at least one real evidence ID. Never invent a detail, metric, client, or outcome; keep the candidate's own qualifiers in the framing limit. Write cues in the candidate's own words (`interview_voice.md` phrases), never full sentences.
6. If the user already has a story bank, keep their edits: add or refresh stories only where the user asked, and never renumber existing IDs.
7. Show the user the list of story titles and stop.

## Command Firewall

No scripts or commands. Read files and write `profile/story_bank.md` only.
