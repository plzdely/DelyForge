import { Logger } from '@nestjs/common';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export const MAILER = Symbol('MAILER');

/**
 * Development mailer: prints emails to the API console instead of sending them.
 *
 * shortcut: no real email provider yet — production needs an SMTP/API mailer (e.g. Postmark, SES) behind this same
 * interface before launch. In production this mailer refuses to send, so reset links never end up in server logs.
 */
export class ConsoleMailer implements Mailer {
  private readonly logger = new Logger('Mail');
  constructor(private readonly production: boolean) {}

  async send(mail: Mail): Promise<void> {
    if (this.production) throw new Error('No email provider is configured (see apps/api/src/mail/mailer.ts).');
    this.logger.log(`\n──── email to ${mail.to} ────\nSubject: ${mail.subject}\n\n${mail.text}\n──────────────────────────`);
  }
}

/** Captures emails in memory — used by tests. */
export class MemoryMailer implements Mailer {
  readonly sent: Mail[] = [];
  async send(mail: Mail): Promise<void> {
    this.sent.push(mail);
  }
}
