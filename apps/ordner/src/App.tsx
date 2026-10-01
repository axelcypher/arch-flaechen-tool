import { useEffect, useState } from 'react';
import { LogDialog } from '@core/ui/LogDialog';
import { TitleBar } from '@core/ui/TitleBar';
import { NeuView } from './components/NeuView';
import { PruefView } from './components/PruefView';
import { StrukturView } from './components/StrukturView';
import { ordnerName } from './plan';
import { useOrdner } from './store';

type Ansicht = 'neu' | 'pruefen' | 'struktur';

const ANSICHTEN: { id: Ansicht; label: string; title: string }[] = [
  { id: 'neu', label: 'Neues Projekt', title: 'Stammdaten eingeben, Trockenlauf ansehen, Projektordner anlegen' },
  { id: 'pruefen', label: 'Ordner prüfen', title: 'Vorhandenen Projektordner mit der Struktur vergleichen – es wird nichts verschoben' },
  { id: 'struktur', label: 'Struktur', title: 'Ordnerbaum, Namensschemata und Vorlagen des Büros' },
];

export function App() {
  const stamm = useOrdner((s) => s.stamm);
  const struktur = useOrdner((s) => s.struktur);
  const [ansicht, setAnsicht] = useState<Ansicht>('neu');
  const [logOpen, setLogOpen] = useState(false);
  const name = ordnerName(stamm, struktur) || 'Neues Projekt';

  useEffect(() => {
    document.title = `${name} – Projektordner`;
  }, [name]);

  return (
    <div className="app">
      <TitleBar app="Projektordner" name={name} dirty={false} onOpenLog={() => setLogOpen(true)} />
      <div className="toolbar">
        <div className="tb-group">
          {ANSICHTEN.map((a) => (
            <button key={a.id} className={ansicht === a.id ? 'active' : ''} title={a.title} onClick={() => setAnsicht(a.id)}>
              {a.label}
            </button>
          ))}
        </div>
        <span className="muted small-text">Struktur: {struktur.name}</span>
      </div>
      <main className="po-main">
        {ansicht === 'neu' && <NeuView />}
        {ansicht === 'pruefen' && <PruefView onUebernommen={() => setAnsicht('neu')} />}
        {ansicht === 'struktur' && <StrukturView />}
      </main>
      {logOpen && <LogDialog onClose={() => setLogOpen(false)} />}
    </div>
  );
}
