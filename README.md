# Codebase DNA 🧬

> **Visualise any GitHub repository as a living organism.**

Paste a GitHub repository and watch it sequence into an interactive biological organism: directory modules become **organs**, source files become **cells**, imports and dependencies become **pulsing veins**, high-traffic coupling bottlenecks trigger **stress**, and unreferenced dead code manifests as **scar tissue**.

---

## Highlights

- **Zero Runtime Dependencies:** Native ES Modules, HTML5 Canvas 2D, and standard Node.js HTTP.
- **Polyglot Dependency Analyzer:** Parses imports, exports, and entrypoints across 15+ programming languages (JavaScript, TypeScript, Python, Go, Rust, Ruby, PHP, Java, Kotlin, Swift, C/C++, C#, and more).
- **Dead-Code & Orphan Detection:** Detects unreachable modules, unused utility files, and orphaned assets, taking framework conventions (Next.js, Nuxt, Django, FastAPI) and package.json entrypoints into account.
- **Blast Radius Tracing:** Click any file or organ to trace transitive dependents and evaluate refactoring impact.
- **Repository Health Auditing:** Computes vitality score, coupling metrics, and exports instant Markdown health reports.
- **Client-Side GitHub REST API:** Connects directly via GitHub REST API with optional personal access token support for higher rate limits.

---

## Quick Start

### Prerequisites
- Node.js 18+ (no 
pm install needed — zero external dependencies!)

### Run Locally
`ash
# Start the local development server
npm start
# or: node server.js
`

Open http://localhost:5173 in your browser.

### Run Tests
`ash
# Run unit and integration tests using node:test
npm test
`

---

## Architecture

`
codebase-dna/
├── index.html            # Main UI, canvas viewport, controls, and inspection drawer
├── styles.css            # Dark bioluminescent theme, glassmorphism, and responsive layout
├── server.js             # Zero-dependency local Node.js development server
├── js/
│   ├── app.js            # UI controller, event bindings, drawer, and report generator
│   ├── genome.js         # Polyglot AST/regex dependency sequencer and dead-code detector
│   ├── github.js         # GitHub REST API client, tree fetching, and blob parsing
│   └── organism.js       # HTML5 Canvas physics engine, organ layout, and fluid rendering
└── test/
    └── genome.test.js    # Comprehensive node:test suite covering language parsers & heuristics
`

---

## Author

**Victor Oluwatobiloba Ogundipe**
- Portfolio: [https://victobiloba.github.io](https://victobiloba.github.io)
- GitHub: [@victobiloba](https://github.com/victobiloba)

---

## License

MIT
