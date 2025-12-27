import { Connection } from 'vscode-languageserver';

export enum LogLevel {
  ERROR = 1,
  WARN = 2,
  INFO = 3,
  DEBUG = 4,
}

export class Logger {
  private connection: Connection;
  private level: LogLevel;

  constructor(connection: Connection, level: LogLevel = LogLevel.INFO) {
    this.connection = connection;
    this.level = level;
  }

  error(message: string, ...args: any[]): void {
    if (this.level >= LogLevel.ERROR) {
      this.connection.console.error(this.formatMessage('ERROR', message, args));
    }
  }

  warn(message: string, ...args: any[]): void {
    if (this.level >= LogLevel.WARN) {
      this.connection.console.warn(this.formatMessage('WARN', message, args));
    }
  }

  info(message: string, ...args: any[]): void {
    if (this.level >= LogLevel.INFO) {
      this.connection.console.info(this.formatMessage('INFO', message, args));
    }
  }

  debug(message: string, ...args: any[]): void {
    if (this.level >= LogLevel.DEBUG) {
      this.connection.console.log(this.formatMessage('DEBUG', message, args));
    }
  }

  private formatMessage(level: string, message: string, args: any[]): string {
    const timestamp = new Date().toISOString();
    const formattedArgs = args.length > 0 ? ` ${JSON.stringify(args)}` : '';
    return `[${timestamp}] [${level}] ${message}${formattedArgs}`;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }
}
