import { logisticsUpdate, parseNames, readLogistics, readStoryFields, storyUpdate } from "../shared/profile-fields";
import { IdentityForm, LogisticsForm, PrivateNamesField, StoryFieldsForm, VoiceFileField, type IdentityValues } from "./ProfileFields";
import { BackupSetting } from "./BackupSetting";
import { BrowserSetting } from "./BrowserSetting";
import { PrivacyAndTerms } from "./Privacy";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { EMPTY_INTERVIEW_LOGISTICS, type BulletBank, type BulletBankItem, type CandidateProfile, type InterviewLogistics, type Settings, type VoiceSettings } from "../shared/schemas";
import { deriveVoicePresets } from "../shared/voice-presets";
import { InfoTip } from "./BentoPrimitives";

type SettingsTab = "voice" | "story" | "truth" | "interview" | "resume" | "bullets" | "identity" | "preview" | "privacy";
// Interview prep settings exist only where the edition has interviews (src/shared/edition.ts).
const SETTINGS_TABS: SettingsTab[] = ["voice", "story", "truth", ...(FEATURES.interviews ? ["interview" as const] : []), "resume", "bullets", "identity", "preview"];

type ProfilePreview = { styleRules: string[]; instructions: string[]; baseResumeHasSummary: boolean | null; interviewLogistics: string[]; storyBankPath: string | null };


export function SettingsModal({
  open,
  onClose,
  profile,
  settings,
  onProfileUpdated,
  onSettingsUpdated,
}: {
  open: boolean;
  onClose: () => void;
  profile: CandidateProfile | null;
  settings: Settings;
  onProfileUpdated: (updated: CandidateProfile) => void;
  onSettingsUpdated: (updated: Settings) => void;
}) {
  // The Recruiter Edition keeps only candidate details, tailoring, what Agy sees, and privacy (recruiter plan R8).
  const [activeTab, setActiveTab] = useState<SettingsTab>(FEATURES.candidates ? "identity" : "voice");
  const derivedPresets = deriveVoicePresets(profile);
  const [voice, setVoice] = useState<VoiceSettings>({
    tonePreset: "direct_outcomes",
    customGuidance: "",
    antiSlopStrictness: "aggressive",
    interactiveQuestions: "on_gaps",
    narrativeDepth: "journey_first",
  });
  const [includeSummary, setIncludeSummary] = useState(false);

  // Narrative Pillars (Human Career Story)
  const [turningPoints, setTurningPoints] = useState("");
  // Cover letter length and focus: each candidate's own (defaults 200–280, career story first).
  const [letterFocus, setLetterFocus] = useState<"career-story" | "examples">("career-story");
  const [letterMin, setLetterMin] = useState(200);
  const [letterMax, setLetterMax] = useState(280);
  const [workingStyle, setWorkingStyle] = useState("");
  const [personalValues, setPersonalValues] = useState("");
  const [transitionSummary, setTransitionSummary] = useState("");
  const [confidentialNamesText, setConfidentialNamesText] = useState("");
  const [boundariesText, setBoundariesText] = useState("");
  const [practiceEvidence, setPracticeEvidence] = useState(true);
  const [identity, setIdentity] = useState<IdentityValues>({ fullName: "", artifactPrefix: "", email: "", phone: "", location: "" });
  const [voiceFile, setVoiceFile] = useState<string | null>(null);
  const voiceLoaded = useRef<string | null>(null);
  const voicePath = profile?.sources.applicationVoicePath ?? "context/application_voice_profile.md";
  const [preview, setPreview] = useState<ProfilePreview | null>(null);
  const [logistics, setLogistics] = useState<InterviewLogistics>(EMPTY_INTERVIEW_LOGISTICS);

  // Bullet Bank state
  const [bulletBank, setBulletBank] = useState<BulletBank | null>(null);
  const [selectedThemeId, setSelectedThemeId] = useState<string>("solutions_partner_engineering");
  const [newBulletText, setNewBulletText] = useState("");
  const [newBulletEmployer, setNewBulletEmployer] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  // Focus moves into the dialog on open and returns to the opener on close.
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    return () => opener?.focus?.();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (profile?.preferences) {
      const existingVoice = profile.preferences.voice;
      const initialPreset = existingVoice?.tonePreset && (
        derivedPresets.some((p) => p.id === existingVoice.tonePreset) ||
        ["solutions_consultant", "pragmatic_engineer", "conversational_storyteller", "direct_outcomes", "strategic_partner", "narrative_storyteller"].includes(existingVoice.tonePreset)
      ) ? existingVoice.tonePreset : (derivedPresets[0]?.id ?? "direct_outcomes");

      setVoice(existingVoice ? {
        ...existingVoice,
        tonePreset: initialPreset,
        customGuidance: existingVoice.customGuidance ?? "",
      } : {
        tonePreset: initialPreset,
        customGuidance: "",
        antiSlopStrictness: "aggressive",
        interactiveQuestions: "on_gaps",
        narrativeDepth: "journey_first",
      });
      setIncludeSummary(profile.preferences.resume.includeSummary ?? false);

      // The same reading and saving as the Setup page (src/shared/profile-fields.ts owns both).
      const story = readStoryFields(profile);
      setTurningPoints(story.turningPoints);
      setLetterFocus(profile.preferences.coverLetter?.focus ?? "career-story");
      setLetterMin(profile.preferences.coverLetter?.length?.min ?? 200);
      setLetterMax(profile.preferences.coverLetter?.length?.max ?? 280);
      setWorkingStyle(story.workingStyle);
      setPersonalValues(story.personalValues);
      setTransitionSummary(story.transitionSummary);
      setConfidentialNamesText((profile.truth?.confidentialNames ?? []).join(", "));
      setBoundariesText((profile.truth?.boundaries ?? []).join("\n"));
      setPracticeEvidence(profile.truth?.practiceInterviewsAsEvidence !== false);
      if (!FEATURES.candidates) void window.sensei.files.preview(profile.sources.applicationVoicePath ?? "context/application_voice_profile.md").then((preview) => { voiceLoaded.current = preview.content ?? ""; setVoiceFile(preview.content ?? ""); }).catch(() => setVoiceFile(null));
      setIdentity({ fullName: profile.identity.fullName, artifactPrefix: profile.identity.artifactPrefix, email: profile.identity.email ?? "", phone: profile.identity.phone ?? "", location: profile.identity.location ?? "" });
      setLogistics(readLogistics(profile));
    }
    void window.sensei.profile.preview().then(setPreview).catch(() => setPreview(null));
    setSaveSuccess(false);

    // Load bullet bank
    void window.sensei.bulletBank.get().then((bank) => {
      setBulletBank(bank);
      if (bank.themes[0]) {
        setSelectedThemeId(bank.themes[0].id);
      }
    });
  }, [open, profile]);

  if (!open) return null;

  function onTabKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = SETTINGS_TABS.indexOf(activeTab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? SETTINGS_TABS.length - 1
      : (index + (event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : SETTINGS_TABS.length - 1)) % SETTINGS_TABS.length;
    setActiveTab(SETTINGS_TABS[next]!);
    document.getElementById(`settings-tab-${SETTINGS_TABS[next]}`)?.focus();
  }

  const handleSavePreferences = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      const updated = await window.sensei.profile.updatePreferences({
        ...profile.preferences,
        voice,
        resume: {
          ...profile.preferences.resume,
          includeSummary,
        },
        coverLetter: {
          ...profile.preferences.coverLetter,
          focus: letterFocus,
          length: { min: Math.min(letterMin, letterMax - 20), max: Math.max(letterMax, letterMin + 20) },
          narrativePillars: storyUpdate({ transitionSummary, turningPoints, workingStyle, personalValues }).narrativePillars,
        },
      });
      if (voiceFile !== null && voiceFile.trim() && voiceFile !== voiceLoaded.current) { await window.sensei.profile.saveVoice(voiceFile); voiceLoaded.current = voiceFile; }
      const withDetails = await window.sensei.profile.updateDetails({
        transitionSummary: transitionSummary.trim(),
        confidentialNames: parseNames(confidentialNamesText),
        boundaries: boundariesText.split("\n").map((line) => line.trim()).filter(Boolean),
        practiceInterviewsAsEvidence: practiceEvidence,
        identity,
        interviewLogistics: logisticsUpdate(logistics),
      });
      onProfileUpdated(withDetails ?? updated);
      setPreview(await window.sensei.profile.preview().catch(() => null));
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2500);
    } finally {
      setSaving(false);
    }
  };

  const handleAddBullet = async () => {
    if (!bulletBank || !newBulletText.trim() || !newBulletEmployer.trim()) return;
    const newItem: BulletBankItem = {
      id: `bullet-${Date.now()}`,
      themeId: selectedThemeId,
      employerName: newBulletEmployer.trim(),
      text: newBulletText.trim(),
      evidenceIds: [],
      metrics: [],
      tags: [],
      updatedAt: new Date().toISOString(),
    };
    const nextBank: BulletBank = {
      ...bulletBank,
      bullets: [newItem, ...bulletBank.bullets],
      updatedAt: new Date().toISOString(),
    };
    const saved = await window.sensei.bulletBank.save(nextBank);
    setBulletBank(saved);
    setNewBulletText("");
  };

  const handleDeleteBullet = async (id: string) => {
    if (!bulletBank) return;
    const nextBank: BulletBank = {
      ...bulletBank,
      bullets: bulletBank.bullets.filter((b) => b.id !== id),
      updatedAt: new Date().toISOString(),
    };
    const saved = await window.sensei.bulletBank.save(nextBank);
    setBulletBank(saved);
  };

  const activeBullets = bulletBank?.bullets.filter((b) => b.themeId === selectedThemeId) ?? [];

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
        <div className="settings-header">
          <div>
            <h2 id="settings-title">Settings</h2>
          </div>
          <button className="settings-close-btn" onClick={onClose} aria-label="Close settings">✕</button>
        </div>

        <nav className="settings-nav" role="tablist" aria-label="Settings sections" aria-orientation="vertical" onKeyDown={onTabKeyDown}>
          {!FEATURES.candidates && (          <button
            role="tab"
            id="settings-tab-voice"
            aria-controls="settings-panel"
            tabIndex={activeTab === "voice" ? 0 : -1}
            aria-selected={activeTab === "voice"}
            className={activeTab === "voice" ? "is-active" : ""}
            onClick={() => setActiveTab("voice")}
          >
            Tone and voice
          </button>
          )}
          {!FEATURES.candidates && (          <button
            role="tab"
            id="settings-tab-story"
            aria-controls="settings-panel"
            tabIndex={activeTab === "story" ? 0 : -1}
            aria-selected={activeTab === "story"}
            className={activeTab === "story" ? "is-active" : ""}
            onClick={() => setActiveTab("story")}
          >
            Career story and pillars
          </button>
          )}
          {!FEATURES.candidates && (          <button
            type="button"
            role="tab"
            id="settings-tab-truth"
            aria-controls="settings-panel"
            tabIndex={activeTab === "truth" ? 0 : -1}
            aria-selected={activeTab === "truth"}
            className={activeTab === "truth" ? "is-active" : ""}
            onClick={() => setActiveTab("truth")}
          >
            Truth and privacy
          </button>
          )}
          {FEATURES.interviews && <button
            type="button"
            role="tab"
            id="settings-tab-interview"
            aria-controls="settings-panel"
            tabIndex={activeTab === "interview" ? 0 : -1}
            aria-selected={activeTab === "interview"}
            className={activeTab === "interview" ? "is-active" : ""}
            onClick={() => setActiveTab("interview")}
          >
            Interview prep
          </button>}
          <button
            role="tab"
            id="settings-tab-resume"
            aria-controls="settings-panel"
            tabIndex={activeTab === "resume" ? 0 : -1}
            aria-selected={activeTab === "resume"}
            className={activeTab === "resume" ? "is-active" : ""}
            onClick={() => setActiveTab("resume")}
          >
            Resume tailoring
          </button>
          {!FEATURES.candidates && (          <button
            role="tab"
            id="settings-tab-bullets"
            aria-controls="settings-panel"
            tabIndex={activeTab === "bullets" ? 0 : -1}
            aria-selected={activeTab === "bullets"}
            className={activeTab === "bullets" ? "is-active" : ""}
            onClick={() => setActiveTab("bullets")}
          >
            Reusable bullet bank
          </button>
          )}
          <button
            role="tab"
            id="settings-tab-identity"
            aria-controls="settings-panel"
            tabIndex={activeTab === "identity" ? 0 : -1}
            aria-selected={activeTab === "identity"}
            className={activeTab === "identity" ? "is-active" : ""}
            onClick={() => setActiveTab("identity")}
          >
            {FEATURES.candidates ? "Candidate details" : "Identity and sources"}
          </button>
          <button
            type="button"
            role="tab"
            id="settings-tab-preview"
            aria-controls="settings-panel"
            tabIndex={activeTab === "preview" ? 0 : -1}
            aria-selected={activeTab === "preview"}
            className={activeTab === "preview" ? "is-active" : ""}
            onClick={() => setActiveTab("preview")}
          >
            What Agy sees
          </button>
          <button
            type="button"
            role="tab"
            id="settings-tab-privacy"
            aria-controls="settings-panel"
            tabIndex={activeTab === "privacy" ? 0 : -1}
            aria-selected={activeTab === "privacy"}
            className={activeTab === "privacy" ? "is-active" : ""}
            onClick={() => setActiveTab("privacy")}
          >
            Privacy and data
          </button>
        </nav>

        <div className="settings-body" role="tabpanel" id="settings-panel" aria-labelledby={`settings-tab-${activeTab}`}>
          {!FEATURES.candidates && activeTab === "voice" && (
            <div className="settings-section">
              <div className="settings-group">
                {/* One dropdown with the chosen preset's one-line summary (#243). */}
                <h3 className="settings-group-title" id="settings-tone-and-positioning-presets">Tone preset <InfoTip label="About tone presets"><p>Made from your profile and field. Sets the voice of cover letters, interview prep, and summaries.</p></InfoTip></h3>
                <select className="settings-select" aria-labelledby="settings-tone-and-positioning-presets" value={derivedPresets.some((preset) => preset.id === voice.tonePreset) ? voice.tonePreset : ""} onChange={(event) => setVoice({ ...voice, tonePreset: event.target.value as typeof voice.tonePreset })}>
                  {!derivedPresets.some((preset) => preset.id === voice.tonePreset) && <option value="" disabled>Choose a preset</option>}
                  {derivedPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                </select>
                {(() => { const chosen = derivedPresets.find((preset) => preset.id === voice.tonePreset); return chosen ? <p className="settings-preset-line">{chosen.tagline}</p> : null; })()}
              </div>

              {voiceFile !== null && <div className="settings-group">
                <h3 className="settings-group-title" id="settings-writing-voice">Your writing voice</h3>
                <VoiceFileField path={voicePath} value={voiceFile} onChange={setVoiceFile} />
              </div>}

              <div className="settings-group">
                <h3 className="settings-group-title" id="settings-custom-voice-and-tone-guidance-optional">Custom voice and tone guidance (optional) <InfoTip label="About custom voice and tone guidance (optional)"><p>Provide your own voice instructions to customize drafts further (e.g., "Keep sentences punchy and conversational; emphasize commercial deal sizes; avoid jargon").</p></InfoTip></h3>
                
                <textarea aria-labelledby="settings-custom-voice-and-tone-guidance-optional"
                  className="settings-textarea"
                  rows={3}
                  value={voice.customGuidance ?? ""}
                  onChange={(e) => setVoice({ ...voice, customGuidance: e.target.value })}
                  placeholder="e.g. Speak candidly, emphasize measurable business impact, and use plain spoken English."
                  style={{
                    width: "100%",
                    background: "var(--raised)",
                    color: "var(--ink)",
                    border: "1px solid var(--line)",
                    borderRadius: "6px",
                    padding: "8px 12px",
                    fontSize: "0.85rem",
                    fontFamily: "inherit",
                    resize: "vertical",
                  }}
                />
              </div>

              <div className="settings-group">
                <h3 className="settings-group-title" id="settings-anti-ai-slop-filter">Anti-AI slop filter <InfoTip label="About anti-ai slop filter"><p>Enforces strict bans on machine clichés (delve, leverage, tapestry, realm, pivotal, rule-of-three corporate lists).</p></InfoTip></h3>
                
                <div className="settings-radio-row">
                  <label className="settings-radio-label">
                    <input aria-labelledby="settings-anti-ai-slop-filter"
                      type="radio"
                      name="slopStrictness"
                      checked={voice.antiSlopStrictness === "aggressive"}
                      onChange={() => setVoice({ ...voice, antiSlopStrictness: "aggressive" })}
                    />
                    <span><strong>Aggressive (Recommended)</strong> — Strips all known LLM clichés and enforces natural human phrasing</span>
                  </label>
                  <label className="settings-radio-label">
                    <input
                      type="radio"
                      name="slopStrictness"
                      checked={voice.antiSlopStrictness === "standard"}
                      onChange={() => setVoice({ ...voice, antiSlopStrictness: "standard" })}
                    />
                    <span><strong>Standard</strong> — Bans obvious corporate buzzwords only</span>
                  </label>
                </div>
              </div>

              <div className="settings-group">
                <h3 className="settings-group-title" id="settings-cover-letter-narrative-depth">Cover letter narrative depth <InfoTip label="About cover letter narrative depth"><p>Determine whether the cover letter is a human journey or technical proof points.</p></InfoTip></h3>
                
                <div className="settings-radio-row">
                  <label className="settings-radio-label">
                    <input aria-labelledby="settings-cover-letter-narrative-depth"
                      type="radio"
                      name="narrativeDepth"
                      checked={voice.narrativeDepth === "journey_first"}
                      onChange={() => setVoice({ ...voice, narrativeDepth: "journey_first" })}
                    />
                    <span><strong>Narrative Journey-First (Recommended)</strong> — 3-Act Arc (Hook, Trajectory & Motivation, Standout Proof Point). Never a mini-resume.</span>
                  </label>
                  <label className="settings-radio-label">
                    <input
                      type="radio"
                      name="narrativeDepth"
                      checked={voice.narrativeDepth === "balanced"}
                      onChange={() => setVoice({ ...voice, narrativeDepth: "balanced" })}
                    />
                    <span><strong>Balanced</strong> — Equal weighting between career evolution and technical implementation</span>
                  </label>
                </div>
              </div>

              <div className="settings-group">
                <h3 className="settings-group-title" id="settings-interactive-clarifying-questions">Interactive clarifying questions <InfoTip label="About interactive clarifying questions"><p>When a job introduces adjacent tech domains (e.g. checkout, fintech, compliance), should JobSensei prompt you with multiple-choice questions?</p></InfoTip></h3>
                
                <div className="settings-radio-row">
                  <label className="settings-radio-label">
                    <input aria-labelledby="settings-interactive-clarifying-questions"
                      type="radio"
                      name="interactiveQuestions"
                      checked={voice.interactiveQuestions === "on_gaps"}
                      onChange={() => setVoice({ ...voice, interactiveQuestions: "on_gaps" })}
                    />
                    <span><strong>Ask on Domain Gaps (Recommended)</strong> — Prompts 1–2 strategic questions when adjacent skills appear</span>
                  </label>
                  <label className="settings-radio-label">
                    <input
                      type="radio"
                      name="interactiveQuestions"
                      checked={voice.interactiveQuestions === "always"}
                      onChange={() => setVoice({ ...voice, interactiveQuestions: "always" })}
                    />
                    <span><strong>Always Ask</strong> — Prompts alignment questions for every new application</span>
                  </label>
                  <label className="settings-radio-label">
                    <input
                      type="radio"
                      name="interactiveQuestions"
                      checked={voice.interactiveQuestions === "never"}
                      onChange={() => setVoice({ ...voice, interactiveQuestions: "never" })}
                    />
                    <span><strong>Silent (Auto-pilot)</strong> — Never prompts; uses existing records automatically</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {!FEATURES.candidates && activeTab === "story" && (
            <div className="settings-section">
              <div className="settings-group">
                <h3 className="settings-group-title" id="settings-career-story-and-narrative-pillars">Career story and narrative pillars <InfoTip label="About career story and narrative pillars"><p>
                  JobSensei uses your authentic human journey instead of parroting job descriptions. These three questions define your career transitions, problem-solving ethos, and person-fit across all cover letters and interviews.
                </p></InfoTip></h3>
                
              </div>

              <div className="settings-group">
                <h3 className="settings-group-title" id="settings-cover-letter-shape">Cover letter <InfoTip label="About cover letter"><p>
                  What carries your letters, and how long they are. Career story first tells where you started, why you moved, and how you work now; examples first tells one or two real situations. The longest letter allowed is your maximum plus 50 words.
                </p></InfoTip></h3>
                
                <div className="segmented" role="group" aria-labelledby="settings-cover-letter-shape">
                  <button type="button" aria-pressed={letterFocus === "career-story"} onClick={() => setLetterFocus("career-story")}>Career story first</button>
                  <button type="button" aria-pressed={letterFocus === "examples"} onClick={() => setLetterFocus("examples")}>Examples first</button>
                </div>
                <div className="settings-inline-fields">
                  <label>Shortest (words)<input type="number" min={80} max={800} step={10} value={letterMin} onChange={(e) => setLetterMin(Number(e.target.value) || 200)} /></label>
                  <label>Longest (words)<input type="number" min={100} max={900} step={10} value={letterMax} onChange={(e) => setLetterMax(Number(e.target.value) || 280)} /></label>
                </div>
              </div>

              <div className="settings-group">
                <h3 className="settings-group-title" id="settings-career-story">Career story</h3>
                <StoryFieldsForm values={{ transitionSummary, turningPoints, workingStyle, personalValues }} onChange={(next) => { setTransitionSummary(next.transitionSummary); setTurningPoints(next.turningPoints); setWorkingStyle(next.workingStyle); setPersonalValues(next.personalValues); }} />
              </div>
            </div>
          )}

          {!FEATURES.candidates && activeTab === "truth" && (
            <div className="settings-section">
              <div className="settings-group">
                <h3 className="settings-group-title" id="settings-private-names">Private names</h3>
                <PrivateNamesField value={confidentialNamesText} onChange={setConfidentialNamesText} />
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title" id="settings-claims-i-never-make">Claims I never make <InfoTip label="About claims i never make"><p>
                  One per line. Agy treats these as hard limits on every application.
                </p></InfoTip></h3>
                
                <textarea aria-labelledby="settings-claims-i-never-make"
                  className="settings-textarea"
                  rows={4}
                  placeholder="e.g., Never claim a professional license or certification I don't hold."
                  value={boundariesText}
                  onChange={(e) => setBoundariesText(e.target.value)}
                />
              </div>
              {FEATURES.interviews && <div className="settings-group">
                <h3 className="settings-group-title" id="settings-practice-evidence">Practice interviews <InfoTip label="About practice interviews"><p>
                  Stories you told in practice (mock) interviews can back drafts once you confirm them into your interview stories. Turn this off to keep practice interviews for interview voice and practice only. A mock interviewer's feedback never counts.
                </p></InfoTip></h3>
                
                <label className="search-check"><input type="checkbox" checked={practiceEvidence} onChange={(e) => setPracticeEvidence(e.target.checked)} />Practice interviews count as career evidence</label>
              </div>}
            </div>
          )}

          {FEATURES.interviews && activeTab === "interview" && (
            <div className="settings-section">
              <div className="settings-group">
                <h3 className="settings-group-title" id="settings-interview-logistics">Interview logistics</h3>
                <LogisticsForm values={logistics} onChange={setLogistics} />
              </div>
              <div className="settings-group">
                <h3 className="settings-group-title" id="settings-story-bank">Story bank <InfoTip label="About story bank"><p>
                  6–8 true stories every interview round picks from. Agy builds it the first time you prepare an interview; you edit the file directly.
                </p></InfoTip></h3>
                
                {preview?.storyBankPath ? (
                  <button type="button" className="secondary-btn" onClick={() => void window.sensei.files.reveal(preview.storyBankPath!)}>
                    Open story bank
                  </button>
                ) : <p className="empty-small">No story bank yet. It is created on your first interview prep.</p>}
              </div>
            </div>
          )}

          {activeTab === "privacy" && <div className="settings-section"><BrowserSetting />{!FEATURES.candidates && <BackupSetting />}<PrivacyAndTerms /></div>}
          {activeTab === "preview" && (
            <div className="settings-section">
              <div className="settings-group">
                <h3 className="settings-group-title" id="settings-what-agy-sees">What Agy sees <InfoTip label="About what agy sees"><p>
                  Exactly what your saved settings and voice profile give Agy on the next application. Save to refresh.
                </p></InfoTip></h3>
                
                {preview ? (
                  <>
                    <strong>Voice & story</strong>
                    {preview.styleRules.length ? <ul className="settings-preview-list">{preview.styleRules.map((rule) => <li key={rule}>{rule}</li>)}</ul> : <p className="empty-small">Nothing yet. Fill in Voice and Career Story.</p>}
                    <strong>Rules for every application</strong>
                    <ul className="settings-preview-list">{preview.instructions.map((rule) => <li key={rule}>{rule}</li>)}</ul>
                    <strong>Interview logistics</strong>
                    <ul className="settings-preview-list">{preview.interviewLogistics.map((line) => <li key={line}>{line}</li>)}</ul>
                  </>
                ) : <p className="empty-small">Preview unavailable.</p>}
              </div>
            </div>
          )}

          {activeTab === "resume" && (
            <div className="settings-section">
              <div className="settings-group">
                <h3 className="settings-group-title" id="settings-professional-summary">Professional summary <InfoTip label="About professional summary"><p>
                  Only applies if your base resume already has a summary section. When on, Agy tailors that summary for each job; when off, it stays exactly as written.
                  {preview?.baseResumeHasSummary === false && <> <strong>Your base resume has no summary section, so this setting has no effect.</strong></>}
                </p></InfoTip></h3>
                
                <label className="settings-toggle-row">
                  <input aria-labelledby="settings-professional-summary"
                    type="checkbox"
                    checked={includeSummary}
                    onChange={(e) => setIncludeSummary(e.target.checked)}
                  />
                  <span>
                    <strong>Include Professional Summary</strong>
                    <small>Default is OFF. Agy never adds a summary your base resume doesn't have.</small>
                  </span>
                </label>
              </div>

              <p className="settings-group-desc">Length and bullets follow your base resume: each job keeps its number of bullets, and the resume keeps its number of pages.</p>
            </div>
          )}

          {!FEATURES.candidates && activeTab === "bullets" && (
            <div className="settings-section">
              <div className="settings-group">
                <h3 className="settings-group-title" id="settings-role-themes-and-reusable-bullets">Role themes and reusable bullets <InfoTip label="About role themes and reusable bullets"><p>
                  JobSensei groups target jobs into common themes. Verified bullets saved here are automatically reused across similar jobs to save compute and preserve consistent, proven wording.
                </p></InfoTip></h3>
                

                <div className="settings-theme-selector">
                  {bulletBank?.themes.map((theme) => (
                    <button
                      key={theme.id}
                      type="button"
                      className={`theme-chip ${selectedThemeId === theme.id ? "is-active" : ""}`}
                      onClick={() => setSelectedThemeId(theme.id)}
                    >
                      {theme.label}
                    </button>
                  ))}
                </div>

                <div className="add-bullet-card">
                  <h4>Add Verified Bullet for {bulletBank?.themes.find((t) => t.id === selectedThemeId)?.label}</h4>
                  <div className="add-bullet-inputs">
                    <input
                      type="text"
                      placeholder="Employer (e.g. Acme Corp, Meridian)"
                      value={newBulletEmployer}
                      onChange={(e) => setNewBulletEmployer(e.target.value)}
                    />
                    <textarea
                      placeholder="Verified action bullet (e.g. Deconstructed complex customer requirements into production-ready architectures...)"
                      rows={3}
                      value={newBulletText}
                      onChange={(e) => setNewBulletText(e.target.value)}
                    />
                    <button type="button" className="primary-action-btn" onClick={() => void handleAddBullet()}>+ Add Bullet to Theme</button>
                  </div>
                </div>

                <div className="bullet-bank-list">
                  <h4>Saved Bullets in Theme ({activeBullets.length})</h4>
                  {activeBullets.length === 0 ? (
                    <p className="empty-small">No bullets saved for this theme yet. Add one above or let JobSensei populate verified bullets during application runs.</p>
                  ) : (
                    activeBullets.map((bullet) => (
                      <div key={bullet.id} className="bullet-bank-item">
                        <div className="bullet-item-content">
                          <strong>{bullet.employerName}</strong>
                          <p>{bullet.text}</p>
                        </div>
                        <button
                          type="button"
                          className="bullet-delete-btn"
                          aria-label="Delete bullet"
                          onClick={() => void handleDeleteBullet(bullet.id)}
                        >
                          ✕
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === "identity" && (
            <div className="settings-section">
              <div className="settings-group">
                <h3 className="settings-group-title" id="settings-candidate-identity">Candidate identity <InfoTip label="About candidate identity"><p>{FEATURES.candidates ? "From the candidate's folder on this computer." : "Used on every resume, cover letter, and file name. Saved in your workspace on this computer."}</p></InfoTip></h3>
                
                <IdentityForm values={identity} onChange={setIdentity} />
                <div className="identity-summary-card">
                  <div><span>Base Resume:</span> <strong>{settings.baseResumePath ?? "None selected"}</strong></div>
                </div>
                <div className="identity-actions">
                  <button type="button" className="secondary-btn" onClick={() => void window.sensei.settings.chooseResume("base").then(onSettingsUpdated)}>
                    Change Base Resume File
                  </button>
                  <button type="button" className="secondary-btn" onClick={() => void window.sensei.settings.chooseResume("secondary").then(onSettingsUpdated)}>
                    Add Secondary Resume File
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="settings-footer">
          {saveSuccess && <span className="settings-success-indicator">✓ Preferences saved</span>}
          <button
            type="button"
            className="settings-save-btn"
            disabled={saving}
            onClick={() => void handleSavePreferences()}
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </div>
    </div>
  );
}
