# Contributing to Loop-Vesper

Thank you for your interest in contributing to Loop-Vesper!

## Getting Started

1. Clone the repository
2. Install dependencies: `npm install`
3. Copy `.env.example` to `.env.local` and fill in required values
4. Run the development server: `npm run dev`

For detailed setup instructions, see [docs/getting-started/SETUP.md](./docs/getting-started/SETUP.md).

## Development Workflow

1. Create a feature branch from `main`
2. Make your changes
3. Ensure all checks pass:
   - `npm run build` - Production build
   - `npm run lint` - Linting
   - `npx tsc --noEmit` - Type checking
4. Submit a pull request

## Code Style

- Use TypeScript for all new code
- Follow existing patterns in the codebase
- Use meaningful variable and function names
- Add comments for complex logic

## Pull Request Guidelines

- Keep PRs focused on a single change
- Include a clear description of what and why
- Reference any related issues
- Ensure CI checks pass

## Reporting Issues

- Use the GitHub issue templates
- Include steps to reproduce
- Provide relevant environment details
- Include screenshots for UI issues

## Documentation

Documentation lives in the `docs/` directory. See [docs/README.md](./docs/README.md) for the full index.

## Questions?

Open an issue for any questions about contributing.
