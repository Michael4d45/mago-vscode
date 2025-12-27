import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  TextDocumentSyncKind,
  InitializeResult,
  TextDocumentPositionParams,
  CompletionItem,
  CompletionItemKind,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { MagoConfig, DEFAULT_CONFIG } from '@shared/config';
import { CheckManager } from './lib/mago/checkManager';
import { ConfigResolver } from './lib/configResolver';
import { DocumentManager } from './lib/documentManager';
import { ErrorManager } from './lib/errorManager';
import { HoverProvider } from './providers/hoverProvider';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = createConnection(ProposedFeatures.all);

// Create a simple text document manager.
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;

let config: MagoConfig = DEFAULT_CONFIG;
let checkManager: CheckManager | undefined;
let configResolver: ConfigResolver | undefined;
let documentManager: DocumentManager | undefined;
let errorManager: ErrorManager | undefined;
let hoverProvider: HoverProvider | undefined;

connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities;

  // Does the client support the `workspace/configuration` request?
  // If not, we fall back using global settings.
  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      // Tell the client that this server supports code completion.
      completionProvider: {
        resolveProvider: true,
      },
      hoverProvider: true,
    },
  };

  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true,
      },
    };
  }

  return result;
});

connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    // Register for all configuration changes.
    connection.client.register(DidChangeConfigurationNotification.type, undefined);
  }

  // Initialize components
  configResolver = new ConfigResolver(connection);
  documentManager = new DocumentManager(connection, documents);
  errorManager = new ErrorManager(connection);
  checkManager = new CheckManager(connection, configResolver, errorManager);
  hoverProvider = new HoverProvider(connection, checkManager);

  // Start the check manager
  checkManager.start();
});

// The example settings
connection.onDidChangeConfiguration(change => {
  if (hasConfigurationCapability) {
    // Reset all cached document settings
    documentManager?.resetSettings();
  } else {
    config = <MagoConfig>(change.settings.mago || DEFAULT_CONFIG);
  }

  // Re-validate all open text documents
  documents.all().forEach(validateTextDocument);
});

function getDocumentSettings(resource: string): Thenable<MagoConfig> {
  if (!hasConfigurationCapability) {
    return Promise.resolve(config);
  }
  const result = connection.workspace.getConfiguration({
    scopeUri: resource,
    section: 'mago',
  });
  return result;
}

// Only keep settings for open documents
documents.onDidClose(e => {
  documentManager?.removeDocument(e.document);
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
  validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  // In watch mode, validation is handled by the watch manager
  // In non-watch mode, we could trigger validation here
  // For now, we'll let the watch manager handle everything
}

// Handle custom requests
connection.onRequest('mago/scanFile', async (params: { uri: string }) => {
  if (checkManager) {
    await checkManager.scanFile(params.uri);
  }
});

connection.onRequest('mago/scanProject', async () => {
  if (checkManager) {
    await checkManager.scanProject();
  }
});

connection.onRequest('mago/clearErrors', async () => {
  if (checkManager) {
    await checkManager.clearErrors();
  }
});

// This handler provides the initial list of the completion items.
connection.onCompletion(
  (_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    // The pass parameter contains the position of the text document in
    // which code complete got requested. For the example we ignore this
    // info and always provide the same completion items.
    return [
      {
        label: 'TypeScript',
        kind: CompletionItemKind.Text,
        data: 1,
      },
      {
        label: 'JavaScript',
        kind: CompletionItemKind.Text,
        data: 2,
      },
    ];
  }
);

// This handler resolves additional information for the item selected in
// the completion list.
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
  if (item.data === 1) {
    item.detail = 'TypeScript details';
    item.documentation = 'TypeScript documentation';
  } else if (item.data === 2) {
    item.detail = 'JavaScript details';
    item.documentation = 'JavaScript documentation';
  }
  return item;
});

// Handle hover requests
connection.onHover(async (params: TextDocumentPositionParams) => {
  if (hoverProvider) {
    return await hoverProvider.provideHover(params);
  }
  return null;
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
