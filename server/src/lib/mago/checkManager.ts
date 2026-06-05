import { Connection } from 'vscode-languageserver';
import { ProcessRunner } from './processRunner';
import { ResultParser } from './resultParser';
import { WatchManager } from './watchManager';
import { ConfigResolver } from '../configResolver';
import { ErrorManager } from '../errorManager';
import { MagoConfig, DEFAULT_CONFIG } from '@shared/config';
import { MagoResult, WatchModeUpdate } from '@shared/types';
import { NOTIFICATIONS } from '@shared/notificationChannels';

export class CheckManager {
  private connection: Connection;
  private configResolver: ConfigResolver;
  private errorManager: ErrorManager;

  private processRunner: ProcessRunner;
  private resultParser: ResultParser;
  private watchManager: WatchManager;

  private currentConfig: MagoConfig;

  constructor(
    connection: Connection,
    configResolver: ConfigResolver,
    errorManager: ErrorManager
  ) {
    this.connection = connection;
    this.configResolver = configResolver;
    this.errorManager = errorManager;

    // Initialize with default config - will be updated when we get workspace info
    this.currentConfig = {
      ...DEFAULT_CONFIG,
    };

    this.processRunner = new ProcessRunner(connection, this.currentConfig);
    this.resultParser = new ResultParser(connection);
    this.watchManager = new WatchManager(
      connection,
      this.processRunner,
      this.resultParser,
      this.errorManager,
      this.currentConfig
    );
  }

  async start(): Promise<void> {
    // Get workspace root from connection
    const workspaceRoot = this.getWorkspaceRoot();

    if (workspaceRoot) {
      this.currentConfig = await this.configResolver.resolveConfig(workspaceRoot);
      this.watchManager.updateConfig(this.currentConfig);
      this.processRunner.updateConfig(this.currentConfig);
    }

    // Watch mode is not currently used - using on-demand scanning instead
    // if (this.currentConfig.useWatchMode) {
    //   this.watchManager.start();
    // }
  }

  stop(): void {
    this.watchManager.stop();
    this.processRunner.killAllProcesses();
  }

  async scanFile(uri: string): Promise<void> {
    // Run analyze on-demand
    if (this.currentConfig.enableAnalyze) {
      await this.runAnalyzeOnDemand(uri);
    }

    // Always run lint on-demand (no watch mode for lint)
    if (this.currentConfig.enableLint) {
      await this.runLintOnDemand(uri);
    }
  }

  private async runLintOnDemand(uri: string): Promise<void> {
    const filePath = this.uriToFilePath(uri);
    const workspaceRoot = this.getWorkspaceRoot();

    if (!workspaceRoot || !filePath) {
      return;
    }

    try {
      const result = await this.runOnDemandCheck('lint', [filePath], workspaceRoot);
      if (result) {
        this.sendDiagnosticsUpdate('lint', result);
      }
    } catch (error) {
      this.connection.console.error(`Failed to lint file ${uri}: ${error}`);
    }
  }

  private async runAnalyzeOnDemand(uri: string): Promise<void> {
    const filePath = this.uriToFilePath(uri);
    const workspaceRoot = this.getWorkspaceRoot();

    if (!workspaceRoot || !filePath) {
      return;
    }

    try {
      const result = await this.runOnDemandCheck('analyze', [filePath], workspaceRoot);
      if (result) {
        this.sendDiagnosticsUpdate('analyze', result);
      }
    } catch (error) {
      this.connection.console.error(`Failed to analyze file ${uri}: ${error}`);
    }
  }

  async scanProject(): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();

    if (!workspaceRoot) {
      return;
    }

    // Always run lint on-demand (no watch mode for lint)
    if (this.currentConfig.enableLint) {
      try {
        const result = await this.runOnDemandCheck('lint', [], workspaceRoot);
        if (result) {
          this.sendDiagnosticsUpdate('lint', result);
        }
      } catch (error) {
        this.connection.console.error(`Failed to lint project: ${error}`);
      }
    }

    // Run analyze on-demand
    if (this.currentConfig.enableAnalyze) {
      try {
        const result = await this.runOnDemandCheck('analyze', [], workspaceRoot);
        if (result) {
          this.sendDiagnosticsUpdate('analyze', result);
        }
      } catch (error) {
        this.connection.console.error(`Failed to analyze project: ${error}`);
      }
    }
  }

  async clearErrors(): Promise<void> {
    // Send empty diagnostics for all files
    const emptyResult: MagoResult = { files: {} };
    const update: WatchModeUpdate = {
      type: 'lint', // Clear both by sending empty lint result
      result: emptyResult,
    };

    this.connection.sendNotification(NOTIFICATIONS.DIAGNOSTICS_UPDATE, update);
  }

  private async runOnDemandCheck(
    command: string,
    files: string[],
    cwd: string
  ): Promise<MagoResult | null> {
    const args = [command, '--reporting-format', 'json'];

    if (this.currentConfig.configFile) {
      args.push('--config', this.currentConfig.configFile);
    }

    if (this.currentConfig.phpVersion) {
      args.push('--php-version', this.currentConfig.phpVersion);
    }

    if (this.currentConfig.threads) {
      args.push('--threads', this.currentConfig.threads.toString());
    }

    // Add baseline if enabled
    if (this.currentConfig.useBaselines) {
      let baselinePath: string;
      if (command === 'lint') {
        baselinePath = this.resolvePath(this.currentConfig.lintBaseline, cwd);
      } else if (command === 'analyze') {
        baselinePath = this.resolvePath(this.currentConfig.analysisBaseline, cwd);
      } else {
        baselinePath = ''; // Should not happen, but satisfy TypeScript
      }
      if (baselinePath) {
        args.push('--baseline', baselinePath);
      }
    }

    // Add minimum report level
    args.push('--minimum-report-level', this.currentConfig.minimumReportLevel);

    // Add files if specified
    args.push(...files);

    const result = await this.processRunner.runCommand(args, cwd, this.currentConfig.timeout);

    if (result.exitCode !== 0 && result.stderr) {
      this.connection.console.error(`Command failed: ${result.stderr}`);
      return null;
    }

    return this.resultParser.parseJsonOutput(result.stdout);
  }

  private resolvePath(path: string, workspaceRoot: string): string {
    // Resolve VS Code configuration variables
    return path
      .replace(/\${workspaceFolder}/g, workspaceRoot)
      .replace(/\${workspaceRoot}/g, workspaceRoot)
      .replace(/\${env:([^}]+)}/g, (_, varName) => process.env[varName] || '');
  }

  private sendDiagnosticsUpdate(type: 'lint' | 'analyze', result: MagoResult): void {
    this.errorManager.handleDiagnosticsUpdate({
      type,
      result,
    });
  }

  private getWorkspaceRoot(): string | undefined {
    // In a real implementation, we'd get this from the LSP initialization params
    // For now, use the current working directory
    return process.cwd();
  }

  private uriToFilePath(uri: string): string | null {
    // Convert file:// URI to file path
    if (uri.startsWith('file://')) {
      return decodeURIComponent(uri.substring(7));
    }
    return null;
  }

  async updateConfig(): Promise<void> {
    const workspaceRoot = this.getWorkspaceRoot();
    if (workspaceRoot) {
      const newConfig = await this.configResolver.resolveConfig(workspaceRoot);

      if (JSON.stringify(this.currentConfig) !== JSON.stringify(newConfig)) {
        this.currentConfig = newConfig;
        this.watchManager.updateConfig(newConfig);
        this.processRunner.updateConfig(newConfig);

        // Watch mode is not currently used - using on-demand scanning instead
        // if (newConfig.useWatchMode && !this.watchManager.isWatchModeActive()) {
        //   this.watchManager.start();
        // } else if (!newConfig.useWatchMode && this.watchManager.isWatchModeActive()) {
        //   this.watchManager.stop();
        // }
      }
    }
  }
}
