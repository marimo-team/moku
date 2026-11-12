import * as React from "react";
import type * as Document from "@moku/editor/Document";

export const DocumentContext = React.createContext<Document.Interface | null>(null);

export function useDocument() {
  const document = React.useContext(DocumentContext);
  if (!document) throw new Error("An editor must belong to an open notebook.");
  return document;
}
