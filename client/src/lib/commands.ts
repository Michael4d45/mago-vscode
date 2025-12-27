import { Connection } from 'vscode-languageserver';
import { COMMANDS } from '@shared/commands/defs';

export class CommandHandler {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  async handleCommand(command: string, ...args: any[]): Promise<any> {
    switch (command) {
      case COMMANDS.SCAN_FILE:
        return this.handleScanFile(args[0]);
      case COMMANDS.SCAN_PROJECT:
        return this.handleScanProject();
      case COMMANDS.CLEAR_ERRORS:
        return this.handleClearErrors();
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  }

  private async handleScanFile(uri: string): Promise<void> {
    // Send scan file request to server
    return this.connection.sendRequest('mago/scanFile', { uri });
  }

  private async handleScanProject(): Promise<void> {
    // Send scan project request to server
    return this.connection.sendRequest('mago/scanProject');
  }

  private async handleClearErrors(): Promise<void> {
    // Send clear errors request to server
    return this.connection.sendRequest('mago/clearErrors');
  }
}
