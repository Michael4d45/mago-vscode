export const REQUESTS = {
  // Client -> Server
  SCAN_FILE: 'mago/scanFile',
  SCAN_PROJECT: 'mago/scanProject',
  CLEAR_ERRORS: 'mago/clearErrors',
  GET_CONFIG: 'mago/getConfig',

  // Server -> Client (if needed)
  GET_FILE_CONTENT: 'mago/getFileContent',
} as const;

export type RequestType = typeof REQUESTS[keyof typeof REQUESTS];
