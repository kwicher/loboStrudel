// The Grid's own independent playback engine -- a second, completely
// separate `webaudioRepl()` instance (the same primitive `@strudel/web`
// itself wraps), decoupled from the shared StrudelMirror editor instance
// that backs the main pattern editor/tabs (see useReplContext.jsx). The
// Grid used to evaluate its ephemeral combined buffer *through* that
// shared editor (editor.setCode() + editor.evaluate()), which meant it
// had to fight the main editor for the same visible text and the same
// scheduler -- see patternGrid.mjs's and GridTab.jsx's older comments,
// and the isGridEvaluating()/haltGrid() restore-hack this module makes
// unnecessary. With its own repl instance, the Grid never touches the
// main editor's buffer at all, and the two can legitimately play at the
// same time -- their webaudio output mixes together automatically since
// `webaudioRepl()` always resolves to the one shared, page-level
// AudioContext (see @strudel/webaudio's getAudioContext()).
//
// Known, deliberately-accepted limitation: @strudel/core's repl()
// registers a few values (current pattern, trigger function, cps getter)
// into module-level globals in schedulerState.mjs on every construction
// and evaluate -- so with two repl instances alive, whichever one
// evaluates most recently "wins" that global registration. The only
// consumer of those globals anywhere in the strudel packages is
// @strudel/midi (MIDI clock-out / trigger availability), which this app
// does use (see src/repl/util.mjs). Ordinary webaudio playback is
// unaffected -- repl.mjs's own scheduler reads getTime from its local
// options closure, never the global -- so this only matters if you rely
// on MIDI clock-out while the Grid and the main editor are both active;
// in that case, whichever side evaluated last is the one MIDI listens to.
import { webaudioRepl, initAudioOnFirstClick } from '@strudel/webaudio';
import { transpiler } from '@strudel/transpiler';

let _gridRepl;

// Lazy singleton: constructing a webaudioRepl() touches the shared
// AudioContext, so this waits until the Grid is actually used (first
// evaluate/stop/setCps call) rather than at module import time.
export function getGridRepl() {
  if (!_gridRepl) {
    _gridRepl = webaudioRepl({
      transpiler,
      // Same first-click audio-unlock gate the main editor's repl uses
      // (useReplContext.jsx) -- initAudioOnFirstClick is itself a module-
      // level singleton (superdough.mjs), so calling it again here with
      // no options just returns that same already-created promise; this
      // only matters the very first time either repl ever evaluates.
      beforeEval: () => initAudioOnFirstClick(),
    });
  }
  return _gridRepl;
}

// Keeps the main editor's and the Grid's tempo in sync by explicit
// design -- patternGrid.mjs's whole premise is "several tracks playing
// at once... under one shared tempo" (see its header comment), and that
// product intent doesn't go away just because playback is now split
// across two repl instances. Call this from both TempoControls (Panel.jsx
// and GridToolsPanel.jsx) instead of calling repl.setCps() directly on
// just one side.
export function setGlobalCps(cps, editorRepl) {
  editorRepl?.setCps(cps);
  getGridRepl().setCps(cps);
}
