// src/services/mammoth/deepseekClient.ts
//
// ** This file is now a thin re-export shim. **
// The real implementation lives in src/providers/deepseekProvider.ts.
// These re-exports preserve backwards compatibility for any code that
// still imports from the old path.

export { 
  getDeepSeekProvider as getMammothDeepSeekClient, 
  resetDeepSeekProvider as resetMammothClient, 
  DeepSeekProvider as DeepSeekClient,
  DeepSeekAPIError,
  anthropicMessagesToDSML,
  deepseekToAnthropicResponse,
} from '../providers/deepseekProvider.js';
