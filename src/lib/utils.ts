import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Prevents Radix focus restoration that can leave the app unresponsive after nested overlays close. */
export function preventRadixAutoFocus(event: Event) {
  event.preventDefault()
}

/**
 * Nested Dialog + AlertDialog (or DropdownMenu + Dialog) can leave
 * `pointer-events: none` on <body> after the top overlay closes.
 * Call after closing a nested modal while another remains open.
 */
export function releaseRadixPointerLock() {
  requestAnimationFrame(() => {
    document.body.style.pointerEvents = ''
    if (document.body.hasAttribute('data-scroll-locked')) {
      // Keep scroll lock if a parent modal is still open; only clear stuck pointer-events.
    }
  })
}

/** Use on DropdownMenuItem when opening a Dialog/AlertDialog from a menu item. */
export function openDialogFromMenu(handler: () => void) {
  return (event: Event) => {
    event.preventDefault()
    handler()
  }
}
