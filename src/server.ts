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

const connection = createConnection(ProposedFeatures.all);
const documents: TextDocuments<TextDocument> = new TextDocuments(TextDocument);

let hasConfigurationCapability = false;
let hasWorkspaceFolderCapability = false;
let hasDiagnosticRelatedInformationCapability = false;

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

interface LaTeXSettings {
  maxNumberOfProblems: number;
  enableAutoReplacement: boolean;
}

const defaultSettings: LaTeXSettings = { 
  maxNumberOfProblems: 1000,
  enableAutoReplacement: true
};

let globalSettings: LaTeXSettings = defaultSettings;
const documentSettings: Map<string, Thenable<LaTeXSettings>> = new Map();

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

function getDocumentSettings(resource: string): Thenable<LaTeXSettings> {
  if (!hasConfigurationCapability) {
    return Promise.resolve(globalSettings);
  }
  let result = documentSettings.get(resource);
  if (!result) {
    result = connection.workspace.getConfiguration({
      scopeUri: resource,
      section: 'latexSymbolsLsp'
    });
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
          label: command,
          kind: CompletionItemKind.Text,
          data: command,
          detail: `${unicode} - ${symbolDescriptions[command] || 'LaTeX symbol'}`,
          documentation: `Converts LaTeX command ${command} to Unicode symbol ${unicode}`,
          insertText: command.substring(currentCommand.length),
          filterText: command
        };
        completionItems.push(item);
      }
    }

    return completionItems;
  }
);

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
