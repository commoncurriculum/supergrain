import type { Route } from "./+types/not-found";

import { HomeLayout } from "fumadocs-ui/layouts/home";
import { DefaultNotFound } from "fumadocs-ui/layouts/home/not-found";

import { baseOptions } from "@/lib/layout.shared";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Not Found" }];
}

export default function NotFound() {
  return (
    <HomeLayout {...baseOptions()}>
      <DefaultNotFound />
    </HomeLayout>
  );
}
