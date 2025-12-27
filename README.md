# Mago VSCode Extension

A VSCode extension that integrates Mago's `lint` and `analyze` commands, providing real-time diagnostics, error highlighting, and hover information for PHP code.

## Features

- **Automatic Scanning**: Scans project on workspace open and files on save
- **Inline Diagnostics**: Shows errors and warnings directly in the editor
- **Status Bar Integration**: Displays analysis status in VSCode's status bar
- **Command Palette**: Provides commands for manual scanning, formatting, and baseline generation
- **Configuration Support**: Supports `mago.toml` configuration files
- **Baseline Support**: Generate and use baseline files to ignore existing issues
- **Code Formatting**: Format PHP files on save or via commands
- **Lint & Analyze**: Supports both linting and static analysis with configurable minimum severity levels

## Requirements

- VSCode 1.90.0 or later
- Mago binary installed and available in PATH
- PHP project with `.php` files

## Installation

1. Clone this repository
2. Run `npm install` in the root directory
3. Run `npm run compile` to build the extension
4. Open the project in VSCode
5. Press `F5` to launch the extension development host

## Configuration

The extension can be configured through VSCode settings (`settings.json`):

```json
{
  "mago.enabled": true,
  "mago.binPath": "mago",
  "mago.binCommand": null,
  "mago.configFile": "mago.toml",
  "mago.workspace": null,
  "mago.enableLint": true,
  "mago.enableAnalyze": true,
  "mago.runOnSave": true,
  "mago.scanOnOpen": true,
  "mago.phpVersion": null,
  "mago.threads": null,
  "mago.minimumReportLevel": "error",
  "mago.timeout": 30000,
  "mago.useBaselines": false,
  "mago.lintBaseline": "lint-baseline.toml",
  "mago.analysisBaseline": "analysis-baseline.toml",
  "mago.enableFormat": true,
  "mago.formatOnSave": false
}
```

### Configuration Options

- `mago.enabled`: Enable/disable the Mago extension (default: `true`)
- `mago.binPath`: Path to the mago binary (default: `mago`)
- `mago.binCommand`: Custom command array for running mago (e.g., `["docker", "exec", "mago"]`)
- `mago.configFile`: Path to `mago.toml` configuration file (default: `mago.toml`)
- `mago.workspace`: Workspace root directory
- `mago.enableLint`: Enable linting (default: `true`)
- `mago.enableAnalyze`: Enable static analysis (default: `true`)
- `mago.runOnSave`: Run Mago automatically when PHP files are saved (default: `true`)
- `mago.scanOnOpen`: Scan project automatically when workspace opens (default: `true`)
- `mago.phpVersion`: PHP version override
- `mago.threads`: Number of threads to use
- `mago.minimumReportLevel`: Minimum severity level to report (default: `error`)
- `mago.timeout`: Timeout for non-watch operations in milliseconds (default: `30000`)
- `mago.useBaselines`: Use baseline files to ignore existing issues (default: `false`)
- `mago.lintBaseline`: Path to lint baseline file (default: `lint-baseline.toml`)
- `mago.analysisBaseline`: Path to analysis baseline file (default: `analysis-baseline.toml`)
- `mago.enableFormat`: Enable formatting functionality (default: `true`)
- `mago.formatOnSave`: Format PHP files automatically when saved (default: `false`)

## Commands

The extension provides the following commands (accessible via Command Palette):

### Scanning Commands
- `Mago: Scan File` - Scan the currently active PHP file
- `Mago: Scan Project` - Scan the entire project
- `Mago: Clear Errors` - Clear all diagnostics

### Baseline Commands
- `Mago: Generate Lint Baseline` - Generate a baseline file for lint issues
- `Mago: Generate Analysis Baseline` - Generate a baseline file for analysis issues

### Formatting Commands
- `Mago: Format File` - Format the currently active PHP file
- `Mago: Format Document` - Format the current document (can be used as default formatter)
- `Mago: Format Project` - Format all PHP files in the project
- `Mago: Format Staged` - Format only staged git files

## Architecture

The extension runs Mago commands directly from the VSCode extension host:

```
┌────────────┐
│   Client   │
│  (VSCode)  │
└────────────┘
      │
      │ spawns
      │
      ▼
┌─────────────┐
│    Mago     │
│   (lint)    │
└─────────────┘
```

### Key Components

- **Extension**: VSCode extension entry point, handles UI interactions and file events
- **Process Runner**: Executes Mago commands and handles output
- **Result Parser**: Parses JSON output from Mago commands
- **Diagnostics Manager**: Handles diagnostics display and status updates

## Development

### Building

```bash
npm run compile
```

### Testing

```bash
npm run test
```

### Debugging

1. Open the project in VSCode
2. Press `F5` to start debugging
3. A new VSCode window will open with the extension loaded

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Run `npm run compile` to ensure everything builds
6. Submit a pull request

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Related Projects

- [Mago](https://github.com/carthage-software/mago) - The PHP linter and static analyzer
- [phpstan-vscode](https://github.com/SanderRonde/phpstan-vscode) - Inspiration for this extension
