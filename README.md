# Mago VSCode Extension

A powerful VSCode extension that seamlessly integrates [Mago](https://github.com/carthage-software/mago)'s advanced linting, static analysis, and architectural guard tools into your PHP development workflow. Get real-time feedback, automatic fixes, and professional code formatting—all without leaving your editor.

![Timeline comparison of intelephense, mago, and phpstan](Timeline.gif)

(Mago is running on a single file for lint and analyze, the auto save is on a 1000ms delay. I'm sure the VS Code extension setup has some overhead, see [here](https://mago.carthage.software/benchmarks) for their benchmarks.)

## Why Use This Extension?

- **Catch Bugs Before They Ship**: Real-time static analysis finds potential issues as you code
- **Enforce Architecture**: Architectural guard ensures your code follows defined architectural boundaries and layer dependencies
- **Fix Issues Instantly**: One-click quick fixes automatically resolve many common problems
- **Professional Code Quality**: Consistent formatting and style enforcement across your entire project, with fine-grained control via format ignore directives
- **Zero Configuration**: Works out of the box—auto-discovers Mago in your `vendor/bin` directory
- **Seamless Integration**: Inline diagnostics, status bar updates, and native VSCode commands
- **Flexible Workflow**: Enable/disable features independently, use baselines for legacy code, and customize everything

## Features

- **Automatic Scanning**: Automatically scans your project when you open it and checks files when you save them (configurable to scan single file or whole project)
- **Inline Diagnostics**: Shows errors and warnings directly in your code with helpful information and code hints
- **Quick Fixes**: One-click fixes for many issues—apply Mago's suggested fixes, suppress warnings with `@mago-expect`, or add format ignore directives
- **Automatic Lint Fixes**: Apply automatic fixes for linting issues with three safety levels: safe, potentially unsafe, and unsafe
- **Format Ignore Directives**: Right-click on selected code to easily exclude it from formatting with `@mago-format-ignore-next`, `@mago-format-ignore-start/end`, or file-level `@mago-format-ignore`
- **Status Bar Integration**: Displays analysis status in VSCode's status bar
- **Code Formatting**: Format PHP files on save or via commands (can be set as default formatter)
- **Separate Lint, Analysis, and Guard**: Enable or disable linting, static analysis, and architectural guard independently
- **Architectural Guard**: Enforce architectural rules and layer dependencies to maintain clean architecture
- **Baseline Support**: Generate baseline files to ignore existing issues and focus on new problems
- **Auto-Discovery**: Automatically finds Mago binary in `vendor/bin/mago` if not in PATH
- **Configurable**: Supports `mago.toml` configuration files and extensive VSCode settings
- **Workspace Variables**: Use `${workspaceFolder}` and `${env:VARNAME}` in configuration paths

## Requirements

- **Mago**: The Mago binary must be installed. The extension will automatically find it if:
  - It's in your system PATH, or
  - It's located at `vendor/bin/mago` in your workspace (common for Composer projects)
  - You can also configure a custom path via settings
- **PHP Project**: Works with any PHP project containing `.php` files

## Quick Start

Once installed, the extension will automatically:

- Scan your project when you open a workspace
- Check PHP files when you save them
- Display errors and warnings inline in your editor with helpful information

**No configuration needed!** The extension automatically discovers Mago if it's:
- In your system PATH, or
- Located at `vendor/bin/mago` in your workspace (common for Composer projects)

### Understanding Diagnostics

When Mago finds issues in your code, they appear as:
- **Error markers** (red squiggles) for errors
- **Warning markers** (yellow squiggles) for warnings
- **Information markers** (blue squiggles) for notes
- **Hint markers** (gray squiggles) for help messages

Hovering over an issue shows the full message, error code, and any help text provided by Mago. You can also see all issues in the Problems panel (View → Problems).

**Issue Categories**: Issues are prefixed with their category:
- `lint:code` - Linting issues (code style, syntax problems)
- `analyze:code` - Static analysis issues (type errors, logic problems)
- `guard:code` - Architectural guard violations (layer dependency violations)

### Quick Fixes

Many issues can be fixed instantly with VSCode's Quick Fix feature:

1. **Hover over an issue** or place your cursor on it
2. **Click the lightbulb icon** (💡) or press `Ctrl+.` (Cmd+. on Mac)
3. **Choose from available fixes**:
   - **Apply fix** - Automatically applies Mago's suggested code changes (when available)
   - **Suppress with @mago-expect** - Adds a comment to expect this specific error code (with category prefix)

**For format ignore directives**, select the code you want to exclude from formatting, then:
- **Right-click** and choose from the context menu, or
- Use Quick Fix (`Ctrl+.` / `Cmd+.`) to add:
  - **@mago-format-ignore-next** - Ignores formatting for the next statement
  - **@mago-format-ignore-start/end** - Ignores formatting for a region
  - **@mago-format-ignore** - Ignores formatting for the entire file

Quick fixes and context menu actions make it easy to resolve issues and control formatting without manually editing code or searching for the right syntax.

## Automatic Lint Fixes

In addition to individual quick fixes for specific issues, you can apply automatic fixes across your entire project using the lint fix commands. These commands run `mago lint --fix` with different safety levels:

### Safety Levels

- **Safe Fixes** (`Mago: Lint Fix`) - Only applies fixes that are guaranteed to be safe and won't change your code's behavior
- **Potentially Unsafe Fixes** (`Mago: Lint Fix Potentially Unsafe`) - Includes fixes that are usually safe but may require manual review
- **Unsafe Fixes** (`Mago: Lint Fix Unsafe`) - Applies all available fixes, including those that may change code behavior

### When to Use Each Level

- **Safe**: Use this for routine cleanup and style fixes. Perfect for automated workflows and CI/CD pipelines.
- **Potentially Unsafe**: Use when you want more aggressive fixes but still want to review changes carefully.
- **Unsafe**: Use with caution and always review changes. Best for experienced developers who understand the risks.

### Usage

1. Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Search for and select the appropriate lint fix command
3. The command will scan your project and apply available fixes
4. Check the status bar for progress and review the output panel for details

**Tip**: You can set custom key bindings for these commands in VSCode's Keyboard Shortcuts settings (`Ctrl+Shift+P` → "Preferences: Open Keyboard Shortcuts") to make lint fixes even faster.

**Note**: These commands respect your baseline configuration—if baselines are enabled, only new issues will be fixed. They also work with all your other Mago configuration settings like workspace paths and custom binary locations.

## Configuration

You can configure the extension through VSCode's settings UI (File → Preferences → Settings) or by editing your `settings.json` file.

### Basic Settings

Open your settings and search for "Mago" to see all available options. Here are the most commonly used settings:

```json
{
  "mago.enabled": true,
  "mago.binPath": "mago",
  "mago.runOnSave": true,
  "mago.runOnSaveScope": "project",
  "mago.scanOnOpen": true,
  "mago.minimumReportLevel": "error"
}
```

### Common Configuration Scenarios

#### Using a Custom Mago Path

**Note**: The extension automatically discovers Mago in `vendor/bin/mago`, so you typically don't need to configure this unless Mago is in a non-standard location.

If Mago is not in your PATH or `vendor/bin/mago`, specify the full path:

```json
{
  "mago.binPath": "/usr/local/bin/mago"
}
```

Or if it's in your project's vendor directory (using workspace variables):

```json
{
  "mago.binPath": "${workspaceFolder}/vendor/bin/mago"
}
```

**Note**: The extension supports VSCode workspace variables:
- `${workspaceFolder}` or `${workspaceRoot}` - The workspace root directory
- `${env:VARNAME}` - Environment variables (e.g., `${env:HOME}`)

#### Running Mago via Docker

If you need to run Mago inside a Docker container:

```json
{
  "mago.binCommand": ["docker", "exec", "mago-container", "mago"]
}
```

#### Using Baseline Files

To ignore existing issues and only show new problems:

1. Generate baseline files using the commands (see Commands section below)
2. Enable baseline usage:

```json
{
  "mago.useBaselines": true,
  "mago.lintBaseline": "lint-baseline.toml",
  "mago.analysisBaseline": "analysis-baseline.toml",
  "mago.guardBaseline": "guard-baseline.toml"
}
```

#### Format on Save

To automatically format PHP files when you save them:

```json
{
  "mago.formatOnSave": true
}
```

#### Format After Lint Fixes

To automatically format files after applying lint fixes:

```json
{
  "mago.formatAfterLintFix": true
}
```

This will run the formatter on any files that were modified by the lint fix commands, ensuring consistent code style after fixes are applied.

#### Setting Mago as Default Formatter

To use Mago as the default formatter for PHP files:

1. Open VSCode settings
2. Search for "default formatter"
3. Set `Editor: Default Formatter` to "Mago" (or use the `Format Document` command)
4. Alternatively, add to your `settings.json`:

```json
{
  "[php]": {
    "editor.defaultFormatter": "Michael4d45.mago-vscode"
  }
}
```

#### Enabling/Disabling Lint, Analysis, and Guard Separately

You can enable or disable linting, static analysis, and architectural guard independently:

```json
{
  "mago.enableLint": true,      // Enable linting (default: true)
  "mago.enableAnalyze": true,   // Enable static analysis (default: true)
  "mago.enableGuard": false     // Enable architectural guard (default: false)
}
```

This is useful if you only want to use specific features or want to run them separately. Note that guard can be slower than lint/analyze, so it defaults to disabled. Enable it when you need architectural enforcement:

```json
{
  "mago.enableGuard": true,     // Enable guard for architectural checks
  "mago.runGuardOnSave": false  // Guard doesn't run on save by default
}
```

#### Run on Save: Single File vs Whole Project

By default, Mago runs on the whole project when you save. You can configure it to scan only the saved file instead:

```json
{
  "mago.runOnSave": true,
  "mago.runOnSaveScope": "project"  // Run on whole project (default)
}
```

Or to scan only the saved file:

```json
{
  "mago.runOnSave": true,
  "mago.runOnSaveScope": "file"     // Run on saved file only
}
```

**Note**: Running on the whole project on save may be slower, especially for large projects, but provides comprehensive feedback. Use `"file"` for faster feedback on the current file only.

### All Configuration Options

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `mago.enabled` | boolean | `true` | Enable/disable the Mago extension |
| `mago.binPath` | string | `"mago"` | Path to the mago binary (supports `${workspaceFolder}` and `${env:VARNAME}` variables) |
| `mago.binCommand` | array | `null` | Custom command array for running mago (e.g., `["docker", "exec", "mago"]`) |
| `mago.configFile` | string | `"mago.toml"` | Path to `mago.toml` configuration file (supports workspace variables) |
| `mago.workspace` | string | `null` | Workspace root directory (usually auto-detected) |
| `mago.enableLint` | boolean | `true` | Enable linting (can be disabled independently from analysis and guard) |
| `mago.enableAnalyze` | boolean | `true` | Enable static analysis (can be disabled independently from linting and guard) |
| `mago.enableGuard` | boolean | `false` | Enable architectural guard checks (can be enabled independently from linting and analysis). Note: Guard can be slower than lint/analyze, so it defaults to false. |
| `mago.guardBaseline` | string | `"guard-baseline.toml"` | Path to guard baseline file (supports workspace variables) |
| `mago.runGuardOnSave` | boolean | `false` | Run guard checks when PHP files are saved. Note: Guard can be slower than lint/analyze, so this defaults to false. |
| `mago.runOnSave` | boolean | `true` | Run Mago automatically when PHP files are saved |
| `mago.runOnSaveScope` | string | `"project"` | What to run the linter/analyzer on when saving: `"file"` (single file) or `"project"` (whole project) |
| `mago.scanOnOpen` | boolean | `true` | Scan project automatically when workspace opens |
| `mago.phpVersion` | string | `null` | PHP version override |
| `mago.threads` | number | `null` | Number of threads to use |
| `mago.minimumReportLevel` | string | `"error"` | Minimum severity level to report (`error`, `warning`, `note`, `help`) |
| `mago.timeout` | number | `30000` | Timeout for operations in milliseconds |
| `mago.useBaselines` | boolean | `false` | Use baseline files to ignore existing issues |
| `mago.lintBaseline` | string | `"lint-baseline.toml"` | Path to lint baseline file (supports workspace variables) |
| `mago.analysisBaseline` | string | `"analysis-baseline.toml"` | Path to analysis baseline file (supports workspace variables) |
| `mago.enableFormat` | boolean | `true` | Enable formatting functionality |
| `mago.formatOnSave` | boolean | `false` | Format PHP files automatically when saved |
| `mago.formatAfterLintFix` | boolean | `false` | Format files after applying lint fixes. Requires --fix to be enabled. |

## Commands

Access these commands via the Command Palette (Ctrl+Shift+P / Cmd+Shift+P):

### Scanning Commands

- **`Mago: Scan File`** - Scan the currently active PHP file
- **`Mago: Scan Project`** - Scan the entire project
- **`Mago: Clear Errors`** - Clear all diagnostics from the editor

### Lint Fix Commands

- **`Mago: Lint Fix`** - Apply automatic fixes for lint issues (safe fixes only)
- **`Mago: Lint Fix Unsafe`** - Apply automatic fixes including unsafe ones that may change behavior
- **`Mago: Lint Fix Potentially Unsafe`** - Apply automatic fixes including potentially unsafe ones that require review

### Baseline Commands

- **`Mago: Generate Lint Baseline`** - Generate a baseline file for lint issues (saves existing issues so they won't be reported)
- **`Mago: Generate Analysis Baseline`** - Generate a baseline file for analysis issues
- **`Mago: Generate Guard Baseline`** - Generate a baseline file for guard violations (saves existing architectural violations so they won't be reported)

### Formatting Commands

- **`Mago: Format File`** - Format the currently active PHP file
- **`Mago: Format Document`** - Format the current document (can be set as default formatter via VSCode settings)
- **`Mago: Format Project`** - Format all PHP files in the project
- **`Mago: Format Staged Files`** - Format only files staged in git

## Quick Fixes

The extension provides powerful quick fix capabilities that let you resolve issues with a single click:

### Applying Automatic Fixes

When Mago provides suggested code changes for an issue, you can apply them instantly:

1. Hover over the issue or click on it
2. Press `Ctrl+.` (Cmd+. on Mac) or click the lightbulb icon (💡)
3. Select **"Apply fix: [issue description]"**
4. The fix is automatically applied to your code

This is perfect for common issues like formatting problems, simple refactorings, or style violations that Mago can automatically correct.

### Suppressing Issues

Sometimes you need to suppress a specific issue. The extension provides suppression via `@mago-expect`:

#### @mago-expect

Expects a specific error code with category prefix, useful for documenting known issues. The format is `category:code` where category is `lint`, `analysis`, or `guard`:

```php
// @mago-expect lint:unused-variable
$unused = getValue(); // We expect this lint warning

// @mago-expect analysis:missing-return-statement
function incomplete() {
    // We know this function doesn't return
}

// @mago-expect guard:disallowed-use
use App\Domain\User; // We know this violates architecture but it's intentional
```

To add a suppression:
1. Hover over the issue or click on it
2. Press `Ctrl+.` (Cmd+. on Mac) or click the lightbulb icon (💡)
3. Select **"Suppress with @mago-expect [category:code]"**

The appropriate comment is automatically added above the line with the correct category and code.

### Format Ignore Directives

When you need to prevent Mago from formatting specific parts of your code, you can use format ignore directives. These are especially useful for preserving custom formatting in arrays, function calls, or other code blocks.

To add format ignore directives:
1. **Select the code** you want to exclude from formatting (or right-click anywhere in a PHP file for file-level ignore)
2. **Right-click** and choose from the context menu, or press `Ctrl+.` (Cmd+. on Mac) / click the lightbulb icon (💡)
3. Choose from:
   - **Add @mago-format-ignore-next** - Ignores formatting for the next statement (requires selection)
   - **Add @mago-format-ignore-start/end** - Ignores formatting for a region (requires selection)
   - **Add @mago-format-ignore (file-level)** - Ignores formatting for the entire file

#### @mago-format-ignore-next

Ignores formatting for the next statement:

```php
// @mago-format-ignore-next
$array = [
    'key1' => 'value1',
    'key2' => 'value2',
]; // This array won't be reformatted
```

#### @mago-format-ignore-start/end

Ignores formatting for a specific region:

```php
// @mago-format-ignore-start
$complex = [
    'nested' => [
        'deeply' => 'formatted',
        'preserve' => 'this',
    ],
];
// @mago-format-ignore-end
```

#### @mago-format-ignore (file-level)

Ignores formatting for the entire file. This is added at the top of the file:

```php
<?php
// @mago-format-ignore

// The rest of this file won't be formatted
class MyClass {
    // ...
}
```

## Using Baselines

Baselines are useful when you're adding Mago to an existing project with many existing issues. They let you focus on new problems while ignoring known issues.

1. Run `Mago: Generate Lint Baseline`, `Mago: Generate Analysis Baseline`, and/or `Mago: Generate Guard Baseline` to create baseline files
2. Enable baseline usage in your settings:
   ```json
   {
     "mago.useBaselines": true
   }
   ```
3. Only new issues will be reported going forward

**Note**: Each command (lint, analyze, guard) has its own baseline file. You can generate baselines for all three, or just the ones you need.

## Troubleshooting

### Mago Not Found

If you see errors about Mago not being found:

1. **Check auto-discovery**: The extension automatically looks for Mago in `vendor/bin/mago` in your workspace. If you're using Composer, make sure Mago is installed as a dependency.

2. **Check your PATH**: Make sure Mago is installed and available in your system PATH. Test by running `mago --version` in your terminal.

3. **Set a custom path**: If Mago is in a different location, set `mago.binPath` to the full path:
   ```json
   {
     "mago.binPath": "/path/to/mago"
   }
   ```

4. **Use workspace variables**: You can use VSCode workspace variables in the path:
   ```json
   {
     "mago.binPath": "${workspaceFolder}/vendor/bin/mago"
   }
   ```

5. **Docker/Container setup**: If you need to run Mago via Docker or another wrapper, use `mago.binCommand`:
   ```json
   {
     "mago.binCommand": ["docker", "exec", "mago-container", "mago"]
   }
   ```

### Extension Not Working

1. Check that `mago.enabled` is set to `true` in your settings
2. Verify Mago is working by running `mago --version` in your terminal
3. Check the VSCode Output panel (View → Output) and select "Mago" from the dropdown to see detailed logs, error messages, and command execution information

The Output panel shows:
- Command execution logs
- Error messages and stack traces
- Issue counts and parsing results
- Process exit codes and stderr output

### Performance Issues

If scanning is too slow:

1. Increase the timeout: `"mago.timeout": 60000`
2. Disable scanning on save: `"mago.runOnSave": false`
3. Adjust the minimum report level to show fewer issues: `"mago.minimumReportLevel": "warning"`

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Related Projects

- [Mago](https://github.com/carthage-software/mago) - The PHP linter, static analyzer, and architectural guard that powers this extension
