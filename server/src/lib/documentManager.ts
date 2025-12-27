import { Connection, TextDocuments } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { FileEvent } from '@shared/types';
import { NOTIFICATIONS } from '@shared/notificationChannels';

export class DocumentManager {
  private connection: Connection;
  private documents: TextDocuments<TextDocument>;
  private documentSettings: Map<string, any> = new Map();

  constructor(connection: Connection, documents: TextDocuments<TextDocument>) {
    this.connection = connection;
    this.documents = documents;

    // Listen for document events
    this.documents.onDidOpen(this.handleDocumentOpen.bind(this));
    this.documents.onDidChangeContent(this.handleDocumentChange.bind(this));
    this.documents.onDidSave(this.handleDocumentSave.bind(this));
    this.documents.onDidClose(this.handleDocumentClose.bind(this));
  }

  private handleDocumentOpen(event: { document: TextDocument }): void {
    this.sendFileEvent(event.document.uri, 'open', event.document.getText(), event.document.version);
  }

  private handleDocumentChange(event: { document: TextDocument }): void {
    // Only send events for PHP files
    if (!event.document.uri.endsWith('.php')) {
      return;
    }

    // Debounce rapid changes
    this.sendFileEvent(event.document.uri, 'change', event.document.getText(), event.document.version);
  }

  private handleDocumentSave(event: { document: TextDocument }): void {
    this.sendFileEvent(event.document.uri, 'save', event.document.getText(), event.document.version);
  }

  private handleDocumentClose(event: { document: TextDocument }): void {
    this.sendFileEvent(event.document.uri, 'close');
  }

  removeDocument(document: TextDocument): void {
    this.documentSettings.delete(document.uri);
  }

  resetSettings(): void {
    this.documentSettings.clear();
  }

  sendFileEvent(uri: string, type: string, content?: string, version?: number): void {
    const event: FileEvent = {
      uri,
      content,
      version,
    };

    this.connection.sendNotification(NOTIFICATIONS.FILE_EVENT, event);
  }

  async getDocumentSettings(uri: string): Promise<any> {
    if (this.documentSettings.has(uri)) {
      return this.documentSettings.get(uri);
    }

    // Get settings from client
    const settings = await this.connection.workspace.getConfiguration({
      scopeUri: uri,
      section: 'mago',
    });

    this.documentSettings.set(uri, settings);
    return settings;
  }
}
