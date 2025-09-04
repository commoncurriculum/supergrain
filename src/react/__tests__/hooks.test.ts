import { DocumentStore } from '../../core/store'
import { useDocument, useDocuments, useDocumentStore } from '../'
import { renderHook, act } from '@testing-library/react'

describe('useDocument', () => {
  it('should return null for a document that does not exist', () => {
    const store = new DocumentStore()
    const { result } = renderHook(() => useDocument(store, 'user', '1'))
    expect(result.current).toBeNull()
  })
})

describe('useDocuments', () => {
  it('should return an array of nulls for documents that do not exist', () => {
    const store = new DocumentStore()
    const { result } = renderHook(() => useDocuments(store, 'user', ['1', '2']))
    expect(result.current).toEqual([null, null])
  })
})

describe('useDocumentStore', () => {
  it('should return the document store', () => {
    const store = new DocumentStore()
    const { result } = renderHook(() => useDocumentStore(store))
    expect(result.current).toBe(store)
  })
})
