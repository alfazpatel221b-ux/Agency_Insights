
"use client"

import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-[#0A0A0A] group-[.toaster]:text-[#FFFFFF] group-[.toaster]:border-[#121212] group-[.toaster]:rounded-none group-[.toaster]:font-mono group-[.toaster]:shadow-[8px_8px_0px_rgba(18,18,18,1)]",
          description: "group-[.toast]:text-neutral-400",
          actionButton:
            "group-[.toast]:bg-[#002FA7] group-[.toast]:text-white",
          cancelButton:
            "group-[.toast]:bg-neutral-800 group-[.toast]:text-neutral-400",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
