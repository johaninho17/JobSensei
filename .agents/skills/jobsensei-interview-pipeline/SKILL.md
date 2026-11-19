---
name: jobsensei-interview-pipeline
description: Advance an existing JobSensei job into stage-aware interview preparation or analyze a completed interview from a short company-and-stage prompt.
---

# JobSensei Interview Pipeline

This is the sole owner of interview preparation rules: the One-Pass flow, framing, the knowability test, the question card, and gap questions. `AGENTS.md`, the coach, and the challenge skill point here. Each round's question archetypes and `prep.md` sections live in `references/stage-0N-*.md`. Mock practice belongs to `$jobsensei-interview-coach`; practice labs to `$jobsensei-technical-challenge`.

Do not activate because a pasted JD contains the word `interview`. Never run from screening, matching, resume, cover-letter, or `$jobsensei-application-pipeline` work.

## Resolve The Existing Job

1. Resolve the job by the `AGENTS.md` rule: a `(job: <job-id>)` in the prompt wins; otherwise match company and title in `jobs/*/.sensei/job.json`.
2. Require exactly one job with `.sensei/job.json` and `original_jd.md`. Never create a job from an interview prompt. If none or several match, ask the user.
3. Map the requested stage to one canonical round: `01-recruiter-screen`, `02-hiring-manager`, `03-practical-evaluation`, or `04-final-panel` (team panel, onsite, executive → `04-final-panel`; technical, case, role-play → `03-practical-evaluation`). Prepare only that round. A reported future round goes in `knownProcess`; it does not create a folder.

## One-Pass Flow

Commands use `sensei <command> <args>` (on your PATH).

Paths below are relative to the workspace, where your terminal starts.

1. If `profile/story_bank.md` does not exist, run `.agents/workflows/jobsensei-story-bank.md` first (once per candidate), then continue.
2. Run `sensei interview:context <job-id> <stage>` exactly once.
3. Read `jobs/<job-id>/interviews/.sensei/interview_context.json` once, in a single full read. It holds the JD's required items and responsibilities, the candidate's gaps, citable evidence, the story bank, the candidate's career story and interview voice, logistics from the candidate profile (`profile/candidate.json`), matched role memory, everything earlier rounds already used, and the question limits. Do not read context files, other jobs, or transcripts separately.
4. Company research (owner of this rule): if the context's `companyResearch.path` is set, reuse that file. If `companyResearch.reuseFrom` is set (a recent file from another job at the same company), copy its company, news, and interview-process sections into `interviews/company_research.md` and write the role sections (role decoded, requirement match, words to know, posted pay) fresh for this job, following `references/research.md`. Otherwise, with internet access, write it from scratch.
5. In one file-writing turn, write `interviews/<round-id>/prep.md` and `interviews/<round-id>/question_bank.json` following this skill and the round's stage reference. Never write `question_bank.md`: the app writes it from the JSON.
6. Run `sensei interview:check <job-id> <round-id>` once. It checks the JSON, writes `question_bank.md` from it, validates the files, and registers the round in `interview.json` (the app builds the dashboard from the files; never write `dashboardBrief`). Report its status, duration, and at most five issues, then stop. Do not repair in a loop; a warning is a finished run.

## Framing: honest and strong

- Present real work at its strongest, with the confidence of the candidate's base resume. Say the ownership qualifier once ("not the sole owner of the architecture"), then stop underselling.
- Never invent a scenario, incident, client, metric, tool, duration, or result. A **Proof** or closest real experience cites a story ID (`S3`) or an evidence ID from the context file.
- A hypothetical ("what would you do if…") is answered as an approach, never as "when I did X".
- Gaps are strengths in progress, never apologies: name the gap plainly → the closest real experience → a concrete ramp plan.
- When no story matches a question exactly, answer with the closest real experience as if it were made for the question: say what it was and how it carries over, without hedging. Adjacent experience is fine; invented experience is not.
- When things happened follows the timing rule in the career-evidence skill (owner): current-phase work is "now", everything earlier is past.
- Logistics (location, authorization, compensation, notice, work arrangement) come only from `logistics` in the context file, word for word. A `null` value is written as `⚠ Fill in Settings → Interview Prep` — never guessed, never defaulted.

## Knowability test

Every question and exercise must be answerable by a strong outside candidate using general skill in the field, the JD, and public information.
- Out: the company's internal systems, unreleased products, private architecture, and niche protocols the JD does not list as required.
- Tailor through the JD's responsibilities and required items, translated into generic situations ("a customer's data sync is failing", not the company's product name).
- Public product knowledge belongs in `prep.md` under `## Learn before the interview` (what they sell in one line, who buys it, public docs worth skimming, and a ready "why this company" answer), marked as study, not expected knowledge.

## Question mix: common and pressure

Each round mixes the questions everyone gets for that round (the stage file's archetypes, "tell me about yourself", "why this role") with **pressure questions**, about half of the primary questions. Pressure questions are where candidates lose interviews: they force one specific example, depth, or a decision under constraints. Build them from this posting's own domain, data, customers, and standards (and public research), never from the company's private setup:

- **Compound example:** one real case with two constraints at once (several stakeholders and a deadline; a technical blocker and an unhappy customer).
- **Depth probe** on the posting's hardest must-have, especially a gap, asked at working depth ("a nightly load of <the posting's kind of data> got slow; how do you find out why?"). Answered as an approach plus the closest real use, never "I haven't done that".
- **Failure-mode scenario** in the posting's domain: a data feed that breaks, bad or duplicate records, a security or compliance review that halts go-live, scope creep found in acceptance testing.
- **Pain to product:** a specific customer problem the candidate turned into a change in the product or process.
- **What changed and how you knew:** the outcome or measure behind an example (only what the evidence states).
- **What you'd do differently.**

Pressure cards always carry a **Likely follow-up**: the drill-down a sharp interviewer uses ("give me one specific example", "what was the result?", "you haven't used X; how would what you know carry over?"), with a 2–3 word cue toward the answer.

**Story fit.** A question about customers, clients, or partners is answered with a customer, client, or partner story. A personal project or internal tool answers only questions about the candidate's own projects, learning, or tools. The reverse holds too: a question about tools, AI use, or projects ("how do you use AI?", "what do you build with?", "tell me about a project") is answered with a project or tool story from the evidence or the story bank, and its first Say point names the project and what it does in plain words ("<project>: <what it does>"), never a generic problem the candidate could have had. Pick the story whose situation matches the question (a customer problem that became a feature → that story, not a process description).

## Question card (the only format)

`question_bank.json` holds the round's cards. `primary` must stay inside `questionLimits`; hypotheticals and scenarios are primary questions too. One line per text field; IDs go in `ids`, never in the text.

```json
{
  "schemaVersion": 1,
  "primary": [
    {
      "question": "<question as an interviewer would ask it>?",
      "whyTheyAsk": "<what they are checking, one line>",
      "say": ["<point>", "<point>", "<point>"],
      "proof": { "text": "<one fact the candidate can name, in plain words>", "ids": ["S2"] },
      "approach": ["<step>", "<step>", "<step>"],
      "followUp": { "question": "<the question they will probably ask next>?", "cue": "<2–3 word cue>" },
      "landOn": "<3–6 plain spoken words naming the point to finish on>",
      "careful": "<one scope boundary>"
    }
  ],
  "gaps": [
    {
      "question": "<how an interviewer would raise the gap>?",
      "gap": "<the requirement>",
      "closestExperience": { "text": "<plain-words fact>", "ids": ["S1"] },
      "rampPlan": "<concrete, short>",
      "landOn": "<3–6 words>"
    }
  ],
  "questionsToAsk": ["<question for the interviewer>?"]
}
```

`say` has 3–5 points, each up to 10 words (on experience questions the first point, which names the experience, may run to 15). `proof`, `approach`, `followUp`, and `careful` are left out of a card when the rules below say so.

- **Say** (`say`) points are what the answer is made of. Each names something concrete: a tool, a kind of customer or team, a step taken, or a result from the evidence. "Clear communication" or "technical bridge" alone is not a point; "weekly call with the partner's IT lead" is.
- Experience questions ("tell me about a time", "walk me through a project you led"): the first Say point says what the experience was, in plain words, with who and roughly when ("Oct 2026: partner needed platform on his laptop"); the middle points are what the candidate did; the last point is how it ended. Take these from the story's cues. A listener must know which experience it is from the first point alone.
- Background questions ("walk me through your background", "tell me about yourself"): Say points in order, oldest first, one per employer, school, or phase, each naming it ("Started at <school>, data and AI", "Built <kind of product> at <employer>", "Since <when>: customer-facing at <employer>") → why this role. Never present an earlier phase as current.
- **Proof**: use a story when it honestly answers the question ("tell me about a time", how you work, tools you use), following the story fit rule above. Leave Proof out of motivation and logistics cards, and never attach a story that doesn't answer the question.
- **Your approach** belongs only on hypotheticals and depth probes ("how would you…"). An experience question ("tell me about a time…") is answered with the story, never a process list.
- **Likely follow-up**: always on pressure cards; on the other cards only where an interviewer will most likely push. Common cards (career walkthrough, why this company, why this role) usually have none, so a round never has a follow-up on every card.
- Say points and "Land on" are memory triggers in the candidate's own words (use `voice.phrases`; no corporate rewording). Never full sentences, quotation marks, STAR scripts, or slogans ("full-lifecycle engineer bridge", "fully aligned with role requirements"). Test: would the candidate say these words out loud?
- Gap questions: 1–3 per round from `gaps`. Recruiter: "do you have X?"; hiring manager: "how would you ramp up on X?"; practical: a foundation-level task touching X.
- When `roleMemory` shows interviewers in this role family ask a question (e.g. "why are you leaving", "how do you rate your performance without metrics", "a time you told a customer no"), prepare it in the round it was asked.
- No overlap: never repeat a question, story ID, or reverse question listed in `priorRounds`.

## `prep.md`

Starts with `## 3 things to get across`: the three points this interviewer should remember, each one line of at most 20 plain words pairing one of the JD's top required items with the candidate's strongest true evidence, with the story or evidence ID only in trailing parentheses (`… onboarding partner GPUs (S1)`). No praise words ("proven track record", "solid background"). Then `## Before you start`: the candidate's `voice.deliveryFixes` (at most 3), each at most 8 words ("Answer first, then context"). Then `## Learn before the interview`, then the stage reference's sections. Keep it to one screen per section; no scripts.

Every `prep.md` also has `## Story map`: one line per kind of question this round will ask → the story to use ("a customer problem that became a feature → S5"), so the right story is found in a second. Every story the round's cards use appears once.

## Debrief Mode

A prompt such as `<Company> debrief` analyzes the latest completed round instead of preparing one. Follow `references/debrief.md`.

## Stop Conditions

- Stop after `interview:check` for a preparation request, or after the debrief analysis for a debrief.
- Start a mock only when the user asks to practice.
- Never infer interview success or advance the job from positive interviewer language.
