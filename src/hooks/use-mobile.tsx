"use client"

import { useState, useEffect } from "react"

const MOBILE_BREAKPOINT = 768

// This hook is now safe for server-side rendering (SSR) in Next.js.
// It defaults to a non-mobile state on the server and on the initial client render,
// then determines the actual state on the client after hydration.
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkDevice = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }

    // Check on mount (after hydration)
    checkDevice()

    // Add resize listener
    window.addEventListener("resize", checkDevice)

    // Cleanup listener on unmount
    return () => {
      window.removeEventListener("resize", checkDevice)
    }
  }, []) // The empty dependency array ensures this effect runs only once on the client.

  return isMobile
}
