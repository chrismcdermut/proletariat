# Proletariat Slide Deck

Marp-based slide deck for Proletariat presentations.

## Prerequisites

Install the Marp CLI:

```bash
npm install -g @marp-team/marp-cli
```

## Build Commands

### HTML (for presenting)

```bash
marp proletariat-deck.md -o proletariat-deck.html
```

### PDF

```bash
marp proletariat-deck.md --pdf -o proletariat-deck.pdf
```

### PowerPoint (PPTX)

```bash
marp proletariat-deck.md --pptx -o proletariat-deck.pptx
```

### PNG images (one per slide)

```bash
marp proletariat-deck.md --images png -o proletariat-deck
```

## Live Preview

Start a local server with hot reload:

```bash
marp -s .
```

Then open `http://localhost:8080/proletariat-deck.md` in your browser.

## Presenter Mode

Open the HTML output in a browser and press `P` to enter presenter mode.

## Customization

The deck uses Marp's default theme with a dark color scheme. To customize:

- **Colors**: Edit the `style` block in the frontmatter of `proletariat-deck.md`
- **Theme**: Change `theme: default` to another Marp theme (`gaia`, `uncover`)
- **Slides**: Each `---` separator creates a new slide
- **Directives**: Use `<!-- _class: lead -->` for title-style slides

## Slide Count

The deck contains 17 slides covering:

1. Title
2. The Problem
3. The Solution
4. Key Features
5. Multi-Agent Parallel Execution
6. Ticket-Based Task Management
7. Integrations Ecosystem
8. Docker Sandboxing & Isolation
9. Architecture
10. Live Demo Walkthrough
11. Before & After Comparison
12. Three Ways to Use prlt
13. Agent Naming Themes
14. Workspace Structure
15. Workflow Automation
16. Roadmap
17. CTA / Get Started
