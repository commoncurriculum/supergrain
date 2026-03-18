export interface DocumentState<T = any> {
  content: T | undefined;
  status: "pending" | "fulfilled" | "rejected";
  error?: string;
  lastFetched?: number;
}

export interface StoreState {
  documents: Record<string, Record<string, DocumentState>>;
}

export interface DocumentPromise<T> {
  content: T | undefined;
  error: string | undefined;
  isPending: boolean;
  isSettled: boolean;
  isRejected: boolean;
  isFulfilled: boolean;
}

export type DocumentTypes = Record<string, any>;

export type FetchHandler = (modelType: string, id: string | number) => Promise<any>;
