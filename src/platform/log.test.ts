import { describe, expect, it } from 'vitest';
import { clearLog, getEntries, logger, logText, setDebugEnabled } from './log';

describe('Protokoll', () => {
  it('schreibt Einträge mit Bereich, Daten und Fehlern; Debug nur wenn aktiviert', () => {
    clearLog();
    const log = logger('test');
    log.debug('unsichtbar');
    log.info('Start', { a: 1, bytes: new Uint8Array(3) });
    log.error('kaputt', new Error('Boom'));
    setDebugEnabled(true);
    log.debug('sichtbar');
    setDebugEnabled(false);
    expect(getEntries().map((e) => `${e.level}:${e.message}`)).toEqual(['info:Start', 'error:kaputt', 'debug:sichtbar']);
    expect(getEntries()[0].data).toBe('{"a":1,"bytes":"<3 Bytes>"}');
    expect(logText()).toMatch(/ERROR \[test\] kaputt\n {4}Error: Boom/);
  });
});
