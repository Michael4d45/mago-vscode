import { spawn, ChildProcess } from 'child_process';
import * as fs from 'fs';
import {
  ExtensionContext,
  workspace,
  commands,
  window,
  StatusBarAlignment,
  StatusBarItem,
  languages,
  Diagnostic,
  DiagnosticSeverity,
  Range,
  Uri,
  TextDocument,
  OutputChannel,
  TextEdit,
  WorkspaceEdit,
  DocumentFormattingEditProvider,
  FormattingOptions,
  CancellationToken,
} from 'vscode';
import { COMMANDS } from '@shared/commands/defs';

let diagnosticCollection = languages.createDiagnosticCollection('mago');
let statusBarItem: StatusBarItem | undefined;
let runningProcess: ChildProcess | undefined;
let outputChannel: OutputChannel | undefined;

interface MagoSpan {
  file_id: {
    name: string;
    path: string;
    size: number;
    file_type: string;
  };
  start: {
    offset: number;
    line: number;
  };
  end: {
    offset: number;
    line: number;
  };
}

interface MagoAnnotation {
  kind: string;
  span: MagoSpan;
}

interface MagoIssue {
  level: string; // "Error", "Warning", "Note", "Help"
  code: string;
  message: string;
  notes?: string[];
  help?: string;
  annotations: MagoAnnotation[];
  edits?: any[];
}

interface MagoResult {
  issues: MagoIssue[];
}

export function activate(context: ExtensionContext) {
  // Create output channel for logging
  outputChannel = window.createOutputChannel('Mago');
  outputChannel.appendLine('Mago extension activated');

  const config = workspace.getConfiguration('mago');
  const enabled = config.get<boolean>('enabled', true);

  if (!enabled) {
    outputChannel.appendLine('Mago extension is disabled');
    return;
  }

  // Create status bar item
  statusBarItem = window.createStatusBarItem(StatusBarAlignment.Left, 100);
  statusBarItem.text = '$(check) Mago';
  statusBarItem.tooltip = 'Mago';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Register commands
  context.subscriptions.push(
    commands.registerCommand(COMMANDS.SCAN_FILE, async () => {
      const activeEditor = window.activeTextEditor;
      if (activeEditor && activeEditor.document.languageId === 'php') {
        await scanFile(activeEditor.document);
      } else {
        window.showWarningMessage('Mago: Please open a PHP file to scan.');
      }
    }),

    commands.registerCommand(COMMANDS.SCAN_PROJECT, async () => {
      await scanProject();
    }),

    commands.registerCommand(COMMANDS.CLEAR_ERRORS, () => {
      diagnosticCollection.clear();
      updateStatusBar('idle');
    }),

    commands.registerCommand(COMMANDS.GENERATE_LINT_BASELINE, async () => {
      await generateBaseline('lint');
    }),

    commands.registerCommand(COMMANDS.GENERATE_ANALYSIS_BASELINE, async () => {
      await generateBaseline('analyze');
    }),

    commands.registerCommand(COMMANDS.FORMAT_FILE, async () => {
      const activeEditor = window.activeTextEditor;
      if (activeEditor && activeEditor.document.languageId === 'php') {
        await formatFile(activeEditor.document.uri.fsPath);
      } else {
        window.showWarningMessage('Mago: Please open a PHP file to format.');
      }
    }),

    commands.registerCommand(COMMANDS.FORMAT_DOCUMENT, async () => {
      const activeEditor = window.activeTextEditor;
      if (activeEditor && activeEditor.document.languageId === 'php') {
        await formatDocument(activeEditor.document);
      } else {
        window.showWarningMessage('Mago: Please open a PHP file to format.');
      }
    }),

    commands.registerCommand(COMMANDS.FORMAT_PROJECT, async () => {
      await formatProject();
    }),

    commands.registerCommand(COMMANDS.FORMAT_STAGED, async () => {
      await formatStaged();
    }),
  );

  // Run on save if configured
  const runOnSave = config.get<boolean>('runOnSave', true);
  if (runOnSave) {
    context.subscriptions.push(
      workspace.onDidSaveTextDocument(async (document: TextDocument) => {
        if (document.languageId === 'php' && document.uri.scheme === 'file') {
          await scanFile(document);
        }
      })
    );
  }

  // Register document formatting provider (allows Mago to be set as default formatter)
  const formatProvider: DocumentFormattingEditProvider = {
    provideDocumentFormattingEdits: async (
      document: TextDocument,
      options: FormattingOptions,
      token: CancellationToken
    ): Promise<TextEdit[]> => {
      if (document.languageId !== 'php' || document.uri.scheme !== 'file') {
        return [];
      }

      const config = workspace.getConfiguration('mago');
      const enableFormat = config.get<boolean>('enableFormat', true);
      
      if (!enableFormat) {
        return [];
      }

      try {
        const workspaceFolder = workspace.workspaceFolders?.[0];
        const workspaceRoot = workspaceFolder?.uri.fsPath || process.cwd();

        // Use stdin-input for formatting the document
        const formattedText = await runFormatCommandStdin(document.getText(), workspaceRoot);
        
        if (formattedText !== document.getText()) {
          const fullRange = new Range(
            document.positionAt(0),
            document.positionAt(document.getText().length)
          );
          return [TextEdit.replace(fullRange, formattedText)];
        }
      } catch (error) {
        outputChannel?.appendLine(`[ERROR] Format provider error: ${error}`);
        if (error instanceof Error) {
          outputChannel?.appendLine(`[ERROR] Stack: ${error.stack}`);
        }
        // Don't show error to user, just return empty array
      }

      return [];
    },
  };

  context.subscriptions.push(
    languages.registerDocumentFormattingEditProvider('php', formatProvider)
  );

  // Format on save if configured
  const formatOnSave = config.get<boolean>('formatOnSave', false);
  if (formatOnSave) {
    context.subscriptions.push(
      workspace.onWillSaveTextDocument(async (event) => {
        const document = event.document;
        if (document.languageId === 'php' && document.uri.scheme === 'file') {
          event.waitUntil(formatDocument(document));
        }
      })
    );
  }

  // Scan on open if configured
  const scanOnOpen = config.get<boolean>('scanOnOpen', true);
  if (scanOnOpen) {
    // Wait a bit for workspace to be fully ready, then scan
    setTimeout(async () => {
      const workspaceFolder = workspace.workspaceFolders?.[0];
      if (workspaceFolder) {
        await scanProject();
      }
    }, 1000);
  }

  // Clean up on deactivate
  context.subscriptions.push(diagnosticCollection);
  if (outputChannel) {
    context.subscriptions.push(outputChannel);
  }
}

export function deactivate(): void {
  if (runningProcess) {
    runningProcess.kill();
    runningProcess = undefined;
  }
  diagnosticCollection.dispose();
  if (statusBarItem) {
    statusBarItem.dispose();
  }
}

async function scanFile(document: TextDocument): Promise<void> {
  if (!document.uri.fsPath.endsWith('.php')) {
    return;
  }

  updateStatusBar('running');
  
  try {
    const config = workspace.getConfiguration('mago');
    const enableLint = config.get<boolean>('enableLint', true);
    const enableAnalyze = config.get<boolean>('enableAnalyze', true);
    const useBaselines = config.get<boolean>('useBaselines', false);
    
    const allIssues: MagoIssue[] = [];
    
    // Run lint if enabled
    if (enableLint) {
      try {
        const lintArgs = ['lint', '--reporting-format', 'json'];
        if (useBaselines) {
          const lintBaseline = config.get<string>('lintBaseline', 'lint-baseline.toml');
          const workspaceFolder = workspace.workspaceFolders?.[0];
          const workspaceRoot = workspaceFolder?.uri.fsPath || process.cwd();
          const baselinePath = resolvePath(lintBaseline, workspaceRoot);
          lintArgs.push('--baseline', baselinePath);
        }
        lintArgs.push(document.uri.fsPath);
        const lintResult = await runMago(lintArgs);
        if (lintResult && lintResult.issues) {
          allIssues.push(...lintResult.issues);
        }
      } catch (error) {
        outputChannel?.appendLine(`[WARN] Lint failed: ${error}`);
      }
    }
    
    // Run analyze if enabled
    if (enableAnalyze) {
      try {
        const analyzeArgs = ['analyze', '--reporting-format', 'json'];
        if (useBaselines) {
          const analysisBaseline = config.get<string>('analysisBaseline', 'analysis-baseline.toml');
          const workspaceFolder = workspace.workspaceFolders?.[0];
          const workspaceRoot = workspaceFolder?.uri.fsPath || process.cwd();
          const baselinePath = resolvePath(analysisBaseline, workspaceRoot);
          analyzeArgs.push('--baseline', baselinePath);
        }
        analyzeArgs.push(document.uri.fsPath);
        const analyzeResult = await runMago(analyzeArgs);
        if (analyzeResult && analyzeResult.issues) {
          allIssues.push(...analyzeResult.issues);
        }
      } catch (error) {
        outputChannel?.appendLine(`[WARN] Analyze failed: ${error}`);
      }
    }
    
    // Update diagnostics with merged results (only if at least one command is enabled)
    if (enableLint || enableAnalyze) {
      updateDiagnostics({ issues: allIssues });
    }
  } catch (error) {
    window.showErrorMessage(`Mago: Failed to scan file - ${error}`);
    outputChannel?.appendLine(`[ERROR] Mago scan error: ${error}`);
    if (error instanceof Error) {
      outputChannel?.appendLine(`[ERROR] Stack: ${error.stack}`);
    }
  } finally {
    updateStatusBar('idle');
  }
}

async function scanProject(): Promise<void> {
  const workspaceFolder = workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    window.showWarningMessage('Mago: No workspace folder open.');
    return;
  }

  updateStatusBar('running');

  try {
    const config = workspace.getConfiguration('mago');
    const enableLint = config.get<boolean>('enableLint', true);
    const enableAnalyze = config.get<boolean>('enableAnalyze', true);
    const useBaselines = config.get<boolean>('useBaselines', false);
    
    const allIssues: MagoIssue[] = [];
    
    // Run lint if enabled
    if (enableLint) {
      try {
        const lintArgs = ['lint', '--reporting-format', 'json'];
        if (useBaselines) {
          const lintBaseline = config.get<string>('lintBaseline', 'lint-baseline.toml');
          const workspaceRoot = workspaceFolder.uri.fsPath;
          const baselinePath = resolvePath(lintBaseline, workspaceRoot);
          lintArgs.push('--baseline', baselinePath);
        }
        const lintResult = await runMago(lintArgs);
        if (lintResult && lintResult.issues) {
          allIssues.push(...lintResult.issues);
        }
      } catch (error) {
        outputChannel?.appendLine(`[WARN] Lint failed: ${error}`);
      }
    }
    
    // Run analyze if enabled
    if (enableAnalyze) {
      try {
        const analyzeArgs = ['analyze', '--reporting-format', 'json'];
        if (useBaselines) {
          const analysisBaseline = config.get<string>('analysisBaseline', 'analysis-baseline.toml');
          const workspaceRoot = workspaceFolder.uri.fsPath;
          const baselinePath = resolvePath(analysisBaseline, workspaceRoot);
          analyzeArgs.push('--baseline', baselinePath);
        }
        const analyzeResult = await runMago(analyzeArgs);
        if (analyzeResult && analyzeResult.issues) {
          allIssues.push(...analyzeResult.issues);
        }
      } catch (error) {
        outputChannel?.appendLine(`[WARN] Analyze failed: ${error}`);
      }
    }
    
    // Update diagnostics with merged results (only if at least one command is enabled)
    if (enableLint || enableAnalyze) {
      updateDiagnostics({ issues: allIssues });
    }
  } catch (error) {
    window.showErrorMessage(`Mago: Failed to scan project - ${error}`);
    outputChannel?.appendLine(`[ERROR] Mago scan error: ${error}`);
    if (error instanceof Error) {
      outputChannel?.appendLine(`[ERROR] Stack: ${error.stack}`);
    }
  } finally {
    updateStatusBar('idle');
  }
}

function resolvePath(path: string, workspaceRoot: string): string {
  // Resolve VS Code configuration variables
  return path
    .replace(/\${workspaceFolder}/g, workspaceRoot)
    .replace(/\${workspaceRoot}/g, workspaceRoot)
    .replace(/\${env:([^}]+)}/g, (_, varName) => process.env[varName] || '');
}

async function runMago(args: string[]): Promise<MagoResult | null> {
  const config = workspace.getConfiguration('mago');
  const binPath = config.get<string>('binPath', 'mago');
  const binCommand = config.get<string[]>('binCommand');
  const workspaceFolder = workspace.workspaceFolders?.[0];
  const workspaceRoot = workspaceFolder?.uri.fsPath || process.cwd();

  // Build command - ensure we have a valid executable
  let command: string[];
  if (binCommand && Array.isArray(binCommand) && binCommand.length > 0 && binCommand[0]) {
    // Filter out any empty/undefined values and resolve paths
    command = binCommand
      .filter(cmd => cmd && typeof cmd === 'string' && cmd.trim())
      .map(cmd => resolvePath(cmd.trim(), workspaceRoot));
    if (command.length === 0) {
      throw new Error('mago.binCommand is set but contains no valid commands. Please check your settings.');
    }
  } else {
    // Use binPath and resolve variables
    const path = binPath || 'mago';
    if (!path || typeof path !== 'string' || !path.trim()) {
      throw new Error('Mago binary path is not configured. Please set mago.binPath in settings.');
    }
    command = [resolvePath(path.trim(), workspaceRoot)];
  }

  // Final validation
  const executable = command[0];
  if (!executable || typeof executable !== 'string' || !executable.trim()) {
    outputChannel?.appendLine(`[ERROR] Command construction failed: ${JSON.stringify({ binPath, binCommand, command })}`);
    throw new Error(`Invalid Mago executable: "${executable}". Please set mago.binPath in settings.`);
  }

  // Build arguments: top-level options come BEFORE the subcommand
  // Structure: mago [TOP_LEVEL_OPTS] <SUBCOMMAND> [SUBCOMMAND_OPTS] [PATHS]
  // The args array already contains the subcommand (e.g., "lint") and its options
  // We need to insert top-level options BEFORE the subcommand
  
  const topLevelArgs: string[] = [];
  
  // Add workspace (top-level option) if not in args
  if (!args.some(arg => arg === '--workspace' || arg.startsWith('--workspace='))) {
    topLevelArgs.push('--workspace', workspaceRoot);
  }

  // Add config file (top-level option) if specified
  const configFile = config.get<string>('configFile');
  if (configFile && !args.some(arg => arg === '--config' || arg.startsWith('--config='))) {
    topLevelArgs.push('--config', configFile);
  }

  // Add PHP version (top-level option) if specified
  const phpVersion = config.get<string>('phpVersion');
  if (phpVersion && !args.some(arg => arg === '--php-version' || arg.startsWith('--php-version='))) {
    topLevelArgs.push('--php-version', phpVersion);
  }

  // Add threads (top-level option) if specified
  const threads = config.get<number>('threads');
  if (threads && !args.some(arg => arg === '--threads' || arg.startsWith('--threads='))) {
    topLevelArgs.push('--threads', threads.toString());
  }

  // Add minimum report level (subcommand option) if specified
  const minReportLevel = config.get<string>('minimumReportLevel', 'error');
  if (minReportLevel && !args.some(arg => arg === '--minimum-report-level' || arg.startsWith('--minimum-report-level='))) {
    // Insert before file paths (at the end of subcommand options)
    args.push('--minimum-report-level', minReportLevel);
  }

  // Combine: [executable] [top-level-args] [subcommand-args]
  // Top-level args must come BEFORE the subcommand
  const fullArgs = [...command.slice(1), ...topLevelArgs, ...args];

  return new Promise((resolve, reject) => {
    // executable is already validated above, but double-check
    const executable = command[0];
    if (!executable || typeof executable !== 'string' || !executable.trim()) {
      outputChannel?.appendLine(`[ERROR] Command validation failed: ${JSON.stringify({ binPath, binCommand, command, executable })}`);
      reject(new Error(`Invalid Mago executable: "${executable}". Please set mago.binPath in settings.`));
      return;
    }

    const fullCommand = [executable, ...fullArgs].join(' ');
    outputChannel?.appendLine(`[INFO] Running Mago: ${fullCommand}`);
    outputChannel?.appendLine(`[INFO] Working directory: ${workspaceRoot}`);
    const proc = spawn(executable, fullArgs, {
      cwd: workspaceRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    runningProcess = proc;

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      runningProcess = undefined;
      outputChannel?.appendLine(`[INFO] Mago process exited with code: ${code}`);

      if (code !== 0 && stderr) {
        outputChannel?.appendLine(`[WARN] Mago stderr: ${stderr}`);
        // Mago may exit with non-zero on errors found, but still output JSON
        // Only reject if there's actual stderr and no valid JSON
        try {
          const result = JSON.parse(stdout);
          outputChannel?.appendLine(`[INFO] Parsed ${result.issues?.length || 0} issues from JSON`);
          resolve(result);
          return;
        } catch {
          outputChannel?.appendLine(`[ERROR] Failed to parse JSON output. stderr: ${stderr}`);
          reject(new Error(stderr || `Mago exited with code ${code}`));
          return;
        }
      }

      try {
        const result = JSON.parse(stdout);
        // Ensure result has issues array
        if (!result.issues) {
          result.issues = [];
        }
        outputChannel?.appendLine(`[INFO] Parsed ${result.issues.length} issues from JSON`);
        resolve(result);
      } catch (error) {
        // If no JSON output, might be empty or error
        if (stdout.trim() === '' && code === 0) {
          // No issues found
          outputChannel?.appendLine('[INFO] No issues found (empty output)');
          resolve({ issues: [] });
        } else {
          outputChannel?.appendLine(`[ERROR] Failed to parse Mago output: ${error}`);
          if (stdout) {
            outputChannel?.appendLine(`[ERROR] stdout: ${stdout.substring(0, 500)}`);
          }
          reject(new Error(`Failed to parse Mago output: ${error}`));
        }
      }
    });

    proc.on('error', (error) => {
      runningProcess = undefined;
      outputChannel?.appendLine(`[ERROR] Failed to spawn Mago: ${error.message}`);
      if (error.stack) {
        outputChannel?.appendLine(`[ERROR] Stack: ${error.stack}`);
      }
      reject(new Error(`Failed to spawn Mago: ${error.message}`));
    });
  });
}

function updateDiagnostics(result: MagoResult): void {
  const diagnosticsMap = new Map<string, Diagnostic[]>();

  // Mago returns issues in a flat array, grouped by file via annotations
  for (const issue of result.issues || []) {
    // Get file path from the first annotation's span
    const annotation = issue.annotations?.[0];
    if (!annotation || !annotation.span) {
      continue;
    }

    const filePath = annotation.span.file_id.path;
    const start = annotation.span.start;
    const end = annotation.span.end;

    // Calculate columns from offsets
    const startCol = getColumnFromOffset(filePath, start.offset);
    const endCol = getColumnFromOffset(filePath, end.offset);

    // Create range from span (line is 0-indexed in Mago, VS Code uses 0-indexed too)
    const range = new Range(
      Math.max(0, start.line),
      Math.max(0, startCol),
      Math.max(0, end.line),
      Math.max(0, endCol)
    );

    const severity = mapSeverity(issue.level);
    const diagnostic = new Diagnostic(range, issue.message, severity);
    diagnostic.source = 'mago';
    diagnostic.code = issue.code;

    // Add help/notes as related information if available
    if (issue.help) {
      diagnostic.relatedInformation = [{
        location: {
          uri: Uri.file(filePath),
          range: range,
        },
        message: issue.help,
      }];
    }

    if (!diagnosticsMap.has(filePath)) {
      diagnosticsMap.set(filePath, []);
    }
    diagnosticsMap.get(filePath)!.push(diagnostic);
  }

  // Update diagnostics collection
  diagnosticCollection.clear();
  for (const [filePath, diagnostics] of diagnosticsMap) {
    const uri = Uri.file(filePath);
    diagnosticCollection.set(uri, diagnostics);
  }
}

// Helper to convert byte offset to column
function getColumnFromOffset(filePath: string, offset: number): number {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const beforeOffset = content.substring(0, offset);
    // Count newlines to get line, then count chars on that line
    const lines = beforeOffset.split('\n');
    return lines[lines.length - 1].length;
  } catch {
    // Fallback: use 0 as column
    return 0;
  }
}

function mapSeverity(level: string): DiagnosticSeverity {
  switch (level.toLowerCase()) {
    case 'error':
      return DiagnosticSeverity.Error;
    case 'warning':
      return DiagnosticSeverity.Warning;
    case 'note':
      return DiagnosticSeverity.Information;
    case 'help':
      return DiagnosticSeverity.Hint;
    default:
      return DiagnosticSeverity.Warning;
  }
}

async function generateBaseline(type: 'lint' | 'analyze'): Promise<void> {
  const workspaceFolder = workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    window.showWarningMessage('Mago: No workspace folder open.');
    return;
  }

  updateStatusBar('running');

  try {
    const config = workspace.getConfiguration('mago');
    const workspaceRoot = workspaceFolder.uri.fsPath;
    const binPath = config.get<string>('binPath', 'mago');
    const binCommand = config.get<string[]>('binCommand');
    
    let baselinePath: string;
    let command: string;
    let baselineName: string;
    
    if (type === 'lint') {
      baselinePath = resolvePath(config.get<string>('lintBaseline', 'lint-baseline.toml'), workspaceRoot);
      command = 'lint';
      baselineName = 'lint baseline';
    } else {
      baselinePath = resolvePath(config.get<string>('analysisBaseline', 'analysis-baseline.toml'), workspaceRoot);
      command = 'analyze';
      baselineName = 'analysis baseline';
    }

    outputChannel?.appendLine(`[INFO] Generating ${baselineName} at: ${baselinePath}`);
    
    // Build command
    let execCommand: string[];
    if (binCommand && Array.isArray(binCommand) && binCommand.length > 0 && binCommand[0]) {
      execCommand = binCommand
        .filter(cmd => cmd && typeof cmd === 'string' && cmd.trim())
        .map(cmd => resolvePath(cmd.trim(), workspaceRoot));
      if (execCommand.length === 0) {
        throw new Error('mago.binCommand is set but contains no valid commands.');
      }
    } else {
      execCommand = [resolvePath(binPath.trim(), workspaceRoot)];
    }

    const executable = execCommand[0];
    if (!executable || typeof executable !== 'string' || !executable.trim()) {
      throw new Error('Invalid Mago executable. Please set mago.binPath in settings.');
    }

    // Build arguments
    const topLevelArgs: string[] = [];
    
    // Add workspace
    topLevelArgs.push('--workspace', workspaceRoot);

    // Add config file if specified
    const configFile = config.get<string>('configFile');
    if (configFile) {
      topLevelArgs.push('--config', configFile);
    }

    // Add PHP version if specified
    const phpVersion = config.get<string>('phpVersion');
    if (phpVersion) {
      topLevelArgs.push('--php-version', phpVersion);
    }

    // Add threads if specified
    const threads = config.get<number>('threads');
    if (threads) {
      topLevelArgs.push('--threads', threads.toString());
    }

    // Build full command: [executable] [top-level-args] [subcommand] [subcommand-args]
    const subcommandArgs = [command, '--generate-baseline', '--baseline', baselinePath];
    const fullArgs = [...execCommand.slice(1), ...topLevelArgs, ...subcommandArgs];

    const fullCommand = [executable, ...fullArgs].join(' ');
    outputChannel?.appendLine(`[INFO] Running Mago: ${fullCommand}`);
    outputChannel?.appendLine(`[INFO] Working directory: ${workspaceRoot}`);

    // Run the command (baseline generation doesn't return JSON)
    await new Promise<void>((resolve, reject) => {
      const proc = spawn(executable, fullArgs, {
        cwd: workspaceRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
        outputChannel?.appendLine(data.toString());
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
        outputChannel?.appendLine(`[STDERR] ${data.toString()}`);
      });

      proc.on('close', (code) => {
        if (code !== 0) {
          outputChannel?.appendLine(`[ERROR] Mago process exited with code: ${code}`);
          if (stderr) {
            reject(new Error(stderr || `Mago exited with code ${code}`));
          } else {
            reject(new Error(`Mago exited with code ${code}`));
          }
        } else {
          outputChannel?.appendLine(`[INFO] ${baselineName} generated successfully`);
          resolve();
        }
      });

      proc.on('error', (error) => {
        outputChannel?.appendLine(`[ERROR] Failed to spawn Mago: ${error.message}`);
        reject(new Error(`Failed to spawn Mago: ${error.message}`));
      });
    });
    
    window.showInformationMessage(`Mago: ${baselineName} generated successfully at ${baselinePath}`);
  } catch (error) {
    window.showErrorMessage(`Mago: Failed to generate ${type} baseline - ${error}`);
    outputChannel?.appendLine(`[ERROR] Failed to generate ${type} baseline: ${error}`);
    if (error instanceof Error) {
      outputChannel?.appendLine(`[ERROR] Stack: ${error.stack}`);
    }
  } finally {
    updateStatusBar('idle');
  }
}

async function formatFile(filePath: string): Promise<void> {
  if (!filePath.endsWith('.php')) {
    window.showWarningMessage('Mago: Can only format PHP files.');
    return;
  }

  updateStatusBar('running');

  try {
    const config = workspace.getConfiguration('mago');
    const enableFormat = config.get<boolean>('enableFormat', true);
    
    if (!enableFormat) {
      window.showInformationMessage('Mago: Formatting is disabled.');
      return;
    }

    const workspaceFolder = workspace.workspaceFolders?.[0];
    const workspaceRoot = workspaceFolder?.uri.fsPath || process.cwd();

    await runFormatCommand([filePath], workspaceRoot);
    
    window.showInformationMessage(`Mago: Formatted ${filePath}`);
  } catch (error) {
    window.showErrorMessage(`Mago: Failed to format file - ${error}`);
    outputChannel?.appendLine(`[ERROR] Format error: ${error}`);
    if (error instanceof Error) {
      outputChannel?.appendLine(`[ERROR] Stack: ${error.stack}`);
    }
  } finally {
    updateStatusBar('idle');
  }
}

async function formatDocument(document: TextDocument): Promise<void> {
  if (document.languageId !== 'php' || document.uri.scheme !== 'file') {
    return;
  }

  updateStatusBar('running');

  try {
    const config = workspace.getConfiguration('mago');
    const enableFormat = config.get<boolean>('enableFormat', true);
    
    if (!enableFormat) {
      return;
    }

    const workspaceFolder = workspace.workspaceFolders?.[0];
    const workspaceRoot = workspaceFolder?.uri.fsPath || process.cwd();

    // Use stdin-input for formatting the document
    const formattedText = await runFormatCommandStdin(document.getText(), workspaceRoot);
    
    if (formattedText !== document.getText()) {
      const edit = new WorkspaceEdit();
      const fullRange = new Range(
        document.positionAt(0),
        document.positionAt(document.getText().length)
      );
      edit.replace(document.uri, fullRange, formattedText);
      await workspace.applyEdit(edit);
    }
  } catch (error) {
    window.showErrorMessage(`Mago: Failed to format document - ${error}`);
    outputChannel?.appendLine(`[ERROR] Format error: ${error}`);
    if (error instanceof Error) {
      outputChannel?.appendLine(`[ERROR] Stack: ${error.stack}`);
    }
  } finally {
    updateStatusBar('idle');
  }
}

async function formatProject(): Promise<void> {
  const workspaceFolder = workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    window.showWarningMessage('Mago: No workspace folder open.');
    return;
  }

  updateStatusBar('running');

  try {
    const config = workspace.getConfiguration('mago');
    const enableFormat = config.get<boolean>('enableFormat', true);
    
    if (!enableFormat) {
      window.showInformationMessage('Mago: Formatting is disabled.');
      return;
    }

    const workspaceRoot = workspaceFolder.uri.fsPath;

    // Format entire project (no paths = format all)
    await runFormatCommand([], workspaceRoot);
    
    window.showInformationMessage('Mago: Project formatted successfully.');
  } catch (error) {
    window.showErrorMessage(`Mago: Failed to format project - ${error}`);
    outputChannel?.appendLine(`[ERROR] Format error: ${error}`);
    if (error instanceof Error) {
      outputChannel?.appendLine(`[ERROR] Stack: ${error.stack}`);
    }
  } finally {
    updateStatusBar('idle');
  }
}

async function formatStaged(): Promise<void> {
  const workspaceFolder = workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    window.showWarningMessage('Mago: No workspace folder open.');
    return;
  }

  updateStatusBar('running');

  try {
    const config = workspace.getConfiguration('mago');
    const enableFormat = config.get<boolean>('enableFormat', true);
    
    if (!enableFormat) {
      window.showInformationMessage('Mago: Formatting is disabled.');
      return;
    }

    const workspaceRoot = workspaceFolder.uri.fsPath;

    // Use --staged flag to format staged git files
    await runFormatCommand(['--staged'], workspaceRoot);
    
    window.showInformationMessage('Mago: Staged files formatted successfully.');
  } catch (error) {
    window.showErrorMessage(`Mago: Failed to format staged files - ${error}`);
    outputChannel?.appendLine(`[ERROR] Format error: ${error}`);
    if (error instanceof Error) {
      outputChannel?.appendLine(`[ERROR] Stack: ${error.stack}`);
    }
  } finally {
    updateStatusBar('idle');
  }
}

async function runFormatCommand(paths: string[], workspaceRoot: string): Promise<void> {
  const config = workspace.getConfiguration('mago');
  const binPath = config.get<string>('binPath', 'mago');
  const binCommand = config.get<string[]>('binCommand');

  // Build command
  let execCommand: string[];
  if (binCommand && Array.isArray(binCommand) && binCommand.length > 0 && binCommand[0]) {
    execCommand = binCommand
      .filter(cmd => cmd && typeof cmd === 'string' && cmd.trim())
      .map(cmd => resolvePath(cmd.trim(), workspaceRoot));
    if (execCommand.length === 0) {
      throw new Error('mago.binCommand is set but contains no valid commands.');
    }
  } else {
    execCommand = [resolvePath(binPath.trim(), workspaceRoot)];
  }

  const executable = execCommand[0];
  if (!executable || typeof executable !== 'string' || !executable.trim()) {
    throw new Error('Invalid Mago executable. Please set mago.binPath in settings.');
  }

  // Build arguments
  const topLevelArgs: string[] = [];
  
  // Add workspace
  topLevelArgs.push('--workspace', workspaceRoot);

  // Add config file if specified
  const configFile = config.get<string>('configFile');
  if (configFile) {
    topLevelArgs.push('--config', configFile);
  }

  // Add PHP version if specified
  const phpVersion = config.get<string>('phpVersion');
  if (phpVersion) {
    topLevelArgs.push('--php-version', phpVersion);
  }

  // Add threads if specified
  const threads = config.get<number>('threads');
  if (threads) {
    topLevelArgs.push('--threads', threads.toString());
  }

  // Build full command: [executable] [top-level-args] format [paths]
  const subcommandArgs = ['format', ...paths];
  const fullArgs = [...execCommand.slice(1), ...topLevelArgs, ...subcommandArgs];

  const fullCommand = [executable, ...fullArgs].join(' ');
  outputChannel?.appendLine(`[INFO] Running Mago: ${fullCommand}`);
  outputChannel?.appendLine(`[INFO] Working directory: ${workspaceRoot}`);

  // Run the format command
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(executable, fullArgs, {
      cwd: workspaceRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
      outputChannel?.appendLine(data.toString());
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      outputChannel?.appendLine(`[STDERR] ${data.toString()}`);
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        outputChannel?.appendLine(`[ERROR] Mago process exited with code: ${code}`);
        if (stderr) {
          reject(new Error(stderr || `Mago exited with code ${code}`));
        } else {
          reject(new Error(`Mago exited with code ${code}`));
        }
      } else {
        outputChannel?.appendLine(`[INFO] Format completed successfully`);
        resolve();
      }
    });

    proc.on('error', (error) => {
      outputChannel?.appendLine(`[ERROR] Failed to spawn Mago: ${error.message}`);
      reject(new Error(`Failed to spawn Mago: ${error.message}`));
    });
  });
}

async function runFormatCommandStdin(input: string, workspaceRoot: string): Promise<string> {
  const config = workspace.getConfiguration('mago');
  const binPath = config.get<string>('binPath', 'mago');
  const binCommand = config.get<string[]>('binCommand');

  // Build command
  let execCommand: string[];
  if (binCommand && Array.isArray(binCommand) && binCommand.length > 0 && binCommand[0]) {
    execCommand = binCommand
      .filter(cmd => cmd && typeof cmd === 'string' && cmd.trim())
      .map(cmd => resolvePath(cmd.trim(), workspaceRoot));
    if (execCommand.length === 0) {
      throw new Error('mago.binCommand is set but contains no valid commands.');
    }
  } else {
    execCommand = [resolvePath(binPath.trim(), workspaceRoot)];
  }

  const executable = execCommand[0];
  if (!executable || typeof executable !== 'string' || !executable.trim()) {
    throw new Error('Invalid Mago executable. Please set mago.binPath in settings.');
  }

  // Build arguments
  const topLevelArgs: string[] = [];
  
  // Add workspace
  topLevelArgs.push('--workspace', workspaceRoot);

  // Add config file if specified
  const configFile = config.get<string>('configFile');
  if (configFile) {
    topLevelArgs.push('--config', configFile);
  }

  // Add PHP version if specified
  const phpVersion = config.get<string>('phpVersion');
  if (phpVersion) {
    topLevelArgs.push('--php-version', phpVersion);
  }

  // Add threads if specified
  const threads = config.get<number>('threads');
  if (threads) {
    topLevelArgs.push('--threads', threads.toString());
  }

  // Build full command: [executable] [top-level-args] format --stdin-input
  const subcommandArgs = ['format', '--stdin-input'];
  const fullArgs = [...execCommand.slice(1), ...topLevelArgs, ...subcommandArgs];

  const fullCommand = [executable, ...fullArgs].join(' ');
  outputChannel?.appendLine(`[INFO] Running Mago: ${fullCommand}`);
  outputChannel?.appendLine(`[INFO] Working directory: ${workspaceRoot}`);

  // Run the format command with stdin input
  return new Promise<string>((resolve, reject) => {
    const proc = spawn(executable, fullArgs, {
      cwd: workspaceRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
      outputChannel?.appendLine(`[STDERR] ${data.toString()}`);
    });

    // Write input to stdin with error handling
    proc.stdin.on('error', (error) => {
      outputChannel?.appendLine(`[ERROR] stdin error: ${error.message}`);
      reject(new Error(`Failed to write to stdin: ${error.message}`));
    });

    try {
      proc.stdin.write(input, 'utf8');
      proc.stdin.end();
    } catch (error) {
      outputChannel?.appendLine(`[ERROR] Failed to write to stdin: ${error}`);
      reject(new Error(`Failed to write to stdin: ${error}`));
      return;
    }

    proc.on('close', (code) => {
      if (code !== 0) {
        outputChannel?.appendLine(`[ERROR] Mago process exited with code: ${code}`);
        if (stderr) {
          reject(new Error(stderr || `Mago exited with code ${code}`));
        } else {
          reject(new Error(`Mago exited with code ${code}`));
        }
      } else {
        outputChannel?.appendLine(`[INFO] Format completed successfully`);
        resolve(stdout);
      }
    });

    proc.on('error', (error) => {
      outputChannel?.appendLine(`[ERROR] Failed to spawn Mago: ${error.message}`);
      reject(new Error(`Failed to spawn Mago: ${error.message}`));
    });
  });
}

function updateStatusBar(status: 'running' | 'idle' | 'error', message?: string): void {
  if (!statusBarItem) {
    return;
  }

  switch (status) {
    case 'running':
      statusBarItem.text = '$(sync~spin) Mago';
      statusBarItem.tooltip = message || 'Mago is analyzing...';
      break;
    case 'idle':
      statusBarItem.text = '$(check) Mago';
      statusBarItem.tooltip = 'Mago';
      break;
    case 'error':
      statusBarItem.text = '$(error) Mago';
      statusBarItem.tooltip = message || 'Mago encountered an error';
      break;
  }
}
