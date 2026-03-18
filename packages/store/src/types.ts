export interface DocumentState<T = any> {
  content: T | undefined;
  status: "pending" | "fulfilled" | "rejected";
  error?: string;
  lastFetched?: number;
}

export interface StoreState {
  documents: {
    [modelType: string]: {
      [id: string]: DocumentState;
    };
  };
}

export interface DocumentPromise<T> {
  content: T | undefined;
  isPending: boolean;
  isSettled: boolean;
  isRejected: boolean;
  isFulfilled: boolean;
}

export interface DocumentTypes {
  [key: string]: any;
}

export interface FetchHandler {
  (modelType: string, id: string | number): Promise<any>;
}
