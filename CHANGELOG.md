# Changelog

All notable changes to the Mago VSCode extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.6] - 2025-12-31

### Added
- **Auto-Scan After Lint Fixes**: Automatically re-scan files after applying lint fixes when `mago.runOnSave` is enabled
- **Improved Setting Descriptions**: Updated `mago.formatAfterLintFix` description for clarity

## [0.1.5] - 2025-12-31

### Added
- **Lint Fix Commands**: Added comprehensive automatic lint fixing capabilities
  - `Mago: Lint Fix` - Apply safe automatic fixes only
  - `Mago: Lint Fix Potentially Unsafe` - Apply fixes that may require review
  - `Mago: Lint Fix Unsafe` - Apply all available fixes (use with caution)
  - New `mago.formatAfterLintFix` setting to format files after applying fixes

## [0.1.4] - 2025-12-28

### Added
- **Architectural Guard Support**: Added full support for Mago's architectural guard functionality
  - New `mago.enableGuard` setting to enable/disable architectural guard checks
  - New `mago.guardBaseline` setting for guard baseline file path
  - New `mago.runGuardOnSave` setting to control when guard checks run
  - New `Mago: Generate Guard Baseline` command
  - Guard violations now appear with `guard:code` prefix in diagnostics

## [0.1.3] - 2025-12-27

### Added
- **Run-on-Save Configuration**: Added granular control over when Mago runs
  - `mago.runOnSaveScope` setting to choose between "file" or "project" scanning
  - Improved performance options for large projects

### Changed
- **Improved Baseline Support**: Enhanced baseline functionality
  - Separate baseline commands for lint, analysis, and guard
  - Better baseline file path configuration with workspace variable support

## [0.1.1] - 2025-12-26

### Added
- **Enhanced Formatting Control**: Expanded format ignore directive support
  - `@mago-format-ignore-next` - Ignore formatting for next statement
  - `@mago-format-ignore-start/end` - Ignore formatting for regions
  - `@mago-format-ignore` - File-level formatting ignore
  - Context menu integration for easy format ignore directive insertion
  - Quick fix integration for format ignore directives

- **Additional Commands**:
  - `Mago: Format Staged Files` - Format only git-staged PHP files
  - `Mago: Clear Errors` - Clear all diagnostics from the editor

- **Enhanced Status Bar**: Improved status bar integration with better progress indication

- **Configuration Improvements**:
  - Added workspace variable support (`${workspaceFolder}`, `${env:VARNAME}`) in all path settings
  - Better auto-discovery for Mago binary in `vendor/bin/mago`
  - Enhanced Docker/container support via `mago.binCommand`

### Fixed
- Publisher information in package.json (changed from "mago" to "Michael4d45")
- README documentation and formatting
- Various bug fixes and stability improvements

### Technical Details
- **Engine Requirements**: Requires VS Code ^1.90.0
- **Dependencies**: No external dependencies (pure VS Code extension)
- **Activation**: Activates on PHP language files (`onLanguage:php`)

## [0.1.0] - 2025-12-26

### Added
- Initial release of Mago VSCode extension
- PHP linting integration with Mago
- Static analysis capabilities
- Code formatting support
- Inline diagnostics with error/warning/note/help levels
- Quick fixes for common issues
- `@mago-expect` suppression comments
- Baseline file generation and support
- Comprehensive configuration options
- Status bar integration
- Command palette integration

### Features Included
- Automatic project scanning on workspace open
- Run-on-save functionality
- Configurable minimum report level
- Custom binary path support
- Timeout configuration
- Thread count control
- PHP version override support

---

## Types of Changes
- `Added` for new features
- `Changed` for changes in existing functionality
- `Deprecated` for soon-to-be removed features
- `Removed` for now removed features
- `Fixed` for any bug fixes
- `Security` in case of vulnerabilities
