import {
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
  keymap,
} from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { Range, Prec } from '@codemirror/state';

// ─── Checkbox widget ────────────────────────────────────────────────────────

class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super();
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = `md-checkbox ${this.checked ? 'md-checkbox--checked' : ''}`;
    // Use a consistent styled div instead of unicode characters
    const box = document.createElement('span');
    box.className = 'md-checkbox-box';
    if (this.checked) {
      box.textContent = '✓';
    }
    span.appendChild(box);
    return span;
  }
  eq(other: CheckboxWidget) {
    return this.checked === other.checked;
  }
}

// ─── Horizontal rule widget ─────────────────────────────────────────────────

class HrWidget extends WidgetType {
  toDOM() {
    const hr = document.createElement('hr');
    hr.className = 'md-hr';
    return hr;
  }
}

// ─── Node types we care about ────────────────────────────────────────────────

const HEADING_TYPES = new Set([
  'ATXHeading1', 'ATXHeading2', 'ATXHeading3',
  'ATXHeading4', 'ATXHeading5', 'ATXHeading6',
]);

const INLINE_MARK_TYPES: Record<string, string> = {
  StrongEmphasis: 'md-bold',
  Emphasis: 'md-italic',
  Strikethrough: 'md-strikethrough',
  InlineCode: 'md-inline-code',
};

// ─── Helper: is cursor on this line? ─────────────────────────────────────────

function cursorOnLine(view: EditorView, lineFrom: number, lineTo: number): boolean {
  const sel = view.state.selection;
  for (const range of sel.ranges) {
    const cursorLine = view.state.doc.lineAt(range.head);
    const nodeStartLine = view.state.doc.lineAt(lineFrom);
    const nodeEndLine = view.state.doc.lineAt(Math.min(lineTo, view.state.doc.length));
    if (cursorLine.number >= nodeStartLine.number && cursorLine.number <= nodeEndLine.number) {
      return true;
    }
  }
  return false;
}

function cursorInRange(view: EditorView, from: number, to: number): boolean {
  const sel = view.state.selection;
  for (const range of sel.ranges) {
    if (range.head >= from && range.head <= to) return true;
  }
  return false;
}

// ─── Build decorations ───────────────────────────────────────────────────────

function buildDecorations(view: EditorView): DecorationSet {
  const decorations: Range<Decoration>[] = [];
  const doc = view.state.doc;

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        const type = node.type.name;

        // ── Headings ──────────────────────────────────────────────
        if (HEADING_TYPES.has(type)) {
          const level = parseInt(type.slice(-1));
          const lineStart = doc.lineAt(node.from).from;
          const lineEnd = doc.lineAt(node.to).to;

          // Apply heading style to the whole line
          decorations.push(
            Decoration.line({ class: `md-h${level}` }).range(lineStart)
          );

          // Hide the "# " prefix when cursor is not on this line
          if (!cursorOnLine(view, node.from, node.to)) {
            // Find the HeaderMark child (the "###" part)
            let markEnd = node.from;
            const cursor = node.node.cursor();
            if (cursor.firstChild()) {
              do {
                if (cursor.type.name === 'HeaderMark') {
                  markEnd = cursor.to;
                  // Include the space after the mark
                  if (markEnd < doc.length && doc.sliceString(markEnd, markEnd + 1) === ' ') {
                    markEnd++;
                  }
                  break;
                }
              } while (cursor.nextSibling());
            }
            if (markEnd > node.from) {
              decorations.push(
                Decoration.replace({}).range(node.from, markEnd)
              );
            }
          }
          return false; // don't descend into heading children
        }

        // ── Bold / Italic / Strikethrough / Inline code ───────────
        if (type in INLINE_MARK_TYPES) {
          const className = INLINE_MARK_TYPES[type];

          decorations.push(
            Decoration.mark({ class: className }).range(node.from, node.to)
          );

          // Hide syntax marks when cursor is not in range
          if (!cursorInRange(view, node.from, node.to)) {
            const cursor = node.node.cursor();
            if (cursor.firstChild()) {
              do {
                const childType = cursor.type.name;
                if (
                  childType === 'EmphasisMark' ||
                  childType === 'StrikethroughMark' ||
                  childType === 'CodeMark'
                ) {
                  decorations.push(
                    Decoration.replace({}).range(cursor.from, cursor.to)
                  );
                }
              } while (cursor.nextSibling());
            }
          }
          return false;
        }

        // ── Links ─────────────────────────────────────────────────
        if (type === 'Link') {
          if (!cursorInRange(view, node.from, node.to)) {
            // Find link text and URL parts
            const cursor = node.node.cursor();
            let linkTextFrom = -1, linkTextTo = -1;
            let urlFrom = -1, urlTo = -1;

            if (cursor.firstChild()) {
              do {
                if (cursor.type.name === 'LinkMark') {
                  // [ or ] or ( or )
                  const mark = doc.sliceString(cursor.from, cursor.to);
                  if (mark === '[') linkTextFrom = cursor.to;
                  if (mark === ']') linkTextTo = cursor.from;
                }
                if (cursor.type.name === 'URL') {
                  urlFrom = cursor.from;
                  urlTo = cursor.to;
                }
              } while (cursor.nextSibling());
            }

            if (linkTextFrom >= 0 && linkTextTo >= 0) {
              // Style the link text
              decorations.push(
                Decoration.mark({ class: 'md-link' }).range(linkTextFrom, linkTextTo)
              );
              // Hide [ before text
              decorations.push(
                Decoration.replace({}).range(node.from, linkTextFrom)
              );
              // Hide ](url) after text
              if (urlTo >= 0) {
                decorations.push(
                  Decoration.replace({}).range(linkTextTo, node.to)
                );
              }
            }
          } else {
            // Cursor is in the link — just style it
            decorations.push(
              Decoration.mark({ class: 'md-link-raw' }).range(node.from, node.to)
            );
          }
          return false;
        }

        // ── Blockquotes ───────────────────────────────────────────
        if (type === 'Blockquote') {
          // Style each line in the blockquote
          const startLine = doc.lineAt(node.from);
          const endLine = doc.lineAt(Math.min(node.to, doc.length));
          for (let ln = startLine.number; ln <= endLine.number; ln++) {
            const line = doc.line(ln);
            decorations.push(
              Decoration.line({ class: 'md-blockquote' }).range(line.from)
            );
            // Hide the "> " prefix when cursor is not on the blockquote
            if (!cursorOnLine(view, node.from, node.to)) {
              const text = line.text;
              const match = text.match(/^>\s?/);
              if (match) {
                decorations.push(
                  Decoration.replace({}).range(line.from, line.from + match[0].length)
                );
              }
            }
          }
          return false;
        }

        // ── Horizontal rule ───────────────────────────────────────
        if (type === 'HorizontalRule') {
          if (!cursorOnLine(view, node.from, node.to)) {
            decorations.push(
              Decoration.replace({ widget: new HrWidget() }).range(node.from, node.to)
            );
          }
        }

        // ── Task list items ───────────────────────────────────────
        if (type === 'TaskMarker') {
          const text = doc.sliceString(node.from, node.to);
          const checked = text.includes('x') || text.includes('X');
          // Find the start of the line to include "- " or "* " prefix
          const line = doc.lineAt(node.from);
          const lineText = line.text;
          const prefixMatch = lineText.match(/^(\s*[-*+]\s)/);
          const replaceFrom = prefixMatch ? line.from + prefixMatch.index! : node.from;

          // Only show raw syntax when cursor is in the prefix/marker area
          if (!cursorInRange(view, replaceFrom, node.to)) {
            decorations.push(
              Decoration.replace({ widget: new CheckboxWidget(checked) }).range(
                replaceFrom,
                node.to
              )
            );
          }
        }
      },
    });
  }

  // Sort decorations by position (required by CM6)
  decorations.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);

  return Decoration.set(decorations, true);
}

// ─── Plugin ──────────────────────────────────────────────────────────────────

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        update.selectionSet
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

// ─── Toggle task hotkey ──────────────────────────────────────────────────────

function toggleTask(view: EditorView): boolean {
  const { state } = view;
  const changes: { from: number; to: number; insert: string }[] = [];

  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.head);
    const text = line.text;

    // Already a checked task: toggle to unchecked
    if (/^\s*[-*+]\s\[x\]\s/.test(text)) {
      const match = text.match(/^(\s*[-*+]\s)\[x\](\s)/);
      if (match) {
        const start = line.from + match[1].length;
        changes.push({ from: start, to: start + 3, insert: '[ ]' });
      }
    }
    // Already an unchecked task: toggle to checked
    else if (/^\s*[-*+]\s\[\s\]\s/.test(text)) {
      const match = text.match(/^(\s*[-*+]\s)\[ \](\s)/);
      if (match) {
        const start = line.from + match[1].length;
        changes.push({ from: start, to: start + 3, insert: '[x]' });
      }
    }
    // A list item without task: add checkbox
    else if (/^\s*[-*+]\s/.test(text)) {
      const match = text.match(/^(\s*[-*+]\s)/);
      if (match) {
        const insertAt = line.from + match[0].length;
        changes.push({ from: insertAt, to: insertAt, insert: '[ ] ' });
      }
    }
    // Plain line: make it a task
    else {
      const match = text.match(/^(\s*)/);
      const indent = match ? match[0].length : 0;
      changes.push({
        from: line.from + indent,
        to: line.from + indent,
        insert: '- [ ] ',
      });
    }
  }

  if (changes.length > 0) {
    view.dispatch({ changes });
    return true;
  }
  return false;
}

const taskKeymap = Prec.highest(keymap.of([
  { key: 'Mod-Enter', run: toggleTask },
]));

// ─── Combined export ─────────────────────────────────────────────────────────

export const markdownLivePreview = [livePreviewPlugin, taskKeymap];
