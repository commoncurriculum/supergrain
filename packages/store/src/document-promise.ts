import type { DocumentState, DocumentPromise } from './types'

export class DocumentPromiseImpl<T> implements DocumentPromise<T> {
  private documentState: () => DocumentState<T> | undefined

  constructor(documentState: () => DocumentState<T> | undefined) {
    this.documentState = documentState
  }

  get content(): T | undefined {
    return this.documentState()?.content
  }

  get isPending(): boolean {
    return this.documentState()?.status === 'pending'
  }

  get isSettled(): boolean {
    const status = this.documentState()?.status
    return status === 'fulfilled' || status === 'rejected'
  }

  get isRejected(): boolean {
    return this.documentState()?.status === 'rejected'
  }

  get isFulfilled(): boolean {
    return this.documentState()?.status === 'fulfilled'
  }
}
