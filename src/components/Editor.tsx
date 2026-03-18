import ReactCodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { githubDark, githubLight } from '@uiw/codemirror-theme-github';
import { EditorView } from '@codemirror/view';
import { useStore } from '../store';
import { useAutoSave } from '../hooks/useAutoSave';
import { useNotes } from '../hooks/useNotes';

const extensions = [
  markdown({ base: markdownLanguage, codeLanguages: languages }),
  EditorView.lineWrapping,
];

export function Editor() {
  const {
    activeNoteId,
    activeNoteContent,
    saveState,
    config,
    setActiveNoteContent,
    setView,
  } = useStore();
  const { deleteNote } = useNotes();

  useAutoSave(activeNoteId, activeNoteContent);

  const theme = config.theme === 'light' ? githubLight : githubDark;

  const handleDelete = () => {
    if (activeNoteId && confirm('Delete this note?')) {
      deleteNote(activeNoteId);
    }
  };

  const noteTitle =
    activeNoteContent.split('\n')[0]?.replace(/^#+\s*/, '').trim() || 'Untitled';

  return (
    <div className="editor-view">
      <div className="editor-header">
        <button className="btn-icon" onClick={() => setView('list')} title="Back to list">
          ←
        </button>
        <span className="editor-title" title={noteTitle}>
          {noteTitle}
        </span>
        <div className="editor-actions">
          <span className={`save-state save-state--${saveState}`}>
            {saveState === 'saving' ? '●' : saveState === 'error' ? '!' : '✓'}
          </span>
          <button className="btn-icon btn-danger" onClick={handleDelete} title="Delete note">
            🗑
          </button>
        </div>
      </div>

      <div className="editor-body">
        <ReactCodeMirror
          value={activeNoteContent}
          onChange={setActiveNoteContent}
          extensions={extensions}
          theme={theme}
          height="100%"
          style={{ height: '100%', fontSize: '14px' }}
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
            highlightActiveLine: false,
            highlightSelectionMatches: true,
          }}
        />
      </div>
    </div>
  );
}
