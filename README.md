# Psyche

A world of artificial minds whose psychology is real machinery you can open up, not a personality written into a prompt.

**Kettle Island** is a live simulation of five people on a small fishing island. Each one runs on the mind engine: real memory that fades and gets rewritten, moods, trust, goals, sleep. Nobody is scripted. You watch them go about their days, bump into each other, gossip and hold grudges, and you can open any of their heads at any moment to see why they did what they did.

The design proposal behind it lives at https://claude.ai/artifact/7iL2xRmmVXMeDJYnBxDP7G.

## Run it

```bash
npm install
npm run dev        # server on :8787, the island on http://localhost:5173
npm run island -- 3 7 --storm   # three days of island life in the terminal (seed 7, with a storm)
npm run village -- 8 11         # eight days of Hollow Bay, the village, in the terminal
npm run generations -- 10       # ten years of Hollow Bay on the mock: lives, norms, inherited fears
npm run region -- 22            # a region of towns: splits, trade, laws, and the crossing told differently
npm test           # engine and world tests
npm run demo       # the original single-mind demo (M0)
```

With no Anthropic credentials, speech runs on an offline mock so everything works out of the box. Set `ANTHROPIC_API_KEY` (or `PSYCHE_FACULTIES=claude`) to use Claude. Set `PSYCHE_AUTOPLAY=0` to start paused, and `PSYCHE_SCENARIO=village` to start in Hollow Bay (or switch worlds from the menu in the header).

### Cost

Every model call goes through a budget governor (`packages/faculties/src/governor.ts`):

- **Tiers.** Speech, perception, memory reconstruction and dreams run on `claude-haiku-5-5`; deliberation and the Architect on `claude-sonnet-5-5`. Override any faculty with `PSYCHE_MODEL_PERCEIVE`, `PSYCHE_MODEL_SPEAK`, `PSYCHE_MODEL_RECONSTRUCT`, `PSYCHE_MODEL_DELIBERATE`, `PSYCHE_MODEL_DREAM` or `PSYCHE_MODEL_ARCHITECT`.
- **Templates for small moments.** The engine scores how much each line matters. Greetings and small talk come from templates; replies that tell a memory, answer you, or follow deliberation go to the model. Whoever you are looking inside always speaks with the model.
- **A daily cap**, default $10 (`PSYCHE_DAILY_CAP`), shared by every run on the machine and kept in `~/.psyche/usage.json` (every call is logged beside it in `usage.log`). At 80% of the cap Sonnet calls drop to Haiku, at 90% only the most salient lines use the model, and at 100% everything falls back to the mock until the next UTC day. The world keeps running throughout.
- **A live meter.** The `$` chip in the island header opens a breakdown by faculty and model. `npm run island` and `npm run why` print it too. On the mock, the meter shows what the same run would have cost on Claude.

- **Two tiers of attention (L0 and L1).** In the village, the Kettle five and whoever you are watching are L0: Sonnet deliberation and model speech for anything that matters. The settlers are L1: Haiku only, and only their more salient lines go to the model. Set the named characters with `governor.core`.

On the mock, five islanders come to about $0.07 per sim day, almost all of it Sonnet deliberation. Hollow Bay's fifteen come to about $0.09 to $0.11 per sim day.

## Why: the causal ledger

The brain scan shows one moment. The ledger (`packages/engine/src/ledger.ts`) joins every moment into one graph of what caused what, across time and across people: the event a memory came from, the beliefs and trust it moved, what was in mind at each choice, who told whom, which belief rewrote which memory, and the formative night behind a core belief. Nothing in it causes behaviour; it is built from the traces after the fact.

In the island UI, open anyone's head. **What weighs on them** lists their core beliefs, darkest beliefs and strongest recent fear or anger; **Trace it** walks each one back to where it started and forward to the choices it has shaped since. Above any moment's brain scan, **Why?** does the same for that choice. Click anything with a moment behind it to open that brain scan, including in other people's heads.

```bash
npm run why -- mara 3 7 --storm   # what weighs on Mara after three days, and where each thing came from
```

## Hollow Bay (C1): the village

The Kettle five and ten generated settlers land on an empty shore at the end of summer (`packages/engine/src/world/village.ts`, `people.ts`). Same minds, same engine; the world now pushes back:

- **Settlers are rolled from the seed**: name, temperament, trade, household, and one formative memory from before the crossing (a hungry winter when the mill families hid grain, a neighbour who fed them, a brother who sold the family boat, a house that burned with nobody coming to help). That memory installs a core belief, and the belief remembers where it came from.
- **Food and seasons.** Fishers, farmers and foragers feed their own households; food spoils in tents. Woodcutters, the quarrier, the thatcher and the builders cut and build for everyone and catch nothing. A season is four days; winter yields little and gales keep the boats in.
- **Houses designed by the Architect.** When a builder is free, the next household's head decides between something sturdy and something quick, and the Architect designs it from what is in their mind. The blueprint is checked and priced (the same building language as Founders), then built as timber, stone and reeds arrive. Households in tents have bad nights when it rains.
- **The common store.** On the second evening Wren asks the fire for a common store to feed the people whose work feeds nobody directly, and again each time the season turns. Every adult chooses: a full share, a little, or hold back. Everyone hears the answers. Holding back is a norm violation that moves trust and becomes a story; taking from the store after holding back is worse, and the keeper sees it.
- **Overhearing and the fire.** Bystanders catch some of the gossip told near them, and the rumor's lineage marks the hop as overheard. Each evening someone tells a story at the fire to everyone there.

Two new analysis views, built on the ledger:

- **Same event, different memories** (Divergence): everyone who lived through something, side by side, with every change each memory has been through. The crossing is the first: fifteen people, one night, fifteen accounts.
- **What they would say vs what drove it** (Says vs was): for any decision, the reasons that were in mind against the causes the ledger finds out of sight: a core belief from years before tilting the appraisal, trust colouring blame, a memory rewritten by gossip, a feeling left over from earlier, a belief whose source is forgotten. Open it from any moment's brain scan, or from any pledge in **The village** tab.

The village is not on a voxel grid yet: houses are real blueprints with real bills of materials, but construction is tracked as progress rather than blocks. Merging it with Founders' voxel world is the remaining C1 item.

## Generations (C2): fears outlive the people who felt them

Hollow Bay now runs for decades (`packages/engine/src/world/life.ts`). A year is sixteen days.

- **Lives.** People age, pair up, have children and die (of age, of fever, of hunger in a hard winter). Newcomers arrive in spring. A child starts with a blend of the parents' temperaments and nothing else: no past, no core beliefs.
- **Inheritance through stories.** At bedtime a parent tells the children the story that matters most to them, often the memory that formed one of their core beliefs. A dark story carries the wary belief it fed ("I can only count on myself"), a hopeful one the trusting belief. The child remembers it in the teller's voice with the source kept, so the ledger can follow it back hop by hop, through the dead, to the first-hand memory it began as.
- **Norms.** When people see someone hold back from the common store and hold it against them, round after round, "everyone puts into the common store" becomes something the village expects (Bicchieri). From then on it weighs on every pledge, and the ledger shows it as "what the village expects".
- **Let years pass.** In the village, the header has a "Let years pass" menu (1 to 25 years). Years run on the offline mock (L2 for everyone, free), then the session is rebased so memory stays bounded. You cannot rewind to before it. `npm run generations -- 10` does the same headless and prints births, deaths, norms and the inherited beliefs.

Two new analysis views:

- **Fears across generations** (the atlas): every core belief in the village, who holds it by generation, and for each person who never lived it, the chain of tellers back to the first-hand memory.
- **What if not?** (counterfactual): pick a core belief or a dark belief, from the atlas or from "What weighs on" in anyone's panel. The next days run twice from this moment on the mock, with the same luck, once without it. It reports the choices that changed, how far each choice's lead over the next option moved, mood, feelings that ended up different, and whether the belief came back on its own.

Core beliefs now also weigh directly on how much it seems wise to give whenever their triggers come up, not only through the appraisal, so what-if-not tests show a real effect.

## Settlements and culture (C3): towns that tell it differently

Pick **A region of towns** in the header (or `PSYCHE_SCENARIO=region`). It starts as Hollow Bay (`packages/engine/src/world/region.ts`, `civic.ts`).

- **Leaders and laws.** Each spring the adults name the three people they would most willingly follow, by liking and trust; the most named leads and asks for the pledge. When the store norm has taken hold and a quarter still hold back, the leader writes a law and puts it to a vote. Under a law, a household that pledged less is made to put in a quarter. It costs them autonomy, and the resentment lands on the leader.
- **The founding story.** On the first night of each summer, everyone comes to the fire and the eldest who carries the crossing tells it. Everyone who wasn't there keeps that telling and drops their older one. What gets passed on is the memory as the teller holds it now, drift included.
- **Towns split.** In spring, once a town reaches 26 people, the adult who least belongs leaves with their household and the households closest to them, and they found a new town. The leavers share one memory of leaving, and that becomes the new town's founding story. The stories they grew up on go with them as remembered copies, so lineage still resolves.
- **Trade, quarrels and peace.** A town with food to spare sends someone to trade for timber, and they tell a story at the other town's fire. A careless or grasping trader keeps some back. If it's noticed, the town comes to believe "folk from there will cheat you", and once most adults believe it, trade stops. A leader who likes peace may send a gift, which softens the belief.
- **Two new views.** **Towns and chronicle** shows each town's population over time, its leader and laws, how the towns regard each other, and a chronicle by year. **How each town tells it** shows each town's versions of the crossing, the chain of tellers back to the person who lived it, and where two towns' versions part.

`npm run region -- 22` runs it headless. In 22 years (seed 11) Hollow Bay splits three times into four towns of about 120 people. Each town comes to tell the crossing from a different founder's memory: Hollow Bay's version comes from Wren, Saltmarsh's from Corran, Greyhaven's from Eamon. It takes about 4 minutes on the mock.

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

Inside a town there is no barter yet, only the common store, and roles are picked at coming of age from aptitude and what the town lacks. Rewind is off in a region (towns change each other, so one town's log can't replay it), and a region is saved as it stands rather than replayed. Conversations are still two people (group moments are the fire and the village meeting). The village is not yet on Founders' voxel grid. The mock faculties write plain language and extract little from free text; real perception and speech need Claude. Several parameters are engineering choices that M3's validation suite should calibrate.
