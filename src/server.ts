import {
  createConnection,
  TextDocuments,
  Diagnostic,
  DiagnosticSeverity,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  CompletionItem,
  CompletionItemKind,
  TextDocumentPositionParams,
  TextDocumentSyncKind,
  InitializeResult,
  CodeAction,
  CodeActionKind} from 'vscode-languageserver/node';

import { TextDocument } from 'vscode-languageserver-textdocument';

import { latexSymbols, symbolDescriptions } from './symbols';

/**
 * LaTeX Symbols Language Server Protocol (LSP) implementation.
 * 
 * This LSP provides:
 * - Autocompletion for LaTeX math symbols triggered by backslash (\)
 * - Diagnostics highlighting LaTeX commands that can be converted to Unicode
 * - Code actions (quick fixes) to replace LaTeX commands with Unicode symbols
 * - Support for 150+ mathematical symbols including Greek letters, operators, arrows, etc.
 */

// Create LSP connection with all proposed features enabled
const connection = createConnection(ProposedFeatures.all);
// Document manager for tracking open text documents
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

// Client capability flags
let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

/**
 * Initialize the LSP server and negotiate capabilities with the client.
 * Sets up text document sync, completion provider, and code action provider.
 */
connection.onInitialize((params: InitializeParams) => {
  const capabilities = params.capabilities;

  hasConfigurationCapability = !!(
    capabilities.workspace && !!capabilities.workspace.configuration
  );
  hasWorkspaceFolderCapability = !!(
    capabilities.workspace && !!capabilities.workspace.workspaceFolders
  );
  hasDiagnosticRelatedInformationCapability = !!(
    capabilities.textDocument &&
    capabilities.textDocument.publishDiagnostics &&
    capabilities.textDocument.publishDiagnostics.relatedInformation
  );

  const result: InitializeResult = {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        resolveProvider: true,
        triggerCharacters: ['\\']
      },
      codeActionProvider: {
        codeActionKinds: [CodeActionKind.QuickFix]
      }
    }
  };

  if (hasWorkspaceFolderCapability) {
    result.capabilities.workspace = {
      workspaceFolders: {
        supported: true
      }
    };
  }

  return result;
});

/**
 * Called after the client-server handshake is complete.
 * Registers for configuration and workspace folder change notifications if supported.
 */
connection.onInitialized(() => {
  if (hasConfigurationCapability) {
    connection.client.register(DidChangeConfigurationNotification.type, undefined);
  }
  if (hasWorkspaceFolderCapability) {
    connection.workspace.onDidChangeWorkspaceFolders(_event => {
      connection.console.log('Workspace folder change event received.');
    });
  }
});

/**
 * Configuration settings for the LaTeX Symbols LSP.
 */
interface LaTeXSettings {
  /** Maximum number of diagnostic problems to report per document */
  maxNumberOfProblems: number;
  /** Whether to enable automatic Unicode replacement suggestions */
  enableAutoReplacement: boolean;
}

const defaultSettings: LaTeXSettings = { 
  maxNumberOfProblems: 1000,
  enableAutoReplacement: true
};

let globalSettings: LaTeXSettings = defaultSettings;

// Mapping from files names to its settings
const documentSettings: Map<string, LaTeXSettings> = new Map();

connection.onDidChangeConfiguration(change => {
  if (hasConfigurationCapability) {
    documentSettings.clear();
  } else {
    globalSettings = <LaTeXSettings>(
      (change.settings.latexSymbolsLsp || defaultSettings)
    );
  }
  documents.all().forEach(validateTextDocument);
});

/**
 * Attempts to get the configuration from the editor, or uses the default configuration otherwise
 */
async function getDocumentSettings(resource: string): Promise<LaTeXSettings> {
  if (!hasConfigurationCapability) {
    return Promise.resolve(globalSettings);
  }
  let result = documentSettings.get(resource);
  if (!result) {
    result = await connection.workspace.getConfiguration({
      scopeUri: resource,
      section: 'latexSymbolsLsp'
    });
    if (!result) {
      result = defaultSettings
    }
    documentSettings.set(resource, result);
  }
  return result;
}

documents.onDidClose(e => {
  documentSettings.delete(e.document.uri);
});

documents.onDidChangeContent(change => {
  validateTextDocument(change.document);
});

/**
 * Validates a text document by finding LaTeX commands that can be converted to Unicode.
 * Creates diagnostics (information-level) for each convertible LaTeX command found.
 * 
 * @param textDocument The document to validate
 */
async function validateTextDocument(textDocument: TextDocument): Promise<void> {
  const settings = await getDocumentSettings(textDocument.uri);
  const text = textDocument.getText();
  const pattern = /\\[a-zA-Z]+/g;
  let m: RegExpExecArray | null;

  const diagnostics: Diagnostic[] = [];
  
  while ((m = pattern.exec(text)) && diagnostics.length < settings.maxNumberOfProblems) {
    const latexCommand = m[0];
    if (latexSymbols[latexCommand]) {
      const diagnostic: Diagnostic = {
        severity: DiagnosticSeverity.Information,
        range: {
          start: textDocument.positionAt(m.index),
          end: textDocument.positionAt(m.index + m[0].length)
        },
        message: `LaTeX symbol "${latexCommand}" can be converted to Unicode: ${latexSymbols[latexCommand]}`,
        source: 'latex-symbols-lsp'
      };
      diagnostics.push(diagnostic);
    }
  }

  connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

/**
 * Provides autocompletion for LaTeX symbols.
 * Triggered when user types backslash (\) followed by letters.
 * Returns completion items that replace the LaTeX command with Unicode symbols.
 */
connection.onCompletion(
  (_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
    const document = documents.get(_textDocumentPosition.textDocument.uri);
    if (!document) {
      return [];
    }

    const position = _textDocumentPosition.position;
    const text = document.getText();
    const offset = document.offsetAt(position);
    
    // Find the start of the current word (LaTeX command)
    let start = offset - 1;
    while (start >= 0 && text[start] !== '\\' && /[a-zA-Z]/.test(text[start])) {
      start--;
    }
    
    if (start < 0 || text[start] !== '\\') {
      return [];
    }

    const currentCommand = text.substring(start, offset);
    
    const completionItems: CompletionItem[] = [];
    
    for (const [command, unicode] of Object.entries(latexSymbols)) {
      if (command.startsWith(currentCommand)) {
        const item: CompletionItem = {
          label: `${command} → ${unicode}`,
          kind: CompletionItemKind.Text,
          data: unicode,
          detail: `${unicode} - ${symbolDescriptions[command] || 'LaTeX symbol'}`,
          documentation: `Converts LaTeX command ${command} to Unicode symbol ${unicode}`,
          textEdit: {
            range: {
              start: document.positionAt(start),
              end: document.positionAt(offset)
            },
            newText: unicode
          },
          filterText: command
        };
        completionItems.push(item);
      }
    }

    return completionItems;
  }
);

/**
 * Resolves additional details for completion items.
 * Adds detailed information about the Unicode symbol and LaTeX command.
 */
connection.onCompletionResolve(
  (item: CompletionItem): CompletionItem => {
    const command = item.data as string;
    if (latexSymbols[command]) {
      item.detail = `${latexSymbols[command]} - ${symbolDescriptions[command] || 'LaTeX symbol'}`;
      item.documentation = `Converts LaTeX command ${command} to Unicode symbol ${latexSymbols[command]}`;
    }
    return item;
  }
);

/**
 * Provides code actions (quick fixes) to replace LaTeX commands with Unicode symbols.
 * Triggered when user activates code actions on diagnostics created by validateTextDocument.
 */
connection.onCodeAction((params) => {
  const document = documents.get(params.textDocument.uri);
  if (!document) {
    return [];
  }

  const codeActions: CodeAction[] = [];
  
  for (const diagnostic of params.context.diagnostics) {
    if (diagnostic.source === 'latex-symbols-lsp') {
      const text = document.getText(diagnostic.range);
      const unicodeSymbol = latexSymbols[text];
      
      if (unicodeSymbol) {
        const fix: CodeAction = {
          title: `Replace with Unicode symbol: ${unicodeSymbol}`,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diagnostic],
          edit: {
            changes: {
              [params.textDocument.uri]: [
                {
                  range: diagnostic.range,
                  newText: unicodeSymbol
                }
              ]
            }
          }
        };
        codeActions.push(fix);
      }
    }
  }
  
  return codeActions;
});

documents.listen(connection);
connection.listen();
