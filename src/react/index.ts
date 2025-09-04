import { DocumentStore } from '../core/store'

export class NotImplementedError extends Error {
  constructor(message = 'Not implemented') {
    super(message)
    this.name = 'NotImplementedError'
  }
}

export function useDocument<T>(
  store: DocumentStore,
  type: string,
  id: string
): T | null {
  throw new NotImplementedError()
}
