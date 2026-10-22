import type { Mission, MissionHistoryEntry } from '../types/mission';

export class MissionEngine {
  private readonly missions: Mission[];

  constructor(missions: Mission[]) { this.missions = missions; }

  available(history: MissionHistoryEntry[]): Mission[] {
    const used = new Set(history.map((entry) => entry.missionId));
    // Catalogue order is intentional: varied prompts, with the final theory last.
    // Selection is derived from earned progress, not mutable render-time queues.
    return this.missions.filter((mission) => !used.has(mission.id));
  }

  next(history: MissionHistoryEntry[], preferredId?: string): Mission | null {
    const choices = this.available(history);
    return choices.find((mission) => mission.id === preferredId) ?? choices[0] ?? null;
  }

  getById(id: string | null): Mission | null { return this.missions.find((mission) => mission.id === id) ?? null; }
  get total(): number { return this.missions.length; }
}
