'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { colorTransition, focusRing } from '@/app/ui';

export type MenuAction = {
  label: string;
  /** Gets the ⋮ button, which should get focus back when whatever this opens closes. */
  onSelect: (trigger: HTMLButtonElement) => void;
  disabled?: boolean;
};

const itemsOf = (menu: HTMLElement) => [
  ...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'),
];

/**
 * A ⋮ button with a menu of actions. The menu is a popover, so it shows in the top layer: a
 * table's scroll box can't clip it, and the browser closes it on Esc or a click elsewhere
 * and returns focus to the ⋮. It opens under the button and closes when the page scrolls.
 */
export function ActionsMenu({ label, actions }: { label: string; actions: MenuAction[] }) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    const menu = menuRef.current!;
    const close = () => menu.hidePopover();
    function onToggle(event: Event) {
      const opened = (event as ToggleEvent).newState === 'open';
      setOpen(opened);
      if (opened) {
        const box = triggerRef.current!.getBoundingClientRect();
        // Above the button when there's no room below it (the table's last rows).
        const fitsBelow = box.bottom + 4 + menu.offsetHeight <= window.innerHeight;
        menu.style.top = `${fitsBelow ? box.bottom + 4 : box.top - 4 - menu.offsetHeight}px`;
        menu.style.right = `${document.documentElement.clientWidth - box.right}px`;
        itemsOf(menu)[0]?.focus();
        window.addEventListener('scroll', close, { capture: true });
      } else {
        window.removeEventListener('scroll', close, { capture: true });
      }
    }
    menu.addEventListener('toggle', onToggle);
    return () => {
      menu.removeEventListener('toggle', onToggle);
      window.removeEventListener('scroll', close, { capture: true });
    };
  }, []);

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Tab') {
      menuRef.current!.hidePopover();
      return;
    }
    const list = itemsOf(menuRef.current!);
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const next = {
      ArrowDown: (at + 1) % list.length,
      ArrowUp: (at - 1 + list.length) % list.length,
      Home: 0,
      End: list.length - 1,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    list[next]?.focus();
  }

  function select(action: MenuAction) {
    menuRef.current!.hidePopover();
    action.onSelect(triggerRef.current!);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        popoverTarget={menuId}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            menuRef.current!.showPopover();
          }
        }}
        className={`inline-flex size-10 items-center justify-center rounded-button text-secondary hover:bg-raised hover:text-foreground ${colorTransition} ${focusRing}`}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className="size-5">
          <circle cx="12" cy="5" r="1.75" />
          <circle cx="12" cy="12" r="1.75" />
          <circle cx="12" cy="19" r="1.75" />
        </svg>
      </button>
      <div
        ref={menuRef}
        id={menuId}
        popover="auto"
        role="menu"
        aria-label={label}
        onKeyDown={onMenuKeyDown}
        className="fixed inset-auto m-0 min-w-40 rounded-input border border-strong bg-overlay p-1 text-foreground shadow-l4"
      >
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            role="menuitem"
            tabIndex={-1}
            disabled={action.disabled}
            onClick={() => select(action)}
            className={`flex w-full items-center rounded-input px-3 py-2 text-left text-body-sm whitespace-nowrap hover:bg-raised focus-visible:bg-raised disabled:cursor-not-allowed disabled:text-disabled-foreground ${colorTransition} ${focusRing}`}
          >
            {action.label}
          </button>
        ))}
      </div>
    </>
  );
}
