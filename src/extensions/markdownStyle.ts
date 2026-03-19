import {
  ViewPlugin,
  ViewUpdate,
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { Range, EditorState, EditorSelection } from '@codemirror/state';

// NOTE: Bold/italic (Mod-b, Mod-i) and line move (Alt-Arrow, Shift-Alt-Arrow)
// keybindings are defined in Editor.tsx to avoid duplicate Prec.highest() conflicts.

// ─── Checkbox widget ────────────────────────────────────────────────────────

type CheckboxState = 'unchecked' | 'checked' | 'wontdo';

class CheckboxWidget extends WidgetType {
  constructor(readonly state: CheckboxState, readonly pos: number) {
    super();
  }
  toDOM(view: EditorView) {
    const span = document.createElement('span');
    span.className = `md-checkbox ${this.state === 'checked' ? 'md-checkbox--checked' : this.state === 'wontdo' ? 'md-checkbox--wontdo' : ''}`;
    const box = document.createElement('span');
    box.className = 'md-checkbox-box';
    if (this.state === 'checked') {
      box.textContent = '✓';
    } else if (this.state === 'wontdo') {
      box.textContent = '—';
    }
    span.appendChild(box);
    // Click to cycle: unchecked → checked → won't do → unchecked
    span.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const line = view.state.doc.lineAt(this.pos);
      const text = line.text;
      const match = text.match(/^(\s*[-*+]\s)\[[ xX\-]\]/);
      if (match) {
        const from = line.from + match[1].length;
        const next = this.state === 'unchecked' ? '[x]'
                   : this.state === 'checked' ? '[-]'
                   : '[ ]';
        view.dispatch({ changes: { from, to: from + 3, insert: next } });
      }
    });
    return span;
  }
  eq(other: CheckboxWidget) {
    return this.state === other.state && this.pos === other.pos;
  }
}

// ─── Horizontal rule widget ─────────────────────────────────────────────────

class HrWidget extends WidgetType {
  toDOM() {
    const span = document.createElement('span');
    span.className = 'md-hr';
    return span;
  }
}

// ─── Image widget ───────────────────────────────────────────────────────────

class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string) {
    super();
  }
  toDOM() {
    const wrapper = document.createElement('div');
    wrapper.className = 'md-image-wrapper';
    const img = document.createElement('img');
    img.className = 'md-image';
    img.src = this.src;
    img.alt = this.alt;
    img.onerror = () => { wrapper.style.display = 'none'; };
    wrapper.appendChild(img);
    if (this.alt) {
      const caption = document.createElement('span');
      caption.className = 'md-image-caption';
      caption.textContent = this.alt;
      wrapper.appendChild(caption);
    }
    return wrapper;
  }
  eq(other: ImageWidget) {
    return this.src === other.src && this.alt === other.alt;
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
            let urlTo = -1;

            if (cursor.firstChild()) {
              do {
                if (cursor.type.name === 'LinkMark') {
                  // [ or ] or ( or )
                  const mark = doc.sliceString(cursor.from, cursor.to);
                  if (mark === '[') linkTextFrom = cursor.to;
                  if (mark === ']') linkTextTo = cursor.from;
                }
                if (cursor.type.name === 'URL') {
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

        // ── Fenced code blocks ────────────────────────────────────
        if (type === 'FencedCode') {
          const startLine = doc.lineAt(node.from);
          const endLine = doc.lineAt(Math.min(node.to, doc.length));
          for (let ln = startLine.number; ln <= endLine.number; ln++) {
            const line = doc.line(ln);
            decorations.push(
              Decoration.line({ class: 'md-code-block' }).range(line.from)
            );
          }
          // Hide ``` fences when cursor is not in the block
          if (!cursorInRange(view, node.from, node.to)) {
            // Hide opening fence line
            decorations.push(
              Decoration.replace({}).range(startLine.from, startLine.to + 1)
            );
            // Hide closing fence line (if it exists and is different from start)
            if (endLine.number > startLine.number) {
              const closingFrom = endLine.from > 0 ? endLine.from - 1 : endLine.from;
              decorations.push(
                Decoration.replace({}).range(closingFrom, endLine.to)
              );
            }
          }
          return false;
        }

        // ── Images ────────────────────────────────────────────────
        if (type === 'Image') {
          if (!cursorInRange(view, node.from, node.to)) {
            const text = doc.sliceString(node.from, node.to);
            const match = text.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
            if (match) {
              const [, alt, src] = match;
              decorations.push(
                Decoration.replace({ widget: new ImageWidget(src, alt) }).range(
                  node.from,
                  node.to
                )
              );
            }
          } else {
            decorations.push(
              Decoration.mark({ class: 'md-link-raw' }).range(node.from, node.to)
            );
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
          const cbState: CheckboxState = (text.includes('x') || text.includes('X')) ? 'checked' : 'unchecked';
          const line = doc.lineAt(node.from);
          const lineText = line.text;
          const prefixMatch = lineText.match(/^(\s*)([-*+]\s)/);
          const replaceFrom = prefixMatch ? line.from + prefixMatch[1].length : node.from;

          // Only show raw syntax when cursor is inside the prefix/marker area
          if (!cursorInRange(view, replaceFrom, node.to)) {
            decorations.push(
              Decoration.replace({ widget: new CheckboxWidget(cbState, node.from) }).range(
                replaceFrom,
                node.to
              )
            );
          }
        }
      },
    });
  }

  // ── "Won't do" checkbox: [-] is not recognized by the Lezer parser,
  //    so we scan visible lines manually for this pattern.
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos < to;) {
      const line = doc.lineAt(pos);
      const match = line.text.match(/^(\s*)([-*+]\s)\[-\](\s)/);
      if (match) {
        const replaceFrom = line.from + match[1].length;
        const replaceTo = line.from + match[1].length + match[2].length + 3; // "- " + "[-]"
        if (!cursorInRange(view, replaceFrom, replaceTo)) {
          decorations.push(
            Decoration.replace({ widget: new CheckboxWidget('wontdo', line.from + match[1].length + match[2].length) }).range(
              replaceFrom,
              replaceTo
            )
          );
        }
        // Strikethrough + dim the text on won't-do lines
        decorations.push(
          Decoration.line({ class: 'md-task-wontdo' }).range(line.from)
        );
      }
      pos = line.to + 1;
    }
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
      if (update.docChanged || update.viewportChanged || update.selectionSet) {
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
  let cursorOffset = 0;

  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.head);
    const text = line.text;

    // Already a checked task: cycle to won't do
    if (/^\s*[-*+]\s\[x\]\s/i.test(text)) {
      const match = text.match(/^(\s*[-*+]\s)\[x\](\s)/i);
      if (match) {
        const start = line.from + match[1].length;
        changes.push({ from: start, to: start + 3, insert: '[-]' });
      }
    }
    // Won't do task: cycle to unchecked
    else if (/^\s*[-*+]\s\[-\]\s/.test(text)) {
      const match = text.match(/^(\s*[-*+]\s)\[-\](\s)/);
      if (match) {
        const start = line.from + match[1].length;
        changes.push({ from: start, to: start + 3, insert: '[ ]' });
      }
    }
    // Unchecked task: cycle to checked
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
        cursorOffset = 4; // "[ ] " length
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
      cursorOffset = 6; // "- [ ] " length
    }
  }

  if (changes.length > 0) {
    const head = state.selection.main.head;
    view.dispatch({
      changes,
      selection: { anchor: head + cursorOffset },
    });
    return true;
  }
  return false;
}

// ─── Auto-continue lists on Enter ────────────────────────────────────────────

function continueList(view: EditorView): boolean {
  const { state } = view;
  const changes: { from: number; to: number; insert: string }[] = [];
  const sels: { anchor: number }[] = [];

  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.head);
    const text = line.text;

    // Match list prefixes: "- [ ] ", "- [x] ", "- [-] ", "- ", "* ", "+ ", "1. ", "2. " etc.
    const taskMatch = text.match(/^(\s*)([-*+])\s\[[ xX\-]\]\s(.*)$/);
    const bulletMatch = text.match(/^(\s*)([-*+])\s(.*)$/);
    const orderedMatch = text.match(/^(\s*)(\d+)\.\s(.*)$/);

    const match = taskMatch || bulletMatch || orderedMatch;
    if (!match) return false;

    const [fullMatch, indent, marker, content] = match;

    // Only continue list if cursor is after the prefix (not at the start of the line)
    const prefixLen = fullMatch.length - content.length;
    const cursorCol = range.head - line.from;
    if (cursorCol < prefixLen) return false;

    // If the current line is an empty list item, remove the prefix instead
    if (!content.trim()) {
      changes.push({ from: line.from, to: line.to, insert: '' });
      sels.push({ anchor: line.from });
      continue;
    }

    let prefix: string;
    if (taskMatch) {
      prefix = `${indent}${marker} [ ] `;
    } else if (orderedMatch) {
      prefix = `${indent}${parseInt(marker) + 1}. `;
    } else {
      prefix = `${indent}${marker} `;
    }

    const insert = '\n' + prefix;
    changes.push({ from: range.head, to: range.head, insert });
    sels.push({ anchor: range.head + insert.length });
  }

  if (changes.length > 0) {
    view.dispatch({
      changes,
      selection: { anchor: sels[0].anchor },
    });
    return true;
  }
  return false;
}

// ─── Tab indent / Shift+Tab outdent for lists ────────────────────────────────

function indentList(view: EditorView): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  if (/^\s*[-*+\d]/.test(line.text)) {
    const indent = '    ';
    view.dispatch({
      changes: { from: line.from, to: line.from, insert: indent },
      selection: { anchor: state.selection.main.head + indent.length },
    });
    return true;
  }
  return false;
}

function outdentList(view: EditorView): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const maxRemove = 4;
  const match = line.text.match(new RegExp(`^( {1,${maxRemove}})`));
  if (match && /^\s*[-*+\d]/.test(line.text)) {
    const removeLen = match[1].length;
    view.dispatch({
      changes: { from: line.from, to: line.from + removeLen, insert: '' },
      selection: { anchor: Math.max(line.from, state.selection.main.head - removeLen) },
    });
    return true;
  }
  return false;
}

// Exported for use in Editor.tsx's consolidated keymap
export { toggleTask, continueList, indentList, outdentList };

// ─── Snap cursor past checkbox prefix ────────────────────────────────────────

const snapCursorPastCheckbox = EditorState.transactionFilter.of((tr) => {
  // Only snap on cursor movement, not on edits
  if (!tr.selection || !tr.isUserEvent('select')) return tr;
  if (tr.docChanged) return tr;

  const doc = tr.newDoc;
  const oldDoc = tr.startState.doc;
  let modified = false;
  const ranges = tr.selection.ranges.map((range, i) => {
    if (!range.empty) return range;

    // Only snap when the cursor changed lines (up/down arrow, click, etc.)
    // Allow left/right arrow to enter prefix area to reveal raw markdown
    const oldRange = tr.startState.selection.ranges[i];
    if (oldRange) {
      const oldLine = oldDoc.lineAt(oldRange.head).number;
      const newLine = doc.lineAt(range.head).number;
      if (oldLine === newLine) return range; // Same line = left/right movement, don't snap
    }

    const line = doc.lineAt(range.head);
    const text = line.text;
    const match = text.match(/^(\s*)([-*+]\s\[[ xX\-]\]\s)/);
    if (match) {
      const indentLen = match[1].length;
      const prefixEnd = line.from + indentLen + match[2].length;
      // When changing lines onto a checkbox line, always snap to text start
      modified = true;
      return EditorSelection.cursor(prefixEnd);
    }
    return range;
  });

  if (!modified) return tr;
  return [tr, { selection: EditorSelection.create(ranges) }];
});

// ─── Combined export ─────────────────────────────────────────────────────────

export const markdownLivePreview = [livePreviewPlugin, snapCursorPastCheckbox];
