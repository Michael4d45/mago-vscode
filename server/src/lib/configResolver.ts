import * as fs from 'fs';
import * as path from 'path';
import { Connection } from 'vscode-languageserver';
import * as toml from '@iarna/toml';
import { MagoConfig, MagoTomlConfig, DEFAULT_CONFIG } from '@shared/config';

export class ConfigResolver {
  private connection: Connection;
  private configCache: Map<string, MagoConfig> = new Map();

  constructor(connection: Connection) {
    this.connection = connection;
  }

  async resolveConfig(workspaceRoot: string): Promise<MagoConfig> {
    if (this.configCache.has(workspaceRoot)) {
      return this.configCache.get(workspaceRoot)!;
    }

    const configPath = this.findConfigFile(workspaceRoot);
    let tomlConfig: MagoTomlConfig = {};

    if (configPath) {
      try {
        const content = await fs.promises.readFile(configPath, 'utf8');
        tomlConfig = toml.parse(content) as MagoTomlConfig;
      } catch (error) {
        this.connection.console.warn(`Failed to parse mago.toml: ${error}`);
      }
    }

    const config: MagoConfig = {
      ...DEFAULT_CONFIG,
      ...this.mapTomlToConfig(tomlConfig),
    };

    this.configCache.set(workspaceRoot, config);
    return config;
  }

  private findConfigFile(workspaceRoot: string): string | null {
    const possiblePaths = [
      'mago.toml',
      '.mago.toml',
      'mago.dist.toml',
    ];

    for (const configFile of possiblePaths) {
      const fullPath = path.join(workspaceRoot, configFile);
      if (fs.existsSync(fullPath)) {
        return fullPath;
      }
    }

    return null;
  }

  private mapTomlToConfig(tomlConfig: MagoTomlConfig): Partial<MagoConfig> {
    // Map TOML config to our MagoConfig interface
    // This will need to be updated based on actual mago.toml format
    const config: Partial<MagoConfig> = {};

    if (tomlConfig.phpVersion) {
      config.phpVersion = tomlConfig.phpVersion;
    }

    if (tomlConfig.threads) {
      config.threads = tomlConfig.threads;
    }

    // Add more mappings as the mago.toml format becomes known

    return config;
  }

  clearCache(): void {
    this.configCache.clear();
  }
}
