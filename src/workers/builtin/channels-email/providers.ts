export interface EmailProviderPreset {
  name: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  imapHost: string;
  imapPort: number;
  helpText: string;
}

const PRESETS: Array<{ domains: string[]; preset: EmailProviderPreset }> = [
  {
    domains: ['gmail.com', 'googlemail.com'],
    preset: {
      name: 'Gmail',
      smtpHost: 'smtp.gmail.com',
      smtpPort: 587,
      smtpSecure: false,
      imapHost: 'imap.gmail.com',
      imapPort: 993,
      helpText:
        'Gmail requires an App Password (not your account password). First enable 2-Step Verification at myaccount.google.com → Security. Then go directly to myaccount.google.com/apppasswords, choose "Other (Custom name)", and copy the 16-digit password shown.',
    },
  },
  {
    domains: ['fastmail.com', 'fastmail.fm', 'fastmail.to', 'fastmail.net', 'fastmail.org'],
    preset: {
      name: 'Fastmail',
      smtpHost: 'smtp.fastmail.com',
      smtpPort: 587,
      smtpSecure: false,
      imapHost: 'imap.fastmail.com',
      imapPort: 993,
      helpText:
        'Fastmail requires an App Password. Go to Settings → Password & Security → Third-party app passwords.',
    },
  },
  {
    domains: ['icloud.com', 'me.com', 'mac.com'],
    preset: {
      name: 'iCloud',
      smtpHost: 'smtp.mail.me.com',
      smtpPort: 587,
      smtpSecure: false,
      imapHost: 'imap.mail.me.com',
      imapPort: 993,
      helpText:
        'iCloud requires an App-Specific Password. Go to appleid.apple.com → Sign-In and Security → App-Specific Passwords.',
    },
  },
  {
    domains: ['outlook.com', 'hotmail.com', 'live.com', 'msn.com'],
    preset: {
      name: 'Outlook / Hotmail',
      smtpHost: 'smtp-mail.outlook.com',
      smtpPort: 587,
      smtpSecure: false,
      imapHost: 'imap-mail.outlook.com',
      imapPort: 993,
      helpText:
        'Outlook accepts your regular password, but you may need to allow "Less secure apps" in your account settings if IMAP access is blocked.',
    },
  },
];

/** Returns a preset if the address domain matches a known provider, otherwise null. */
export function detectEmailProvider(emailAddress: string): EmailProviderPreset | null {
  const domain = emailAddress.split('@').pop()?.toLowerCase() ?? '';
  for (const { domains, preset } of PRESETS) {
    if (domains.includes(domain)) return preset;
  }
  return null;
}
