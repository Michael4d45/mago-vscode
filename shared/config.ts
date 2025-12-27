export interface MagoConfig {
  enabled: boolean;
  binPath: string;
  binCommand?: string[];
  configFile: string;
  workspace?: string;
  enableLint: boolean;
  enableAnalyze: boolean;
  runOnSave: boolean;
  scanOnOpen: boolean;
  phpVersion?: string;
  threads?: number;
  minimumReportLevel: 'error' | 'warning' | 'note' | 'help';
  timeout: number;
  useBaselines: boolean;
  lintBaseline: string;
  analysisBaseline: string;
  enableFormat: boolean;
  formatOnSave: boolean;
}

export interface MagoTomlConfig {
  [key: string]: any;
  // Add specific Mago TOML config fields as they become known
}

export interface ProcessConfig {
  command: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

export const DEFAULT_CONFIG: MagoConfig = {
  enabled: true,
  binPath: 'mago',
  configFile: 'mago.toml',
  enableLint: true,
  enableAnalyze: true,
  runOnSave: true,
  scanOnOpen: true,
  minimumReportLevel: 'error',
  timeout: 30000,
  useBaselines: false,
  lintBaseline: 'lint-baseline.toml',
  analysisBaseline: 'analysis-baseline.toml',
  enableFormat: true,
  formatOnSave: false,
};
