# GitHub Actions Workflows - Deployment Strategy

## Current Status

There are **TWO** workflows in `.github/workflows/`:

1. **`docs.yml`** - MkDocs deployment (full documentation site)
2. **`static.yml`** - Static HTML deployment (visualization gallery only)

## ⚠️ Important: Deployment Conflict

**GitHub Pages allows only ONE active deployment per repository.**

Both workflows deploy to the same GitHub Pages site (`https://nousproj.github.io/nous-docs`), so **only ONE can be active at a time**.

## Deployment Options

### Option 1: MkDocs Full Site (RECOMMENDED ✅)

**Active Workflow**: `docs.yml`
**Status**: Currently Active
**Deploys**: Full MkDocs documentation site with navigation, search, and embedded HTML visualizations

**Pros:**
- ✅ Professional documentation site with Material theme
- ✅ Built-in search functionality
- ✅ Navigation menu and page hierarchy
- ✅ Includes HTML visualizations in `docs/visual/`
- ✅ Responsive design and mobile-friendly
- ✅ Code syntax highlighting
- ✅ Mermaid diagram support
- ✅ Light/dark mode toggle

**Access:**
- Main site: `https://nousproj.github.io/nous-docs`
- Visualizations: `https://nousproj.github.io/nous-docs/visual/<page>.html`

**To Use:**
- Already active - just push to `main` branch
- The workflow auto-deploys on changes to `docs/**`, `mkdocs.yml`, or `requirements.txt`

---

### Option 2: Static HTML Gallery Only

**Active Workflow**: `static.yml`
**Status**: Currently Manual-Only (workflow_dispatch)
**Deploys**: Standalone gallery with ONLY the 5 HTML visualization pages

**Pros:**
- ✅ Lightweight - no build step required
- ✅ Direct access to visualizations
- ✅ Custom gallery landing page
- ✅ Faster deployment

**Cons:**
- ❌ No documentation navigation
- ❌ No search functionality
- ❌ No markdown documentation
- ❌ Conflicts with docs.yml if both are active

**Access:**
- Main site: `https://nousproj.github.io/nous-docs` (gallery index)
- Visualizations: `https://nousproj.github.io/nous-docs/visual/<page>.html`

**To Use:**
1. Disable `docs.yml` (rename to `docs.yml.disabled`)
2. Uncomment the `push:` trigger in `static.yml`
3. Push to `main` branch

---

## Current Configuration

### docs.yml (Active)

```yaml
on:
  push:
    branches: [main]
    paths:
      - 'docs/**'
      - 'mkdocs.yml'
      - 'requirements.txt'
      - '.github/workflows/docs.yml'
  workflow_dispatch:
```

- ✅ Auto-deploys on push to main
- ✅ Includes all HTML files in docs/visual/
- ✅ Builds full MkDocs site

### static.yml (Disabled - Manual Only)

```yaml
on:
  # push:                    # COMMENTED OUT
  #   branches: ["main"]
  #   paths:
  #     - 'docs/visual/*.html'
  workflow_dispatch:         # Manual trigger only
```

- ⚠️ Only runs on manual trigger
- ⚠️ Would conflict with docs.yml if auto-enabled
- ✅ Has proper HTML gallery implementation
- ✅ Creates index.html with links to all visualizations

---

## HTML Visualization Files

Located in `docs/visual/`:

1. ✅ `nous-overview.html` - System overview
2. ✅ `control-plane-architecture.html` - Control plane components
3. ✅ `system-architecture.html` - Full system architecture
4. ✅ `reconciliation-flow.html` - Reconciliation loop
5. ✅ `dynamodb-schema.html` - Database schema

**Status**: All files are ready and will be deployed by whichever workflow is active.

---

## Recommended Setup (Current Configuration)

**Keep docs.yml active, static.yml as backup.**

This gives you:
- Full professional documentation site
- HTML visualizations accessible at `/visual/` paths
- Manual option to deploy standalone gallery if needed

### To Deploy Now

The documentation is already configured correctly. Just push to main:

```bash
cd /Users/mohammadismail/Apple/personal/nous-project/nousproj/nous-docs
git add .
git commit -m "docs: Update GitHub Actions workflows for proper Pages deployment"
git push origin main
```

The docs.yml workflow will automatically:
1. Build the MkDocs site
2. Include all HTML files from docs/visual/
3. Deploy to GitHub Pages

---

## Alternative: Use Static HTML Only

If you want ONLY the visualizations without MkDocs:

### Step 1: Disable docs.yml

```bash
cd /Users/mohammadismail/Apple/personal/nous-project/nousproj/nous-docs
mv .github/workflows/docs.yml .github/workflows/docs.yml.disabled
```

### Step 2: Enable static.yml

Edit `.github/workflows/static.yml` and uncomment the push trigger:

```yaml
on:
  push:
    branches: ["main"]
    paths:
      - 'docs/visual/*.html'
  workflow_dispatch:
```

### Step 3: Deploy

```bash
git add .
git commit -m "chore: Switch to static HTML deployment"
git push origin main
```

---

## Testing Workflows Locally

### Test MkDocs Build

```bash
pip install -r requirements.txt
mkdocs build --strict --verbose
# Output in site/ directory
```

### Test Static HTML Structure

```bash
mkdir -p _test_site/visual
cp docs/visual/*.html _test_site/visual/
# Open _test_site/visual/nous-overview.html in browser
```

---

## Current State Summary

| Workflow | Status | Purpose | Recommendation |
|----------|--------|---------|----------------|
| **docs.yml** | ✅ Active | Full MkDocs documentation with HTML visualizations | **Keep Active** |
| **static.yml** | ⚠️ Manual-only | Standalone HTML gallery | Keep as backup/alternative |

**Next Action**: Push changes to deploy via docs.yml (MkDocs), which includes all HTML files.

---

## Troubleshooting

### Both Workflows Running

If both workflows are active, they will conflict. Last one to run wins. Solution:
- Choose one primary deployment method
- Disable the other workflow

### HTML Files Not Showing

If HTML files don't appear in MkDocs:
- They're already in `docs/visual/` ✅
- They're already in `mkdocs.yml` nav ✅
- MkDocs copies them automatically ✅

The files WILL be accessible at: `https://nousproj.github.io/nous-docs/visual/<filename>.html`

### Want Both Options

Not possible with GitHub Pages free tier. Options:
- Use Vercel/Netlify for one deployment
- Use different GitHub repos for different sites
- Use gh-pages branch for one, GitHub Actions for the other

---

## Questions?

**Q: Which workflow should I use?**
A: Use `docs.yml` (MkDocs) - it's more professional and includes everything.

**Q: Are the HTML files already being published?**
A: Yes! They're in `docs/visual/` and MkDocs copies them to the output automatically.

**Q: When do I use static.yml?**
A: Only if you want a minimal visualization gallery without the full documentation site.

**Q: Can I test before deploying?**
A: Yes - run `mkdocs serve` locally to preview the site.

