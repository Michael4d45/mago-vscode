import { spawn, ChildProcess } from 'child_process';
import { Connection } from 'vscode-languageserver';
import { MagoConfig } from '@shared/config';

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export class ProcessRunner {
  private connection: Connection;
  private config: MagoConfig;
  private runningProcesses: Set<ChildProcess> = new Set();

  constructor(connection: Connection, config: MagoConfig) {
    this.connection = connection;
    this.config = config;
  }

  async runCommand(args: string[], cwd: string, timeout?: number): Promise<ProcessResult> {
    const command = this.buildCommand(args);
    const env = { ...process.env };

    return new Promise((resolve, reject) => {
      this.connection.console.log(`Running command: ${command.join(' ')} in ${cwd}`);

      const childProcess = spawn(command[0], command.slice(1), {
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.runningProcesses.add(childProcess);

      let stdout = '';
      let stderr = '';
      let timeoutId: NodeJS.Timeout | undefined;

      childProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      childProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      childProcess.on('close', (code) => {
        this.runningProcesses.delete(childProcess);
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        // Filter out common stderr messages that aren't actual errors
        const filteredStderr = this.filterStderr(stderr);

        resolve({
          stdout,
          stderr: filteredStderr,
          exitCode: code || 0,
        });
      });

      childProcess.on('error', (error) => {
        this.runningProcesses.delete(childProcess);
        if (timeoutId) {
          clearTimeout(timeoutId);
        }
        reject(error);
      });

      // Set timeout if specified
      if (timeout) {
        timeoutId = setTimeout(() => {
          this.runningProcesses.delete(childProcess);
          childProcess.kill('SIGTERM');

          // Give it a moment, then force kill
          setTimeout(() => {
            if (!childProcess.killed) {
              childProcess.kill('SIGKILL');
            }
          }, 5000);

          reject(new Error(`Command timed out after ${timeout}ms`));
        }, timeout);
      }
    });
  }

  spawnWatchProcess(args: string[], cwd: string): ChildProcess {
    const command = this.buildCommand(args);
    const env = { ...process.env };

    this.connection.console.log(`Spawning watch process: ${command.join(' ')} in ${cwd}`);

    const childProcess = spawn(command[0], command.slice(1), {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.runningProcesses.add(childProcess);

    childProcess.on('close', (code) => {
      this.runningProcesses.delete(childProcess);
      this.connection.console.log(`Watch process exited with code ${code}`);
    });

    childProcess.on('error', (error) => {
      this.runningProcesses.delete(childProcess);
      this.connection.console.error(`Watch process error: ${error.message}`);
    });

    return childProcess;
  }

  private buildCommand(args: string[]): string[] {
    if (this.config.binCommand && this.config.binCommand.length > 0) {
      return [...this.config.binCommand, ...args];
    }

    return [this.config.binPath, ...args];
  }

  private filterStderr(stderr: string): string {
    // Filter out common non-error messages from stderr
    const lines = stderr.split('\n');
    const filteredLines = lines.filter(line => {
      // Filter out common mago stderr messages that aren't errors
      if (line.includes('Watching files for changes')) return false;
      if (line.includes('Found')) return false;
      if (line.trim() === '') return false;

      return true;
    });

    return filteredLines.join('\n');
  }

  killAllProcesses(): void {
    for (const process of this.runningProcesses) {
      try {
        process.kill('SIGTERM');
      } catch (error) {
        // Ignore errors when killing processes
      }
    }
    this.runningProcesses.clear();
  }

  updateConfig(config: MagoConfig): void {
    this.config = config;
  }
}
