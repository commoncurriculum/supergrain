// Setup file for React tests
// This file is loaded before any test files

import { expect } from 'vitest'
import * as matchers from '@vitest/browser/matchers'

expect.extend(matchers)

// Export to make this a module
export {}
