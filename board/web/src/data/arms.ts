export interface ArmInfo {
  tab: string;
  legend: string;
  sub: string;
}

const ARMS: Record<string, ArmInfo> = {
  control: { tab: "control", legend: "Frontier everywhere", sub: "Every call goes to the frontier model." },
  lanes_v1: { tab: "lanes_v1", legend: "Small delegate", sub: "Frontier plans and patches. A small model does the grunt work." },
  lanes_v2: { tab: "lanes_v2", legend: "Small drafts", sub: "A small model drafts the patch. Frontier reviews it." },
};

export function armInfo(key: string): ArmInfo {
  return ARMS[key] ?? { tab: key, legend: key, sub: "" };
}

/** Lane order on the road: control on the left, challengers to the right. */
export function orderArms(keys: string[]): string[] {
  return [...keys].sort((a, b) => (a === "control" ? -1 : b === "control" ? 1 : a.localeCompare(b)));
}

export const DEFAULT_ARMS = ["control", "lanes_v1"];
