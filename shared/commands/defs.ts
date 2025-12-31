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
  LINT_FIX: 'mago.lintFix',
  LINT_FIX_UNSAFE: 'mago.lintFixUnsafe',
  LINT_FIX_POTENTIALLY_UNSAFE: 'mago.lintFixPotentiallyUnsafe',
} as const;

export type CommandType = typeof COMMANDS[keyof typeof COMMANDS];
