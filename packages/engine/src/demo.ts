// The M0 demo: six days in Mara's life. A visitor asks about the night of the storm on day 1,
// Jun passes on a rumor, the week goes badly, Theo asks a favour, and on day 7 the visitor asks again.

import type { Input } from "./session.js";

const at = (day: number, hour: number, minute = 0) => (day - 1) * 1440 + hour * 60 + minute;

export function demoScript(): Input[] {
  return [
    { type: "say", from: "visitor", at: at(1, 9), text: "Morning. I'm new on the island. People say you know the harbour better than anyone." },
    { type: "say", from: "visitor", at: at(1, 9, 20), text: "What happened at the dock the night of the big storm? I heard it was bad." },
    {
      type: "event",
      at: at(1, 15),
      text: 'Jun, mending a net beside Mara: "Theo never showed up at the dock that night, you know. He was at the tavern the whole time."',
      percept: {
        kind: "speech",
        actor: "jun",
        addressedToSelf: true,
        about: ["theo"],
        topics: ["dock", "storm", "tavern"],
        features: { outcomeForSelf: -0.15, agency: "other", intentional: 0, normViolation: 0, prospective: false, intensity: 0.45 },
        claims: [
          {
            about: "theo",
            topics: ["dock", "storm", "tavern"],
            proposition: "Theo was drinking at the tavern instead of helping at the dock",
            valence: -0.7,
            slotKey: "arrival",
            value: "never showed up",
          },
        ],
        details: [],
        gist: "Jun told me Theo was at the tavern the night of the storm.",
      },
    },
    {
      type: "event",
      at: at(5, 6, 30),
      text: "Overnight the storm tore Mara's nets loose from the drying racks. Half of them are ruined.",
      percept: {
        kind: "event",
        actor: "world",
        addressedToSelf: false,
        about: [],
        topics: ["storm", "nets", "boat"],
        features: { outcomeForSelf: -0.8, agency: "circumstance", intentional: 0, normViolation: 0, prospective: false, intensity: 0.85 },
        claims: [],
        details: [{ key: "damage", value: "half of them are ruined", salience: 0.4 }],
        template: "The storm tore my nets off the racks, and {damage}.",
        gist: "The storm wrecked my nets.",
      },
    },
    {
      type: "event",
      at: at(6, 17, 15),
      text: "Corran pays Mara half of what he promised for the week's catch, and shrugs: \"Market's down.\"",
      percept: {
        kind: "event",
        actor: "corran",
        addressedToSelf: false,
        about: ["corran"],
        topics: ["money", "buyer", "catch"],
        features: { outcomeForSelf: -0.6, agency: "other", intentional: 0.7, normViolation: 0.6, prospective: false, intensity: 0.7 },
        claims: [],
        details: [{ key: "amount", value: "half of what he promised", salience: 0.5 }],
        template: "Corran paid me {amount} for the catch.",
        gist: "Corran shorted me on the week's catch.",
      },
    },
    {
      type: "event",
      at: at(6, 18),
      text: 'Theo, at Mara\'s door: "Mara, my engine\'s gone. Could I borrow your boat for two days? I\'ll make it right, I swear."',
      percept: {
        kind: "speech",
        actor: "theo",
        addressedToSelf: true,
        about: ["theo"],
        topics: ["boat", "help", "rely"],
        features: { outcomeForSelf: -0.25, agency: "other", intentional: 0.3, normViolation: 0, prospective: true, intensity: 0.6 },
        request: { what: "lend Theo the boat for two days", topics: ["boat"] },
        claims: [],
        details: [],
        gist: "Theo asked to borrow my boat for two days.",
      },
    },
    { type: "say", from: "visitor", at: at(7, 10), text: "Tell me again about the night of the storm at the dock?" },
  ];
}
