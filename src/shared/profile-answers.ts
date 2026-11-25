// Application questions answered from the candidate profile (issue #161). One owner of which form question takes which
// profile fact, and of how a fact picks a dropdown option. Code only: these answers never go to Agy, and a blank fact
// is asked for once and saved to the profile, never guessed (I11).
import type { ApplicationQuestion, CandidateProfile, QuestionAnswer } from "./schemas";

export const PROFILE_FACT_KEYS = ["sponsorship", "workAuthorization", "compensation", "noticePeriod", "relocation", "workArrangement", "location", "heardAbout", "pronouns", "yearsExperience"] as const;
export type ProfileFactKey = (typeof PROFILE_FACT_KEYS)[number];

/** Facts that are also interview logistics: their one owner is `preferences.interview`. The rest live in `preferences.applicationFacts.answers`. */
export const LOGISTICS_FACT_KEYS = ["workAuthorization", "compensation", "noticePeriod", "workArrangement", "location"] as const satisfies readonly ProfileFactKey[];

type FactRule = { key: ProfileFactKey; label: string; example: string; pattern: RegExp };

/** Checked in order: the first rule whose pattern matches the question wins (sponsorship before authorization, relocation before location). */
const RULES: FactRule[] = [
  { key: "sponsorship", label: "Visa sponsorship", example: "No, I don't need sponsorship", pattern: /\bsponsor\w*|\bvisa\b|\bh-?1b\b/i },
  { key: "workAuthorization", label: "Work authorization", example: "Yes, US citizen", pattern: /\bauthori[sz]ed to work|\beligib\w* to work|\bwork authori[sz]ation|\blegally (?:able|allowed|permitted|entitled) to work|\bright to work/i },
  { key: "compensation", label: "Pay expectation", example: "$120,000–$140,000 base", pattern: /\bsalary|\bcompensation|\bpay (?:range|expectations?)|\bdesired pay|\bexpected pay|\bote\b/i },
  { key: "noticePeriod", label: "Start date or notice", example: "Two weeks' notice", pattern: /\bstart date|\bnotice period|\bwhen (?:can|could) you start|\bearliest (?:start|available)|\bavailab\w* to start/i },
  { key: "relocation", label: "Relocation", example: "Yes, open to relocating", pattern: /\brelocat\w*/i },
  { key: "workArrangement", label: "Work setup", example: "Remote or hybrid", pattern: /\bonsite\b|\bon-site\b|\bin-office\b|\bin office\b|\bhybrid\b|\bcommut\w*|\bdays (?:a|per) week in/i },
  { key: "location", label: "Location", example: "Denver, Colorado", pattern: /\bwhere (?:do you|are you|will you) (?:plan|live|located|based|work)|\bwhere are you (?:located|based)|\btime ?zone|\bcurrent(?:ly)? (?:located|location|based)|\bwhat (?:city|state|country) (?:do you|are you)|\bcountry (?:of residence|where you (?:currently )?(?:reside|live))|\bwhere you (?:currently )?(?:reside|live)|\bcurrently reside/i },
  { key: "heardAbout", label: "Where you usually find jobs", example: "Company careers page", pattern: /\bhear about|\bheard about|\bfind (?:this|the|our) (?:job|role|posting|position|opening)|\bfound (?:this|the|our) (?:job|role|posting|position)|\blearn(?:ed)? about (?:this|the|our) (?:job|role|position|opening)/i },
  { key: "pronouns", label: "Pronouns", example: "he/him", pattern: /\bpronouns?\b/i },
  { key: "yearsExperience", label: "Years of experience", example: "6", pattern: /\byears of [\w\s-]{0,30}experience|\bhow many years/i },
];

const RULE = new Map(RULES.map((rule) => [rule.key, rule] as const));

export function factLabel(key: ProfileFactKey): string { return RULE.get(key)!.label; }
export function factExample(key: ProfileFactKey): string { return RULE.get(key)!.example; }

/** The profile fact a question asks for, or null when it asks for something else. */
export function factFor(label: string): ProfileFactKey | null {
  return RULES.find((rule) => rule.pattern.test(label))?.key ?? null;
}

/** The fact's saved value ("" when blank). Location falls back to the identity's location, as the facts sheet does. */
export function profileFact(profile: CandidateProfile | null, key: ProfileFactKey): string {
  if (!profile) return "";
  if (key === "location") return (profile.preferences.interview.location || profile.identity.location || "").trim();
  if ((LOGISTICS_FACT_KEYS as readonly string[]).includes(key)) return (profile.preferences.interview[key as (typeof LOGISTICS_FACT_KEYS)[number]] ?? "").trim();
  return (profile.preferences.applicationFacts.answers[key as keyof CandidateProfile["preferences"]["applicationFacts"]["answers"]] ?? "").trim();
}

const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9$]+/g, " ").trim();

/** Yes or No stated plainly at the start of a fact ("No, I don't need sponsorship", "Yes – US citizen"); null otherwise. */
function yesNo(value: string): "yes" | "no" | null {
  const start = norm(value);
  if (/^yes\b/.test(start)) return "yes";
  if (/^no\b/.test(start)) return "no";
  return null;
}

/** Whether a number falls in the range an option states ("Less than 6 years", "6+", "3-5", "10 or more"); null when it states none. */
function inRange(value: number, option: string): boolean | null {
  const text = option.toLowerCase();
  let match: RegExpExecArray | null;
  if ((match = /(\d+(?:\.\d+)?)\s*(?:-|–|—|to)\s*(\d+(?:\.\d+)?)/.exec(text))) return value >= Number(match[1]) && value <= Number(match[2]);
  if ((match = /(?:less|fewer) than\s*(\d+(?:\.\d+)?)|under\s*(\d+(?:\.\d+)?)|below\s*(\d+(?:\.\d+)?)/.exec(text))) return value < Number(match[1] ?? match[2] ?? match[3]);
  if ((match = /(?:more than|over|above)\s*(\d+(?:\.\d+)?)/.exec(text))) return value > Number(match[1]);
  if ((match = /at least\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:\+|or more|or above|and above|plus|or greater)/.exec(text))) return value >= Number(match[1] ?? match[2]);
  if ((match = /^\D*(\d+(?:\.\d+)?)\D*$/.exec(text))) return value === Number(match[1]);
  return null;
}

/**
 * The option a fact picks, or null when none clearly fits (the user picks then). A number picks the option whose range
 * holds it; Yes/No options follow a fact that starts with Yes or No; other options match when one contains the other as
 * whole words, the longest match winning.
 */
export function chooseOption(value: string, options: string[]): string | null {
  const fact = norm(value);
  if (!fact || !options.length) return null;
  const exact = options.find((option) => norm(option) === fact);
  if (exact) return exact;
  const number = /^\$?\s*(\d+(?:\.\d+)?)\b/.exec(fact);
  if (number && options.some((option) => /\d/.test(option))) {
    const fits = options.filter((option) => inRange(Number(number[1]), option) === true);
    return fits.length === 1 ? fits[0]! : null;
  }
  const answer = yesNo(value);
  if (answer) {
    const match = options.filter((option) => yesNo(option) === answer);
    if (match.length === 1) return match[0]!;
  }
  const padded = ` ${fact} `;
  const contained = options
    .filter((option) => { const text = norm(option); return text.length > 1 && (padded.includes(` ${text} `) || ` ${text} `.includes(padded)); })
    .sort((a, b) => norm(b).length - norm(a).length);
  return contained[0] ?? null;
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

const BLANK_FACT = "Not in your profile yet";

/** A skipped question whose profile fact is blank: what the user types is saved to the profile, not just this job. */
export function isBlankFact(answer: Pick<QuestionAnswer, "decision" | "factKey" | "reason">): boolean {
  return answer.decision === "skip" && Boolean(answer.factKey) && Boolean(answer.reason?.startsWith(BLANK_FACT));
}

/** A skipped form question: the reason says what's missing. */
export function skipAnswer(id: string, reason: string, factKey?: ProfileFactKey): QuestionAnswer {
  return { id, decision: "skip", kind: "other", reason, text: null, notes: [], evidenceIds: [], storyIds: [], words: 0, issues: [], ...(factKey ? { factKey } : {}) };
}

/** The user's own answer for this job (typed, or an option picked). */
export function yourAnswer(id: string, text: string): QuestionAnswer {
  const value = text.trim();
  return { id, decision: "answer", kind: "other", reason: null, text: value, notes: [], evidenceIds: [], storyIds: [], words: words(value), issues: [], source: "you" };
}

/**
 * A logistics or choice question answered from the profile: the fact itself, or the option it picks. A blank fact, or
 * one that fits none of the options, comes back skipped with a reason and the fact's key so it can be filled in place.
 * Questions that ask for no profile fact are skipped for the user to answer.
 */
export function profileAnswer(question: ApplicationQuestion, profile: CandidateProfile | null): QuestionAnswer {
  const key = factFor(question.label);
  const options = question.options ?? [];
  if (!key) return skipAnswer(question.id, options.length ? "Pick the option that fits." : "Answer this one yourself in a line.");
  const value = profileFact(profile, key);
  if (!value) return skipAnswer(question.id, `${BLANK_FACT} (${factLabel(key)}). Add it once and every job uses it.`, key);
  const text = options.length ? chooseOption(value, options) : value;
  if (!text) return skipAnswer(question.id, `Your profile says "${value}"; pick the option that fits.`, key);
  return { id: question.id, decision: "answer", kind: "other", reason: null, text, notes: [], evidenceIds: [], storyIds: [], words: words(text), issues: [], source: "profile", factKey: key };
}

/**
 * Re-applies the profile to a job's form-fact questions (logistics and choices): the user's own answers and anything
 * Agy answered ("Answer anyway") are kept; every other one follows the profile as it is now.
 */
export function withProfileAnswers(questions: ApplicationQuestion[], answers: QuestionAnswer[], profile: CandidateProfile | null): QuestionAnswer[] {
  return questions.flatMap((question) => {
    const current = answers.find((answer) => answer.id === question.id);
    if (!question.logistics || question.force || current?.source === "you") return current ? [current] : [];
    return [profileAnswer(question, profile)];
  });
}
