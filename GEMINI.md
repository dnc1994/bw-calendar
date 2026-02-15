# Gemini CLI Project Notes

This project was developed with the assistance of Gemini CLI.

## Tech Stack
- **TypeScript**: Main programming language.
- **React**: Used for the calendar UI components.
- **esbuild**: Used for fast bundling of the plugin.
- **Obsidian API**: To interact with the vault and workspace.

## Development Workflow
- `npm run dev`: Build and watch for changes.
- `npm run build`: Minified production build.
- `npm run deploy`: Build and copy to the local Obsidian vault for testing.

## Key Considerations
- **Date Handling**: Strictly uses the filename (`YYYY-MM-DD.md`) as the source of truth for the calendar date to avoid timezone-related off-by-one errors.
- **Parsing**: A custom regex-based parser handles the specific YAML-like format used for event logging.
