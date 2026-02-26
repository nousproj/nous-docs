# Documentation Deployment Guide

## Overview

The Nous documentation is built with MkDocs Material and automatically deployed to GitHub Pages using GitHub Actions.

## Prerequisites

- Python 3.12+
- pip

## Local Development

### Setup

```bash
# Install dependencies
pip install -r requirements.txt

# Serve locally
mkdocs serve

# The docs will be available at http://127.0.0.1:1988
```

### Build Locally

```bash
# Build the site
mkdocs build --verbose --strict

# Output will be in the site/ directory
```

## GitHub Pages Deployment

### Automatic Deployment

The documentation is automatically deployed to GitHub Pages when:

1. Changes are pushed to the `main` branch in the following paths:
   - `docs/**`
   - `mkdocs.yml`
   - `requirements.txt`
   - `.github/workflows/docs.yml`

2. Manual trigger via workflow_dispatch in GitHub Actions

### Workflow

The `.github/workflows/docs.yml` workflow:

1. **Build Job**:
   - Checks out the repository
   - Sets up Python 3.12
   - Installs dependencies from `requirements.txt`
   - Builds the MkDocs site with `--strict` mode (fails on warnings)
   - Uploads the built site as a GitHub Pages artifact

2. **Deploy Job**:
   - Deploys the artifact to GitHub Pages
   - Only runs on non-PR events (push to main or manual trigger)

### GitHub Repository Settings

Ensure the following settings are configured in your GitHub repository:

1. Go to **Settings** → **Pages**
2. Set **Source** to: **GitHub Actions**
3. The site will be published to: `https://nousproj.github.io/nous-docs`

### Permissions

The workflow requires the following permissions:
- `contents: read` - To checkout the repository
- `pages: write` - To deploy to GitHub Pages
- `id-token: write` - For GitHub Pages deployment authentication

## Dependencies

The documentation uses the following dependencies (see `requirements.txt`):

- **mkdocs** (>=1.5.0) - Core documentation framework
- **mkdocs-material** (9.5.50) - Material theme for MkDocs
- **pymdown-extensions** (>=10.7) - Extended Markdown features

## Configuration

The site configuration is in `mkdocs.yml`:

- **Site URL**: `https://nousproj.github.io/nous-docs`
- **Theme**: Material with light/dark mode toggle
- **Features**: Navigation tabs, code copy, search, and more
- **Markdown Extensions**: Mermaid diagrams, code highlighting, admonitions, etc.

## Troubleshooting

### Build Fails Locally

```bash
# Ensure all dependencies are installed
pip install --upgrade pip
pip install -r requirements.txt

# Try building without strict mode to see warnings
mkdocs build --verbose
```

### GitHub Actions Build Fails

1. Check the Actions tab in GitHub for detailed error logs
2. Common issues:
   - Broken links in Markdown files
   - Missing pages referenced in `nav` section of `mkdocs.yml`
   - Invalid YAML syntax in `mkdocs.yml`
   - Missing files in `docs/` directory

### Pages Not Updating

1. Check that GitHub Pages is set to use **GitHub Actions** as the source
2. Verify the workflow completed successfully in the Actions tab
3. GitHub Pages may take a few minutes to update after deployment
4. Try a hard refresh in your browser (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows)

## Testing Changes

### Before Committing

```bash
# Build with strict mode (same as CI)
mkdocs build --verbose --strict

# If this succeeds, your changes should deploy successfully
```

### Testing in Pull Requests

The workflow runs on PRs but does not deploy. It will:
- Validate that the site builds successfully
- Report any errors in the PR checks

## Manual Deployment

You can manually trigger a deployment:

1. Go to **Actions** tab in GitHub
2. Select **Deploy Docs to GitHub Pages**
3. Click **Run workflow**
4. Select the `main` branch
5. Click **Run workflow**

## Contributing

When adding new documentation:

1. Add Markdown files to the `docs/` directory
2. Update the `nav` section in `mkdocs.yml` to include new pages
3. Test locally with `mkdocs serve`
4. Build with strict mode: `mkdocs build --strict`
5. Submit a PR with your changes

The PR will automatically run the build check to validate your changes before merging.

