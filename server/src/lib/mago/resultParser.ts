import { Connection } from 'vscode-languageserver';
import { MagoResult, MagoIssue, MagoFileResult } from '@shared/types';

export class ResultParser {
  private connection: Connection;

  constructor(connection: Connection) {
    this.connection = connection;
  }

  parseJsonOutput(jsonString: string): MagoResult | null {
    try {
      // Handle streaming output where we might get multiple JSON objects
      const lines = jsonString.trim().split('\n');
      let result: MagoResult | null = null;

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        try {
          const parsed = JSON.parse(trimmedLine);

          // Handle Mago's JSON format
          if (parsed.issues) {
            const magoResult = this.convertMagoJsonToResult(parsed);
            // Merge results if we have multiple
            if (result) {
              result = this.mergeResults(result, magoResult);
            } else {
              result = magoResult;
            }
          } else {
            this.connection.console.log(`Skipping unrecognized JSON: ${trimmedLine}`);
          }
        } catch (parseError) {
          // If this line isn't valid JSON, skip it (might be progress messages)
          this.connection.console.log(`Skipping non-JSON line: ${trimmedLine}`);
          continue;
        }
      }

      return result;
    } catch (error) {
      this.connection.console.error(`Failed to parse mago output: ${error}`);
      return null;
    }
  }

  private convertMagoJsonToResult(magoJson: any): MagoResult {
    const files: Record<string, MagoFileResult> = {};

    if (magoJson.issues && Array.isArray(magoJson.issues)) {
      for (const issue of magoJson.issues) {
        const filePath = issue.annotations?.[0]?.span?.file_id?.path;
        if (!filePath) continue;

        if (!files[filePath]) {
          files[filePath] = { issues: [] };
        }

        const magoIssue: MagoIssue = {
          code: issue.code,
          severity: this.mapLevelToSeverity(issue.level),
          message: issue.message,
          line: issue.annotations[0].span.start.line + 1, // Convert to 1-based
          column: issue.annotations[0].span.start.offset - issue.annotations[0].span.start.line * this.estimateLineLength(issue.annotations[0].span) + 1, // Rough column calculation
          fixable: issue.edits && issue.edits.length > 0,
          rule: issue.code,
        };

        files[filePath].issues.push(magoIssue);
      }
    }

    return { files };
  }

  private estimateLineLength(span: any): number {
    // Rough estimation - in a real implementation, we'd need to read the file
    // For now, assume a reasonable line length
    return 80;
  }

  private mapLevelToSeverity(level: string): 'error' | 'warning' | 'note' | 'help' {
    switch (level.toLowerCase()) {
      case 'error':
        return 'error';
      case 'warning':
        return 'warning';
      case 'note':
        return 'note';
      case 'help':
      default:
        return 'help';
    }
  }

  private mergeResults(result1: MagoResult, result2: MagoResult): MagoResult {
    const merged: MagoResult = {
      files: { ...result1.files },
    };

    // Merge file results
    for (const [filePath, fileResult] of Object.entries(result2.files)) {
      if (merged.files[filePath]) {
        // Merge issues for the same file
        merged.files[filePath].issues = [
          ...merged.files[filePath].issues,
          ...fileResult.issues,
        ];
      } else {
        merged.files[filePath] = fileResult;
      }
    }

    // Merge summaries if they exist
    if (result1.summary && result2.summary) {
      merged.summary = {
        total: result1.summary.total + result2.summary.total,
        errors: result1.summary.errors + result2.summary.errors,
        warnings: result1.summary.warnings + result2.summary.warnings,
      };
    } else if (result1.summary) {
      merged.summary = result1.summary;
    } else if (result2.summary) {
      merged.summary = result2.summary;
    }

    return merged;
  }

  parseStreamingOutput(data: string): MagoResult[] {
    // For watch mode, parse streaming JSON output line by line
    const lines = data.split('\n');
    const results: MagoResult[] = [];

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;

      try {
        const result = JSON.parse(trimmedLine) as MagoResult;
        results.push(result);
      } catch (error) {
        // Skip non-JSON lines
        continue;
      }
    }

    return results;
  }

  validateIssue(issue: any): issue is MagoIssue {
    return (
      typeof issue === 'object' &&
      typeof issue.code === 'string' &&
      typeof issue.severity === 'string' &&
      ['error', 'warning', 'note', 'help'].includes(issue.severity) &&
      typeof issue.message === 'string' &&
      typeof issue.line === 'number' &&
      typeof issue.column === 'number'
    );
  }

  validateResult(result: any): result is MagoResult {
    if (!result || typeof result !== 'object') return false;

    if (!result.files || typeof result.files !== 'object') return false;

    // Validate each file's issues
    for (const [filePath, fileResult] of Object.entries(result.files)) {
      if (typeof filePath !== 'string') return false;
      if (!fileResult || typeof fileResult !== 'object') return false;
      if (!Array.isArray((fileResult as any).issues)) return false;

      for (const issue of (fileResult as any).issues) {
        if (!this.validateIssue(issue)) return false;
      }
    }

    return true;
  }
}
