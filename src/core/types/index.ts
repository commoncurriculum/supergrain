// Core type definitions for document storage and retrieval

export interface Document {
  id: string
  [key: string]: any
}

export type DocumentType = string
export type DocumentId = string
export type DocumentKey = `${DocumentType}:${DocumentId}`
