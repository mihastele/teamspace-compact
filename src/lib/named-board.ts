import type { BoardProperty } from "./model";
import { defaultTicketViews, validateViewConfig, type SavedView, type ViewConfig } from "./ticket-query";

export function newNamedBoard(): ViewConfig {
  const { id, ...config } = defaultTicketViews()[0];
  void id;
  return { ...config, name: "New board" };
}

/** Keep the exact request across response loss, and the acknowledgement across link failure. */
export class NamedBoardCreation {
  private packet?: { config: ViewConfig; operationId: string };
  private acknowledged?: SavedView;
  private running = false;

  get started() { return Boolean(this.packet); }

  async save(config: ViewConfig, properties: BoardProperty[], createId: () => string,
    save: (config: ViewConfig, controls: { operationId: string }) => Promise<SavedView>): Promise<SavedView> {
    if (this.running) throw new Error("Board creation is already in progress.");
    this.running = true;
    try {
      if (!this.packet) this.packet = { config: structuredClone(validateViewConfig(config, properties)), operationId: createId() };
      if (!this.acknowledged) this.acknowledged = await save(structuredClone(this.packet.config), { operationId: this.packet.operationId });
      return this.acknowledged;
    } finally { this.running = false; }
  }
}
