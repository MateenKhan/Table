// Interior vertical — an example domain vertical (interior-design sizes).
//
// Each profile is an interior element. Sizes (length/width/height, in mm) are the
// shared dimensions every element has; profile-specific columns append after them.
// Images come later.

import { Vertical } from './types'

const DIMENSIONS = [
  { id: 'length', header: 'Length', type: 'number' as const, defaultValue: 0 },
  { id: 'width', header: 'Width', type: 'number' as const, defaultValue: 0 },
  { id: 'height', header: 'Height', type: 'number' as const, defaultValue: 0 },
]

export const interiorVertical: Vertical = {
  id: 'interior',
  name: 'Interior',
  subdomain: 'interior',
  defaultSelected: ['cupboard'],
  profiles: [
    {
      id: 'cupboard',
      name: 'Cupboard',
      rows: 3,
      columns: [
        ...DIMENSIONS,
        { id: 'shelves', header: 'Shelves', type: 'number', defaultValue: 4 },
        { id: 'material', header: 'Material', type: 'text', defaultValue: 'Plywood' },
      ],
    },
    {
      id: 'table',
      name: 'Table',
      rows: 2,
      columns: [
        ...DIMENSIONS,
        { id: 'seats', header: 'Seats', type: 'number', defaultValue: 4 },
      ],
    },
    {
      id: 'bed',
      name: 'Bed',
      rows: 2,
      columns: [
        ...DIMENSIONS,
        { id: 'bedSize', header: 'Size', type: 'text', defaultValue: 'Queen' },
      ],
    },
  ],
}
