const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { execSync } = require('child_process');

const vsixFile = 'mago-vscode-0.1.1.vsix';

if (!fs.existsSync(vsixFile)) {
  console.error(`VSIX file not found: ${vsixFile}`);
  process.exit(1);
}

// Extract VSIX
const tempDir = path.join(__dirname, '..', '.vsix-temp');
if (fs.existsSync(tempDir)) {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
fs.mkdirSync(tempDir, { recursive: true });

const zip = new AdmZip(vsixFile);
zip.extractAllTo(tempDir, true);

// Copy server dependencies (including transitive dependencies)
const deps = [
  'vscode-languageserver',
  'vscode-languageserver-textdocument',
  'vscode-languageserver-protocol',
  'vscode-languageserver-types',
  'vscode-jsonrpc'
];
const extensionDir = path.join(tempDir, 'extension');
const extensionNodeModules = path.join(extensionDir, 'node_modules');

let added = 0;
deps.forEach(dep => {
  const src = path.join(__dirname, '..', 'node_modules', dep);
  if (fs.existsSync(src)) {
    const dest = path.join(extensionNodeModules, dep);
    if (fs.existsSync(dest)) {
      fs.rmSync(dest, { recursive: true, force: true });
    }
    fs.cpSync(src, dest, { recursive: true });
    added++;
    console.log(`Added ${dep} to VSIX`);
  } else {
    console.warn(`Warning: ${dep} not found in node_modules`);
  }
});

if (added > 0) {
  // Recreate VSIX
  const newZip = new AdmZip();
  newZip.addLocalFolder(extensionDir, 'extension');
  // Add VSIX manifest files
  ['[Content_Types].xml', 'extension.vsixmanifest'].forEach(file => {
    const filePath = path.join(tempDir, file);
    if (fs.existsSync(filePath)) {
      newZip.addLocalFile(filePath, '');
    }
  });
  newZip.writeZip(vsixFile);
  console.log(`Successfully added ${added} server dependencies to VSIX`);
  
  // Cleanup
  fs.rmSync(tempDir, { recursive: true, force: true });
} else {
  console.warn('No server dependencies were added');
  fs.rmSync(tempDir, { recursive: true, force: true });
}

