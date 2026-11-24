import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@skalahq/draw/styles.css";
import "./editor.css";

export const metadata: Metadata = { title: "Draw — First canvas", description: "Edit a canvas with Draw." };

export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
