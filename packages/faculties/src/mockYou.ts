// Offline lines for when the player walks into the world in person (engine/world/you.ts): what
// villagers say to the newcomer, and how they answer what the newcomer does. Free, deterministic,
// and only words: who says what, and why, is decided by the engine before any of this runs.

import type { SpeakRequest, SpeakResponse } from "@psyche/engine";

function pick<T>(xs: T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) | 0;
  return xs[Math.abs(h) % xs.length]!;
}

/** A memory in the speaker's own words, turned to face the person it is about. */
function toYou(text: string, listener: string): string {
  return text
    .replace(new RegExp(`\\b(the stranger|${listener.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\b`, "gi"), "you")
    .replace(/\byou has\b/g, "you have")
    .replace(/\byou was\b/g, "you were")
    .replace(/\bthey would\b/g, "you would")
    .replace(/\.$/, "");
}

const LINES: Record<string, (ctx: { name: string; curt: boolean; warm: boolean; story: string; you: string; self: string }) => string[]> = {
  // How a hello from someone nobody knows is taken.
  "Welcome the newcomer": ({ name, self }) => [`Welcome${name}. I'm ${self.split(" ")[0]}. You'll find most of us at the fire come evening.`, `Good to meet you${name}. Not many boats bring anyone new.`, `Well, hello${name}. Sit down, you look like you've walked a way.`],
  "Nod and carry on": () => ["Hm. Hello.", "Morning.", "Right. Well. I've work to do."],
  "Eye the newcomer warily": () => ["And what do you want here?", "We don't know you.", "Nobody sent for anyone."],
  // Plain answers.
  "Warm to the newcomer": ({ name }) => [`That's good of you${name}.`, "I'll remember that.", "You're all right, you know."],
  "Stay guarded": () => ["If you say so.", "Hm.", "We'll see."],
  "Turn cold": () => ["I've nothing more to say to you.", "Go on. Away with you.", "Don't come to me again."],
  // Praise.
  "Take it kindly": ({ name }) => [`That's kind of you to say${name}.`, "Well. Nobody's said that in a while. Thank you.", "I do what needs doing. But thank you."],
  "Shrug it off": () => ["It's only work.", "Someone has to.", "Hm. If you say so."],
  "Smell flattery": () => ["And what is it you're after?", "Nobody says that for nothing.", "Save it. What do you want?"],
  // Comfort.
  "Open up": ({ story }) => [story ? `Since you ask. ${story}` : "I don't sleep. I lie there counting what's in the store and what's left of the winter.", story ? `I've not said this to anyone. ${story}` : "It's nothing you can mend. But it helps to say it out loud."],
  "Thank them and leave it": () => ["Kind of you. I'm all right.", "Thank you. It'll pass.", "I'd rather not. But thank you."],
  "Want to be left alone": () => ["Leave me be.", "It's none of your business.", "I didn't ask."],
  // An insult.
  "Snap back": () => ["Say that again and you'll swim home.", "You've a mouth on you for someone nobody asked here.", "A fool, am I? Get away from me."],
  "Let it pass": () => ["I'll put that down to a long crossing.", "If that's how you see it.", "I've been called worse by better."],
  "Turn away": () => ["...", "(says nothing, and turns their back)"],
  // An apology.
  Forgive: ({ name }) => [`All right${name}. It's done. We'll say no more about it.`, "It takes something to say that. It's forgotten.", "Good. Then we start again."],
  "Accept it, coolly": () => ["I hear you.", "Words. We'll see what you do.", "Fine."],
  "Refuse the apology": () => ["Sorry is cheap.", "No. Not that easily.", "Keep it. I know what you are."],
  // A gift.
  "Take it gladly": ({ name }) => [`Thank you${name}. I won't forget this.`, "That's more than anyone asked of you. Thank you.", "Bless you. We were down to nothing."],
  "Take it, and wonder why": () => ["I'll take it. I'd like to know why, though.", "Thank you. What is it you want for it?", "Hm. All right."],
  "Refuse it": () => ["I don't take from people I don't know.", "Keep it. We manage.", "No. Thank you, but no."],
  // Trade.
  "Sell for amber": () => ["Amber's amber. Here, take what you paid for.", "Done. That's a fair piece.", "All right. I can use that."],
  "Give it for nothing": () => ["Put your stone away. Nobody goes hungry while I've a pot on.", "Keep your amber. Eat."],
  "Refuse to sell": () => ["You can't eat amber. No.", "What would I do with a stone?", "Not for sale."],
  "Pay amber for it": () => ["Here. One piece. Hand it over.", "That'll see us through. Take the amber.", "Fair. Done."],
  "Not buying": () => ["No. I asked for help, not a price.", "We've enough.", "I've nothing to pay with."],
  // Asking them for food.
  "Give them food": () => ["Here. Eat. Nobody starves on my doorstep.", "Take it. You'd do the same."],
  "Lend it": () => ["I'll lend it. Two days, and I'll want it back.", "Take it. But it's a loan, mind."],
  "Ask amber for it": () => ["For a piece of amber, yes.", "It'll cost you a piece of amber."],
  "Send them away hungry": () => ["I've my own to feed.", "No. Try someone else.", "We've nothing to spare for strangers."],
  // Help with the work.
  "Work alongside them": () => ["Take that end, then. Mind your fingers.", "I won't say no. Here, like this.", "Good. Two's quicker."],
  "Let them, grudgingly": () => ["If you must. Don't break anything.", "Suit yourself."],
  "Wave them off": () => ["I do it my own way. Thanks.", "You'd only be under my feet.", "No need."],
  // A story about a neighbour.
  "Take it in": () => ["Is that so? I always wondered.", "That doesn't surprise me.", "Go on. What else?"],
  "Doubt it": () => ["Maybe. I'd want to hear it from someone I know.", "Hm. Who told you that?", "I'll believe it when I see it."],
  "Stand up for them": () => ["I'll not hear that said. Not from you.", "You've been here five minutes. Mind who you talk about.", "That's a lie, and you should be ashamed."],
  "Believe the denial": () => ["Then I had it wrong. I'm sorry I said it.", "All right. I'll take your word."],
  "Don't buy it": () => ["I know what I know.", "Don't lie to my face.", "No. It was you."],
  // Coming over to the newcomer.
  "Size up the newcomer": () => ["You're the one off the boat. Who are you, then?", "I don't know your face. What brings you here?", "Stranger. You've a name, I suppose?"],
  "Ask the newcomer for food": () => ["I wouldn't ask, but we're short tonight. Have you anything in that pack?", "You've food. We've none. Could you spare some?"],
  "Have it out with the newcomer": ({ story, curt }) => [`${curt ? "You." : "I'll say it to your face."} ${story ? `${story}.` : "I know what you did."} What have you to say?`],
  "Call in a debt": () => ["You owe me food, and it's past the day. I'll have it now.", "I lent to you in good faith. Where is it?"],
  "Thank the newcomer": ({ story }) => [`${story ? `${story}. ` : ""}I've not forgotten. Here, take this. It's not much.`],
  "Confide in the newcomer": ({ story }) => [`You're not from here, so I can say it to you. ${story}`, `Can I tell you something? ${story}`],
  "Invite the newcomer to the fire": ({ name }) => [`Come and sit at the fire tonight${name}. You shouldn't eat alone.`, "There's room at the fire. Come."],
  "Warn the newcomer": ({ name }) => [`A word${name}. People are talking about putting you on a boat. Mind yourself.`, "I like you, so I'll tell you. Some of them want you gone."],
  "Call for the newcomer to go": ({ story }) => [`I'll say what others are thinking. ${story ? `${story}. ` : ""}We took a stranger in and this is what we have for it. I say they go on the next boat. Who's with me?`],
  "Ask the newcomer to stay": ({ name, story }) => [`${story ? `${story}. ` : ""}There's a place for you here${name}, for as long as you want one.`],
};

/** A line for one of the walk-in moments, or nothing when the request is not one of them. */
export function mockYouSpeak(req: SpeakRequest): SpeakResponse | undefined {
  const make = LINES[req.intent.option];
  if (!make) return undefined;
  const stranger = req.listener.name.startsWith("the ");
  const facing = req.listener.id === "visitor";
  const raw = req.content.map((c) => c.text).join(" ");
  const story = facing && !/^(Open up|Confide)/.test(req.intent.option) ? toYou(raw, req.listener.name) : raw;
  const seed = `${req.self.name}|${req.heard}|${req.intent.option}|${req.content.map((c) => c.id).join()}`;
  const text = pick(make({ name: stranger || !facing ? "" : `, ${req.listener.name}`, curt: req.style.curtness > 0.55, warm: req.style.warmth > 0.55, story: story ? story.charAt(0).toUpperCase() + story.slice(1) : "", you: req.listener.name, self: req.self.name }), seed);
  return { utterance: text, acts: [] };
}
