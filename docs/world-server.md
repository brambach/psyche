# The world at scale: a realm of coasts, and a server that keeps it alive

Psyche could already run one region of a few thousand people on one thread (`world/region.ts`, `world/aggregate.ts`). This is the layer above it: tens of thousands of minds on worker threads, in a process that runs for days, saves itself, comes back from a crash where it left off, and writes a page each morning about what happened in the night.

Nothing here calls a model. Every town in the realm runs on the aggregate tier (rules, a season at a time), so the world server costs $0.00 however long it runs. Model calls only start when you open one coast in the game, and there the game's own budget governor applies.

```bash
npm run world                  # start the world in data/world, or pick it up where it stopped
npm run world -- status        # how it stands (works whether or not it is running)
npm run world -- digest        # ask the running world to write a digest now
npm run world -- export r3     # save one coast as a world the game can open
npm run scale -- 50000 4       # benchmark: grow to 50,000 people on 4 threads and time a year
```

While it runs, http://localhost:8790 shows the status page: people, coasts, speed, the last things that mattered, and the latest digest.

## How it is put together

```
            Realm (main thread)                     packages/engine/src/realm/realm.ts
            the barrier between seasons:
            colonies, boats, grievances, gifts
                       |
                  RegionHost                        realm.ts (interface), host.ts (in one thread)
        +--------------+---------------+            packages/server/src/world/pool.ts (threads)
        |              |               |
    worker 1       worker 2        worker 3         packages/server/src/world/worker.ts
    RegionRunner   RegionRunner    RegionRunner     packages/engine/src/realm/runner.ts
    RegionRunner   RegionRunner    ...
        |
    RegionSession  (unchanged: towns, trade, laws, chronicle)
        |
    WorldState per town  (unchanged: minds, households, crafts, money, engines)
```

**A region is the unit of parallelism.** A region is the same `RegionSession` the game uses: up to a dozen towns that trade, quarrel and split. Within a season, a region touches nothing outside itself, so each one can live on its own thread. Sixty coasts of about 900 people each is a world of 50,000.

**Everything between regions happens at the season barrier.** When all regions have lived a season, the `Realm` on the main thread carries out what crosses the sea, in a fixed order, with its own random stream:

- **Colonies.** A coast that is full cannot keep a new town. The newest town is lifted out whole (people, minds, memories, the stories they were told and who told them) and set down on a neighbouring coast with room, or on a new shore. The founding is chronicled with its causes, back to the person who led the leaving and the belief that made them go.
- **Boats.** A town with food to spare sends a trader to a town over the water that has timber. The trader may keep some back, may be noticed, may teach a craft, and tells a story at the other fire. The listener's memory keeps who told it, and a remembered copy of the teller travels with the story so the chain can still be followed.
- **Grievances and gifts.** A short load noticed becomes a belief about that town; once most adults hold it, the two coasts stop trading. A leader who likes peace may send a gift.

Each of these is a pair of plain messages (`SeaTradePacket`, `TownPacket`, `SeaGiftPacket` in `realm/sea.ts` and `world/region.ts`): one region writes it, the other reads it. No region ever sees another's memory.

**The same world on any number of threads.** Because regions only meet at the barrier and the barrier is ordered, a realm is bit-for-bit the same on one thread or eight, before and after regions move between threads, and before and after a save and restart. The tests check this by hash (`packages/server/test/world.test.ts`, `packages/engine/test/realm.test.ts`).

**Ids never repeat.** Every town carries its own mark (`b3`: the third town founded on the second coast) and counts the ids it makes (`mara_b3_17`), so a town can sail to another region and nobody there will ever share an id with anyone who arrives. Town and coast names come from generators in `realm/names.ts`.

## Running for days

- **Pace.** The world grows flat out until it first holds `PSYCHE_WORLD_PEOPLE`, then keeps to `PSYCHE_WORLD_PACE` sim years a real hour (60 by default: a year a minute), sleeping between seasons. `max` never sleeps. `POST /api/world/pace?years=120` changes it while it runs.
- **Saves.** Every `PSYCHE_WORLD_CHECKPOINT_MIN` minutes (10) each thread writes its regions, gzipped, as a new generation; then one small manifest (`realm.json`) is swapped in atomically. The last two generations are kept. Ctrl-C finishes the season, saves and stops.
- **Picking up.** Start it again and it loads the newest manifest, truncates the event log back to that save, and carries on. The result is exactly the world an unbroken run would have reached.
- **Crashes.** If a thread dies or a season throws, the server goes back to its last save by itself and carries on, counting a restart. More than three failures in ten minutes and it stops and says why in `status.json`.
- **Memory stays bounded.** A town that runs for thousands of years cannot keep everyone who ever lived there. Each spring a town on rules lets go of the long dead whom nothing points to any more (`forget` in `world/aggregate.ts`). A story or a craft that has passed through many generations keeps its eight nearest tellers and the person it began with; the ones in the middle are let go and counted (`Source.elided`, `Know.elided`), so "passed down 31 tellings from Wren's memory" stays true. In a 600-year soak of about 870 people the saved world held between 37 and 39 MB from year 200 on (before this it grew 15 MB a century).
- **The log is put away in pieces.** `events.jsonl` is rotated into `events/years-<from>-<to>.jsonl.gz` at a save once it passes 128 MB.

## The morning digest

At `PSYCHE_WORLD_DIGEST_HOUR` (7, local time) the server writes `digests/<date>.md` and `digests/latest.md`. A night at 50,000 people chronicles tens of thousands of lines; the digest picks the dozen that mattered (weighed by kind, how many people it touched, whether it crossed the sea, and how far back its causes go), each with the chain of reasons the chronicle recorded when it happened. Then: new shores settled, what passed between the coasts, a table of every coast, the oldest people alive, how the oldest story is told on different coasts now, and the engine's own health (speed, saves, restarts, memory, spend).

`npm run world -- digest` (or `kill -USR2 <pid>`) writes one on the spot.

## On disk

```
data/world/
  realm.json            the manifest: realm state, which region files make up the newest save
  regions/r7.g42.json.gz  one region in save 42 (two generations kept)
  events.jsonl          every chronicled event worth keeping, one per line, with its why
  events/               older stretches of the log, gzipped
  timeline.jsonl        one line a sim year: people, towns, coasts, births, deaths
  digests/2026-11-12.md the morning pages; latest.md is the newest
  status.json           how it stands, rewritten every season
  exports/r3/           a coast saved for the game (island.json)
  world.lock            the pid of the server that has this world open
```

## Settings

| Variable | Default | What it does |
| --- | --- | --- |
| `PSYCHE_WORLD_DIR` | `data/world` | Where the world lives on disk. |
| `PSYCHE_WORLD_PEOPLE` | `50000` | Grow flat out until the world first holds this many. It goes on growing until the coasts are full, a little above this. |
| `PSYCHE_WORLD_PACE` | `60` | Sim years a real hour after that, or `max`. |
| `PSYCHE_WORLD_THREADS` | cores less one, at most 8 | Worker threads. |
| `PSYCHE_WORLD_REGIONS` | people / 1,400 | How many coasts the sea has room for. A full coast settles at about 1,700 people, so this is what caps the population. |
| `PSYCHE_WORLD_SEED` | `11` | The same seed is the same world. |
| `PSYCHE_WORLD_PORT` | `8790` | Status page and API. `0` for none. |
| `PSYCHE_WORLD_CHECKPOINT_MIN` | `10` | Real minutes between saves. |
| `PSYCHE_WORLD_DIGEST_HOUR` | `7` | Local hour of the morning digest. |
| `PSYCHE_WORLD_HEAP_MB` | 3/4 of memory, shared out | Memory limit for each thread. |

## Looking in

Everything the status page shows comes from a small JSON API, which is also what the other tracks build on.

| Route | Gives |
| --- | --- |
| `GET /api/world/status` | The same as `status.json`. |
| `GET /api/world/timeline` | A row a sim year. |
| `GET /api/world/recent?limit=50` | The latest events heavy enough to matter. |
| `GET /api/world/events?kind=quarrel&region=r3&since=400&limit=200` | Events from the log, each with its `why`. |
| `GET /api/world/digests`, `GET /api/world/digests/latest` | The digests written so far; one as markdown. |
| `POST /api/world/digest`, `POST /api/world/checkpoint`, `POST /api/world/pace?years=` | Write a digest, save now, change the pace. |
| `GET /api/world/regions`, `GET /api/world/regions/r3` | The coasts; one coast with its towns, leaders, laws and regard. |
| `GET /api/world/regions/r3/myths` | How each town on that coast tells the crossing, and from whose memory. |
| `GET /api/world/regions/r3/towns/<town>` | Who lives there. |
| `GET /api/world/regions/r3/people/<id>` | One person: core beliefs with the chain of tellings behind each, memories, family. |
| `POST /api/world/regions/r3/export` | Save that coast for the game: `PSYCHE_DATA=<dir> npm run dev` opens it live. |

## For the other tracks

- **Psychology and civilization systems.** Anything added to a mind, a town (`WorldState`, `aggSeason`) or a region (`RegionSession`) runs at scale as it is, as long as it stays plain data and draws its chance from the world's own random stream. Something new that should cross the sea goes through the barrier: add a packet type and a pair of runner ops in `realm/runner.ts` (`RunnerOps`), and call them from `Realm.step`. `RegionPort` (`world/region.ts`) gives a layer above the region the region's own sinks, chronicle and grievance machinery.
- **The causal history explorer.** `events.jsonl` (and `GET /api/world/events`) is the whole chronicle of the realm with every event's `why` chain, ids included. `people/<id>` returns each core belief's lineage. A person's ids are stable for the life of the world and say where they were born.
- **The game.** `export` writes an ordinary region save. Open it with `PSYCHE_DATA` and the coast runs hour by hour, with model calls and the budget governor, like any other region. Writing a watched coast back into the realm is not built yet.
- **Long lines.** Code that walks a told-by chain should add `source.elided` to its count (as `rootOf` and `schemaLineage` do), and code that walks a craft's teachers `Know.elided`.

## How big, how fast

Measured on a 4-core, 16 GB cloud machine, offline mock, seed 11, from one crossing of 15 people:

| | Default (3 threads, 36 coasts) | 4 threads, 46 coasts |
| --- | ---: | ---: |
| Real time to 50,000 people | 23.5 minutes (sim year 279) | 19 minutes (sim year 280) |
| People, towns, minds held when measured | 53,300 in 466 towns; 86,700 minds | 54,400 in 545 towns; 90,400 minds |
| A sim year at that size | 22 to 26 s (about 150 years an hour) | 20 to 24 s (about 165 years an hour) |
| A save | 180 MB gzipped, 16 to 21 s | 195 MB gzipped, 10 to 15 s |
| Picking up from a save | | 11 s |
| Memory (heap in use / process) | 2.8 GB / 6.7 GB | 2.7 GB / 8.2 GB |
| Event log after 285 years | 6 MB, 20,000 events | 6.6 MB |
| Spend | $0.00 | $0.00 |

"Minds held" counts the living and the dead who are still remembered: the tellers a story still leads back through. At the default pace of 60 years an hour, a world this size keeps the machine about 40% busy.

`npm run scale -- <people> <threads>` repeats the measurement on your machine and writes `out/scale/scale.json`.

Where the time goes: the aggregate tier costs about 1.2 ms per person per sim year on one core, with no single hot spot (compacting minds, bedtime stories, crafts, and the engines some towns build, whose inner worlds are real worlds). A season is as long as the busiest thread's share of it, so the server evens out what each thread carries every five sim years; the barrier itself and the largest single coast (about 0.4 s a season) are a small part of it. More cores is the direct way to more people or more years an hour.

## Not here yet

- Words and sayings (`voice.ts`) do not cross the sea with traders; stories, crafts, grievances and people do.
- A coast watched live in the game is a copy. It does not flow back into the running realm.
- The realm is one process on one machine. `RegionHost` is the seam where regions could move to other machines.
- Rewind is off at this scale, as it is for any region: the realm is saved as it stands, not replayed.
