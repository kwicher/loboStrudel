// Shared header for panel content (Sounds/Files/Export/Console/Settings/
// Reference/Welcome). Panels no longer have their own in-panel tab row --
// navigation lives in AppSidebar.jsx now -- so every panel needs a small,
// consistent "what am I looking at + how do I close it" header instead of
// jumping straight into raw content, which is what made everything read as
// flat "text mode."
import { XMarkIcon } from '@heroicons/react/16/solid';
import cx from '@src/cx.mjs';
import { setIsPanelOpened } from '../../../settings.mjs';

export function PanelHeader({ title, subtitle, children, className }) {
  return (
    <div
      className={cx(
        'flex items-center justify-between gap-2 px-3 h-10 min-h-10 border-b border-muted bg-lineHighlight',
        className,
      )}
    >
      <div className="flex items-baseline gap-2 min-w-0">
        <h2 className="text-sm font-semibold text-foreground truncate">{title}</h2>
        {subtitle && <span className="text-xs opacity-50 truncate">{subtitle}</span>}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {children}
        <button
          onClick={() => setIsPanelOpened(false)}
          className="p-1 text-foreground hover:opacity-50"
          aria-label="Close panel"
        >
          <XMarkIcon className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
