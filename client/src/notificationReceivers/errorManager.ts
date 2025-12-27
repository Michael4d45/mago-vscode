import {
  Connection,
  Diagnostic,
  DiagnosticSeverity,
  PublishDiagnosticsParams,
} from 'vscode-languageserver';
import { WatchModeUpdate, issueToDiagnostic } from '@shared/types';

export class ErrorManager {
  private connection: Connection;
  private diagnostics: Map<string, Diagnostic[]> = new Map();

  constructor(connection: Connection) {
    this.connection = connection;
  }

  handleDiagnosticsUpdate(update: WatchModeUpdate): void {
    const { type, result } = update;

    // Convert file paths to URIs
    for (const [filePath, fileResult] of Object.entries(result.files)) {
      const uri = this.filePathToUri(filePath);
      const existingDiagnostics = this.diagnostics.get(uri) || [];

      // Filter existing diagnostics by type (lint vs analyze)
      const otherTypeDiagnostics = existingDiagnostics.filter(d => !this.isDiagnosticOfType(d, type));
      const newDiagnostics = (fileResult as any).issues.map(issueToDiagnostic);

      // Combine diagnostics
      const allDiagnostics = [...otherTypeDiagnostics, ...newDiagnostics];
      this.diagnostics.set(uri, allDiagnostics);

      // Send to client
      this.sendDiagnostics(uri, allDiagnostics);
    }

    // Clear diagnostics for files that no longer have issues
    const reportedFiles = new Set(Object.keys(result.files).map(fp => this.filePathToUri(fp)));
    for (const [uri, diagnostics] of this.diagnostics.entries()) {
      if (!reportedFiles.has(uri)) {
        // Remove diagnostics of the current type
        const filteredDiagnostics = diagnostics.filter(d => !this.isDiagnosticOfType(d, type));
        if (filteredDiagnostics.length !== diagnostics.length) {
          this.diagnostics.set(uri, filteredDiagnostics);
          this.sendDiagnostics(uri, filteredDiagnostics);
        }
      }
    }
  }

  clearAllDiagnostics(): void {
    for (const [uri, diagnostics] of this.diagnostics.entries()) {
      if (diagnostics.length > 0) {
        this.sendDiagnostics(uri, []);
      }
    }
    this.diagnostics.clear();
  }

  clearDiagnosticsForFile(uri: string): void {
    if (this.diagnostics.has(uri)) {
      this.diagnostics.delete(uri);
      this.sendDiagnostics(uri, []);
    }
  }

  private sendDiagnostics(uri: string, diagnostics: Diagnostic[]): void {
    const params: PublishDiagnosticsParams = {
      uri,
      diagnostics,
    };

    this.connection.sendDiagnostics(params);
  }

  private filePathToUri(filePath: string): string {
    // Convert file path to file:// URI
    const normalizedPath = filePath.replace(/\\/g, '/');
    return `file://${normalizedPath}`;
  }

  private isDiagnosticOfType(diagnostic: Diagnostic, type: 'lint' | 'analyze'): boolean {
    // For now, we can't easily distinguish between lint and analyze diagnostics
    // since Mago might not provide a way to differentiate them in the issue data.
    // This is a simplified implementation - in practice, we might need to track
    // diagnostics by their source or add type information to the diagnostic.
    return true; // Assume all diagnostics can be from either type
  }

  getDiagnosticsForFile(uri: string): Diagnostic[] {
    return this.diagnostics.get(uri) || [];
  }

  getAllDiagnostics(): Map<string, Diagnostic[]> {
    return new Map(this.diagnostics);
  }
}
