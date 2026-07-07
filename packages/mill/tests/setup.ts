import { afterAll, afterEach } from "vitest";

import { closeMongo, validateRecordedAgainstMongo } from "./mongo-oracle";

// Registered as a global setup file (see vitest.config.ts). After every test,
// replay any updates it recorded against real mongod; close the connection when
// the file finishes.
afterEach(async () => {
  await validateRecordedAgainstMongo();
});

afterAll(async () => {
  await closeMongo();
});
