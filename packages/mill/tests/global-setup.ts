import { MongoMemoryServer } from "mongodb-memory-server";

// Boot a single real `mongod` for the whole mill test run and hand its URI to
// every worker via `provide`/`inject`. mill's MongoDB compatibility is checked
// against this server on every mutating test (see ./mongo-oracle.ts), so the
// truth about "what does Mongo do here?" comes from Mongo, never from memory.

let server: MongoMemoryServer | undefined;

export default async function setup({
  provide,
}: {
  provide: (key: "millMongoUri", value: string) => void;
}): Promise<() => Promise<void>> {
  server = await MongoMemoryServer.create();
  provide("millMongoUri", server.getUri());
  return async () => {
    await server?.stop();
  };
}

declare module "vitest" {
  interface ProvidedContext {
    millMongoUri: string;
  }
}
