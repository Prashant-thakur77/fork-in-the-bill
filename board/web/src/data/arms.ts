export interface ArmInfo {
  tab: string;
  legend: string;
  sub: string;
}

const ARMS: Record<string, ArmInfo> = {
  control: { tab: "control", legend: "Frontier everywhere", sub: "Every call goes to the frontier model." },
  lanes_v1: { tab: "lanes_v1", legend: "Small delegate", sub: "Frontier plans and patches. A small model does the grunt work." },
  lanes_v2: { tab: "lanes_v2", legend: "Small model drafts", sub: "The small model writes a first patch. The frontier model reviews and corrects it." },
};

// What an arm means depends on the batch: after experiment 1 the winner became the flag's own
// value, so "control" in experiment 2 is the lanes_v1 policy.
const BY_BATCH: Record<string, Record<string, ArmInfo>> = {
  exp2: {
    control: { tab: "control", legend: "Small model reads", sub: "The rolled-out lanes_v1 policy: the small model explores and reports, the frontier model writes every edit." },
  },
  rollout: {
    lanes_v1: { tab: "lanes_v1", legend: "The winner, rolled out", sub: "Every task gets the lanes_v1 policy as the flag's own value. No comparison arm." },
  },
};

export function armInfo(key: string, batch?: string): ArmInfo {
  return (batch && BY_BATCH[batch]?.[key]) || ARMS[key] || { tab: key, legend: key, sub: "" };
}

/** Lane order on the road: control on the left, challengers to the right. */
export function orderArms(keys: string[]): string[] {
  return [...keys].sort((a, b) => (a === "control" ? -1 : b === "control" ? 1 : a.localeCompare(b)));
}

export const DEFAULT_ARMS = ["control", "lanes_v1"];
