# Psyche

A world of artificial minds whose psychology is real machinery you can open up, not a personality written into a prompt.

**Kettle Island** is a live simulation of five people on a small fishing island. Each one runs on the mind engine: real memory that fades and gets rewritten, moods, trust, goals, sleep. Nobody is scripted. You watch them go about their days, bump into each other, gossip and hold grudges, and you can open any of their heads at any moment to see why they did what they did.

The design proposal behind it lives at https://claude.ai/artifact/7iL2xRmmVXMeDJYnBxDP7G.

## Run it

```bash
npm install
npm run dev        # server on :8787, the island on http://localhost:5173
npm run island -- 3 7 --storm   # three days of island life in the terminal (seed 7, with a storm)
npm test           # engine and world tests
npm run demo       # the original single-mind demo (M0)
```

With no Anthropic credentials, speech runs on an offline mock so everything works out of the box. Set `ANTHROPIC_API_KEY` (or `PSYCHE_FACULTIES=claude`) to use Claude. Set `PSYCHE_AUTOPLAY=0` to start paused.

### Cost

Every model call goes through a budget governor (`packages/faculties/src/governor.ts`):

- **Tiers.** Speech, perception, memory reconstruction and dreams run on `claude-haiku-5-5`; deliberation and the Architect on `claude-sonnet-5-5`. Override any faculty with `PSYCHE_MODEL_PERCEIVE`, `PSYCHE_MODEL_SPEAK`, `PSYCHE_MODEL_RECONSTRUCT`, `PSYCHE_MODEL_DELIBERATE`, `PSYCHE_MODEL_DREAM` or `PSYCHE_MODEL_ARCHITECT`.
- **Templates for small moments.** The engine scores how much each line matters. Greetings and small talk come from templates; replies that tell a memory, answer you, or follow deliberation go to the model. Whoever you are looking inside always speaks with the model.
- **A daily cap**, default $10 (`PSYCHE_DAILY_CAP`), shared by every run on the machine and kept in `~/.psyche/usage.json` (every call is logged beside it in `usage.log`). At 80% of the cap Sonnet calls drop to Haiku, at 90% only the most salient lines use the model, and at 100% everything falls back to the mock until the next UTC day. The world keeps running throughout.
- **A live meter.** The `$` chip in the island header opens a breakdown by faculty and model. `npm run island` and `npm run why` print it too. On the mock, the meter shows what the same run would have cost on Claude.

On the mock, five islanders for three sim days come to about $0.07 per sim day, almost all of it Sonnet deliberation.

## Why: the causal ledger

The brain scan shows one moment. The ledger (`packages/engine/src/ledger.ts`) joins every moment into one graph of what caused what, across time and across people: the event a memory came from, the beliefs and trust it moved, what was in mind at each choice, who told whom, which belief rewrote which memory, and the formative night behind a core belief. Nothing in it causes behaviour; it is built from the traces after the fact.

In the island UI, open anyone's head. **What weighs on them** lists their core beliefs, darkest beliefs and strongest recent fear or anger; **Trace it** walks each one back to where it started and forward to the choices it has shaped since. Above any moment's brain scan, **Why?** does the same for that choice. Click anything with a moment behind it to open that brain scan, including in other people's heads.

```bash
npm run why -- mara 3 7 --storm   # what weighs on Mara after three days, and where each thing came from
```

## Founders (F0): one mind builds a house

**Founders** is the first step toward an open-world sandbox where Psyche minds build their own town. One mind (any of the Kettle Island five) lands on **Tern Holm**, an empty voxel islet, with a storm due at dusk the next day. Nothing is scripted: the mind decides whether to start building, look around or wait; designs a house; fells pines, quarries stone and cuts reeds; and sets every block over sim hours. Open `http://localhost:5173/#/founders`, or run it in the terminal:

```bash
npm run founders -- jun        # one builder, 60 sim hours, prints the feed, the design and a top-down map
npm run founders -- mara --early   # bring the storm forward and watch the choice that follows
```

**The model designs; code builds.** The only new language faculty is the **Architect**. It gets the mind's identity, its temperament, what is in its workspace right now (the memory of the last big storm, the goal, the fear), the site, the materials and the hours left, and returns a blueprint in a small building language: footprint, wall height and material, foundation, corner posts, floor, roof shape and material, door side, windows, furniture, porch. About a dozen fields, not thousands of blocks. The engine validates and repairs it (and reports every change), compiles it into ordered block placements, and prices it in planks, stone, thatch and hours. The body layer does the rest with no model calls.

**Personality shows in the house and in the outcome.** A careful worrier like Mara sizes the job to the time, builds low in stone with the door out of the wind and finishes with hours to spare. An open, sociable builder like Jun wants windows and a porch, over-reaches, and later has to choose: cut the plan down, push on past dark, or give up for the night. The storm then tests whatever got built. Every choice opens in the brain scan, and every design shows what was on the builder's mind when they drew it.

| Piece | Where |
| --- | --- |
| Voxel islet, seeded terrain, pines, outcrop, reeds | `packages/engine/src/founders/voxel.ts` |
| Blueprint language: compile, check and repair, bill of materials | `packages/engine/src/founders/blueprint.ts` |
| The loop: percepts and choices, the Architect call, gathering and building, the storm | `packages/engine/src/founders/founder.ts` |
| Event-sourced sessions (rewind and replay block for block) | `packages/engine/src/founders/session.ts` |
| Architect faculty (Claude and offline mock) | `packages/faculties/src` |
| 3D view (Three.js) and panels | `packages/web/src/founders` |

The scoping doc for the full vision (F0 to F5) is at https://claude.ai/artifact/LN8aZH3jP7TnMNczpYE4N6.

## The island

| Who | |
| --- | --- |
| **Mara**, fisher | Guarded, proud of managing alone. Holds it against Theo that he arrived late the night of the big storm. |
| **Theo**, boatwright | Easygoing, always late. Was late that night because he was pulling Jun's skiff off the rocks, and has never told Mara. |
| **Jun**, fisher | Talks to everyone. Owes Theo her skiff. |
| **Corran**, fish buyer | Thin-skinned, keeps score, has stories about everybody. |
| **Wren**, keeps the Gull | Everyone's confidant. Remembers Theo coming in soaked after the storm and saying nothing. |

Each has a routine (the harbour at dawn, the fish shed at noon, maybe the Gull at night), goals, things they want from each other, and memories of a shared past that don't agree.

**What happens is decided by the engine, not by a prompt.** Who is where comes from routines and moods (lonely people go out in the evening; stressed ones stay home). When two people are in the same place, the engine decides whether they talk and what about: a favour they want, an offer of help, something they've been meaning to explain, a story about someone else, or the weather. The listener then runs a full cognitive cycle and decides how to respond. The language model only turns those decisions into words, so most of the simulation needs no model calls at all.

**What you can do:** play, pause and change speed; trigger a storm, a gathering at the Gull, or a big catch; plant a rumor with one person and follow it round the island; talk to anyone yourself; rewind the whole island to any morning and let it play out differently; restart with mechanisms switched off.

**What you can see:**

- *What's happening*: the live feed. Click any line to open that person's brain scan for that moment.
- *Stories going round*: every story that has changed hands, who told whom, how much each listener believed it, and how the wording drifted.
- *Who feels what*: liking and trust between everyone, and the biggest misreadings (Theo thinks Mara can't stand him; she's warmer than he thinks).
- *Inside someone's head*: how they read each person against how that person actually feels, their goals, their life story, and the M0 brain scan for every moment.

### How stories move

When someone tells a story, they recall it in full, and recall rewrites memory. The story becomes a claim with a lineage. A listener weighs it by how much they trust the teller and whether it fits how they already feel about its subject. Hearing the same story again from someone new makes it feel truer. When a story has faded and gets retold, the teller rebuilds it from mood and attitude, so it drifts toward what they already think. And if the story is about an event the listener lived through, it competes with their own memory of it: once they've forgotten where they heard it, they may come to remember it that way themselves.

That last part is the engine at its most interesting. Theo explaining himself can quietly repair Mara's memory of the storm night. Mara telling her version can just as easily overwrite Theo's, until he remembers only that he was late and not why.

| Mechanism added for the island | Source |
| --- | --- |
| Illusory truth: repetition raises belief | Hasher, Goldstein & Toppino 1977 |
| Rumor transmission: levelling, sharpening, assimilation | Allport & Postman 1947; Bartlett 1932 |
| Gossip as reputation information | Dunbar 2004 |

## The idea in one paragraph

The psychology lives in a deterministic engine (`packages/engine`). Memory strength, mood, trust, traits and biases are typed state with update rules taken from cognitive science. The language model is called only for narrow faculties (`packages/faculties`): perceive, deliberate, speak, reconstruct and dream. Each call receives only what the mind is currently holding in its four-slot workspace and must cite item ids, so the brain scan shows real causes rather than a story told afterwards.

## Layout

| Package | What it is |
| --- | --- |
| `packages/engine` | The mind: memory, appraisal and affect, workspace, decisions, sleep, explanation, event-sourced sessions. No runtime dependencies; runs in Node or the browser. |
| `packages/faculties` | Claude-backed faculties with structured outputs, plus a deterministic offline mock. |
| `packages/engine/src/world` | Kettle Island: places, the cast, routines, encounters, conversations, gossip, events, and event-sourced world sessions. |
| `packages/server` | Hosts the island with a running clock, saved as seed + inputs + recorded calls. |
| `packages/web` | The island UI: map, feed, stories, relationships and the brain scan (React + Vite). |

## One cognitive cycle

1. **Perceive**: text becomes a structured percept (Perceive faculty), primed by the memories the words call up.
2. **Appraise**: goal relevance, desirability, blame, coping and threat; OCC emotions; trust updates. Low trust inflates blame and core beliefs add their bias.
3. **Recall**: ACT-R base-level activation plus spreading activation (with the fan effect), mood congruence, emotional charge and noise.
4. **Compete**: percepts, memories, beliefs, feelings, goals and needs compete for about four workspace slots. Only winners influence the choice.
5. **Decide**: the engine generates options (unkind ones included) and scores them from state. System 2 deliberation engages on conflict, novelty and stakes, scaled by capacity that stress and fatigue erode.
6. **Act and speak**: speech is rendered with a style vector from affect and traits.
7. **Learn**: encode the episode, settle trait expressions, strengthen habits and goal investment.
8. **Sleep** (23:00 to 07:00): prioritized replay, consolidation into beliefs, emotional tempering, stress recovery, nightly trait drift.

Recall rewrites memories. When a memory is recalled in full, each detail is re-retrieved: post-event information competes with the original trace, and once the source has faded the winner is adopted as if seen first-hand. Faded details are filled in from mood and beliefs. The original stays in the record, so the scan can show the diff.

## Mechanisms and where they come from

Every number is in `packages/engine/src/params.ts` with its source, or marked as tuned. Each mechanism can be switched off (`Ablations` in `types.ts`, or the Mechanisms panel in the UI).

| Mechanism | Source |
| --- | --- |
| Global workspace, about four items | Baars 1988; Dehaene 2014; Cowan 2001 |
| Cognitive cycle | Franklin et al. 2014 (LIDA) |
| Base-level activation, fan effect | Anderson & Schooler 1991; Anderson 1974 |
| Gist vs verbatim decay | Reyna & Brainerd 1995 |
| Reconsolidation | Nader, Schafe & LeDoux 2000 |
| Misinformation, source monitoring | Loftus & Palmer 1974; Johnson, Hashtroudi & Lindsay 1993 |
| Mood-congruent recall, emotional memory | Bower 1981; McGaugh 2004 |
| Appraisal and OCC emotions | Lazarus 1991; Scherer 2001; Ortony, Clore & Collins 1988 |
| Core affect | Russell 1980 |
| Allostatic load | McEwen 1998 |
| Trust (ability, benevolence, integrity) and its asymmetry | Mayer, Davis & Schoorman 1995; Slovic 1993 |
| Adult attachment dimensions | Brennan, Clark & Shaver 1998 |
| Motivated reasoning | Kunda 1990 |
| Dual process | Evans & Stanovich 2013 |
| Whole trait theory, trait drift | Fleeson 2001; Wrzus & Roberts 2017 |
| Self-efficacy, controllability | Bandura 1977; Maier & Seligman 2016 |
| Consolidation, prioritized replay, emotional tempering | McClelland, McNaughton & O'Reilly 1995; Mattar & Daw 2018; Walker & van der Helm 2009 |
| Courtesy as a social norm | Bicchieri 2006 |

## What the tests show

Across 30 seeds of the M0 demo, Mara adopts Jun's rumor ("Theo never showed up") as her own memory in a fraction of runs, and never when the misinformation mechanism is off. She never adopts it at the moment she hears it, because the source is still vivid. Replays from the recorded log are byte-identical, rewinds restore exact state, and changing a mechanism is reported as a divergence instead of silently reusing stale responses.

On the island, the same seed always gives the same island, replay from the log is exact, and rewinding to a morning restores it exactly. Across eight seeds, stories pass beyond the person who first told them, a planted rumor travels on its own in most runs, and people come to remember what they were told about shared events, but never when the misinformation mechanism is switched off.

## Not here yet

Says-vs-was (confabulation) and the counterfactual button are still to come. Overhearing, more than two people in one conversation, and a bigger cast are the next steps for the island. The mock faculties write plain language and extract little from free text; real perception and speech need Claude. Several parameters are engineering choices that M3's validation suite should calibrate.
