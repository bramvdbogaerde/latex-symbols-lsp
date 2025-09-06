# LaTeX Symbols LSP

A Language Server Protocol (LSP) implementation that provides autocompletion for LaTeX math symbols and offers quick fixes to replace them with Unicode equivalents.

## Features

- **Autocompletion**: Type `\` followed by symbol names to get autocompletion suggestions
- **Unicode Replacement**: Automatic suggestions to replace LaTeX commands with Unicode symbols
- **Comprehensive Symbol Support**: Includes Greek letters, mathematical operators, arrows, relations, and more
- **Code Actions**: Quick fix actions to convert LaTeX symbols to Unicode

## Supported Symbols

The LSP supports over 150 LaTeX math symbols including:

- **Greek Letters**: `\alpha` → α, `\beta` → β, `\gamma` → γ, etc.
- **Mathematical Operators**: `\pm` → ±, `\times` → ×, `\div` → ÷, etc.
- **Relations**: `\leq` → ≤, `\geq` → ≥, `\neq` → ≠, etc.  
- **Arrows**: `\rightarrow` → →, `\Rightarrow` → ⇒, etc.
- **Set Theory**: `\in` → ∈, `\subset` → ⊂, `\cup` → ∪, etc.
- **Logic**: `\forall` → ∀, `\exists` → ∃, `\neg` → ¬, etc.
- **Calculus**: `\partial` → ∂, `\nabla` → ∇, `\infty` → ∞, etc.

## Installation

1. Clone this repository:
   ```bash
   git clone <repository-url>
   cd latex-symbols-lsp
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the project:
   ```bash
   npm run build
   ```

## Usage

### Running the LSP Server

Start the LSP server:
```bash
npm start
```

The server will listen for LSP client connections on stdio.

### Development Mode

Run in development mode with automatic rebuilding:
```bash
npm run dev
```

### Integration with Editors

This LSP can be integrated with any LSP-compatible editor:

#### VS Code
Create a VS Code extension that connects to this LSP server.

#### Neovim
Configure with nvim-lspconfig:
```lua
local configs = require('lspconfig.configs')
local lspconfig = require('lspconfig')

configs.latex_symbols = {
  default_config = {
    cmd = {'node', '/path/to/latex-symbols-lsp/dist/server.js', '--stdio'},
    filetypes = {'tex', 'latex', 'markdown'},
    root_dir = lspconfig.util.root_pattern('.git'),
    settings = {}
  }
}

lspconfig.latex_symbols.setup{}
```

#### Emacs
Use with lsp-mode or eglot.

## Configuration

The LSP supports the following configuration options:

- `maxNumberOfProblems`: Maximum number of diagnostics to show (default: 1000)

## Architecture

- `src/server.ts`: Main LSP server implementation
- `src/symbols.ts`: LaTeX symbol to Unicode mappings and descriptions
- `dist/`: Compiled JavaScript output

## License

GPLv3
