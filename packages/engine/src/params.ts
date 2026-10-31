// Every tunable number in the mind engine, with where it comes from.
// Values marked "tuned" are engineering choices, not published estimates; they are the first
// candidates for calibration in the M3 validation suite.

export const PARAMS = {
  memory: {
    /** Base-level decay for gist, with time in hours. ACT-R default d = 0.5 (Anderson & Schooler 1991). */
    gistDecay: 0.5,
    /**
     * Episodes kept before sleep lets the faintest ordinary ones go. Memories that installed or
     * deepened a core belief, or that a belief rests on, are never dropped. Tuned for long runs.
     */
    capacity: 160,
    /** Verbatim details decay faster than gist (Reyna & Brainerd 1995). Tuned. */
    detailDecay: 0.9,
    /** Retrieval threshold on total activation (ACT-R tau). Tuned. */
    retrievalThreshold: -1.6,
    /** Activation noise scale s (ACT-R typical 0.2 to 0.5). */
    noise: 0.3,
    /** Maximum associative strength S in S_ji = S - ln(fan_j) (Anderson 1974 fan effect). */
    spreadMax: 2.5,
    /** Floor on S_ji so a matching cue always helps a little, however crowded. Tuned. */
    spreadFloor: 0.25,
    /** Weight of each cue source. Tuned. */
    cueWeight: 1.0,
    /** Mood congruence bonus per unit of mood x memory valence (Bower 1981). Tuned. */
    moodCongruence: 0.6,
    /** Bonus per unit of emotional charge (arousal x |valence|) at encoding (McGaugh 2004). Tuned. */
    arousalBonus: 1.0,
    /** Below this, a detail has faded and recall has to fill it in. Tuned. */
    detailThreshold: -3.9,
    /** Softmax temperature when an original detail competes with post-event information. Tuned. */
    competitionTemperature: 0.35,
    /**
     * Source memory fades faster than content (Johnson, Hashtroudi & Lindsay 1993). While the source
     * is still vivid, the agent knows "that's what I was told, not what I saw" and rejects the swap.
     * Half-life in hours. Tuned.
     */
    sourceHalfLife: 30,
    /** How strongly a told claim's credibility helps it compete. Tuned. */
    credibilityWeight: 0.5,
    /** How far recall pulls a memory's emotional tag toward current mood. Tuned. */
    retagRate: 0.15,
    /** Beliefs compete on confidence; this converts confidence to an activation offset. Tuned. */
    beliefOffset: 0.4,
  },
  affect: {
    /** Emotion half-life in minutes. Tuned; discrete emotions last minutes to hours. */
    emotionHalfLife: 240,
    /** Mood half-life in minutes. Tuned; mood persists for hours to days. */
    moodHalfLife: 60 * 8,
    /** Core affect relaxes toward mood with this half-life in minutes. Tuned. */
    coreHalfLife: 45,
    /** How much neuroticism amplifies negative emotion. Tuned. */
    neuroticismGain: 0.9,
    /** How much extraversion amplifies positive emotion. Tuned. */
    extraversionGain: 0.4,
    /** Stress decays with this half-life in minutes while awake. Tuned. */
    stressHalfLife: 60 * 30,
    /** Stress above this, sustained, accumulates allostatic load (McEwen 1998). Tuned. */
    allostaticThreshold: 0.6,
    /** Fatigue per waking hour. Tuned. */
    fatiguePerHour: 0.045,
  },
  social: {
    /** Trust learning rate for confirming evidence. Tuned. */
    trustGain: 0.06,
    /** Violations move trust more than confirmations (Slovic 1993). Ratio is tuned. */
    negativityRatio: 3,
    /** Low benevolence trust inflates blame (hostile attribution). Tuned. */
    hostileAttribution: 0.6,
    /** Attitude-congruent claims gain this much confidence (Kunda 1990). Tuned. */
    motivatedUpdating: 0.35,
    /** Confidence gained when a known story is heard again from a new teller (illusory truth). Tuned. */
    illusoryTruth: 0.2,
    /**
     * A told story whose activation (detail decay) has fallen below this is rebuilt when retold,
     * and drifts toward the teller's attitude (Allport & Postman 1947; Bartlett 1932). Tuned.
     */
    retellFade: -1.5,
    /** How strongly liking for a story's subject colours its retelling, added to mood. Tuned. */
    retellAttitude: 0.8,
  },
  workspace: {
    /** About four items (Cowan 2001). */
    capacity: 4,
    /** High arousal narrows attention (Easterbrook 1959): capacity drops by one above this. */
    narrowingArousal: 0.8,
    subliminalShown: 3,
  },
  decision: {
    /** System 2 engagement logistic: bias and gain. Tuned. */
    s2Bias: -1.0,
    s2Gain: 4.0,
    /** Capacity loss per unit of stress, fatigue and allostatic load. Tuned. */
    stressCost: 0.55,
    fatigueCost: 0.35,
    allostaticCost: 0.3,
    /** Decision noise (sd) for System 1. Tuned. */
    noise: 0.08,
  },
  development: {
    /** Nightly trait learning rate (TESSERA, Wrzus & Roberts 2017). Small on purpose. Tuned. */
    traitRate: 0.01,
    /** Whole Trait Theory: state spread around trait means (Fleeson 2001). Tuned. */
    stateSpread: 0.12,
    /** Event qualifies as formative above this arousal, below this coping. Tuned. */
    formativeArousal: 0.75,
    formativeCoping: 0.35,
  },
  sleep: {
    replayCount: 5,
    /** Sleep tempers emotional charge of replayed memories (Walker & van der Helm 2009). Tuned. */
    emotionalTempering: 0.25,
    stressRecovery: 0.55,
    /** Generalize a belief once this many episodes about the same entity agree in sign. */
    generalizeAt: 2,
  },
} as const;
