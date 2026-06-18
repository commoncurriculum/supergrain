import type { Route } from './+types/home';
import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { Link } from 'react-router';
import { baseOptions } from '@/lib/layout.shared';

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'Supergrain — reactive state for React' },
    {
      name: 'description',
      content:
        'A reactive store library for React with super fine-grained reactivity. Mutate state directly; re-render only the leaf that changed.',
    },
  ];
}

export default function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <main className="flex flex-1 flex-col items-center justify-center px-4 py-24 text-center">
        <p className="mb-3 text-sm font-medium text-fd-muted-foreground">
          Reactive state for React
        </p>
        <h1 className="mb-4 max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl">
          Mutate state directly. Re-render only the leaf that changed.
        </h1>
        <p className="mb-8 max-w-2xl text-fd-muted-foreground">
          Supergrain gives you plain objects with super fine-grained reactivity —
          no reducers, no selectors, no ceremony.
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <Link
            className="rounded-full bg-fd-primary px-5 py-2.5 text-sm font-medium text-fd-primary-foreground"
            to="/docs"
          >
            Get started
          </Link>
          <a
            className="rounded-full border px-5 py-2.5 text-sm font-medium"
            href="https://github.com/commoncurriculum/supergrain"
          >
            GitHub
          </a>
        </div>
      </main>
    </HomeLayout>
  );
}
