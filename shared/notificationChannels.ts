export const NOTIFICATIONS = {
  // Client -> Server
  FILE_EVENT: 'mago/fileEvent',

  // Server -> Client
  DIAGNOSTICS_UPDATE: 'mago/diagnosticsUpdate',
  STATUS_UPDATE: 'mago/statusUpdate',
  ERROR_OCCURRED: 'mago/errorOccurred',
} as const;

export type NotificationType = typeof NOTIFICATIONS[keyof typeof NOTIFICATIONS];
