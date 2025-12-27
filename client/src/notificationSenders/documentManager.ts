import { Connection, TextDocumentChangeEvent } from 'vscode-languageserver';
import { FileEvent } from '@shared/types';
import { NOTIFICATIONS } from '@shared/notificationChannels';

export class ClientDocumentManager {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  handleDocumentChange(event: any): void {
    // Only handle PHP files
    if (!event.document.uri.endsWith('.php')) {
      return;
    }

    const fileEvent: FileEvent = {
      uri: event.document.uri,
      content: event.document.getText(),
      version: event.document.version,
    };

    this.connection.sendNotification(NOTIFICATIONS.FILE_EVENT, fileEvent);
  }

  handleDocumentSave(uri: string, content: string, version?: number): void {
    const fileEvent: FileEvent = {
      uri,
      content,
      version,
    };

    this.connection.sendNotification(NOTIFICATIONS.FILE_EVENT, fileEvent);
  }

  handleDocumentOpen(uri: string, content: string, version?: number): void {
    const fileEvent: FileEvent = {
      uri,
      content,
      version,
    };

    this.connection.sendNotification(NOTIFICATIONS.FILE_EVENT, fileEvent);
  }

  handleDocumentClose(uri: string): void {
    const fileEvent: FileEvent = {
      uri,
    };

    this.connection.sendNotification(NOTIFICATIONS.FILE_EVENT, fileEvent);
  }
}
