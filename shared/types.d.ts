import * as lsp from 'vscode-languageserver';
export interface MagoIssue {
    code: string;
    severity: 'error' | 'warning' | 'note' | 'help';
    message: string;
    line: number;
    column: number;
    fixable?: boolean;
    rule?: string;
}
export interface MagoFileResult {
    issues: MagoIssue[];
}
export interface MagoResult {
    files: Record<string, MagoFileResult>;
    summary?: {
        total: number;
        errors: number;
        warnings: number;
    };
}
export interface WatchModeUpdate {
    type: 'lint' | 'analyze';
    result: MagoResult;
}
export interface FileEvent {
    uri: string;
    content?: string;
    version?: number;
}
export interface StatusUpdate {
    type: 'lint' | 'analyze';
    status: 'running' | 'idle' | 'error';
    message?: string;
}
export declare function issueToDiagnostic(issue: MagoIssue): lsp.Diagnostic;
//# sourceMappingURL=types.d.ts.map