export const COMMANDS = {
  SCAN_FILE: 'mago.scanFile',
  SCAN_PROJECT: 'mago.scanProject',
  CLEAR_ERRORS: 'mago.clearErrors',
  GENERATE_LINT_BASELINE: 'mago.generateLintBaseline',
  GENERATE_ANALYSIS_BASELINE: 'mago.generateAnalysisBaseline',
  GENERATE_GUARD_BASELINE: 'mago.generateGuardBaseline',
  FORMAT_FILE: 'mago.formatFile',
  FORMAT_DOCUMENT: 'mago.formatDocument',
  FORMAT_PROJECT: 'mago.formatProject',
  FORMAT_STAGED: 'mago.formatStaged',
} as const;

export type CommandType = typeof COMMANDS[keyof typeof COMMANDS];
