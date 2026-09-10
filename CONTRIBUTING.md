# Contribution Guide

Welcome! We appreciate your interest in contributing to the RAG Documentation MCP Server. Please follow these guidelines:

## Development Setup

1. Clone the repository:

```bash
git clone https://github.com/your-username/mcp-server-ragdocs.git
cd mcp-server-ragdocs
```

2. Install dependencies (npm required):

```bash
npm install
# Enforced by .npmrc engine-strict=true
```

3. Build the project:

```bash
npm run build
```

4. Format code with Prettier (using .prettierrc config):

```bash
npm run format
```

5. Check code quality with ESLint (using eslint.config.ts config):

```bash
npm run lint
```

## Development Workflow

### Branch Strategy

- All changes must be made through feature branches (`feat/...`)
- Direct commits to main branch are blocked

### Commit Process

### Commit Validation Workflow

We enforce commit standards through:

- [Husky](https://typicode.github.io/husky/) pre-commit hooks
- [commitlint](https://commitlint.js.org/) message validation
- npm-enforced package manager via `.npmrc`

#### Hook Configuration

```bash
# .husky/pre-commit
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

npm run lint

# .husky/commit-msg
#!/usr/bin/env sh
. "$(dirname -- "$0")/_/husky.sh"

npx commitlint --edit "$1"
```

1. Stage changes with `git add`
2. Attempt commit - validation runs automatically
3. If rejected:
   - Fix message format
   - Retry commit

Example workflow:

```bash
git add .
git commit -m "invalid message" # Fails
git commit -m "feat: add validation workflow" # Succeeds
```

### Pull Requests

- Require 1+ approved review
- All CI checks must pass
- Enforce linear commit history

## Coding Standards

- Follow TypeScript best practices
- Use descriptive variable/method names
- Include JSDoc comments for public methods
- Keep functions focused (single responsibility principle)

### Testing Conventions

1. **File Structure**:

   - Test files must live adjacent to their implementation
   - Naming pattern: `[filename].test.ts`
   - Example:
     ```
     src/
       tools/
         base-tool.ts
         base-tool.test.ts
     ```

2. **Test Execution**:

   ```bash
   # Run all tests
   npm test

   # Run tests for specific file
   npm test src/tools/base-tool.test.ts

   # Generate coverage report
   npm run test:coverage
   ```

3. **Coverage Requirements**:

   - Minimum 80% branch coverage
   - Reports generated in /coverage
   - CI blocks PRs with reduced coverage

4. **Best Practices**:

   - Test files must mirror source folder structure
   - Use Jest's modern ESM syntax
   - Prefer `describe.each` for parameterized tests
   - Mock external dependencies using Jest's mocking system

5. **Example Test Structure**:

```typescript
// Example from src/tools/jestTestFunction.test.ts
import { jestTestFunction } from './jestTestFunction'

describe('jestTestFunction', () => {
  it('should return true for valid inputs', () => {
    // Arrange
    const input = { test: true }

    // Act
    const result = jestTestFunction(input)

    // Assert
    expect(result).toBe(true)
  })

  it('should handle edge cases', () => {
    // Test edge cases with proper mocking
    jest.spyOn(console, 'log').mockImplementation()

    expect(jestTestFunction(null)).toBe(false)
    expect(console.log).toHaveBeenCalledWith('Invalid input')
  })
})
```

7. **CI Integration**:
   - Tests run on GitHub Actions for all PRs
   - Coverage tracked via Codecov
   - Failure blocks merge

## Commit Message Guide

Use the interactive wizard for standardized commits:

```bash
npm run commit
```

### Format

```
type(scope): description [issue-number]
```

### Valid Types:

- feat: New feature (triggers minor release)
- fix: Bug fix (triggers patch release)
- perf: Performance improvement (triggers patch release)
- docs: Documentation changes
- style: Code formatting
- refactor: Code refactoring
- test: Test updates
- chore: Maintenance tasks (including releases)

The Commitizen wizard will guide you through these types. Our configuration
extends @commitlint/config-conventional which also recognizes:

- build: Changes to build process (not currently used)
- ci: CI configuration changes (not currently used)
- revert: Revert commits (auto-generated)

Official @commitlint/config-conventional types include:

- build: Changes that affect the build system
- ci: CI configuration changes
- revert: Revert a previous commit

### Example:

```
fix(commit): Add interactive commit wizard [GH-6]
```

The wizard will validate your input and ensure proper formatting.

## Pull Request Process

1. Create a feature branch from `main`
2. Implement your changes
3. Run tests: `npm test`
4. Ensure linting passes: `npm run lint`
5. Push to your fork and open a PR
6. Include a clear description of changes
7. Reference any related issues

## Reporting Issues

- Use the GitHub issue tracker
- Include reproduction steps
- Specify expected vs actual behavior
- Add relevant code snippets/logs

## Code Review

- All PRs require maintainer approval
- Address review comments promptly
- Keep discussion focused on the code

## Release Process

This project uses semantic-release for automated version management:

- Commits must follow Conventional Commits specification
- Merges to `main` trigger automated releases
- Patch versions for `fix` commits
- Minor versions for `feat` commits
- Major versions for breaking changes (`BREAKING CHANGE` in footer)

### How a release works

1. A commit with a release type (`fix:`, `feat:`, or breaking change) is merged to `main`.
2. The `Release` workflow (`.github/workflows/release.yml`) runs `npx semantic-release`.
3. semantic-release determines the next version, updates `package.json` and `CHANGELOG.md`,
   creates a git tag `v<version>`, publishes the package to npm, and creates a GitHub Release.

### Publishing to npm (OIDC Trusted Publisher)

The package is published to npm via **OIDC Trusted Publisher** — no npm token is stored
in GitHub Actions secrets. npm trusts the OIDC identity of the GitHub Actions workflow
(`id-token: write` permission in the `Release` job).

The Trusted Publisher must be configured on npm for the package
(`@gorizond/mcp-server-ragdocs` → Settings → Access → Trusted Publisher):

- Publisher: **GitHub Actions**
- Repository: **gorizond/mcp-server-ragdocs**
- Workflow filename: **release.yml** (exact match, including the `.yml` extension)

If the OIDC exchange fails with `404 OIDC token exchange error - package not found`,
the Trusted Publisher configuration does not match the workflow — verify the three
fields above.

### Verifying a release

```bash
npm view @gorizond/mcp-server-ragdocs versions
npm view @gorizond/mcp-server-ragdocs dist-tags.latest
gh release list -R gorizond/mcp-server-ragdocs
```

The published version must match the git tag and the `version` field in `package.json`.

### Security note

Do not store the npm token as a GitHub **variable** (variables are not masked and are
visible to anyone with read access to the repository). If a classic token is ever needed,
store it as a GitHub **secret** (`NPM_TOKEN`) and rotate it if it may have been exposed.
