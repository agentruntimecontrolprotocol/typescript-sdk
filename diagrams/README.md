# Architecture diagrams

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="architecture-dark.svg">
  <img alt="ARCP architecture (worked example)" src="architecture-light.svg">
</picture>

Graphviz `.dot` templates for clean architecture diagrams, with paired
light/dark SVGs that GitHub auto-switches via `<picture>` and
`prefers-color-scheme`. The image above renders from
[`architecture-light.dot`](architecture-light.dot) / [`architecture-dark.dot`](architecture-dark.dot).

## Using this with an AI coding agent

Drop the template files and this README into a `diagrams/` directory in
your repo, then send your agent the prompt below. Replace the bracketed
placeholders.

```
Read diagrams/README.md, then produce an architecture diagram for
[SUBJECT — e.g. "the OAuth login flow", "the job scheduler"].

Steps:
1. Copy diagrams/diagram-template-light.dot to diagrams/[name]-light.dot,
   and diagrams/diagram-template-dark.dot to diagrams/[name]-dark.dot.
2. Edit ONLY the EXAMPLE section in each .dot file. Leave the canvas,
   node, and edge default blocks exactly as they are.
3. Compose nodes, clusters, and edges using only the palette and patterns
   from the README's Style reference section.
4. Render both:
     dot -Tsvg diagrams/[name]-light.dot -o diagrams/[name]-light.svg
     dot -Tsvg diagrams/[name]-dark.dot  -o diagrams/[name]-dark.svg
5. Embed the pair in [TARGET_FILE.md] using the <picture> snippet from
   the README's "Render and embed" section.

Hard constraints — do not violate:
- Two anchors max per diagram: one ENTRY (blue, #3B82F6) and one HUB
  (amber, #F59E0B). All other nodes use defaults.
- Single-line centered node labels. No subtitles, no section references,
  no metadata under the name. If context is needed, put it in the cluster
  label or in surrounding prose.
- Light and dark variants must be structurally identical — same nodes,
  same edges, same cluster boundaries. Only color attributes differ.
- bgcolor stays "transparent" in both variants.
- Do not introduce colors outside the README palette table.
```

## Files

| File                               | Role                                                    |
| ---------------------------------- | ------------------------------------------------------- |
| `diagram-template-light.dot`       | Starting point. Full style docs in the header.          |
| `diagram-template-dark.dot`        | Dark companion. Structure must match the light variant. |
| `architecture-light.dot` / `architecture-dark.dot` | Worked example shown above.                             |

The `.dot` files are the source you edit. The `.svg` files are rendered
deliverables; you commit both and reference them from markdown.

## Render and embed

Render both variants:

```bash
dot -Tsvg diagrams/foo-light.dot -o diagrams/foo-light.svg
dot -Tsvg diagrams/foo-dark.dot  -o diagrams/foo-dark.svg
```

Embed in any markdown file:

```markdown
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="diagrams/foo-dark.svg">
  <img alt="Foo architecture" src="diagrams/foo-light.svg">
</picture>
```

GitHub serves the matching SVG based on the viewer's theme. Both variants
render with `bgcolor="transparent"`, so they sit on whatever page
background is active.

## Style reference

### Design rules

- **Two anchors max** — one ENTRY (blue) and one HUB (amber). If you
  highlight a third thing, nothing is highlighted.
- **Two-tier edges** — primary spine carries the main flow at penwidth
  1.2 with slate-500 (light) / slate-400 (dark). Secondary wiring
  recedes at penwidth 1.0 with slate-300 / slate-600. Switch defaults
  mid-graph with `edge [...]`.
- **Cluster fills signal nesting** — outer/primary uses ink-100 /
  slate-900, inner/secondary uses ink-50 / slate-800. Both share borders
  at ink-200 / slate-700.
- **Data stores** use `shape=cylinder`. Everything else is a rounded box.
- **Feedback / async / return paths** use dashed pink edges with a label
  and `constraint=false` so they don't distort layout.
- **Single-line centered node labels.** Cluster labels use a TABLE
  wrapper for asymmetric padding (top and sides only, no bottom).

### Palette

| Role                | Light                 | Dark                |
| ------------------- | --------------------- | ------------------- |
| canvas              | transparent           | transparent         |
| primary text        | `#1F2937` ink-900     | `#F1F5F9` slate-100 |
| cluster label       | `#475569` ink-600     | `#94A3B8` slate-400 |
| muted subtitle      | `#94A3B8` ink-400     | `#64748B` slate-500 |
| primary edge        | `#64748B` ink-500     | `#94A3B8` slate-400 |
| default edge        | `#94A3B8` ink-400     | `#64748B` slate-500 |
| secondary edge      | `#CBD5E1` ink-300     | `#475569` slate-600 |
| default node fill   | white                 | `#334155` slate-700 |
| default node border | `#CBD5E1` ink-300     | `#475569` slate-600 |
| cluster border      | `#E2E8F0` ink-200     | `#334155` slate-700 |
| outer cluster fill  | `#F1F5F9` ink-100     | `#0F172A` slate-900 |
| inner cluster fill  | `#F8FAFC` ink-50      | `#1E293B` slate-800 |
| ENTRY fill / border | `#3B82F6` / `#2563EB` | unchanged           |
| HUB fill / border   | `#F59E0B` / `#D97706` | unchanged           |
| feedback edge       | `#F472B6` pink-400    | unchanged           |
| feedback label      | `#DB2777` pink-600    | `#F472B6` pink-400  |

### Node variants

Default — inherits everything from the defaults block, no overrides:

```dot
NodeA [label="Component A"];
```

ENTRY anchor — the external client or user-facing entry point. Use once
per diagram:

```dot
Entry [
  label=<<FONT POINT-SIZE="12"><B>EntryName</B></FONT>>,
  fillcolor="#3B82F6", color="#2563EB",
  fontcolor="white", penwidth=1.4
];
```

HUB anchor — the central component everything routes through. Use once
per diagram:

```dot
Hub [
  label=<<FONT POINT-SIZE="12"><B>HubName</B></FONT>>,
  fillcolor="#F59E0B", color="#D97706",
  fontcolor="white", penwidth=1.4
];
```

Data store — persistent state. Optional one-word subtitle for the
storage technology:

```dot
Store [
  label=<<FONT POINT-SIZE="10">Store</FONT><BR/><FONT POINT-SIZE="8" COLOR="#94A3B8">SQLite</FONT>>,
  shape=cylinder, fillcolor="#FAFBFC"
];
```

In the dark variant, swap the subtitle color to `#64748B` and the fill
to `#1E293B`.

### Cluster pattern

The TABLE wrapper gives the cluster label top and side padding but no
bottom padding, so the title sits cleanly above its contents. Don't
simplify it back to a plain `label=` — the asymmetric padding is the
trick:

```dot
subgraph cluster_name {
  label=<<TABLE BORDER="0" CELLBORDER="0" CELLPADDING="0" CELLSPACING="0"><TR><TD COLSPAN="3" HEIGHT="8"></TD></TR><TR><TD WIDTH="8"></TD><TD><FONT POINT-SIZE="12"><B>Group Name</B></FONT></TD><TD WIDTH="8"></TD></TR></TABLE>>;
  style="rounded,filled";
  fillcolor="#F1F5F9";   // outer; use #F8FAFC for inner/nested groups
  color="#E2E8F0";
  fontcolor="#475569";
  fontname="Helvetica";
  margin=14;
  labeljust=l;
  penwidth=1.0;

  // nodes inside go here
}
```

### Edge tiers

Switch edge defaults mid-graph; the change affects every subsequent edge
until you switch again:

```dot
// PRIMARY SPINE — main flow
edge [color="#64748B", penwidth=1.2];   // dark variant: #94A3B8
Hub -> A;
Hub -> B;

// SECONDARY WIRING — recedes
edge [color="#CBD5E1", penwidth=1.0];   // dark variant: #475569
A -> Store;
B -> Store;
```

### Feedback / async return

Dashed pink, off-spine, labeled. `constraint=false` keeps it out of the
layout solver:

```dot
Store -> Hub [
  style=dashed, color="#F472B6", penwidth=1.1,
  constraint=false,
  label=<<FONT COLOR="#DB2777">return</FONT>>, fontsize=9
];
```

In the dark variant, swap the label color to `#F472B6`.

### Edges into / out of clusters

Connect to a real node inside the cluster, then use `lhead` / `ltail` to
make the arrow attach to the cluster boundary instead:

```dot
Outer -> InsideNode [lhead=cluster_name];
InsideNode -> Outer [ltail=cluster_name];
```

Requires `compound=true` at the graph level — already set in the
template.

### Same-rank trick

Force nodes onto a single row:

```dot
A -> B -> C [style=invis];
{ rank=same; A; B; C; }
```

Used in the worked example to lay out `WebSocket`, `stdio`, and
`in-memory` side by side.
