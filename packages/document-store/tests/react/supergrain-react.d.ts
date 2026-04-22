declare module "@supergrain/react" {
  import type { ComponentType } from "react";

  export function tracked<T extends ComponentType<any>>(component: T): T;
}
