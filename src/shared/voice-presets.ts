import type { CandidateProfile, VoicePreset } from "./schemas";

export function getUniversalPresets(): VoicePreset[] {
  return [
    {
      id: "direct_outcomes",
      name: "Direct & Results-Driven Operator",
      tagline: "Clear, concise, and focused on execution",
      description: "Focuses on concrete actions, measurable results, accountability, and operational excellence. Zero corporate fluff.",
      toneGuidance: "Direct, professional, outcome-focused, and concise. State actions, evidence, and results plainly without decorative filler.",
    },
    {
      id: "strategic_partner",
      name: "Strategic & Cross-Functional Partner",
      tagline: "Consultative, collaborative, and aligned",
      description: "Bridges diverse stakeholder needs, organizational vision, and practical multi-disciplinary delivery.",
      toneGuidance: "Consultative, collaborative, and strategic. Emphasize partnership, stakeholder alignment, and sustainable outcomes.",
    },
    {
      id: "narrative_storyteller",
      name: "Narrative & Mission-Driven Storyteller",
      tagline: "Authentic, engaging, and journey-focused",
      description: "Tells a compelling career story connecting foundational roots, core motivations, and why this role is the next chapter.",
      toneGuidance: "Authentic, human-first, engaging, and reflective. Trace genuine career motivation and the underlying reasons behind moves.",
    },
  ];
}

export function deriveVoicePresets(profile: CandidateProfile | null): VoicePreset[] {
  if (!profile) return getUniversalPresets();

  const roleFamilies = (profile.career?.preferredRoleFamilies ?? []).map((f) => f.toLowerCase()).join(" ");
  const transition = (profile.career?.transitionSummary ?? "").toLowerCase();
  const titles = (profile.career?.employers ?? []).map((e) => e.title.toLowerCase()).join(" ");
  const combined = `${roleFamilies} ${transition} ${titles}`;

  // HR / People / Talent / Recruiting
  if (/(?:people|hr|talent|recruiting|human resources|culture|people operations)/.test(combined)) {
    return [
      {
        id: "people_strategy",
        name: "People & Culture Strategist",
        tagline: "Strategic, empathetic, and organizational",
        description: "Focuses on organizational growth, employee engagement, leadership alignment, and high-trust culture.",
        toneGuidance: "Strategic, people-centered, and consultative. Ground points in organizational impact, talent retention, and cross-functional alignment.",
      },
      {
        id: "talent_operations",
        name: "Talent Operations & Analytics",
        tagline: "Systems, metrics, and workforce execution",
        description: "Emphasizes scalable HR processes, structured talent pipelines, HR tech stacks, and data-informed decision making.",
        toneGuidance: "Analytical, structured, and operational. Highlight concrete workflow efficiencies, metrics, and structured execution.",
      },
      {
        id: "people_partner",
        name: "Collaborative People Partner",
        tagline: "Empathetic, consultative, and authentic",
        description: "Bridges executive priorities with human advocacy, team health, and authentic career coaching.",
        toneGuidance: "Warm, empathetic, conversational, and direct. Focus on listening, resolving workplace friction, and building trust across teams.",
      },
    ];
  }

  // Commercial / Sales / Account Executive / Business Development
  if (/(?:sales|account executive|business development|commercial|revenue|gtm|partnerships)/.test(combined)) {
    return [
      {
        id: "commercial_executive",
        name: "Consultative Commercial Lead",
        tagline: "Enterprise discovery, value realized, and revenue expansion",
        description: "Focuses on uncovering client pain points, enterprise discovery, multi-stakeholder navigation, and driving revenue growth.",
        toneGuidance: "Confident, consultative, outcome-driven, and articulate. Highlight customer discovery, deal navigation, and revenue the evidence actually shows.",
      },
      {
        id: "strategic_gtm",
        name: "Strategic GTM Operator",
        tagline: "Pipeline velocity, market expansion, and execution",
        description: "Emphasizes repeatable go-to-market systems, territory strategy, pipeline acceleration, and cross-functional enablement.",
        toneGuidance: "Strategic, metrics-aware, and execution-oriented. Emphasize repeatable process, conversion rates, and collaborative GTM execution.",
      },
      {
        id: "customer_champion",
        name: "Client Advocate & Relationship Builder",
        tagline: "Authentic, customer-first, and retention-focused",
        description: "Bridges customer success, account growth, retention, and long-term partnership building.",
        toneGuidance: "Engaging, consultative, relationship-first, and grounded in mutual value creation.",
      },
    ];
  }

  // Marketing / Product Marketing / Content / Brand
  if (/(?:marketing|brand|product marketing|growth|content|demand gen)/.test(combined)) {
    return [
      {
        id: "growth_marketer",
        name: "Growth & Demand Marketer",
        tagline: "Data-driven, performance-focused, and conversion-oriented",
        description: "Focuses on acquisition funnels, campaign analytics, conversion rate optimization, and measurable demand generation.",
        toneGuidance: "Metrics-driven, sharp, and focused on commercial results, ROI, and customer acquisition channels.",
      },
      {
        id: "brand_storyteller",
        name: "Brand & Narrative Storyteller",
        tagline: "Compelling positioning, resonance, and audience empathy",
        description: "Crafts memorable narratives, brand identity, audience resonance, and clear differentiated positioning.",
        toneGuidance: "Articulate, evocative, clear, and empathetic. Emphasize message clarity, voice consistency, and audience connection.",
      },
      {
        id: "product_marketing",
        name: "Product Marketing Orchestrator",
        tagline: "Customer discovery, launch execution, and market positioning",
        description: "Bridges product strategy, sales enablement, competitive intelligence, and customer insight.",
        toneGuidance: "Cross-functional, strategic, and customer-first. Connect product capabilities to tangible market problems.",
      },
    ];
  }

  // Engineering / Technical / Software / Solutions Architecture
  if (/(?:engineer|developer|software|architect|technical|systems|cloud|data|infrastructure)/.test(combined)) {
    return [
      {
        id: "systems_builder",
        name: "Pragmatic Systems Builder",
        tagline: "Direct, evidence-driven, and code-focused",
        description: "Direct systems practitioner. Focused on architecture, code quality, performance metrics, and reliable execution. Zero fluff.",
        toneGuidance: "Concise, technical, direct, and concrete. Emphasize system trade-offs, measurable throughput or reliability, and clean execution.",
      },
      {
        id: "solutions_partner",
        name: "Technical Solutions & Partner Lead",
        tagline: "Consultative, client-facing, and integration-focused",
        description: "Bridges core architecture with external partner discovery, API integration guides, and resolving ecosystem friction.",
        toneGuidance: "Consultative, empathetic to external developers, practical, and clear. Highlight friction removal, API clarity, and triage.",
      },
      {
        id: "product_engineer",
        name: "Product-Minded Engineer",
        tagline: "User-centric, pragmatic, and business-aligned",
        description: "Connects technical implementation directly to user value, product velocity, and measurable business outcomes.",
        toneGuidance: "Engaging, pragmatic, and outcome-oriented. Connect technical implementation directly to real user impact.",
      },
    ];
  }

  return getUniversalPresets();
}
