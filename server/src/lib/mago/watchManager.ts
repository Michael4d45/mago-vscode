import { ChildProcess } from 'child_process';
import { Connection } from 'vscode-languageserver';
import { ProcessRunner } from './processRunner';
import { ResultParser } from './resultParser';
import { MagoConfig } from '@shared/config';
import { WatchModeUpdate } from '@shared/types';
import { NOTIFICATIONS } from '@shared/notificationChannels';
import { ErrorManager } from '../errorManager';

export class WatchManager {
  private connection: Connection;
  private processRunner: ProcessRunner;
  private resultParser: ResultParser;
  private errorManager: ErrorManager;
  private config: MagoConfig;

  private analyzeProcess: ChildProcess | null = null;
  private isRunning = false;

  constructor(
    connection: Connection,
    processRunner: ProcessRunner,
    resultParser: ResultParser,
    errorManager: ErrorManager,
    config: MagoConfig
  ) {
    this.connection = connection;
    this.processRunner = processRunner;
    this.resultParser = resultParser;
    this.errorManager = errorManager;
    this.config = config;
  }

  start(): void {
    if (this.isRunning) {
      return;
    }

    this.isRunning = true;
    this.connection.console.log('Starting watch mode...');

    try {
      // Only analyze supports watch mode in current Mago version
      this.startAnalyzeWatch();
      this.errorManager.sendStatusUpdate('analyze', 'running', 'Watch mode active');
    } catch (error) {
      this.connection.console.error(`Failed to start watch mode: ${error}`);
      this.isRunning = false;
      this.errorManager.sendStatusUpdate('analyze', 'error', 'Failed to start watch mode');
    }
  }

  stop(): void {
    if (!this.isRunning) {
      return;
    }

    this.connection.console.log('Stopping watch mode...');

    if (this.analyzeProcess) {
      this.analyzeProcess.kill('SIGTERM');
      this.analyzeProcess = null;
    }

    this.isRunning = false;
    this.errorManager.sendStatusUpdate('analyze', 'idle', 'Watch mode stopped');
  }

  private startAnalyzeWatch(): void {
    if (!this.config.enableAnalyze) {
      return;
    }

    const args = this.buildWatchArgs();
    this.analyzeProcess = this.processRunner.spawnWatchProcess(args, this.getWorkspaceRoot());

    this.setupProcessHandlers(this.analyzeProcess, 'analyze');
  }

  private setupProcessHandlers(process: ChildProcess, type: 'lint' | 'analyze'): void {
    let buffer = '';

    process.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString();

      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.trim()) {
          this.processWatchOutput(line, type);
        }
      }
    });

    process.stderr?.on('data', (data: Buffer) => {
      const errorOutput = data.toString();
      // Filter out non-error messages
      if (errorOutput.trim() && !this.isIgnoredStderr(errorOutput)) {
        this.connection.console.error(`[${type}] ${errorOutput}`);
      }
    });

    process.on('close', (code) => {
      this.connection.console.log(`analyze watch process exited with code ${code}`);

      this.analyzeProcess = null;

      // Restart the process if we're still supposed to be running
      if (this.isRunning && this.config.enableAnalyze) {
        this.connection.console.log(`Restarting analyze watch process...`);
        this.startAnalyzeWatch();
      }
    });

    process.on('error', (error) => {
      this.connection.console.error(`${type} watch process error: ${error.message}`);
    });
  }

  private processWatchOutput(output: string, type: 'lint' | 'analyze'): void {
    const results = this.resultParser.parseStreamingOutput(output);

    for (const result of results) {
      if (this.resultParser.validateResult(result)) {
        this.errorManager.handleDiagnosticsUpdate({
          type,
          result,
        });
      } else {
        this.connection.console.warn(`Invalid ${type} result received: ${JSON.stringify(result)}`);
      }
    }
  }

  private buildWatchArgs(): string[] {
    const args = ['analyze', '--watch', '--reporting-format', 'json'];

    if (this.config.configFile) {
      args.push('--config', this.config.configFile);
    }

    if (this.config.phpVersion) {
      args.push('--php-version', this.config.phpVersion);
    }

    if (this.config.threads) {
      args.push('--threads', this.config.threads.toString());
    }

    // Add minimum severity levels
    args.push('--minimum-report-level', this.config.minimumReportLevel);

    return args;
  }

  private getWorkspaceRoot(): string {
    // Get workspace root from connection
    // This is a simplified implementation - in a real scenario,
    // we'd get this from the LSP initialization params
    return process.cwd();
  }

  private isIgnoredStderr(output: string): boolean {
    const ignoredPatterns = [
      'Watching files for changes',
      'Found',
      /^\s*$/, // Empty lines
    ];

    return ignoredPatterns.some(pattern => {
      if (typeof pattern === 'string') {
        return output.includes(pattern);
      }
      return pattern.test(output);
    });
  }

  updateConfig(config: MagoConfig): void {
    const needsRestart = this.configNeedsRestart(this.config, config);

    this.config = config;
    this.processRunner.updateConfig(config);

    if (needsRestart && this.isRunning) {
      this.stop();
      this.start();
    }
  }

  private configNeedsRestart(oldConfig: MagoConfig, newConfig: MagoConfig): boolean {
    return (
      oldConfig.binPath !== newConfig.binPath ||
      JSON.stringify(oldConfig.binCommand) !== JSON.stringify(newConfig.binCommand) ||
      oldConfig.configFile !== newConfig.configFile ||
      oldConfig.phpVersion !== newConfig.phpVersion ||
      oldConfig.threads !== newConfig.threads ||
      oldConfig.enableAnalyze !== newConfig.enableAnalyze
    );
  }

  isWatchModeActive(): boolean {
    return this.isRunning;
  }
}
