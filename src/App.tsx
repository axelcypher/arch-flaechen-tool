import { useEffect } from 'react';
import { Canvas } from './components/Canvas';
import { ExcelDialog } from './components/ExcelDialog';
import { Properties } from './components/Properties';
import { Report } from './components/Report';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { useEditor } from './store/store';

export function App() {
  const reportOpen = useEditor((s) => s.reportOpen);
  const excelOpen = useEditor((s) => s.excelOpen);
  const name = useEditor((s) => s.project.name);
  const dirty = useEditor((s) => s.dirty);

  useEffect(() => {
    document.title = `${dirty ? '• ' : ''}${name} – Flächenrechner`;
  }, [name, dirty]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useEditor.getState().dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  return (
    <div className="app">
      <Toolbar />
      <div className="workspace">
        <Sidebar />
        <main className="main">
          <Canvas />
        </main>
        <Properties />
      </div>
      {reportOpen && <Report />}
      {excelOpen && <ExcelDialog />}
    </div>
  );
}
