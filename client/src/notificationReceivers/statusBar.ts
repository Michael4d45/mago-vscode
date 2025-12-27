import { Connection } from 'vscode-languageserver';
import { StatusUpdate } from '@shared/types';

export class StatusBarManager {
  private connection: Connection;
  private statusItems: Map<string, any> = new Map();

  constructor(connection: Connection) {
    this.connection = connection;
  }

  handleStatusUpdate(update: StatusUpdate): void {
    const { type, status, message } = update;

    // Send status update to client
    // In a real implementation, this would update VSCode's status bar
    // For now, we'll just log it
    this.connection.console.log(`[${type}] Status: ${status}${message ? ` - ${message}` : ''}`);

    // Store status for potential future use
    this.statusItems.set(type, { status, message });
  }

  getStatus(type: string): { status: string; message?: string } | undefined {
    return this.statusItems.get(type);
  }

  getAllStatuses(): Map<string, { status: string; message?: string }> {
    return new Map(this.statusItems);
  }

  clearStatus(type: string): void {
    this.statusItems.delete(type);
  }

  clearAllStatuses(): void {
    this.statusItems.clear();
  }
}
