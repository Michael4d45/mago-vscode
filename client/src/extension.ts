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
  CodeActionProvider,
  CodeAction,
  CodeActionKind,
  Position,
  CodeActionContext,
} from 'vscode';
import { COMMANDS } from '@shared/commands/defs';

let diagnosticCollection = languages.createDiagnosticCollection('mago');
let statusBarItem: StatusBarItem | undefined;
let runningProcess: ChildProcess | undefined;
let outputChannel: OutputChannel | undefined;
// Map to store issues by key (filePath:line:col:code) for code actions
const issueMap = new Map<string, MagoIssue>();

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

interface MagoEdit {
  range: { start: number; end: number };
  new_text: string;
  safety?: "safe" | "potentiallyunsafe" | "unsafe";
}

interface MagoFileId {
  name: string;
  path: string;
  size: number;
  file_type: string;
}

interface MagoIssue {
  level: string; // "Error", "Warning", "Note", "Help"
  code: string;
  message: string;
  notes?: string[];
  help?: string;
  annotations: MagoAnnotation[];
  edits?: [MagoFileId, MagoEdit[]][];
  category?: 'lint' | 'analysis' | 'guard'; // Track which command this issue came from
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

    commands.registerCommand(COMMANDS.GENERATE_GUARD_BASELINE, async () => {
      await generateBaseline('guard');
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

    commands.registerCommand(COMMANDS.LINT_FIX, async () => {
      await lintFix('safe');
    }),

    commands.registerCommand(COMMANDS.LINT_FIX_UNSAFE, async () => {
      await lintFix('unsafe');
    }),

    commands.registerCommand(COMMANDS.LINT_FIX_POTENTIALLY_UNSAFE, async () => {
      await lintFix('potentially-unsafe');
    }),

    commands.registerCommand('mago.applyFix', async (issue: MagoIssue, uri: Uri) => {
      await applyMagoFix(issue, uri);
    }),

    commands.registerCommand('mago.addSuppression', async (
      document: TextDocument,
      line: number,
      type: 'expect',
      suppressionCode: string
    ) => {
      await addSuppression(document, line, type, suppressionCode);
    }),

    commands.registerCommand('mago.addFormatIgnoreFile', async () => {
      const activeEditor = window.activeTextEditor;
      if (!activeEditor || activeEditor.document.languageId !== 'php') {
        window.showWarningMessage('Mago: Please open a PHP file.');
        return;
      }
      await addFormatIgnoreFile(activeEditor.document);
    }),

    commands.registerCommand('mago.addFormatIgnoreNext', async (document?: TextDocument, range?: Range) => {
      let doc = document;
      let selectionRange = range;
      
      // If not provided, get from active editor
      if (!doc || !selectionRange) {
        const activeEditor = window.activeTextEditor;
        if (!activeEditor || activeEditor.document.languageId !== 'php') {
          window.showWarningMessage('Mago: Please select text in a PHP file.');
          return;
        }
        doc = activeEditor.document;
        const selection = activeEditor.selection;
        if (selection.isEmpty) {
          window.showWarningMessage('Mago: Please select some text first.');
          return;
        }
        selectionRange = new Range(selection.start, selection.end);
      }
      
      await addFormatIgnoreNext(doc, selectionRange);
    }),

    commands.registerCommand('mago.addFormatIgnoreRegion', async (document?: TextDocument, range?: Range) => {
      let doc = document;
      let selectionRange = range;
      
      // If not provided, get from active editor
      if (!doc || !selectionRange) {
        const activeEditor = window.activeTextEditor;
        if (!activeEditor || activeEditor.document.languageId !== 'php') {
          window.showWarningMessage('Mago: Please select text in a PHP file.');
          return;
        }
        doc = activeEditor.document;
        const selection = activeEditor.selection;
        if (selection.isEmpty) {
          window.showWarningMessage('Mago: Please select some text first.');
          return;
        }
        selectionRange = new Range(selection.start, selection.end);
      }
      
      await addFormatIgnoreRegion(doc, selectionRange);
    }),
  );

  // Run on save if configured
  const runOnSave = config.get<boolean>('runOnSave', true);
  if (runOnSave) {
    context.subscriptions.push(
      workspace.onDidSaveTextDocument(async (document: TextDocument) => {
        if (document.languageId === 'php' && document.uri.scheme === 'file') {
          const saveConfig = workspace.getConfiguration('mago');
          const runOnSaveScope = saveConfig.get<string>('runOnSaveScope', 'project');
          if (runOnSaveScope === 'project') {
            await scanProject();
          } else {
            await scanFile(document);
          }
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

  // Register code action provider for quick fixes and source actions
  context.subscriptions.push(
    languages.registerCodeActionsProvider(
      'php',
      new MagoCodeActionProvider(),
      {
        providedCodeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.Source]
      }
    )
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
    const enableGuard = config.get<boolean>('enableGuard', false);
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
          // Tag issues with category
          const taggedIssues = lintResult.issues.map(issue => ({ ...issue, category: 'lint' as const }));
          allIssues.push(...taggedIssues);
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
          // Tag issues with category
          const taggedIssues = analyzeResult.issues.map(issue => ({ ...issue, category: 'analysis' as const }));
          allIssues.push(...taggedIssues);
        }
      } catch (error) {
        outputChannel?.appendLine(`[WARN] Analyze failed: ${error}`);
      }
    }
    
    // Run guard if enabled
    if (enableGuard) {
      try {
        const guardArgs = ['guard', '--reporting-format', 'json'];
        if (useBaselines) {
          const guardBaseline = config.get<string>('guardBaseline', 'guard-baseline.toml');
          const workspaceFolder = workspace.workspaceFolders?.[0];
          const workspaceRoot = workspaceFolder?.uri.fsPath || process.cwd();
          const baselinePath = resolvePath(guardBaseline, workspaceRoot);
          guardArgs.push('--baseline', baselinePath);
        }
        guardArgs.push(document.uri.fsPath);
        const guardResult = await runMago(guardArgs);
        if (guardResult && guardResult.issues) {
          // Tag issues with category
          const taggedIssues = guardResult.issues.map(issue => ({ ...issue, category: 'guard' as const }));
          allIssues.push(...taggedIssues);
        }
      } catch (error) {
        outputChannel?.appendLine(`[WARN] Guard failed: ${error}`);
      }
    }
    
    // Update diagnostics with merged results (only if at least one command is enabled)
    if (enableLint || enableAnalyze || enableGuard) {
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
    const enableGuard = config.get<boolean>('enableGuard', false);
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
          // Tag issues with category
          const taggedIssues = lintResult.issues.map(issue => ({ ...issue, category: 'lint' as const }));
          allIssues.push(...taggedIssues);
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
          // Tag issues with category
          const taggedIssues = analyzeResult.issues.map(issue => ({ ...issue, category: 'analysis' as const }));
          allIssues.push(...taggedIssues);
        }
      } catch (error) {
        outputChannel?.appendLine(`[WARN] Analyze failed: ${error}`);
      }
    }
    
    // Run guard if enabled
    if (enableGuard) {
      try {
        const guardArgs = ['guard', '--reporting-format', 'json'];
        if (useBaselines) {
          const guardBaseline = config.get<string>('guardBaseline', 'guard-baseline.toml');
          const workspaceRoot = workspaceFolder.uri.fsPath;
          const baselinePath = resolvePath(guardBaseline, workspaceRoot);
          guardArgs.push('--baseline', baselinePath);
        }
        const guardResult = await runMago(guardArgs);
        if (guardResult && guardResult.issues) {
          // Tag issues with category
          const taggedIssues = guardResult.issues.map(issue => ({ ...issue, category: 'guard' as const }));
          allIssues.push(...taggedIssues);
        }
      } catch (error) {
        outputChannel?.appendLine(`[WARN] Guard failed: ${error}`);
      }
    }
    
    // Update diagnostics with merged results (only if at least one command is enabled)
    if (enableLint || enableAnalyze || enableGuard) {
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

async function lintFix(safetyLevel: 'safe' | 'unsafe' | 'potentially-unsafe'): Promise<void> {
  const workspaceFolder = workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    window.showWarningMessage('Mago: No workspace folder open.');
    return;
  }

  updateStatusBar('running');

  try {
    const config = workspace.getConfiguration('mago');
    const workspaceRoot = workspaceFolder.uri.fsPath;

    // Build lint args
    const lintArgs = ['lint', '--fix'];
    if (safetyLevel === 'unsafe') {
      lintArgs.push('--unsafe');
    } else if (safetyLevel === 'potentially-unsafe') {
      lintArgs.push('--potentially-unsafe');
    }

    // Add format after fix if enabled
    const formatAfterFix = config.get<boolean>('formatAfterLintFix', false);
    if (formatAfterFix) {
      lintArgs.push('--format-after-fix');
    }

    // Use baselines if configured
    const useBaselines = config.get<boolean>('useBaselines', false);
    if (useBaselines) {
      const lintBaseline = config.get<string>('lintBaseline', 'lint-baseline.toml');
      const baselinePath = resolvePath(lintBaseline, workspaceRoot);
      lintArgs.push('--baseline', baselinePath);
    }

    // Run the lint fix command
    const result = await runMago(lintArgs);

    if (result) {
      const issuesFixed = result.issues?.length || 0;
      if (issuesFixed > 0) {
        window.showInformationMessage(`Mago: Applied ${issuesFixed} fix(es) with ${safetyLevel} safety level.`);

        // Re-run scan if scanOnSave is enabled (since lint fixes may have changed the code)
        const runOnSave = config.get<boolean>('runOnSave', true);
        if (runOnSave) {
          setTimeout(async () => {
            try {
              await scanProject();
            } catch (scanError) {
              outputChannel?.appendLine(`[WARN] Failed to re-scan after lint fix: ${scanError}`);
            }
          }, 100); // Small delay to allow UI to update
        }
      } else {
        window.showInformationMessage('Mago: No issues to fix.');
      }
    }
  } catch (error) {
    window.showErrorMessage(`Mago: Failed to apply lint fixes - ${error}`);
    outputChannel?.appendLine(`[ERROR] Lint fix error: ${error}`);
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
  let binPath = config.get<string>('binPath', 'mago');
  const binCommand = config.get<string[]>('binCommand');
  const workspaceFolder = workspace.workspaceFolders?.[0];
  const workspaceRoot = workspaceFolder?.uri.fsPath || process.cwd();

  // Auto-discover Mago binary if binPath is blank, empty, or default "mago"
  if (!binCommand || binCommand.length === 0 || !binCommand[0]) {
    if (!binPath || binPath.trim() === '' || binPath.trim() === 'mago') {
      const discoveredPath = findMagoBinary(workspaceRoot);
      if (discoveredPath) {
        binPath = discoveredPath;
      }
    }
  }

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
  // Clear issue map before updating
  issueMap.clear();

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
    // Prefix code with category if available (lint:code, analyze:code, or guard:code)
    let diagnosticCode: string;
    if (issue.category) {
      const categoryPrefix = issue.category === 'analysis' ? 'analyze' : issue.category;
      diagnosticCode = `${categoryPrefix}:${issue.code}`;
    } else {
      diagnosticCode = issue.code;
    }
    diagnostic.code = diagnosticCode;

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

    // Store issue in map for code actions (key: filePath:line:col:code)
    // Use the prefixed code to match what's in the diagnostic
    const issueKey = `${filePath}:${start.line}:${startCol}:${diagnosticCode}`;
    issueMap.set(issueKey, issue);

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

async function generateBaseline(type: 'lint' | 'analyze' | 'guard'): Promise<void> {
  const workspaceFolder = workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    window.showWarningMessage('Mago: No workspace folder open.');
    return;
  }

  updateStatusBar('running');

  try {
    const config = workspace.getConfiguration('mago');
    const workspaceRoot = workspaceFolder.uri.fsPath;
    let binPath = config.get<string>('binPath', 'mago');
    const binCommand = config.get<string[]>('binCommand');

    // Auto-discover Mago binary if binPath is blank, empty, or default "mago"
    if (!binCommand || binCommand.length === 0 || !binCommand[0]) {
      if (!binPath || binPath.trim() === '' || binPath.trim() === 'mago') {
        const discoveredPath = findMagoBinary(workspaceRoot);
        if (discoveredPath) {
          binPath = discoveredPath;
        }
      }
    }
    
    let baselinePath: string;
    let command: string;
    let baselineName: string;
    
    if (type === 'lint') {
      baselinePath = resolvePath(config.get<string>('lintBaseline', 'lint-baseline.toml'), workspaceRoot);
      command = 'lint';
      baselineName = 'lint baseline';
    } else if (type === 'analyze') {
      baselinePath = resolvePath(config.get<string>('analysisBaseline', 'analysis-baseline.toml'), workspaceRoot);
      command = 'analyze';
      baselineName = 'analysis baseline';
    } else {
      baselinePath = resolvePath(config.get<string>('guardBaseline', 'guard-baseline.toml'), workspaceRoot);
      command = 'guard';
      baselineName = 'guard baseline';
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
  let binPath = config.get<string>('binPath', 'mago');
  const binCommand = config.get<string[]>('binCommand');

  // Auto-discover Mago binary if binPath is blank, empty, or default "mago"
  if (!binCommand || binCommand.length === 0 || !binCommand[0]) {
    if (!binPath || binPath.trim() === '' || binPath.trim() === 'mago') {
      const discoveredPath = findMagoBinary(workspaceRoot);
      if (discoveredPath) {
        binPath = discoveredPath;
      }
    }
  }

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
  let binPath = config.get<string>('binPath', 'mago');
  const binCommand = config.get<string[]>('binCommand');

  // Auto-discover Mago binary if binPath is blank, empty, or default "mago"
  if (!binCommand || binCommand.length === 0 || !binCommand[0]) {
    if (!binPath || binPath.trim() === '' || binPath.trim() === 'mago') {
      const discoveredPath = findMagoBinary(workspaceRoot);
      if (discoveredPath) {
        binPath = discoveredPath;
      }
    }
  }

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

// Code Action Provider for quick fixes
class MagoCodeActionProvider implements CodeActionProvider {
  provideCodeActions(
    document: TextDocument,
    range: Range,
    context: CodeActionContext,
    token: CancellationToken
  ): CodeAction[] | undefined {
    const actions: CodeAction[] = [];

    // Check if text is selected - use range parameter or check active editor selection
    let hasSelection = !range.isEmpty && range.start.compareTo(range.end) !== 0;
    
    // Also check active editor selection as fallback (VSCode might not pass selection in range)
    if (!hasSelection) {
      const activeEditor = window.activeTextEditor;
      if (activeEditor && activeEditor.document.uri.toString() === document.uri.toString()) {
        const selection = activeEditor.selection;
        hasSelection = !selection.isEmpty && selection.start.compareTo(selection.end) !== 0;
        // Use the active selection range if available
        if (hasSelection) {
          range = new Range(selection.start, selection.end);
        }
      }
    }

    // Add format ignore actions when text is selected
    if (hasSelection && document.languageId === 'php' && document.uri.scheme === 'file') {
      // Add "Add @mago-format-ignore-next" action
      const ignoreNextAction = new CodeAction(
        'Add @mago-format-ignore-next',
        CodeActionKind.Source
      );
      ignoreNextAction.command = {
        command: 'mago.addFormatIgnoreNext',
        title: 'Add @mago-format-ignore-next',
        arguments: [document, range],
      };
      actions.push(ignoreNextAction);

      // Add "Add @mago-format-ignore-start/end" action
      const ignoreRegionAction = new CodeAction(
        'Add @mago-format-ignore-start/end',
        CodeActionKind.Source
      );
      ignoreRegionAction.command = {
        command: 'mago.addFormatIgnoreRegion',
        title: 'Add @mago-format-ignore-start/end',
        arguments: [document, range],
      };
      actions.push(ignoreRegionAction);

      // Add "Add @mago-format-ignore" (file-level) action
      const ignoreFileAction = new CodeAction(
        'Add @mago-format-ignore (file-level)',
        CodeActionKind.Source
      );
      ignoreFileAction.command = {
        command: 'mago.addFormatIgnoreFile',
        title: 'Add @mago-format-ignore',
      };
      actions.push(ignoreFileAction);
    }

    // Add diagnostic-based actions
    for (const diagnostic of context.diagnostics) {
      if (diagnostic.source !== 'mago' || !diagnostic.code) {
        continue;
      }

      const filePath = document.uri.fsPath;
      const startLine = diagnostic.range.start.line;
      const startCol = diagnostic.range.start.character;
      const issueKey = `${filePath}:${startLine}:${startCol}:${diagnostic.code}`;
      const issue = issueMap.get(issueKey);

      if (!issue) {
        continue;
      }

      // Add "Apply fix" action if edits are available
      if (issue.edits && issue.edits.length > 0) {
        const applyFixAction = new CodeAction(
          `Apply fix: ${diagnostic.message}`,
          CodeActionKind.QuickFix
        );
        applyFixAction.diagnostics = [diagnostic];
        applyFixAction.command = {
          command: 'mago.applyFix',
          title: 'Apply Mago fix',
          arguments: [issue, document.uri],
        };
        actions.push(applyFixAction);
      }

      // Determine category (default to 'lint' if not set for backwards compatibility)
      const category = issue.category || 'lint';
      const suppressionCode = `${category}:${issue.code}`;

      // Add "Suppress with @mago-expect" action
      // Use the diagnostic range's end line, as that's typically where the actual issue code is
      // The diagnostic range is calculated from the annotation span and accounts for the actual code location
      const issueLine = diagnostic.range.end.line;
      
      const expectAction = new CodeAction(
        `Suppress with @mago-expect ${suppressionCode}`,
        CodeActionKind.QuickFix
      );
      expectAction.diagnostics = [diagnostic];
      expectAction.command = {
        command: 'mago.addSuppression',
        title: 'Add @mago-expect',
        arguments: [document, issueLine, 'expect', suppressionCode],
      };
      actions.push(expectAction);
    }

    // Always return actions if we have any (including format ignore actions)
    // This ensures format ignore actions appear even without diagnostics
    return actions.length > 0 ? actions : undefined;
  }
}

// Apply Mago fix from edits
async function applyMagoFix(issue: MagoIssue, uri: Uri): Promise<void> {
  if (!issue.edits || issue.edits.length === 0) {
    window.showWarningMessage('Mago: No fixes available for this issue.');
    return;
  }

  try {
    const edit = new WorkspaceEdit();

    for (const [fileId, edits] of issue.edits) {
      const fileUri = Uri.file(fileId.path);
      const document = await workspace.openTextDocument(fileUri);
      const content = document.getText();

      for (const magoEdit of edits) {
        // Convert byte offsets to positions
        const startPos = offsetToPosition(content, magoEdit.range.start);
        const endPos = offsetToPosition(content, magoEdit.range.end);
        const range = new Range(startPos, endPos);

        edit.replace(fileUri, range, magoEdit.new_text);
      }
    }

    const applied = await workspace.applyEdit(edit);
    if (applied) {
      window.showInformationMessage('Mago: Fix applied successfully.');
    } else {
      window.showWarningMessage('Mago: Failed to apply fix.');
    }
  } catch (error) {
    window.showErrorMessage(`Mago: Failed to apply fix - ${error}`);
    outputChannel?.appendLine(`[ERROR] Apply fix error: ${error}`);
    if (error instanceof Error) {
      outputChannel?.appendLine(`[ERROR] Stack: ${error.stack}`);
    }
  }
}

// Convert byte offset to Position
function offsetToPosition(content: string, offset: number): Position {
  const beforeOffset = content.substring(0, offset);
  const lines = beforeOffset.split('\n');
  const line = Math.max(0, lines.length - 1);
  const character = lines[lines.length - 1].length;
  return new Position(line, character);
}

// Add suppression comment
async function addSuppression(
  document: TextDocument,
  line: number,
  type: 'expect',
  suppressionCode: string
): Promise<void> {
  try {
    const edit = new WorkspaceEdit();
    
    // Get the indentation from the line with the issue to match it
    const issueLineText = document.lineAt(line).text;
    const indentation = issueLineText.match(/^\s*/)?.[0] || '';
    
    // Check if the line before the issue is a closing brace
    const prevLineNum = Math.max(0, line - 1);
    const prevLineText = document.lineAt(prevLineNum).text;
    const prevLineTrimmed = prevLineText.trim();
    
    // If the previous line is just a closing brace (}, };, ], etc.), place suppression on a new line after it
    if (prevLineTrimmed === '}' || prevLineTrimmed === '};' || prevLineTrimmed === '],' || 
        prevLineTrimmed === ');' || prevLineTrimmed.match(/^[}\]\);,]+$/)) {
      // Insert after the closing brace, creating a new line for the suppression
      const braceEndPos = prevLineText.length;
      const position = new Position(prevLineNum, braceEndPos);
      // Add newline after brace, then comment (no trailing newline since next line already exists)
      const comment = `\n${indentation}// @mago-expect ${suppressionCode}`;
      edit.insert(document.uri, position, comment);
    } else {
      // Insert on a new line before the issue line
      // Insert at the start of the issue line, which will push it down
      // The trailing newline ensures the issue line appears on its own line after the comment
      const position = new Position(line, 0);
      const comment = `${indentation}// @mago-expect ${suppressionCode}\n`;
      edit.insert(document.uri, position, comment);
    }
    
    const applied = await workspace.applyEdit(edit);
    
    if (applied) {
      window.showInformationMessage(`Mago: Added @mago-expect suppression.`);
    } else {
      window.showWarningMessage('Mago: Failed to add suppression.');
    }
  } catch (error) {
    window.showErrorMessage(`Mago: Failed to add suppression - ${error}`);
    outputChannel?.appendLine(`[ERROR] Add suppression error: ${error}`);
    if (error instanceof Error) {
      outputChannel?.appendLine(`[ERROR] Stack: ${error.stack}`);
    }
  }
}

// Add file-level format ignore
async function addFormatIgnoreFile(document: TextDocument): Promise<void> {
  try {
    const edit = new WorkspaceEdit();
    const content = document.getText();
    
    // Check if file already has @mago-format-ignore
    if (content.includes('@mago-format-ignore') || content.includes('@mago-formatter-ignore')) {
      window.showWarningMessage('Mago: File already contains a format ignore marker.');
      return;
    }

    // Find insertion point - after <?php if present, otherwise at line 0
    let insertLine = 0;
    
    // Check if file starts with <?php
    if (content.trim().startsWith('<?php')) {
      // Find the line after the opening tag
      const firstLine = document.lineAt(0);
      if (firstLine.text.includes('<?php')) {
        // If <?php is on first line, insert on second line (line 1)
        insertLine = 1;
      } else {
        // Otherwise insert at line 0
        insertLine = 0;
      }
    }

    const position = new Position(insertLine, 0);
    const comment = '// @mago-format-ignore\n';

    edit.insert(document.uri, position, comment);
    const applied = await workspace.applyEdit(edit);
    
    if (applied) {
      window.showInformationMessage('Mago: Added @mago-format-ignore (file-level).');
    } else {
      window.showWarningMessage('Mago: Failed to add format ignore.');
    }
  } catch (error) {
    window.showErrorMessage(`Mago: Failed to add format ignore - ${error}`);
    outputChannel?.appendLine(`[ERROR] Add format ignore error: ${error}`);
    if (error instanceof Error) {
      outputChannel?.appendLine(`[ERROR] Stack: ${error.stack}`);
    }
  }
}

// Add next statement format ignore
async function addFormatIgnoreNext(
  document: TextDocument,
  range: Range
): Promise<void> {
  try {
    const edit = new WorkspaceEdit();
    // Insert on line before selection start
    const insertLine = Math.max(0, range.start.line - 1);
    
    // Get indentation from selection start line
    const selectionStartLine = document.lineAt(range.start.line);
    const indentation = selectionStartLine.text.match(/^\s*/)?.[0] || '';
    
    const position = new Position(insertLine, 0);
    const comment = `${indentation}// @mago-format-ignore-next\n`;

    edit.insert(document.uri, position, comment);
    const applied = await workspace.applyEdit(edit);
    
    if (applied) {
      window.showInformationMessage('Mago: Added @mago-format-ignore-next.');
    } else {
      window.showWarningMessage('Mago: Failed to add format ignore.');
    }
  } catch (error) {
    window.showErrorMessage(`Mago: Failed to add format ignore - ${error}`);
    outputChannel?.appendLine(`[ERROR] Add format ignore error: ${error}`);
    if (error instanceof Error) {
      outputChannel?.appendLine(`[ERROR] Stack: ${error.stack}`);
    }
  }
}

// Add region format ignore (start/end)
async function addFormatIgnoreRegion(
  document: TextDocument,
  range: Range
): Promise<void> {
  try {
    const edit = new WorkspaceEdit();
    
    // Get indentation from selection start line
    const selectionStartLine = document.lineAt(range.start.line);
    const startIndentation = selectionStartLine.text.match(/^\s*/)?.[0] || '';
    
    // Get indentation from selection end line (may differ)
    const selectionEndLine = document.lineAt(range.end.line);
    const endIndentation = selectionEndLine.text.match(/^\s*/)?.[0] || '';
    
    // Insert start marker on line before selection
    const startLine = Math.max(0, range.start.line - 1);
    const startPosition = new Position(startLine, 0);
    const startComment = `${startIndentation}// @mago-format-ignore-start\n`;
    edit.insert(document.uri, startPosition, startComment);
    
    // Insert end marker on line after selection
    const endLine = range.end.line + 1;
    const endPosition = new Position(endLine, 0);
    const endComment = `${endIndentation}// @mago-format-ignore-end\n`;
    edit.insert(document.uri, endPosition, endComment);
    
    const applied = await workspace.applyEdit(edit);
    
    if (applied) {
      window.showInformationMessage('Mago: Added @mago-format-ignore-start/end region.');
    } else {
      window.showWarningMessage('Mago: Failed to add format ignore region.');
    }
  } catch (error) {
    window.showErrorMessage(`Mago: Failed to add format ignore region - ${error}`);
    outputChannel?.appendLine(`[ERROR] Add format ignore region error: ${error}`);
    if (error instanceof Error) {
      outputChannel?.appendLine(`[ERROR] Stack: ${error.stack}`);
    }
  }
}

// Find Mago binary in vendor/bin/mago
function findMagoBinary(workspaceRoot: string): string | null {
  const vendorPath = `${workspaceRoot}/vendor/bin/mago`;
  if (fs.existsSync(vendorPath)) {
    outputChannel?.appendLine(`[INFO] Auto-discovered Mago binary at: ${vendorPath}`);
    return vendorPath;
  }
  return null;
}
