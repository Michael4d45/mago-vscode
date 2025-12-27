import { Connection } from 'vscode-languageserver';
import { WatchModeUpdate } from '@shared/types';
import { NOTIFICATIONS } from '@shared/notificationChannels';

export class ErrorManager {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  handleDiagnosticsUpdate(update: WatchModeUpdate): void {
    // Send diagnostics update to client
    this.connection.sendNotification(NOTIFICATIONS.DIAGNOSTICS_UPDATE, update);
  }

  sendError(message: string, details?: any): void {
    this.connection.sendNotification(NOTIFICATIONS.ERROR_OCCURRED, {
      message,
      details,
    });
  }

  sendStatusUpdate(type: 'lint' | 'analyze', status: 'running' | 'idle' | 'error', message?: string): void {
    this.connection.sendNotification(NOTIFICATIONS.STATUS_UPDATE, {
      type,
      status,
      message,
    });
  }
}
