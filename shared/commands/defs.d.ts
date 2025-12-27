export declare const COMMANDS: {
    readonly SCAN_FILE: "mago.scanFile";
    readonly SCAN_PROJECT: "mago.scanProject";
    readonly CLEAR_ERRORS: "mago.clearErrors";
    readonly GENERATE_LINT_BASELINE: "mago.generateLintBaseline";
    readonly GENERATE_ANALYSIS_BASELINE: "mago.generateAnalysisBaseline";
    readonly FORMAT_FILE: "mago.formatFile";
    readonly FORMAT_DOCUMENT: "mago.formatDocument";
    readonly FORMAT_PROJECT: "mago.formatProject";
    readonly FORMAT_STAGED: "mago.formatStaged";
};
export type CommandType = typeof COMMANDS[keyof typeof COMMANDS];
//# sourceMappingURL=defs.d.ts.map