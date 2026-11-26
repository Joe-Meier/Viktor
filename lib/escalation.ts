import type { LevelId } from "./types";

export interface EscalationLevel {
  id: LevelId;
  label: string;
  guidance: string;
}

export const LEVELS: readonly EscalationLevel[] = [
  {
    id: 1,
    label: "Minor family involvement",
    guidance:
      "One uncle is quietly involved in the decision. Keep the complication small and believable: a preference, a habit, a process that is slightly old-fashioned. The reply could plausibly be real.",
  },
  {
    id: 2,
    label: "Informal family oversight",
    guidance:
      "The family's involvement now shapes the buying process. Ask for something specific and mildly unusual that follows from an uncle's established habits or preferences.",
  },
  {
    id: 3,
    label: "Overlapping jurisdictions",
    guidance:
      "Authority over the purchase is unclear. Requirements may conflict, an uncle may assert a say over part of the decision, and the salesperson is asked to accommodate more than one position at once.",
  },
  {
    id: 4,
    label: "Formal family proceedings",
    guidance:
      "The family runs procurement like a governing body: motions, minutes, recusals, notice periods, information kept between specific uncles. Impose a concrete procedural requirement on the vendor.",
  },
  {
    id: 5,
    label: "Constitutional uncle crisis",
    guidance:
      "The family's governing structure itself is in dispute: competing claims of authority, founding documents, emergency sessions, contested succession. Stay calm and businesslike; the crisis is treated as a routine scheduling matter.",
  },
] as const;

export const DEFAULT_LEVEL: LevelId = 1;

export function getLevel(id: number): EscalationLevel {
  return LEVELS.find((l) => l.id === id) ?? LEVELS[0];
}

export function isLevelId(n: unknown): n is LevelId {
  return typeof n === "number" && LEVELS.some((l) => l.id === n);
}
