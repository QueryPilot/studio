/**
 * Export secure stores
 * These stores use encrypted backend storage
 * No sensitive data is stored in localStorage or sessionStorage
 */

// Export the secure stores as the default stores
export { useSecureConnectionStore as useConnectionStore } from './secureConnectionStore';
export { useSecureQueryStore as useQueryStore } from './secureQueryStore';

// Also export with explicit secure names for clarity
export { useSecureConnectionStore } from './secureConnectionStore';
export { useSecureQueryStore } from './secureQueryStore';

// Export UI store
export { useUIStore } from './uiStore';

// Export types
export type { QueryHistoryItem, SavedQuery } from './secureQueryStore';