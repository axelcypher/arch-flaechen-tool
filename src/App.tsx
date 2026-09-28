import { lazy, Suspense, useEffect } from 'react';
import { Canvas } from './components/Canvas';
import { ExcelDialog } from './components/ExcelDialog';
import { Properties } from './components/Properties';
import { Report } from './components/Report';
import { Sidebar } from './components/Sidebar';
import { Toolbar } from './components/Toolbar';
import { useEditor } from './store/store';

const View3D = lazy(() => import('./components/View3D'));

export function App() {
  const reportOpen = useEditor((s) => s.reportOpen);
  const excelOpen = useEditor((s) => s.excelOpen);
  const mainView = useEditor((s) => s.mainView);
  const setMainView = useEditor((s) => s.setMainView);
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
          <div className="view-switch">
            <button className={mainView === '2d' ? 'active' : ''} onClick={() => setMainView('2d')}>
              Grundriss
            </button>
            <button className={mainView === '3d' ? 'active' : ''} onClick={() => setMainView('3d')}>
              3D
            </button>
          </div>
          <div className={mainView === '2d' ? 'view-pane' : 'view-pane hidden'}>
            <Canvas />
          </div>
          {mainView === '3d' && (
            <div className="view-pane">
              <Suspense fallback={<p className="busy view-loading">3D-Ansicht wird geladen …</p>}>
                <View3D />
              </Suspense>
            </div>
          )}
        </main>
        <Properties />
      </div>
      {reportOpen && <Report />}
      {excelOpen && <ExcelDialog />}
    </div>
  );
}
