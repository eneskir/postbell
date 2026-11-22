import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { ReactNode } from "react";

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;
export const MenuRadioGroup = DropdownMenu.RadioGroup;

// Radix aligns the submenu to the trigger row, which sits inside the 4 px padding and 1 px border.
const SUB_SIDE = 9;
const SUB_ALIGN = -5;

type ContentProps = {
  readonly children: ReactNode;
  readonly sideOffset: number;
  readonly alignOffset: number;
  // Set focus here: while the menu is open its focus trap pulls focus back.
  readonly onCloseAutoFocus?: (e: Event) => void;
};

export function MenuContent({ children, sideOffset, alignOffset, onCloseAutoFocus }: ContentProps) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content className="menu" side="bottom" align="end" sideOffset={sideOffset} alignOffset={alignOffset} onCloseAutoFocus={onCloseAutoFocus}>
        {children}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  );
}

export function MenuItem({ children, danger = false, onSelect }: { children: ReactNode; danger?: boolean; onSelect: () => void }) {
  return (
    <DropdownMenu.Item className="menu-item" data-danger={danger || undefined} onSelect={onSelect}>
      <span className="menu-label">{children}</span>
    </DropdownMenu.Item>
  );
}

export function MenuSeparator() {
  return <DropdownMenu.Separator className="menu-separator" />;
}

export function MenuRadioItem({ value, children, onSelect }: { value: string; children: ReactNode; onSelect: () => void }) {
  return (
    <DropdownMenu.RadioItem className="menu-item" value={value} onSelect={onSelect}>
      <span className="menu-label">{children}</span>
      <DropdownMenu.ItemIndicator className="menu-check">✓</DropdownMenu.ItemIndicator>
    </DropdownMenu.RadioItem>
  );
}

export function SubMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <DropdownMenu.Sub>
      <DropdownMenu.SubTrigger className="menu-item">
        <span className="menu-label">{label}</span>
        <span className="menu-sub" aria-hidden="true">
          ▸
        </span>
      </DropdownMenu.SubTrigger>
      <DropdownMenu.Portal>
        <DropdownMenu.SubContent className="menu" sideOffset={SUB_SIDE} alignOffset={SUB_ALIGN}>
          {children}
        </DropdownMenu.SubContent>
      </DropdownMenu.Portal>
    </DropdownMenu.Sub>
  );
}
