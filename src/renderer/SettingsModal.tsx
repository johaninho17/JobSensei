import { useEffect, useState } from "react";
import type { BulletBank, BulletBankItem, CandidateProfile, Settings, VoiceSettings } from "../shared/schemas";
import { deriveVoicePresets } from "../shared/voice-presets";

type SettingsTab = "voice" | "story" | "truth" | "resume" | "bullets" | "identity" | "preview";

type ProfilePreview = { styleRules: string[]; instructions: string[]; baseResumeHasSummary: boolean | null };

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
  const [activeTab, setActiveTab] = useState<SettingsTab>("voice");
  const derivedPresets = deriveVoicePresets(profile);
  const [voice, setVoice] = useState<VoiceSettings>({
    tonePreset: "direct_outcomes",
    customGuidance: "",
    antiSlopStrictness: "aggressive",
    interactiveQuestions: "on_gaps",
    narrativeDepth: "journey_first",
  });
  const [includeSummary, setIncludeSummary] = useState(false);
  const [totalMin, setTotalMin] = useState(10);
  const [totalMax, setTotalMax] = useState(14);
  const [currentMin, setCurrentMin] = useState(6);
  const [currentMax, setCurrentMax] = useState(8);

  // Narrative Pillars (Human Career Story)
  const [turningPoints, setTurningPoints] = useState("");
  const [workingStyle, setWorkingStyle] = useState("");
  const [personalValues, setPersonalValues] = useState("");
  const [transitionSummary, setTransitionSummary] = useState("");
  const [confidentialNamesText, setConfidentialNamesText] = useState("");
  const [boundariesText, setBoundariesText] = useState("");
  const [preview, setPreview] = useState<ProfilePreview | null>(null);

  // Bullet Bank state
  const [bulletBank, setBulletBank] = useState<BulletBank | null>(null);
  const [selectedThemeId, setSelectedThemeId] = useState<string>("solutions_partner_engineering");
  const [newBulletText, setNewBulletText] = useState("");
  const [newBulletEmployer, setNewBulletEmployer] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

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
      setTotalMin(profile.preferences.resume.totalExperienceBullets.min ?? 10);
      setTotalMax(profile.preferences.resume.totalExperienceBullets.max ?? 14);
      setCurrentMin(profile.preferences.resume.currentEmployerBullets.min ?? 6);
      setCurrentMax(profile.preferences.resume.currentEmployerBullets.max ?? 8);

      setTurningPoints(profile.preferences.coverLetter?.narrativePillars?.turningPoints ?? profile.career?.narrativePillars?.turningPoints ?? "");
      setWorkingStyle(profile.preferences.coverLetter?.narrativePillars?.workingStyle ?? profile.career?.narrativePillars?.workingStyle ?? "");
      setPersonalValues(profile.preferences.coverLetter?.narrativePillars?.personalValues ?? profile.career?.narrativePillars?.personalValues ?? "");
      setTransitionSummary(profile.career?.transitionSummary ?? "");
      setConfidentialNamesText((profile.truth?.confidentialNames ?? []).join(", "));
      setBoundariesText((profile.truth?.boundaries ?? []).join("\n"));
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
          totalExperienceBullets: { min: totalMin, max: totalMax },
          currentEmployerBullets: { min: currentMin, max: currentMax },
        },
        coverLetter: {
          ...profile.preferences.coverLetter,
          narrativePillars: {
            turningPoints,
            workingStyle,
            personalValues,
          },
        },
      });
      const withDetails = await window.sensei.profile.updateDetails({
        transitionSummary,
        confidentialNames: confidentialNamesText.split(/[,\n]/).map((name) => name.trim()).filter(Boolean),
        boundaries: boundariesText.split("\n").map((line) => line.trim()).filter(Boolean),
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
    <div className="settings-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="JobSensei Profile and Voice Settings">
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <div>
            <span className="eyebrow">PREFERENCES & VOICE</span>
            <h2>Settings & Profile</h2>
          </div>
          <button className="settings-close-btn" onClick={onClose} aria-label="Close settings">✕</button>
        </div>

        <nav className="settings-nav" role="tablist">
          <button
            role="tab"
            aria-selected={activeTab === "voice"}
            className={activeTab === "voice" ? "is-active" : ""}
            onClick={() => setActiveTab("voice")}
          >
            Tone & Voice
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "story"}
            className={activeTab === "story" ? "is-active" : ""}
            onClick={() => setActiveTab("story")}
          >
            Career Story & Pillars
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "truth"}
            className={activeTab === "truth" ? "is-active" : ""}
            onClick={() => setActiveTab("truth")}
          >
            Truth & Privacy
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "resume"}
            className={activeTab === "resume" ? "is-active" : ""}
            onClick={() => setActiveTab("resume")}
          >
            Resume Tailoring
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "bullets"}
            className={activeTab === "bullets" ? "is-active" : ""}
            onClick={() => setActiveTab("bullets")}
          >
            Reusable Bullet Bank
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "identity"}
            className={activeTab === "identity" ? "is-active" : ""}
            onClick={() => setActiveTab("identity")}
          >
            Identity & Sources
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "preview"}
            className={activeTab === "preview" ? "is-active" : ""}
            onClick={() => setActiveTab("preview")}
          >
            What Agy Sees
          </button>
        </nav>

        <div className="settings-body">
          {activeTab === "voice" && (
            <div className="settings-section">
              <div className="settings-group">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <label className="settings-group-title">Tone & Positioning Presets</label>
                  <span style={{ fontSize: "0.75rem", color: "var(--color-fg-muted)" }}>
                    Generated dynamically from your profile & career discipline
                  </span>
                </div>
                <p className="settings-group-desc">Controls the voice and personality applied to cover letters, interview prep, and narrative summaries.</p>
                <div className="settings-cards-grid">
                  {derivedPresets.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      className={`settings-card ${voice.tonePreset === preset.id ? "is-selected" : ""}`}
                      onClick={() => setVoice({ ...voice, tonePreset: preset.id })}
                    >
                      <strong>{preset.name}</strong>
                      <p style={{ fontWeight: 600, color: "var(--color-fg-primary)", marginBottom: "4px" }}>{preset.tagline}</p>
                      <p>{preset.description}</p>
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-group">
                <label className="settings-group-title">Custom Voice & Tone Guidance (Optional)</label>
                <p className="settings-group-desc">Provide your own voice instructions to customize drafts further (e.g., "Keep sentences punchy and conversational; emphasize commercial deal sizes; avoid jargon").</p>
                <textarea
                  className="settings-textarea"
                  rows={3}
                  value={voice.customGuidance ?? ""}
                  onChange={(e) => setVoice({ ...voice, customGuidance: e.target.value })}
                  placeholder="e.g. Speak candidly, emphasize measurable business impact, and use plain spoken English."
                  style={{
                    width: "100%",
                    background: "var(--color-bg-surface-elevated)",
                    color: "var(--color-fg-primary)",
                    border: "1px solid var(--color-border-subtle)",
                    borderRadius: "6px",
                    padding: "8px 12px",
                    fontSize: "0.85rem",
                    fontFamily: "inherit",
                    resize: "vertical",
                  }}
                />
              </div>

              <div className="settings-group">
                <label className="settings-group-title">Anti-AI Slop Filter</label>
                <p className="settings-group-desc">Enforces strict bans on machine clichés (delve, leverage, tapestry, realm, pivotal, rule-of-three corporate lists).</p>
                <div className="settings-radio-row">
                  <label className="settings-radio-label">
                    <input
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
                <label className="settings-group-title">Cover Letter Narrative Depth</label>
                <p className="settings-group-desc">Determine whether the cover letter is a human journey or technical proof points.</p>
                <div className="settings-radio-row">
                  <label className="settings-radio-label">
                    <input
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
                <label className="settings-group-title">Interactive Clarifying Questions</label>
                <p className="settings-group-desc">When a job introduces adjacent tech domains (e.g. checkout, fintech, compliance), should JobSensei prompt you with multiple-choice questions?</p>
                <div className="settings-radio-row">
                  <label className="settings-radio-label">
                    <input
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

          {activeTab === "story" && (
            <div className="settings-section">
              <div className="settings-group">
                <label className="settings-group-title">Career Story & Narrative Pillars</label>
                <p className="settings-group-desc">
                  JobSensei uses your authentic human journey instead of parroting job descriptions. These three questions define your career transitions, problem-solving ethos, and person-fit across all cover letters and interviews.
                </p>
              </div>

              <div className="settings-group">
                <label className="settings-group-title">Career Direction</label>
                <p className="settings-group-desc">
                  One or two sentences: where your career has been and where you are heading. Agy opens your story with this.
                </p>
                <textarea
                  className="settings-textarea"
                  rows={2}
                  placeholder="e.g., Started in backend development and moved into customer-facing technical work; now looking for solutions roles that keep me close to both the code and the customer."
                  value={transitionSummary}
                  onChange={(e) => setTransitionSummary(e.target.value)}
                />
              </div>

              <div className="settings-group">
                <label className="settings-group-title">1. Career Transitions & Turning Points</label>
                <p className="settings-group-desc">
                  What motivated you to move between roles or step outside your comfort zone? What drives your career choices?
                </p>
                <textarea
                  className="settings-textarea"
                  rows={3}
                  placeholder="e.g., I started my career focused on backend systems and architecture, but transitioned into solutions engineering to combine hands-on technical problem-solving with client-facing strategy."
                  value={turningPoints}
                  onChange={(e) => setTurningPoints(e.target.value)}
                />
              </div>

              <div className="settings-group">
                <label className="settings-group-title">2. Operating Style & Ownership</label>
                <p className="settings-group-desc">
                  When a client, partner, or teammate runs into friction, how do you handle it?
                </p>
                <textarea
                  className="settings-textarea"
                  rows={3}
                  placeholder="e.g., I take proactive ownership of the issue, diagnose the technical root cause alongside internal engineering and external stakeholders, and resolve blockers collaboratively rather than passing off responsibility."
                  value={workingStyle}
                  onChange={(e) => setWorkingStyle(e.target.value)}
                />
              </div>

              <div className="settings-group">
                <label className="settings-group-title">3. Fit as a Person & Core Values</label>
                <p className="settings-group-desc">
                  Who are you as a person? What defines your character and motivation beyond daily task descriptions?
                </p>
                <textarea
                  className="settings-textarea"
                  rows={3}
                  placeholder="e.g., I care about the people on the other side of the problem. I stay with an issue until it's actually fixed, and I'd rather say 'I don't know yet, let me find out' than guess."
                  value={personalValues}
                  onChange={(e) => setPersonalValues(e.target.value)}
                />
              </div>
            </div>
          )}

          {activeTab === "truth" && (
            <div className="settings-section">
              <div className="settings-group">
                <label className="settings-group-title">Clients & Partners Never to Name</label>
                <p className="settings-group-desc">
                  These names never appear in your resume or cover letter. Agy describes them by industry instead (for example, "a global professional-services firm"). Separate names with commas.
                </p>
                <textarea
                  className="settings-textarea"
                  rows={2}
                  placeholder="e.g., Northwind Partners, Contoso Health"
                  value={confidentialNamesText}
                  onChange={(e) => setConfidentialNamesText(e.target.value)}
                />
              </div>
              <div className="settings-group">
                <label className="settings-group-title">Claims I Never Make</label>
                <p className="settings-group-desc">
                  One per line. Agy treats these as hard limits on every application.
                </p>
                <textarea
                  className="settings-textarea"
                  rows={4}
                  placeholder="e.g., Never claim a professional license or certification I don't hold."
                  value={boundariesText}
                  onChange={(e) => setBoundariesText(e.target.value)}
                />
              </div>
            </div>
          )}

          {activeTab === "preview" && (
            <div className="settings-section">
              <div className="settings-group">
                <label className="settings-group-title">What Agy Sees</label>
                <p className="settings-group-desc">
                  Exactly what your saved settings and voice profile give Agy on the next application. Save to refresh.
                </p>
                {preview ? (
                  <>
                    <strong>Voice & story</strong>
                    {preview.styleRules.length ? <ul className="settings-preview-list">{preview.styleRules.map((rule) => <li key={rule}>{rule}</li>)}</ul> : <p className="empty-small">Nothing yet. Fill in Voice and Career Story.</p>}
                    <strong>Rules for every application</strong>
                    <ul className="settings-preview-list">{preview.instructions.map((rule) => <li key={rule}>{rule}</li>)}</ul>
                  </>
                ) : <p className="empty-small">Preview unavailable.</p>}
              </div>
            </div>
          )}

          {activeTab === "resume" && (
            <div className="settings-section">
              <div className="settings-group">
                <label className="settings-group-title">Professional Summary</label>
                <p className="settings-group-desc">
                  Only applies if your base resume already has a summary section. When on, Agy tailors that summary for each job; when off, it stays exactly as written.
                  {preview?.baseResumeHasSummary === false && <> <strong>Your base resume has no summary section, so this setting has no effect.</strong></>}
                </p>
                <label className="settings-toggle-row">
                  <input
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

              <div className="settings-group">
                <label className="settings-group-title">Bullet Density Targets</label>
                <p className="settings-group-desc">Control how many experience bullets are budgeted across your resume.</p>
                <div className="settings-inputs-grid">
                  <label>
                    <span>Total Experience Bullets (Min):</span>
                    <input type="number" min={8} max={20} value={totalMin} onChange={(e) => setTotalMin(Number(e.target.value))} />
                  </label>
                  <label>
                    <span>Total Experience Bullets (Max):</span>
                    <input type="number" min={8} max={20} value={totalMax} onChange={(e) => setTotalMax(Number(e.target.value))} />
                  </label>
                  <label>
                    <span>Current Employer Bullets (Min):</span>
                    <input type="number" min={3} max={10} value={currentMin} onChange={(e) => setCurrentMin(Number(e.target.value))} />
                  </label>
                  <label>
                    <span>Current Employer Bullets (Max):</span>
                    <input type="number" min={3} max={10} value={currentMax} onChange={(e) => setCurrentMax(Number(e.target.value))} />
                  </label>
                </div>
              </div>
            </div>
          )}

          {activeTab === "bullets" && (
            <div className="settings-section">
              <div className="settings-group">
                <label className="settings-group-title">Role Themes & Reusable Bullets</label>
                <p className="settings-group-desc">
                  JobSensei groups target jobs into common themes. Verified bullets saved here are automatically reused across similar jobs to save compute and preserve consistent, proven wording.
                </p>

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
                <label className="settings-group-title">Candidate Identity</label>
                <p className="settings-group-desc">Read dynamically from your local workspace. Never checked into Git.</p>
                <div className="identity-summary-card">
                  <div><span>Full Name:</span> <strong>{profile?.identity.fullName ?? "Not set"}</strong></div>
                  <div><span>Artifact Prefix:</span> <strong>{profile?.identity.artifactPrefix ?? "Candidate"}</strong></div>
                  <div><span>Email:</span> <strong>{profile?.identity.email ?? "Not configured"}</strong></div>
                  <div><span>Location:</span> <strong>{profile?.identity.location ?? "Not configured"}</strong></div>
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
          <button type="button" className="settings-cancel-btn" onClick={onClose}>Close</button>
          <button
            type="button"
            className="settings-save-btn"
            disabled={saving}
            onClick={() => void handleSavePreferences()}
          >
            {saving ? "Saving…" : "Save Preferences"}
          </button>
        </div>
      </div>
    </div>
  );
}
