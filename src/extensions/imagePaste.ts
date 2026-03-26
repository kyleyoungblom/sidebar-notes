import { EditorView } from '@codemirror/view';
import { writeFile } from '@tauri-apps/plugin-fs';
import { noteDirectoryField } from './markdownStyle';

export const imagePasteHandler = EditorView.domEventHandlers({
  paste(event: ClipboardEvent, view: EditorView) {
    const items = event.clipboardData?.items;
    if (!items) return false;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        event.preventDefault();
        const blob = item.getAsFile();
        if (!blob) return true;

        const noteDir = view.state.field(noteDirectoryField, false);
        if (!noteDir) {
          console.warn('[imagePaste] No note directory available');
          return true;
        }

        const ext = item.type === 'image/jpeg' ? 'jpg' : 'png';
        const filename = `img-${Date.now()}.${ext}`;
        const normalDir = noteDir.replace(/\\/g, '/');
        const filePath = normalDir + '/' + filename;

        blob.arrayBuffer().then(async (buffer) => {
          try {
            await writeFile(filePath, new Uint8Array(buffer));
            console.log('[imagePaste] Saved image to', filePath);

            // Insert markdown image link at cursor
            const pos = view.state.selection.main.head;
            const mdLink = `![](${filename})`;
            view.dispatch({
              changes: { from: pos, to: pos, insert: mdLink },
              selection: { anchor: pos + mdLink.length },
            });
          } catch (e) {
            console.error('[imagePaste] Failed to save image:', e);
          }
        });

        return true;
      }
    }
    return false;
  },
});
