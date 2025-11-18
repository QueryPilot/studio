# Query Pilot

A modern, lightweight database IDE built with Tauri and React. Query Pilot provides a beautiful interface for managing your databases with native desktop performance.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)

## Features

- 🚀 **Fast & Lightweight** - Native performance with Tauri
- 🎨 **Beautiful UI** - Modern interface with light and dark themes
- 🔒 **Secure** - Your data stays on your machine
- 📊 **Multi-Database Support** - PostgreSQL, MySQL, SQLite, and more
- ⚡ **Smart Query Editor** - Intelligent autocomplete and syntax highlighting
- 📈 **Data Visualizations** - Beautiful charts and insights

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS, shadcn/ui
- **Backend**: Tauri 2, Rust
- **Build Tool**: Vite
- **Package Manager**: pnpm

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher)
- [pnpm](https://pnpm.io/) (v8 or higher)
- [Rust](https://www.rust-lang.org/) (latest stable)
- [Tauri Prerequisites](https://tauri.app/v1/guides/getting-started/prerequisites)

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/query-pilot.git
cd query-pilot
```

2. Install dependencies:
```bash
pnpm install
```

## Development

Run the app in development mode:
```bash
pnpm tauri:dev
```

Or use the Makefile:
```bash
make dev
```

### Other Commands

```bash
# Frontend development only
pnpm dev

# Build for production
pnpm tauri:build

# Lint code
pnpm lint

# Type checking
pnpm typecheck

# Clean build artifacts
make clean
```

## Building

Build the application for production:
```bash
pnpm tauri:build
```

This will create platform-specific installers in `src-tauri/target/release/bundle/`.

## Project Structure

```
query-pilot/
├── src/                    # React frontend
│   ├── components/         # React components
│   │   ├── ui/            # shadcn/ui components
│   │   └── TitleBar.tsx   # Custom title bar
│   ├── lib/               # Utilities
│   └── App.tsx            # Main application
├── src-tauri/             # Rust backend
│   ├── src/               # Rust source code
│   └── tauri.conf.json    # Tauri configuration
├── docs/                  # Documentation
└── package.json           # Node dependencies
```

## Configuration

The application configuration is managed through:
- `src-tauri/tauri.conf.json` - Tauri window and build settings
- `tailwind.config.js` - Tailwind CSS configuration
- `vite.config.ts` - Vite build configuration

## Telemetry & Privacy

Query Pilot includes **optional** error tracking and performance monitoring via Sentry:

- ✅ **Disabled by default** - Requires explicit opt-in
- ✅ **User controlled** - Enable/disable in Preferences → Telemetry & Error Reporting
- ✅ **Privacy-first** - No SQL queries, credentials, or user data sent
- ✅ **Transparent** - Clear disclosure of what data is collected

**For Users:**
- Open Preferences → Telemetry & Error Reporting to control data collection
- See what we collect vs. what we never collect

**For Developers:**
- See [SENTRY.md](./SENTRY.md) for comprehensive integration documentation
- Quick setup: [.github/SENTRY_QUICKSTART.md](./.github/SENTRY_QUICKSTART.md)
- Detailed guide: [.github/SENTRY_SETUP.md](./.github/SENTRY_SETUP.md)

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/)
- [Tauri Extension](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode)
- [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- Built with [Tauri](https://tauri.app/)
- UI components from [shadcn/ui](https://ui.shadcn.com/)
- Icons from [Lucide](https://lucide.dev/)
