// Calls for bringing someone into the world from their own writing (server: /api/persona/*).
import type { PersonaLife, PersonaReading } from "@psyche/engine";
import { call } from "../api";

export interface PersonaSummary {
  id: string;
  name: string;
  alive: boolean;
  arrived: number;
  method: "mock" | "claude";
}

export const personaApi = {
  sample: () => call<{ name: string; pronouns: "she" | "he" | "they"; label: string; text: string }>("/api/persona/sample"),
  read: (b: { text: string; name: string; pronouns?: "she" | "he" | "they"; author?: string }) => call<{ reading: PersonaReading }>("/api/persona/read", b),
  arrive: (reading: PersonaReading) => call<{ id: string }>("/api/persona/arrive", { reading }),
  list: () => call<{ personas: PersonaSummary[] }>("/api/personas"),
  life: (id: string) => call<PersonaLife>(`/api/persona/${id}`),
};

export type { PersonaLife, PersonaReading };
